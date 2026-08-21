import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerExpenseTools } from "./expenses.js";
import { apiRequest } from "../services/boond-client.js";
import type { JsonApiResponse } from "../types.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

function handlerOf(server: McpServer, name: string): (params: unknown) => Promise<{ content: { text: string }[] }> {
  const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === name);
  if (!call) throw new Error(`tool ${name} not registered`);
  return call[2] as never;
}

/** The `data` the mocked apiRequest received on its last POST/PUT. */
function lastBodyData(): Record<string, unknown> {
  const call = vi.mocked(apiRequest).mock.calls.at(-1);
  const body = call?.[2] as { data: Record<string, unknown> };
  return body.data;
}

describe("registerExpenseTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "1", type: "expensesreport", attributes: {} } });
  });

  it("should register 6 expense tools", () => {
    registerExpenseTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(6);
  });

  it("should register all expected tool names", () => {
    registerExpenseTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_expenses_search");
    expect(names).toContain("boond_expenses_get");
    expect(names).toContain("boond_expenses_default");
    expect(names).toContain("boond_expenses_create");
    expect(names).toContain("boond_expenses_update");
    expect(names).toContain("boond_expenses_delete");
  });

  it("should register search, get and default as readOnly", () => {
    registerExpenseTools(server);
    const readOnly = ["boond_expenses_search", "boond_expenses_get", "boond_expenses_default"];
    const calls = vi
      .mocked(server.registerTool)
      .mock.calls.filter((c) => typeof c[0] === "string" && readOnly.includes(c[0] as string));
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call[1].annotations?.readOnlyHint).toBe(true);
    }
  });

  it("should register delete as destructive", () => {
    registerExpenseTools(server);
    const deleteCall = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_expenses_delete");
    expect(deleteCall?.[1].annotations?.destructiveHint).toBe(true);
  });

  it("should point the create description at boond_expenses_default", () => {
    registerExpenseTools(server);
    const createCall = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_expenses_create");
    expect(createCall?.[1].description).toContain("boond_expenses_default");
  });

  describe("boond_expenses_default", () => {
    // The query must travel in `queryParams`, never inlined in the path:
    // `assertSafeApiPath` rejects a `?` outright, so building the URL by hand
    // here threw "Unsafe API path rejected" on every call.
    it("should pass resource and term as query params, keeping the path clean", async () => {
      registerExpenseTools(server);
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "0", type: "expensesreport", attributes: {} } });
      await handlerOf(server, "boond_expenses_default")({ resourceId: "18081", term: "2027-01" });
      const [path, method, body, query] = vi.mocked(apiRequest).mock.calls[0];
      expect(path).toBe("/expenses-reports/default");
      expect(path).not.toContain("?");
      expect(method).toBe("GET");
      expect(body).toBeUndefined();
      expect(query).toMatchObject({ resource: "18081", term: "2027-01" });
    });

    it("should forward agencyId when provided", async () => {
      registerExpenseTools(server);
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "0", type: "expensesreport", attributes: {} } });
      await handlerOf(server, "boond_expenses_default")({ resourceId: "1", term: "2027-01", agencyId: "3" });
      expect(vi.mocked(apiRequest).mock.calls[0][3]).toMatchObject({ agency: "3" });
    });

    // The expense-type `reference` codes are published nowhere else: they live on
    // the agency, `/application/dictionary` has no expense-type table and
    // `/agencies/{id}` returns only a name. Losing them from this rendering makes
    // `boond_expenses_create` unusable.
    it("should surface the agency expense types, km rates and project/delivery pairs", async () => {
      registerExpenseTools(server);
      const response: JsonApiResponse = {
        data: {
          id: "0",
          type: "expensesreport",
          attributes: {
            term: "2027-01",
            currencyAgency: 0,
            exchangeRateAgency: 1,
            ratePerKilometerType: { reference: 3, name: "5CV", amount: 0.636 },
          },
          relationships: {
            resource: { data: { id: "18081", type: "resource" } },
            agency: { data: { id: "3", type: "agency" } },
          },
        },
        included: [
          {
            id: "3",
            type: "agency",
            attributes: {
              name: "Silamir Sas",
              expenseTypes: [
                { reference: 1, name: "Restaurant", taxRate: 0 },
                { reference: 12, name: "Fournitures", taxRate: 20 },
              ],
              ratePerKilometerTypes: [{ reference: 3, name: "5CV", amount: 0.636 }],
            },
          },
          // Shape as the live API returns it: the project → deliveries link is on
          // the PROJECT, and the included `delivery` objects carry no
          // relationships at all.
          {
            id: "1607",
            type: "project",
            attributes: { reference: "PRJ1607 / Interne" },
            relationships: {
              deliveries: { data: [{ id: "7889", type: "delivery" }] },
              batches: { data: [] },
            },
          },
          { id: "7889", type: "delivery", attributes: { title: "" } },
          // A project with no chargeable delivery must be reported as such, not
          // paired with someone else's delivery.
          {
            id: "999",
            type: "project",
            attributes: { reference: "PRJ999 / Sans prestation" },
            relationships: { deliveries: { data: [] } },
          },
        ],
      };
      vi.mocked(apiRequest).mockResolvedValue(response);
      const result = await handlerOf(server, "boond_expenses_default")({ resourceId: "18081", term: "2027-01" });
      const text = result.content[0].text;
      expect(text).toContain("reference=1 | Restaurant | TVA 0 %");
      expect(text).toContain("reference=12 | Fournitures | TVA 20 %");
      expect(text).toContain("ratePerKilometerTypeReference");
      expect(text).toContain("projectId=1607");
      expect(text).toContain("deliveryId ∈ #7889");
      expect(text).toContain("Agence: #3 (Silamir Sas)");
      // No cross-pairing: 999 has no delivery of its own and must not borrow 7889.
      expect(text).toContain("projectId=999 | PRJ999 / Sans prestation | deliveryId ∈ (aucune prestation");
      expect(text).not.toContain("PRJ999 / Sans prestation | deliveryId ∈ #7889");
    });

    it("should stay readable when the agency has no expense type and the resource no imputation", async () => {
      registerExpenseTools(server);
      vi.mocked(apiRequest).mockResolvedValue({
        data: { id: "0", type: "expensesreport", attributes: { term: "2027-01" } },
        included: [],
      });
      const result = await handlerOf(server, "boond_expenses_default")({ resourceId: "1", term: "2027-01" });
      expect(result.content[0].text).toContain("aucun type de frais configuré");
      expect(result.content[0].text).toContain("aucune imputation disponible");
    });
  });

  describe("payload built for /expenses-reports", () => {
    const LINE = {
      startDate: "2027-01-15",
      expenseTypeReference: 1,
      amountIncludingTax: 12.34,
      tax: 10,
      projectId: "1607",
      deliveryId: "7889",
      isKilometricExpense: false,
      reinvoiced: false,
      currency: 0,
      exchangeRate: 1,
      activityType: "production" as const,
    };

    it("should nest the convenience ids the way the API expects", async () => {
      registerExpenseTools(server);
      await handlerOf(
        server,
        "boond_expenses_create"
      )({
        resourceId: "18081",
        agencyId: "3",
        term: "2027-01",
        exchangeRateAgency: 1,
        ratePerKilometerTypeReference: 3,
        actualExpenses: [LINE],
      });
      const data = lastBodyData();
      expect(data.relationships).toEqual({
        resource: { data: { id: "18081", type: "resource" } },
        agency: { data: { id: "3", type: "agency" } },
      });
      const attrs = data.attributes as Record<string, unknown>;
      expect(attrs.ratePerKilometerType).toEqual({ reference: 3 });
      const line = (attrs.actualExpenses as Record<string, unknown>[])[0];
      expect(line.expenseType).toEqual({ reference: 1 });
      expect(line.project).toEqual({ id: "1607" });
      expect(line.delivery).toEqual({ id: "7889" });
      expect(line.expenseTypeReference).toBeUndefined();
      expect(line.projectId).toBeUndefined();
    });

    // `batch` must be PRESENT with a null id when there is no batch: the API
    // rejects `{ id: "0" }` and `{ id: 0 }` alike (1002), and an absent key is a
    // "missing required attribute" (1017). This is the one field that must
    // survive the undefined-stripping every other attribute goes through.
    it("should always send batch, with a null id when there is none", async () => {
      registerExpenseTools(server);
      await handlerOf(
        server,
        "boond_expenses_create"
      )({
        resourceId: "1",
        term: "2027-01",
        exchangeRateAgency: 1,
        actualExpenses: [LINE],
      });
      const line = (
        (lastBodyData().attributes as Record<string, unknown>).actualExpenses as Record<string, unknown>[]
      )[0];
      expect(Object.hasOwn(line, "batch")).toBe(true);
      expect(line.batch).toEqual({ id: null });
    });

    it("should send the batch id when one is given", async () => {
      registerExpenseTools(server);
      await handlerOf(
        server,
        "boond_expenses_create"
      )({
        resourceId: "1",
        term: "2027-01",
        exchangeRateAgency: 1,
        actualExpenses: [{ ...LINE, batchId: "42" }],
      });
      const line = (
        (lastBodyData().attributes as Record<string, unknown>).actualExpenses as Record<string, unknown>[]
      )[0];
      expect(line.batch).toEqual({ id: "42" });
    });

    // A kilometric line carries `expenseType: null` — the key present, holding
    // null, exactly as the API returns it.
    it("should send a null expenseType for a kilometric line", async () => {
      registerExpenseTools(server);
      await handlerOf(
        server,
        "boond_expenses_create"
      )({
        resourceId: "1",
        term: "2027-01",
        exchangeRateAgency: 1,
        actualExpenses: [
          { ...LINE, expenseTypeReference: undefined, isKilometricExpense: true, numberOfKilometers: 42 },
        ],
      });
      const line = (
        (lastBodyData().attributes as Record<string, unknown>).actualExpenses as Record<string, unknown>[]
      )[0];
      expect(Object.hasOwn(line, "expenseType")).toBe(true);
      expect(line.expenseType).toBeNull();
      expect(line.numberOfKilometers).toBe(42);
    });

    it("should leave actualExpenses out entirely when no line is given", async () => {
      registerExpenseTools(server);
      await handlerOf(
        server,
        "boond_expenses_create"
      )({
        resourceId: "1",
        term: "2027-01",
        exchangeRateAgency: 1,
      });
      expect(Object.hasOwn(lastBodyData().attributes as object, "actualExpenses")).toBe(false);
    });

    it("should PUT the update on /expenses-reports/{id} and carry the id in the body", async () => {
      registerExpenseTools(server);
      await handlerOf(server, "boond_expenses_update")({ id: "4567", informationComments: "ok" });
      const call = vi.mocked(apiRequest).mock.calls.at(-1);
      expect(call?.[0]).toBe("/expenses-reports/4567");
      expect(call?.[1]).toBe("PUT");
      expect(lastBodyData().id).toBe("4567");
    });
  });
});
