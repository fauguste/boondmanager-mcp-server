import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatAbsenceDefaults, registerAbsenceTools } from "./absences.js";
import { apiRequest } from "../services/boond-client.js";
import { AbsenceSearchSchema } from "../schemas/index.js";

vi.mock("../services/boond-client.js", () => ({
  apiRequest: vi.fn().mockResolvedValue({ data: { id: "31", type: "absencesreport", attributes: {} } }),
  buildSearchQuery: vi.fn((params: Record<string, unknown>) => params),
  formatListResponse: vi.fn().mockReturnValue(""),
  formatDetailResponse: vi.fn().mockReturnValue(""),
}));

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

describe("registerAbsenceTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockClear();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "31", type: "absencesreport", attributes: {} } } as never);
  });

  it("should register 6 absence tools (default + CRUD)", () => {
    registerAbsenceTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(6);
  });

  it("should register all expected tool names", () => {
    registerAbsenceTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_absences_search");
    expect(names).toContain("boond_absences_get");
    expect(names).toContain("boond_absences_create");
    expect(names).toContain("boond_absences_update");
    expect(names).toContain("boond_absences_delete");
  });

  it("should register search and get as readOnly", () => {
    registerAbsenceTools(server);
    const readOnlyCalls = vi
      .mocked(server.registerTool)
      .mock.calls.filter(
        (c) => typeof c[0] === "string" && ["boond_absences_search", "boond_absences_get"].includes(c[0] as string)
      );
    for (const call of readOnlyCalls) {
      expect(call[1].annotations?.readOnlyHint).toBe(true);
    }
  });

  it("should register delete as destructive", () => {
    registerAbsenceTools(server);
    const deleteCall = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_absences_delete");
    expect(deleteCall?.[1].annotations?.destructiveHint).toBe(true);
  });

  it("creates absences-reports with absencesPeriods", async () => {
    registerAbsenceTools(server);
    const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_absences_create");
    const handler = call?.[2] as (params: unknown) => Promise<unknown>;

    await handler({
      resourceId: "5",
      typeOf: "CP",
      startDate: "2026-07-14",
      endDate: "2026-07-15",
      workUnitTypeReference: 1,
      note: "note",
    });

    expect(apiRequest).toHaveBeenCalledWith("/absences-reports", "POST", {
      data: {
        type: "absencesreport",
        attributes: {
          informationComments: "note",
          absencesPeriods: [
            {
              startDate: "2026-07-14",
              endDate: "2026-07-15",
              duration: 2,
              title: "CP",
              workUnitType: { reference: 1 },
            },
          ],
        },
        relationships: {
          resource: { data: { id: "5", type: "resource" } },
        },
      },
    });
  });

  it("refuses state: on /absences-reports it is a validation-workflow string the write cannot move (#250)", () => {
    registerAbsenceTools(server);
    for (const name of ["boond_absences_create", "boond_absences_update"]) {
      const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === name)!;
      const schema = call[1].inputSchema as unknown as { safeParse: (v: unknown) => { success: boolean } };
      expect(
        schema.safeParse({
          id: "1",
          resourceId: "5",
          typeOf: "CP",
          startDate: "2026-10-01",
          endDate: "2026-10-02",
          state: 1,
        }).success,
        name
      ).toBe(false);
    }
  });

  it("searches absences reports with resource keyword reference", async () => {
    registerAbsenceTools(server);
    const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_absences_search");
    const handler = call?.[2] as (params: unknown) => Promise<unknown>;

    await handler({ resourceId: "5", startMonth: "2026-07", endMonth: "2026-09", page: 1, pageSize: 20 });

    expect(apiRequest).toHaveBeenCalledWith(
      "/absences-reports",
      "GET",
      undefined,
      expect.objectContaining({ keywords: "COMP5", startMonth: "2026-07", endMonth: "2026-09" })
    );
  });
});

describe("absence handlers (#245)", () => {
  let server: McpServer;
  const handler = (name: string) =>
    vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === name)![2] as (p: unknown) => Promise<unknown>;

  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockClear();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "31", type: "absencesreport", attributes: {} } } as never);
    registerAbsenceTools(server);
  });

  it("search converts resourceId into a COMP keyword and lists /absences-reports", async () => {
    await handler("boond_absences_search")({ resourceId: "30888", startMonth: "2026-09", endMonth: "2026-09" });
    const [path, method, , query] = vi.mocked(apiRequest).mock.calls[0];
    expect(path).toBe("/absences-reports");
    expect(method).toBe("GET");
    expect(query).toMatchObject({ keywords: "COMP30888", startMonth: "2026-09", endMonth: "2026-09" });
    expect(query).not.toHaveProperty("resourceId");
  });

  it("get reads /absences-reports/{id}", async () => {
    await handler("boond_absences_get")({ id: "31" });
    expect(vi.mocked(apiRequest).mock.calls[0][0]).toBe("/absences-reports/31");
  });

  it("create derives one period from the dates — inclusive day count, default work-unit type 2 — and the resource relationship", async () => {
    await handler("boond_absences_create")({
      resourceId: "30888",
      typeOf: "Congé payé",
      startDate: "2026-10-05",
      endDate: "2026-10-07",
      note: "vacances",
    });
    expect(apiRequest).toHaveBeenCalledWith("/absences-reports", "POST", {
      data: {
        type: "absencesreport",
        attributes: {
          informationComments: "vacances",
          absencesPeriods: [
            {
              startDate: "2026-10-05",
              endDate: "2026-10-07",
              duration: 3,
              title: "Congé payé",
              workUnitType: { reference: 2 },
            },
          ],
        },
        relationships: { resource: { data: { id: "30888", type: "resource" } } },
      },
    });
  });

  it("create keeps an explicit duration, work-unit type and raw periods", async () => {
    await handler("boond_absences_create")({
      resourceId: "1",
      typeOf: "RTT",
      startDate: "2026-10-07",
      endDate: "2026-10-05",
      duration: 0.5,
      workUnitTypeReference: 4,
    });
    const first = (vi.mocked(apiRequest).mock.calls[0][2] as { data: { attributes: { absencesPeriods: unknown[] } } })
      .data.attributes.absencesPeriods[0];
    expect(first).toMatchObject({ duration: 0.5, workUnitType: { reference: 4 } });

    const raw = [{ startDate: "2026-11-02", endDate: "2026-11-02", duration: 1 }];
    await handler("boond_absences_create")({
      resourceId: "1",
      typeOf: "x",
      startDate: "2026-11-02",
      endDate: "2026-11-02",
      absencesPeriods: raw,
    });
    const second = vi.mocked(apiRequest).mock.calls[1][2] as { data: { attributes: { absencesPeriods: unknown[] } } };
    expect(second.data.attributes.absencesPeriods).toEqual(raw);
  });

  it("an inverted or unparsable window counts as one day", async () => {
    await handler("boond_absences_create")({
      resourceId: "1",
      typeOf: "x",
      startDate: "2026-10-07",
      endDate: "2026-10-05",
    });
    await handler("boond_absences_create")({ resourceId: "1", typeOf: "x", startDate: "nope", endDate: "2026-10-05" });
    for (const call of vi.mocked(apiRequest).mock.calls) {
      const body = call[2] as { data: { attributes: { absencesPeriods: Array<{ duration: number }> } } };
      expect(body.data.attributes.absencesPeriods[0].duration).toBe(1);
    }
  });

  it("update PUTs /absences-reports/{id} with the id in the body", async () => {
    await handler("boond_absences_update")({ id: "31", note: "corrigé" });
    expect(apiRequest).toHaveBeenCalledWith("/absences-reports/31", "PUT", {
      data: { type: "absencesreport", id: "31", attributes: { note: "corrigé" } },
    });
  });
});

describe("AbsenceSearchSchema", () => {
  // `GET /absences-reports` answers 422 `1017 - Missing required attribute`
  // without both months (caught live by scripts/smoke-live.mjs, issue #244);
  // the schema used to declare them optional, so the tool's most natural
  // call — no arguments — always failed.
  it("requires startMonth and endMonth in YYYY-MM", () => {
    const missing = AbsenceSearchSchema.safeParse({});
    expect(missing.success).toBe(false);
    const paths = missing.success ? [] : missing.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["startMonth", "endMonth"]));

    expect(AbsenceSearchSchema.safeParse({ startMonth: "2026-9", endMonth: "2026-09" }).success).toBe(false);
    expect(AbsenceSearchSchema.safeParse({ startMonth: "2026-09", endMonth: "2026-09" }).success).toBe(true);
  });
});

describe("boond_absences_default (issue #257)", () => {
  it("reads /absences-reports/default with resource (and agency when given)", async () => {
    const server = createMockServer();
    vi.mocked(apiRequest).mockClear();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "0", type: "absencesreport", attributes: {} } } as never);
    registerAbsenceTools(server);
    const handler = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_absences_default")![2] as (
      p: unknown
    ) => Promise<unknown>;
    await handler({ resourceId: "18081" });
    expect(apiRequest).toHaveBeenCalledWith("/absences-reports/default", "GET", undefined, { resource: "18081" });
    await handler({ resourceId: "18081", agencyId: "3" });
    expect(apiRequest).toHaveBeenLastCalledWith("/absences-reports/default", "GET", undefined, {
      resource: "18081",
      agency: "3",
    });
  });

  it("renders the absence work-unit types of the included resource and the report's scalars", () => {
    const text = formatAbsenceDefaults({
      data: {
        id: "0",
        type: "absencesreport",
        attributes: { term: "2026-09", state: "savedAndNoValidation", absencesPeriods: [] },
        relationships: { resource: { data: { id: "18081", type: "resource" } } },
      },
      included: [
        {
          id: "18081",
          type: "resource",
          attributes: {
            firstName: "Ana",
            lastName: "Silva",
            workUnitTypesAllowed: [
              { reference: 1, name: "Normale", activityType: "production" },
              { reference: 4, name: "RTT", activityType: "absence" },
              { reference: 5, name: "Maladie", activityType: "absence" },
            ],
          },
        },
        { id: "3", type: "agency", attributes: { name: "Paris" } },
      ],
    });
    expect(text).toContain("ressource #18081 (Ana Silva) | agence #3 (Paris)");
    expect(text).toContain("reference=4 | RTT | absence");
    expect(text).toContain("reference=5 | Maladie | absence");
    expect(text).not.toContain("Normale");
    expect(text).toContain("term: 2026-09");
    expect(text).not.toContain("absencesPeriods");
  });
});
