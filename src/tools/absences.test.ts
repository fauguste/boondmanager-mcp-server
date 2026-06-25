import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAbsenceTools } from "./absences.js";
import { apiRequest } from "../services/boond-client.js";

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

  it("should register 5 absence tools", () => {
    registerAbsenceTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(5);
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

  it("maps absence state when provided", async () => {
    registerAbsenceTools(server);
    const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_absences_create");
    const handler = call?.[2] as (params: unknown) => Promise<unknown>;

    await handler({
      resourceId: "5",
      typeOf: "CP",
      startDate: "2026-07-14",
      endDate: "2026-07-14",
      state: 1,
    });

    expect(apiRequest).toHaveBeenCalledWith(
      "/absences-reports",
      "POST",
      expect.objectContaining({
        data: expect.objectContaining({
          attributes: expect.objectContaining({ state: 1 }),
        }),
      })
    );
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
