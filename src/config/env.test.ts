import { describe, it, expect, afterEach } from "vitest";
import { isUnset, readBool, readCsv, readPositiveInt, readString, readUrl } from "./env.js";
import { resolveHttpOptions } from "../transports/http.js";
import { resolveAuthorizationServer, resolveAdvertisedScopes } from "../services/oauth.js";
import { resolveAccessPolicy } from "./access-policy.js";
import { loadDictionaryOverrides } from "./dictionary-overrides.js";
import { isUpdateCheckDisabled } from "../services/update-checker.js";
import { resolveLogLevel, usePrettyOutput } from "../services/logger.js";

/**
 * Every documented variable, so the "blank means unset" rule is asserted for
 * all of them at once rather than for whichever reader happened to get a test
 * (issue #242). Add a variable here when it is added to CLAUDE.md.
 */
const DOCUMENTED_VARS = [
  // stdio / credentials
  "BOOND_USER_TOKEN",
  "BOOND_CLIENT_TOKEN",
  "BOOND_CLIENT_KEY",
  "BOOND_API_TOKEN",
  "BOOND_USER",
  "BOOND_PASSWORD",
  "BOOND_JWT_TTL_SECONDS",
  "BOOND_BASE_URL",
  // HTTP client
  "BOOND_HTTP_TIMEOUT_MS",
  "BOOND_HTTP_MAX_RETRIES",
  "BOOND_HTTP_RETRY_BASE_MS",
  "BOOND_HTTP_RETRY_MAX_MS",
  "BOOND_HTTP_RATE_LIMIT_RPS",
  "BOOND_HTTP_RATE_LIMIT_BURST",
  // access policy / features
  "BOOND_MCP_PROFILE",
  "BOOND_MCP_DOMAINS",
  "BOOND_MCP_EXCLUDE_DOMAINS",
  "BOOND_MCP_OPERATIONS",
  "BOOND_MCP_READ_ONLY",
  "BOOND_MCP_ICONS",
  "BOOND_MCP_CONFIRM_DELETE",
  "BOOND_DICTIONARY_OVERRIDES",
  "BOOND_DICTIONARY_TTL_MS",
  "BOOND_DISABLE_UPDATE_CHECK",
  // HTTP transport
  "MCP_TRANSPORT",
  "MCP_HTTP_HOST",
  "MCP_HTTP_PORT",
  "MCP_HTTP_PATH",
  "MCP_HTTP_STATEFUL",
  "MCP_HTTP_JSON_RESPONSE",
  "MCP_HTTP_PUBLIC_URL",
  "MCP_HTTP_SESSION_TTL_MS",
  "MCP_HTTP_SESSION_SWEEP_INTERVAL_MS",
  "MCP_HTTP_MAX_SESSIONS",
  "MCP_HTTP_ALLOWED_HOSTS",
  "MCP_HTTP_ALLOWED_ORIGINS",
  "MCP_HTTP_KEEP_ALIVE_TIMEOUT_MS",
  "MCP_HTTP_HEADERS_TIMEOUT_MS",
  "MCP_HTTP_REQUEST_TIMEOUT_MS",
  "MCP_HTTP_SHUTDOWN_TIMEOUT_MS",
  "MCP_HTTP_VALIDATE_TOKEN",
  "MCP_HTTP_TOKEN_VALIDATION_TTL_MS",
  "BOOND_HTTP_STATIC_AUTH",
  "MCP_HTTP_API_KEY",
  "MCP_HTTP_INSECURE_STATIC_AUTH",
  "BOOND_OAUTH_AUTHORIZATION_SERVER",
  "BOOND_OAUTH_SCOPES",
  // logging
  "LOG_LEVEL",
  "LOG_FORMAT",
] as const;

/** The three shapes a half-filled MCPB / plugin form hands the server. */
const UNSET_SHAPES = ["", "   ", "\t\n", "${user_config.x}", "  ${user_config.x}  "] as const;

describe("readString — the one 'unset' rule", () => {
  it.each(UNSET_SHAPES)("treats %j as not configured, for every documented variable", (shape) => {
    for (const name of DOCUMENTED_VARS) {
      expect(readString(name, { [name]: shape }), name).toBeUndefined();
      expect(isUnset(shape)).toBe(true);
    }
  });

  it("returns a configured value untouched (no trimming — a password may end with a space)", () => {
    expect(readString("X", { X: "value " })).toBe("value ");
    expect(readString("X", { X: "0" })).toBe("0");
    expect(readString("X", { X: "false" })).toBe("false");
  });

  it("reads process.env by default", () => {
    process.env["ENV_TEST_DEFAULT"] = "yes";
    try {
      expect(readString("ENV_TEST_DEFAULT")).toBe("yes");
    } finally {
      delete process.env["ENV_TEST_DEFAULT"];
    }
  });
});

describe("readBool", () => {
  it("accepts both spellings and falls back on anything else", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on", " Yes "]) expect(readBool("X", false, { X: v }), v).toBe(true);
    for (const v of ["0", "false", "no", "off", " OFF "]) expect(readBool("X", true, { X: v }), v).toBe(false);
    for (const v of ["", "  ", "${user_config.x}", "maybe"]) {
      expect(readBool("X", true, { X: v }), v).toBe(true);
      expect(readBool("X", false, { X: v }), v).toBe(false);
    }
    expect(readBool("X", true, {})).toBe(true);
  });
});

describe("readPositiveInt", () => {
  it("floors a positive number and falls back on unset / garbage / negative / zero", () => {
    expect(readPositiveInt("X", 5, { X: "12.9" })).toBe(12);
    expect(readPositiveInt("X", 5, { X: " 7 " })).toBe(7);
    for (const v of ["", "  ", "${x}", "lots", "-1", "0", "Infinity"])
      expect(readPositiveInt("X", 5, { X: v }), v).toBe(5);
    expect(readPositiveInt("X", 5, {})).toBe(5);
  });

  it("accepts zero only when asked", () => {
    expect(readPositiveInt("X", 5, { X: "0" }, { allowZero: true })).toBe(0);
    expect(readPositiveInt("X", 5, { X: "-0.5" }, { allowZero: true })).toBe(5);
  });
});

describe("readCsv", () => {
  it("splits on commas and whitespace, drops empties, and is undefined when unset", () => {
    expect(readCsv("X", { X: "a, b ,,c\td" })).toEqual(["a", "b", "c", "d"]);
    expect(readCsv("X", { X: " , " })).toBeUndefined();
    expect(readCsv("X", { X: "${user_config.hosts}" })).toBeUndefined();
    expect(readCsv("X", {})).toBeUndefined();
  });
});

describe("readUrl", () => {
  it("returns a trimmed absolute http(s) URL and undefined when unset", () => {
    expect(readUrl("X", { X: " https://mcp.example.com/api/mcp " })).toBe("https://mcp.example.com/api/mcp");
    expect(readUrl("X", { X: "http://127.0.0.1:3000" })).toBe("http://127.0.0.1:3000");
    for (const v of UNSET_SHAPES) expect(readUrl("X", { X: v }), v).toBeUndefined();
  });

  it("throws, naming the variable, on a value that is present but not a URL", () => {
    expect(() => readUrl("BOOND_BASE_URL", { BOOND_BASE_URL: "ui.boondmanager.com/api" })).toThrow(
      /Invalid BOOND_BASE_URL/
    );
    expect(() => readUrl("MCP_HTTP_PUBLIC_URL", { MCP_HTTP_PUBLIC_URL: "ftp://x" })).toThrow(/http:\/\/ or https:\/\//);
  });
});

/**
 * The readers are only worth one test each if the modules actually go through
 * them. These assert the observable behaviour the six divergent readers got
 * wrong, at the module boundary.
 */
describe("modules read through the shared reader", () => {
  const SET_IN_PROCESS = [
    "MCP_HTTP_PATH",
    "MCP_HTTP_HOST",
    "MCP_HTTP_PUBLIC_URL",
    "MCP_HTTP_STATEFUL",
    "BOOND_HTTP_STATIC_AUTH",
    "MCP_HTTP_ALLOWED_HOSTS",
    "BOOND_OAUTH_AUTHORIZATION_SERVER",
    "BOOND_OAUTH_SCOPES",
    "BOOND_DISABLE_UPDATE_CHECK",
  ];
  afterEach(() => {
    for (const k of SET_IN_PROCESS) delete process.env[k];
  });

  it("a blank MCP_HTTP_PATH / MCP_HTTP_HOST falls back to the default instead of becoming the path", () => {
    process.env["MCP_HTTP_PATH"] = " ";
    process.env["MCP_HTTP_HOST"] = "${user_config.host}";
    const opts = resolveHttpOptions();
    expect(opts.path).toBe("/mcp");
    expect(opts.host).toBe("127.0.0.1");
  });

  it("a blank BOOND_OAUTH_AUTHORIZATION_SERVER keeps the default issuer; a malformed one throws", () => {
    process.env["BOOND_OAUTH_AUTHORIZATION_SERVER"] = "  ";
    expect(resolveAuthorizationServer()).toBe("https://ui.boondmanager.com");
    process.env["BOOND_OAUTH_AUTHORIZATION_SERVER"] = "not a url";
    expect(() => resolveAuthorizationServer()).toThrow(/Invalid BOOND_OAUTH_AUTHORIZATION_SERVER/);
    process.env["BOOND_OAUTH_SCOPES"] = "${user_config.scopes}";
    expect(resolveAdvertisedScopes()).toEqual([]);
  });

  it("a malformed MCP_HTTP_PUBLIC_URL stops start-up with a readable message", () => {
    process.env["MCP_HTTP_PUBLIC_URL"] = "mcp.example.com/mcp";
    expect(() => resolveHttpOptions()).toThrow(/Invalid MCP_HTTP_PUBLIC_URL/);
  });

  it("booleans accept 'false' as off and blank as default on the HTTP transport", () => {
    process.env["MCP_HTTP_STATEFUL"] = "false";
    process.env["BOOND_HTTP_STATIC_AUTH"] = "${user_config.static}";
    const opts = resolveHttpOptions();
    expect(opts.stateless).toBe(true);
    expect(opts.staticAuth).toBe(false);
    process.env["MCP_HTTP_STATEFUL"] = "on";
    expect(resolveHttpOptions().stateless).toBe(false);
  });

  it("a blank MCP_HTTP_ALLOWED_HOSTS is unconfigured, not an empty allow-list", () => {
    process.env["MCP_HTTP_ALLOWED_HOSTS"] = " , ";
    expect(resolveHttpOptions().allowedHosts).toBeUndefined();
  });

  it("access policy and dictionary overrides ignore blank / placeholder values", () => {
    const policy = resolveAccessPolicy({
      BOOND_MCP_DOMAINS: "  ",
      BOOND_MCP_PROFILE: "${user_config.profile}",
      BOOND_MCP_READ_ONLY: "false",
    });
    expect(policy.allowedDomains).toBeNull();
    expect([...policy.operations].sort()).toEqual(["create", "delete", "read", "update"]);
    expect(loadDictionaryOverrides({ BOOND_DICTIONARY_OVERRIDES: "\t" })).toBeNull();
  });

  it("update-check opt-out and logger settings follow the same rule", () => {
    process.env["BOOND_DISABLE_UPDATE_CHECK"] = "${user_config.x}";
    expect(isUpdateCheckDisabled()).toBe(false);
    process.env["BOOND_DISABLE_UPDATE_CHECK"] = "on";
    expect(isUpdateCheckDisabled()).toBe(true);
    expect(resolveLogLevel({ LOG_LEVEL: "  " })).toBe("info");
    expect(resolveLogLevel({ LOG_LEVEL: " DEBUG " })).toBe("debug");
    expect(usePrettyOutput({ LOG_FORMAT: " json " })).toBe(false);
    expect(usePrettyOutput({ LOG_FORMAT: "${x}", NODE_ENV: "" })).toBe(true);
  });
});
