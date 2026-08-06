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
import { PROFILES, PROFILE_NAMES } from "./profiles.js";
import { REGISTERED_DOMAINS } from "../constants.js";

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

/**
 * Both packaged install channels — the MCPB extension (`manifest.json`) and the
 * Claude Code plugin (`plugins/boondmanager-mcp/.mcp.json`) — build the server's
 * env by substituting `${user_config.KEY}` into all fourteen `BOOND_*` vars. So
 * every var is **defined** even for the options the user never touched: a
 * half-filled configuration form hands us empty strings, not absent keys.
 *
 * The invariant, in the restricting direction: a *defined but empty* restriction
 * variable counts as unconfigured and yields the full surface. It is the mirror
 * of the `MCP_HTTP_ALLOWED_HOSTS` rule (a blank value must never silently switch
 * a security control *off*) — here a blank value must never silently switch a
 * restriction *on*, which would hide most of the catalogue with no way for the
 * user to tell why.
 */
describe("resolveAccessPolicy: defined-but-empty values (packaged-install substitution)", () => {
  const RESTRICTION_VARS = [
    "BOOND_MCP_PROFILE",
    "BOOND_MCP_DOMAINS",
    "BOOND_MCP_EXCLUDE_DOMAINS",
    "BOOND_MCP_OPERATIONS",
    "BOOND_MCP_READ_ONLY",
  ] as const;

  function expectUnrestricted(p: AccessPolicy) {
    expect(p.allowedDomains).toBeNull();
    expect(p.excludedDomains.size).toBe(0);
    expect([...p.operations].sort()).toEqual([...ALL_OPERATIONS].sort());
  }

  it("treats every restriction var set to the empty string as unconfigured", () => {
    expectUnrestricted(resolveAccessPolicy(env(Object.fromEntries(RESTRICTION_VARS.map((k) => [k, ""])))));
  });

  it("treats whitespace-only values as unconfigured too", () => {
    expectUnrestricted(resolveAccessPolicy(env(Object.fromEntries(RESTRICTION_VARS.map((k) => [k, "   "])))));
  });

  it.each(RESTRICTION_VARS)("%s alone, set to empty, restricts nothing", (key) => {
    expectUnrestricted(resolveAccessPolicy(env({ [key]: "" })));
  });

  // A host that does not substitute leaves the literal reference behind. Same
  // outcome required: full surface, no crash.
  it("treats an unsubstituted ${user_config.*} reference as unconfigured", () => {
    const raw = Object.fromEntries(
      RESTRICTION_VARS.map((k) => [k, `\${user_config.${k.replace("BOOND_", "").toLowerCase()}}`])
    );
    expectUnrestricted(resolveAccessPolicy(env(raw)));
  });

  // `mcp_read_only` is declared `type: "boolean"` in both manifests, so what
  // reaches us is the *string* "true" / "false". "false" must not read as
  // "set, therefore on" — that is the whole trap of stringified booleans.
  it('BOOND_MCP_READ_ONLY="false" allows all operations', () => {
    expect([...resolveAccessPolicy(env({ BOOND_MCP_READ_ONLY: "false" })).operations].sort()).toEqual(
      [...ALL_OPERATIONS].sort()
    );
  });

  it('BOOND_MCP_READ_ONLY="true" restricts to read', () => {
    expect([...resolveAccessPolicy(env({ BOOND_MCP_READ_ONLY: "true" })).operations]).toEqual(["read"]);
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

describe("resolveAccessPolicy: profiles", () => {
  it("every profile resolves to a non-empty set of known domains", () => {
    for (const name of PROFILE_NAMES) {
      const p = resolveAccessPolicy(env({ BOOND_MCP_PROFILE: name }));
      expect(p.allowedDomains, name).not.toBeNull();
      expect(p.allowedDomains!.size, name).toBeGreaterThan(0);
      for (const domain of p.allowedDomains!) {
        expect(REGISTERED_DOMAINS as readonly string[], `${name}: ${domain}`).toContain(domain);
      }
    }
  });

  it("every profile keeps `application` (dictionary + current-user substrate)", () => {
    for (const name of PROFILE_NAMES) {
      expect(isDomainAllowed(resolveAccessPolicy(env({ BOOND_MCP_PROFILE: name })), "application"), name).toBe(true);
    }
  });

  it("a profile restricts the surface (it is not a no-op allow-all)", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_PROFILE: "recruiting" }));
    expect(isDomainAllowed(p, "candidates")).toBe(true);
    expect(isDomainAllowed(p, "invoices")).toBe(false);
  });

  it("is case-insensitive and accepts several profiles as a union", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_PROFILE: "Recruiting, FINANCE" }));
    expect(isDomainAllowed(p, "candidates")).toBe(true);
    expect(isDomainAllowed(p, "invoices")).toBe(true);
    expect(isDomainAllowed(p, "webhooks")).toBe(false);
  });

  it("BOOND_MCP_DOMAINS takes precedence over BOOND_MCP_PROFILE", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_PROFILE: "finance", BOOND_MCP_DOMAINS: "candidates,application" }));
    expect([...p.allowedDomains!].sort()).toEqual(["application", "candidates"]);
    expect(isDomainAllowed(p, "invoices")).toBe(false);
  });

  it("BOOND_MCP_EXCLUDE_DOMAINS still wins over a profile", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_PROFILE: "finance", BOOND_MCP_EXCLUDE_DOMAINS: "payments" }));
    expect(isDomainAllowed(p, "invoices")).toBe(true);
    expect(isDomainAllowed(p, "payments")).toBe(false);
  });

  it("an unknown profile is ignored, never fatal, and never an empty surface", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_PROFILE: "nonsense" }));
    expect(p.allowedDomains).toBeNull();
    expect(isDomainAllowed(p, "candidates")).toBe(true);
  });

  it("keeps the valid profiles of a partly-wrong list", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_PROFILE: "nonsense,admin" }));
    expect(isDomainAllowed(p, "roles")).toBe(true);
    expect(isDomainAllowed(p, "candidates")).toBe(false);
  });

  /**
   * `PROFILES` is an object literal, so a profile name that collides with an
   * `Object.prototype` property used to resolve to a truthy non-array, skip the
   * warn-and-ignore branch and throw `TypeError: … is not iterable` — a server
   * that refuses to start instead of the documented warning. The domain axis has
   * always been `Set`-based and therefore immune; this pins the profile axis to
   * the same resilience rule.
   */
  it.each(["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"])(
    "treats the prototype property name %s as an unknown profile, not a crash",
    (name) => {
      let p!: ReturnType<typeof resolveAccessPolicy>;
      expect(() => {
        p = resolveAccessPolicy(env({ BOOND_MCP_PROFILE: name }));
      }).not.toThrow();
      expect(p.allowedDomains).toBeNull();
      expect(isDomainAllowed(p, "candidates")).toBe(true);
    }
  );

  it("keeps the valid profile of a list containing a prototype name", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_PROFILE: "constructor,admin" }));
    expect(isDomainAllowed(p, "roles")).toBe(true);
    expect(isDomainAllowed(p, "candidates")).toBe(false);
  });

  it("stays orthogonal to the operation axis", () => {
    const p = resolveAccessPolicy(env({ BOOND_MCP_PROFILE: "delivery", BOOND_MCP_READ_ONLY: "true" }));
    expect(isDomainAllowed(p, "projects")).toBe(true);
    expect([...p.operations]).toEqual(["read"]);
  });
});

describe("PROFILES table", () => {
  it("only references domains that exist", () => {
    for (const [name, domains] of Object.entries(PROFILES)) {
      expect(domains.length, name).toBeGreaterThan(0);
      for (const domain of domains) {
        expect(REGISTERED_DOMAINS as readonly string[], `${name}: ${domain}`).toContain(domain);
      }
    }
  });

  it("has no duplicate entry inside a profile", () => {
    for (const [name, domains] of Object.entries(PROFILES)) {
      expect(new Set(domains).size, name).toBe(domains.length);
    }
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
