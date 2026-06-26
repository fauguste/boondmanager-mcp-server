import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerContactTools } from "./contacts.js";
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

describe("registerContactTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates via PUT /contacts/{id}/information (issue #134)", async () => {
    registerContactTools(server);
    const apiSpy = vi
      .spyOn(boondClient, "apiRequest")
      .mockResolvedValue({ data: { id: "9", type: "contact", attributes: {} } } as never);

    const handler = getHandler(server, "boond_contacts_update");
    await handler({ id: "9", phone1: "+33769594357" });

    const [path, method] = apiSpy.mock.calls[0];
    // The base resource returns 405 on PATCH; updates target the
    // /information sub-resource with PUT.
    expect(path).toBe("/contacts/9/information");
    expect(method).toBe("PUT");
  });

  it("should register CRUD tools + 6 tab tools = 11 total", () => {
    registerContactTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(11);
  });

  it("should register all CRUD tools", () => {
    registerContactTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_contacts_search");
    expect(names).toContain("boond_contacts_get");
    expect(names).toContain("boond_contacts_create");
    expect(names).toContain("boond_contacts_update");
    expect(names).toContain("boond_contacts_delete");
  });

  it("should register all 6 tab tools", () => {
    registerContactTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_contacts_information");
    expect(names).toContain("boond_contacts_actions");
    expect(names).toContain("boond_contacts_opportunities");
    expect(names).toContain("boond_contacts_projects");
    expect(names).toContain("boond_contacts_orders");
    expect(names).toContain("boond_contacts_invoices");
  });

  it("should register tab tools as readOnly and non-destructive", () => {
    registerContactTools(server);
    const tabCalls = vi
      .mocked(server.registerTool)
      .mock.calls.filter(
        (c) =>
          typeof c[0] === "string" &&
          [
            "boond_contacts_information",
            "boond_contacts_actions",
            "boond_contacts_opportunities",
            "boond_contacts_projects",
            "boond_contacts_orders",
            "boond_contacts_invoices",
          ].includes(c[0] as string)
      );

    expect(tabCalls).toHaveLength(6);
    for (const call of tabCalls) {
      const [, metadata] = call;
      expect(metadata.annotations?.readOnlyHint).toBe(true);
      expect(metadata.annotations?.destructiveHint).toBe(false);
    }
  });
});
