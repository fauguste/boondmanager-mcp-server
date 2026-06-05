import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  resolveAccessPolicy,
  isDomainAllowed,
  isOperationAllowed,
  operationOf,
  withPolicy,
  ALL_OPERATIONS,
  type AccessPolicy,
  type ToolAnnotations,
} from "./access-policy.js";

/** Helper: build an env object (only the keys we set; rest undefined). */
function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

const READ: ToolAnnotations = { readOnlyHint: true, idempotentHint: true };
const GET: ToolAnnotations = { readOnlyHint: true };
const CREATE: ToolAnnotations = { readOnlyHint: false, idempotentHint: false };
const UPDATE: ToolAnnotations = { readOnlyHint: false, idempotentHint: true };
const DELETE: ToolAnnotations = { destructiveHint: true };

describe("resolveAccessPolicy: defaults", () => {
  it("with no env vars: no domain restriction, all operations", () => {
    const p = resolveAccessPolicy(env({}));
    expect(p.allowedDomains).toBeNull();
    expect(p.excludedDomains.size).toBe(0);
    expect([...p.operations].sort()).toEqual([...ALL_OPERATIONS].sort());
  });

  it("ignores unresolved placeholder values like ${VAR}", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_DOMAINS: "${SOMETHING}" }));
    expect(p.allowedDomains).toBeNull();
  });
});

describe("resolveAccessPolicy: domains", () => {
  it("parses an allow-list (comma-separated)", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_DOMAINS: "invoices,payments,application" }));
    expect(p.allowedDomains).not.toBeNull();
    expect([...p.allowedDomains!].sort()).toEqual(["application", "invoices", "payments"]);
  });

  it("normalises underscores to dashes (provider_invoices -> provider-invoices)", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_DOMAINS: "provider_invoices,business_units" }));
    expect(p.allowedDomains!.has("provider-invoices")).toBe(true);
    expect(p.allowedDomains!.has("business-units")).toBe(true);
  });

  it("accepts whitespace separators too", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_DOMAINS: "invoices  payments" }));
    expect([...p.allowedDomains!].sort()).toEqual(["invoices", "payments"]);
  });

  it("drops unknown domains (typos) without throwing", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_DOMAINS: "invoices,invoicez,nope" }));
    expect([...p.allowedDomains!]).toEqual(["invoices"]);
  });

  it("parses a deny-list", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_EXCLUDE_DOMAINS: "candidates,resources" }));
    expect(p.allowedDomains).toBeNull();
    expect([...p.excludedDomains].sort()).toEqual(["candidates", "resources"]);
  });
});

describe("resolveAccessPolicy: operations", () => {
  it("BOOND_MCP_READ_ONLY=true → only read", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_READ_ONLY: "true" }));
    expect([...p.operations]).toEqual(["read"]);
  });

  it("accepts 1/yes as truthy for read-only", () => {
    expect([...resolveAccessPolicy(env({ BOOND_MCP_READ_ONLY: "1" })).operations]).toEqual(["read"]);
    expect([...resolveAccessPolicy(env({ BOOND_MCP_READ_ONLY: "yes" })).operations]).toEqual(["read"]);
  });

  it("BOOND_MCP_OPERATIONS allow-list is honoured", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_OPERATIONS: "read,create,update" }));
    expect([...p.operations].sort()).toEqual(["create", "read", "update"]);
  });

  it("BOOND_MCP_OPERATIONS takes precedence over BOOND_MCP_READ_ONLY", () => {
    const p = resolveAccessPolicy(
      env({ BOOND_MCP_OPERATIONS: "read,create,update,delete", BOOND_MCP_READ_ONLY: "true" })
    );
    expect([...p.operations].sort()).toEqual([...ALL_OPERATIONS].sort());
  });

  it("falls back to all operations when only invalid values are given", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_OPERATIONS: "bogus,nonsense" }));
    expect([...p.operations].sort()).toEqual([...ALL_OPERATIONS].sort());
  });

  it("keeps valid operations and drops invalid ones", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_OPERATIONS: "read,bogus,delete" }));
    expect([...p.operations].sort()).toEqual(["delete", "read"]);
  });
});

describe("isDomainAllowed", () => {
  it("allows everything when no allow-list and no deny-list", () => {
    const p = resolveAccessPolicy(env({}));
    expect(isDomainAllowed(p, "candidates")).toBe(true);
    expect(isDomainAllowed(p, "provider-invoices")).toBe(true);
  });

  it("allow-list: only listed domains pass", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_DOMAINS: "invoices,payments" }));
    expect(isDomainAllowed(p, "invoices")).toBe(true);
    expect(isDomainAllowed(p, "candidates")).toBe(false);
  });

  it("deny-list wins over allow-list", () => {
    const p = resolveAccessPolicy(
      env({ BOOND_MCP_DOMAINS: "invoices,payments", BOOND_MCP_EXCLUDE_DOMAINS: "payments" })
    );
    expect(isDomainAllowed(p, "invoices")).toBe(true);
    expect(isDomainAllowed(p, "payments")).toBe(false);
  });

  it("accepts the underscore form of a multi-word domain at query time", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_DOMAINS: "provider-invoices" }));
    expect(isDomainAllowed(p, "provider_invoices")).toBe(true);
    expect(isDomainAllowed(p, "provider-invoices")).toBe(true);
  });
});

describe("operationOf", () => {
  it("classifies each annotation shape", () => {
    expect(operationOf(READ)).toBe("read");
    expect(operationOf(GET)).toBe("read");
    expect(operationOf(CREATE)).toBe("create");
    expect(operationOf(UPDATE)).toBe("update");
    expect(operationOf(DELETE)).toBe("delete");
  });

  it("treats a tool with no read-only hint as a write (safe default)", () => {
    expect(operationOf(undefined)).toBe("create");
    expect(operationOf({})).toBe("create");
  });

  it("read-only wins even if other hints are set", () => {
    expect(operationOf({ readOnlyHint: true, destructiveHint: true })).toBe("read");
  });
});

describe("isOperationAllowed", () => {
  it("respects a read-only policy", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_READ_ONLY: "true" }));
    expect(isOperationAllowed(p, READ)).toBe(true);
    expect(isOperationAllowed(p, CREATE)).toBe(false);
    expect(isOperationAllowed(p, UPDATE)).toBe(false);
    expect(isOperationAllowed(p, DELETE)).toBe(false);
  });

  it("read+create+update keeps writes but drops deletes", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_OPERATIONS: "read,create,update" }));
    expect(isOperationAllowed(p, CREATE)).toBe(true);
    expect(isOperationAllowed(p, UPDATE)).toBe(true);
    expect(isOperationAllowed(p, DELETE)).toBe(false);
  });
});

describe("withPolicy (Proxy)", () => {
  function fakeServer() {
    return { registerTool: vi.fn(), registerPrompt: vi.fn() } as unknown as McpServer;
  }

  it("returns the same instance when all operations are allowed (fast path)", () => {
    const s = fakeServer();
    const p = resolveAccessPolicy(env({}));
    expect(withPolicy(s, p)).toBe(s);
  });

  it("drops disallowed-operation tools and keeps allowed ones", () => {
    const s = fakeServer();
    const p = resolveAccessPolicy(env({ BOOND_MCP_READ_ONLY: "true" }));
    const wrapped = withPolicy(s, p);

    wrapped.registerTool("boond_x_search", { annotations: READ } as never, (() => {}) as never);
    wrapped.registerTool("boond_x_create", { annotations: CREATE } as never, (() => {}) as never);
    wrapped.registerTool("boond_x_delete", { annotations: DELETE } as never, (() => {}) as never);

    const names = vi.mocked(s.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toEqual(["boond_x_search"]);
  });

  it("passes registerPrompt straight through", () => {
    const s = fakeServer();
    const p = resolveAccessPolicy(env({ BOOND_MCP_READ_ONLY: "true" }));
    const wrapped = withPolicy(s, p);
    wrapped.registerPrompt("p1", {} as never, (() => {}) as never);
    expect(vi.mocked(s.registerPrompt)).toHaveBeenCalledTimes(1);
  });
});

describe("AccessPolicy shape", () => {
  it("is a plain serialisable structure", () => {
    const p: AccessPolicy = resolveAccessPolicy(env({ BOOND_MCP_DOMAINS: "invoices" }));
    expect(p.operations instanceof Set).toBe(true);
    expect(p.excludedDomains instanceof Set).toBe(true);
  });
});
