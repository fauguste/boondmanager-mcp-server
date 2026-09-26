import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProductTools } from "./products.js";
import * as boondClient from "../services/boond-client.js";

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

function getHandler(server: McpServer, name: string) {
  const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === name);
  if (!call) throw new Error(`tool ${name} not registered`);
  return call[2] as (params: unknown) => Promise<unknown>;
}

describe("registerProductTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates via PUT /products/{id}/information (issue #134)", async () => {
    registerProductTools(server);
    const apiSpy = vi
      .spyOn(boondClient, "apiRequest")
      .mockResolvedValue({ data: { id: "3", type: "product", attributes: {} } } as never);

    const handler = getHandler(server, "boond_products_update");
    await handler({ id: "3", name: "Renamed product" });

    const [path, method] = apiSpy.mock.calls[0];
    // The base resource returns 405 on PATCH; updates target the
    // /information sub-resource with PUT.
    expect(path).toBe("/products/3/information");
    expect(method).toBe("PUT");
  });

  it("should register 5 product tools (CRUD)", () => {
    registerProductTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(5);
  });

  it("should register all expected tool names", () => {
    registerProductTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_products_search");
    expect(names).toContain("boond_products_get");
    expect(names).toContain("boond_products_create");
    expect(names).toContain("boond_products_update");
    expect(names).toContain("boond_products_delete");
  });
});

describe("product handlers (#245)", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
    registerProductTools(server);
  });
  afterEach(() => vi.restoreAllMocks());

  it("create POSTs the attributes as-is and returns the new id", async () => {
    const apiSpy = vi
      .spyOn(boondClient, "apiRequest")
      .mockResolvedValue({ data: { id: "5", type: "product", attributes: {} } } as never);
    const result = (await getHandler(server, "boond_products_create")({ name: "Licence", unitPrice: 100 })) as {
      structuredContent: unknown;
    };
    expect(apiSpy).toHaveBeenCalledWith("/products", "POST", {
      data: { type: "product", attributes: { name: "Licence", unitPrice: 100 } },
    });
    expect(result.structuredContent).toEqual({ id: "5", type: "product" });
  });

  it("update carries the id in the body and only the supplied fields", async () => {
    const apiSpy = vi
      .spyOn(boondClient, "apiRequest")
      .mockResolvedValue({ data: { id: "5", type: "product", attributes: {} } } as never);
    await getHandler(server, "boond_products_update")({ id: "5", taxRate: 20 });
    expect(apiSpy.mock.calls[0][2]).toEqual({ data: { type: "product", id: "5", attributes: { taxRate: 20 } } });
  });
});
