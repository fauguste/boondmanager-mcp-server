import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerResourceTools, mergeTechnicalData } from "./resources.js";
import * as boondClient from "../services/boond-client.js";

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

const WRITE_DT_TOOLS = [
  "boond_resources_technical_data_update",
  "boond_resources_reference_create",
  "boond_resources_reference_update",
  "boond_resources_reference_delete",
] as const;

describe("registerResourceTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
    vi.restoreAllMocks();
  });

  it("should register CRUD tools + 10 tab tools + 4 DT-write tools = 19 total", () => {
    registerResourceTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(19);
  });

  it("should register all CRUD tools", () => {
    registerResourceTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_resources_search");
    expect(names).toContain("boond_resources_get");
    expect(names).toContain("boond_resources_create");
    expect(names).toContain("boond_resources_update");
    expect(names).toContain("boond_resources_delete");
  });

  it("should register all 10 tab tools", () => {
    registerResourceTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_resources_information");
    expect(names).toContain("boond_resources_technical_data");
    expect(names).toContain("boond_resources_administrative");
    expect(names).toContain("boond_resources_advantages");
    expect(names).toContain("boond_resources_actions");
    expect(names).toContain("boond_resources_positionings");
    expect(names).toContain("boond_resources_projects");
    expect(names).toContain("boond_resources_times_reports");
    expect(names).toContain("boond_resources_expenses_reports");
    expect(names).toContain("boond_resources_absences_reports");
  });

  it("should register all 4 technical-data write tools", () => {
    registerResourceTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    for (const name of WRITE_DT_TOOLS) {
      expect(names).toContain(name);
    }
  });

  it("should register tab tools as readOnly and non-destructive", () => {
    registerResourceTools(server);
    const tabCalls = vi
      .mocked(server.registerTool)
      .mock.calls.filter(
        (c) =>
          typeof c[0] === "string" &&
          [
            "boond_resources_information",
            "boond_resources_technical_data",
            "boond_resources_administrative",
            "boond_resources_advantages",
            "boond_resources_actions",
            "boond_resources_positionings",
            "boond_resources_projects",
            "boond_resources_times_reports",
            "boond_resources_expenses_reports",
            "boond_resources_absences_reports",
          ].includes(c[0] as string)
      );

    expect(tabCalls).toHaveLength(10);
    for (const call of tabCalls) {
      const [, metadata] = call;
      expect(metadata.annotations?.readOnlyHint).toBe(true);
      expect(metadata.annotations?.destructiveHint).toBe(false);
    }
  });

  it("flags reference_delete as destructive and the other DT writes as non-destructive", () => {
    registerResourceTools(server);
    const byName = new Map(vi.mocked(server.registerTool).mock.calls.map((c) => [c[0] as string, c[1]]));
    expect(byName.get("boond_resources_technical_data_update")?.annotations?.destructiveHint).toBe(false);
    expect(byName.get("boond_resources_reference_create")?.annotations?.destructiveHint).toBe(false);
    expect(byName.get("boond_resources_reference_update")?.annotations?.destructiveHint).toBe(false);
    expect(byName.get("boond_resources_reference_delete")?.annotations?.destructiveHint).toBe(true);
  });

  describe("boond_resources_technical_data_update handler", () => {
    function getHandler() {
      registerResourceTools(server);
      const call = vi
        .mocked(server.registerTool)
        .mock.calls.find((c) => c[0] === "boond_resources_technical_data_update");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return call![2] as any;
    }

    it("fetches current DT then PUTs the merged payload in merge mode", async () => {
      const apiSpy = vi.spyOn(boondClient, "apiRequest").mockImplementation(async (path, method) => {
        if (method === undefined || method === "GET") {
          return {
            data: {
              id: "42",
              type: "resource",
              attributes: {
                skills: "Python, Java",
                tools: [{ tool: "aws", level: 3 }],
                languages: [{ language: "Anglais", level: "courant" }],
                title: "BU Manager",
                summary: "Old summary",
                experience: 5,
                expertiseAreas: ["Banque"],
                diplomas: ["DUT Informatique"],
              },
            },
          } as never;
        }
        return { data: { id: "42", type: "resource", attributes: {} } } as never;
      });

      const handler = getHandler();
      await handler({
        id: "42",
        mode: "merge",
        skills: "Java, TensorFlow",
        tools: [
          { tool: "aws", level: 1 },
          { tool: "snowflake", level: 4 },
        ],
        languages: [
          { language: "anglais", level: "scolaire" },
          { language: "Espagnol", level: "courant" },
        ],
        expertiseAreas: ["Banque", "Assurance"],
        diplomas: ["DUT Informatique", "Master IA (2018)"],
        title: "ignored because already set",
        summary: "ignored because already set",
        experience: 99,
      });

      expect(apiSpy).toHaveBeenCalledTimes(2);
      const putCall = apiSpy.mock.calls.find((c) => c[1] === "PUT");
      expect(putCall).toBeDefined();
      const putPath = putCall![0];
      const putBody = putCall![2] as { data: { id: string; type: string; attributes: Record<string, unknown> } };

      expect(putPath).toBe("/resources/42/technical-data");
      expect(putBody.data.type).toBe("resource");
      expect(putBody.data.id).toBe("42");

      const attrs = putBody.data.attributes;
      expect(attrs.skills).toBe("Python, Java, TensorFlow");
      expect(attrs.tools).toEqual([
        { tool: "aws", level: 3 },
        { tool: "snowflake", level: 4 },
      ]);
      expect(attrs.languages).toEqual([
        { language: "Anglais", level: "courant" },
        { language: "Espagnol", level: "courant" },
      ]);
      expect(attrs.expertiseAreas).toEqual(["Banque", "Assurance"]);
      expect(attrs.diplomas).toEqual(["DUT Informatique", "Master IA (2018)"]);
      expect(attrs.title).toBeUndefined();
      expect(attrs.summary).toBeUndefined();
      expect(attrs.experience).toBeUndefined();
    });

    it("PUTs the raw payload directly in replace mode (no GET)", async () => {
      const apiSpy = vi
        .spyOn(boondClient, "apiRequest")
        .mockResolvedValue({ data: { id: "42", type: "resource", attributes: {} } } as never);

      const handler = getHandler();
      await handler({
        id: "42",
        mode: "replace",
        skills: "Python",
        tools: [{ tool: "aws", level: 2 }],
      });

      expect(apiSpy).toHaveBeenCalledTimes(1);
      const [path, method, body] = apiSpy.mock.calls[0];
      expect(method).toBe("PUT");
      expect(path).toBe("/resources/42/technical-data");
      const attrs = (body as { data: { attributes: Record<string, unknown> } }).data.attributes;
      expect(attrs).toEqual({ skills: "Python", tools: [{ tool: "aws", level: 2 }] });
    });

    it("short-circuits with a no-op message when merge produces no changes", async () => {
      const apiSpy = vi.spyOn(boondClient, "apiRequest").mockResolvedValue({
        data: {
          id: "42",
          type: "resource",
          attributes: {
            skills: "Python",
            title: "Existing title",
          },
        },
      } as never);

      const handler = getHandler();
      const result = await handler({
        id: "42",
        mode: "merge",
        title: "another title", // ignored: existing is non-empty
      });

      expect(apiSpy).toHaveBeenCalledTimes(1); // only the GET fetch
      expect(result.content[0].text).toMatch(/inchangé/i);
    });
  });

  // References live as embedded sub-objects inside /resources/{id}/technical-data.
  // The three reference tools therefore all do a GET-then-PUT on technical-data
  // (full references[] array republished).
  function mockDtRefs(refs: Array<Record<string, unknown>>) {
    return vi.spyOn(boondClient, "apiRequest").mockImplementation(async (_path, method, body) => {
      if (method === undefined || method === "GET") {
        return {
          data: { id: "42", type: "resource", attributes: { references: refs } },
        } as never;
      }
      const next =
        (body as { data?: { attributes?: { references?: Array<Record<string, unknown>> } } } | undefined)?.data
          ?.attributes?.references ?? refs;
      return {
        data: { id: "42", type: "resource", attributes: { references: next } },
      } as never;
    });
  }

  describe("boond_resources_reference_create handler", () => {
    it("GETs the current refs then PUTs technical-data with the new ref appended", async () => {
      const apiSpy = vi.spyOn(boondClient, "apiRequest").mockImplementation(async (_p, method) => {
        if (method === undefined || method === "GET") {
          return {
            data: {
              id: "42",
              type: "resource",
              attributes: { references: [{ id: "10", title: "Existing", company: "Old Co", description: "x" }] },
            },
          } as never;
        }
        return {
          data: {
            id: "42",
            type: "resource",
            attributes: {
              references: [
                { id: "10", title: "Existing", company: "Old Co", description: "x" },
                { id: "11", title: "Lead Dev", company: "Acme", description: "New role" },
              ],
            },
          },
        } as never;
      });

      registerResourceTools(server);
      const handler = vi
        .mocked(server.registerTool)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mock.calls.find((c) => c[0] === "boond_resources_reference_create")![2] as any;

      const result = await handler({
        resourceId: "42",
        title: "Lead Dev",
        company: "Acme",
        description: "New role",
        startMonth: 5,
        startYear: 2024,
      });

      expect(apiSpy).toHaveBeenCalledTimes(2);
      expect(apiSpy.mock.calls[0][0]).toBe("/resources/42/technical-data");
      expect(apiSpy.mock.calls[0][1]).toBeUndefined();

      const [putPath, putMethod, putBody] = apiSpy.mock.calls[1];
      expect(putPath).toBe("/resources/42/technical-data");
      expect(putMethod).toBe("PUT");
      const data = (putBody as { data: { id: string; type: string; attributes: { references: unknown[] } } }).data;
      expect(data.id).toBe("42");
      expect(data.type).toBe("resource");
      const refs = data.attributes.references;
      expect(refs).toHaveLength(2);
      expect(refs[0]).toEqual({ id: "10", title: "Existing", company: "Old Co", description: "x" });
      expect(refs[1]).toEqual({
        title: "Lead Dev",
        company: "Acme",
        description: "New role",
        startMonth: 5,
        startYear: 2024,
      });
      expect(result.content[0].text).toMatch(/✅/);
    });
  });

  describe("boond_resources_reference_update handler", () => {
    it("patches only the provided fields of the matching reference, others intact", async () => {
      const apiSpy = mockDtRefs([
        {
          id: "10",
          title: "Silamir",
          company: "Silamir Group",
          description: "BU Manager",
          startMonth: "",
          startYear: "",
          endMonth: "",
          endYear: "",
        },
        { id: "20", title: "AFD.TECH", company: "AFD", description: "Lead Dev", startMonth: "1", startYear: "2022" },
      ]);

      registerResourceTools(server);
      const handler = vi
        .mocked(server.registerTool)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mock.calls.find((c) => c[0] === "boond_resources_reference_update")![2] as any;

      await handler({
        resourceId: "42",
        referenceId: "10",
        startMonth: 5,
        startYear: 2024,
        endMonth: 1,
        endYear: 2026,
      });

      expect(apiSpy).toHaveBeenCalledTimes(2);
      const [, , putBody] = apiSpy.mock.calls[1];
      const refs = (putBody as { data: { attributes: { references: Array<Record<string, unknown>> } } }).data.attributes
        .references;
      expect(refs).toHaveLength(2);
      // Reference #10: dates filled, title/company/description preserved
      expect(refs[0]).toEqual({
        id: "10",
        title: "Silamir",
        company: "Silamir Group",
        description: "BU Manager",
        startMonth: 5,
        startYear: 2024,
        endMonth: 1,
        endYear: 2026,
      });
      // Reference #20: untouched
      expect(refs[1]).toEqual({
        id: "20",
        title: "AFD.TECH",
        company: "AFD",
        description: "Lead Dev",
        startMonth: "1",
        startYear: "2022",
      });
    });

    it("returns isError=true with hint when the ref id isn't on the resource", async () => {
      mockDtRefs([{ id: "10", title: "Other" }]);

      registerResourceTools(server);
      const handler = vi
        .mocked(server.registerTool)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mock.calls.find((c) => c[0] === "boond_resources_reference_update")![2] as any;

      const result = await handler({ resourceId: "42", referenceId: "999", endMonth: 5 });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/introuvable/i);
      expect(result.content[0].text).toMatch(/10/); // lists existing ids
    });
  });

  describe("boond_resources_reference_delete handler", () => {
    it("PUTs technical-data with the targeted reference removed", async () => {
      const apiSpy = mockDtRefs([
        { id: "10", title: "Keep me" },
        { id: "20", title: "Delete me" },
      ]);

      registerResourceTools(server);
      const handler = vi
        .mocked(server.registerTool)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mock.calls.find((c) => c[0] === "boond_resources_reference_delete")![2] as any;

      const result = await handler({ resourceId: "42", referenceId: "20" });
      expect(apiSpy).toHaveBeenCalledTimes(2);
      const [, method, putBody] = apiSpy.mock.calls[1];
      expect(method).toBe("PUT");
      const refs = (putBody as { data: { attributes: { references: Array<Record<string, unknown>> } } }).data.attributes
        .references;
      expect(refs).toEqual([{ id: "10", title: "Keep me" }]);
      expect(result.content[0].text).toMatch(/🗑️/);
    });

    it("returns isError when the ref id isn't on the resource", async () => {
      const apiSpy = mockDtRefs([{ id: "10", title: "Only one" }]);

      registerResourceTools(server);
      const handler = vi
        .mocked(server.registerTool)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mock.calls.find((c) => c[0] === "boond_resources_reference_delete")![2] as any;

      const result = await handler({ resourceId: "42", referenceId: "999" });
      expect(result.isError).toBe(true);
      // Only the GET happened; no PUT
      expect(apiSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe("mergeTechnicalData", () => {
  it("only emits keys that the caller actually provided", () => {
    const out = mergeTechnicalData(
      { skills: "Python", title: "Existing", tools: [{ tool: "aws", level: 3 }] },
      { skills: "Java" }
    );
    expect(Object.keys(out).sort()).toEqual(["skills"]);
  });

  it("dedups skills case-insensitively while preserving original casing", () => {
    const out = mergeTechnicalData({ skills: "Python, AWS" }, { skills: "python, GCP" });
    expect(out.skills).toBe("Python, AWS, GCP");
  });

  it("keeps existing tool level when slug is already present (no overwrite)", () => {
    const out = mergeTechnicalData(
      { tools: [{ tool: "aws", level: 3 }] },
      {
        tools: [
          { tool: "aws", level: 1 },
          { tool: "gcp", level: 2 },
        ],
      }
    );
    expect(out.tools).toEqual([
      { tool: "aws", level: 3 },
      { tool: "gcp", level: 2 },
    ]);
  });

  it("keeps existing language level when language is already present", () => {
    const out = mergeTechnicalData(
      { languages: [{ language: "Anglais", level: "courant" }] },
      {
        languages: [
          { language: "anglais", level: "scolaire" },
          { language: "Espagnol", level: "courant" },
        ],
      }
    );
    expect(out.languages).toEqual([
      { language: "Anglais", level: "courant" },
      { language: "Espagnol", level: "courant" },
    ]);
  });

  it("fills title/summary/training only when currently blank", () => {
    const out = mergeTechnicalData(
      { title: "", summary: "Existing summary", training: null as unknown as string },
      { title: "Manager", summary: "New summary", training: "BAC+5" }
    );
    expect(out.title).toBe("Manager");
    expect(out.training).toBe("BAC+5");
    expect(out.summary).toBeUndefined();
  });

  it("fills experience only when current is 0/empty", () => {
    expect(mergeTechnicalData({ experience: 0 }, { experience: 7 }).experience).toBe(7);
    expect(mergeTechnicalData({ experience: 5 }, { experience: 7 }).experience).toBeUndefined();
  });

  it("dedups string-array fields like expertiseAreas/diplomas", () => {
    const out = mergeTechnicalData(
      { expertiseAreas: ["Banque"], diplomas: ["DUT Info"] },
      { expertiseAreas: ["banque", "Assurance"], diplomas: ["DUT Info", "Master IA"] }
    );
    expect(out.expertiseAreas).toEqual(["Banque", "Assurance"]);
    expect(out.diplomas).toEqual(["DUT Info", "Master IA"]);
  });
});
