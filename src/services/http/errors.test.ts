import { describe, it, expect, vi } from "vitest";
import { initClient, resetClientForTests } from "./auth.js";
import { parseBoondErrorBody, hintForUnauthorized, BoondApiError, formatApiError } from "./errors.js";
import { resetRateLimiterForTests } from "./rate-limit.js";
import { apiRequest } from "./transport.js";
import { oauthContext } from "../oauth.js";

describe("parseBoondErrorBody", () => {
  it("returns the detail of a single error", () => {
    expect(
      parseBoondErrorBody(
        JSON.stringify({
          errors: [{ status: "422", detail: "422 - password mismatch" }],
        })
      )
    ).toBe("422 - password mismatch");
  });

  it("joins multiple errors with a separator", () => {
    expect(
      parseBoondErrorBody(
        JSON.stringify({
          errors: [{ detail: "first thing wrong" }, { detail: "second thing wrong" }],
        })
      )
    ).toBe("first thing wrong | second thing wrong");
  });

  it("includes title when distinct from detail", () => {
    expect(
      parseBoondErrorBody(
        JSON.stringify({
          errors: [{ title: "Forbidden", detail: "user cannot access this scope" }],
        })
      )
    ).toBe("Forbidden: user cannot access this scope");
  });

  it("falls back to code when detail is missing", () => {
    expect(
      parseBoondErrorBody(
        JSON.stringify({
          errors: [{ code: "503" }],
        })
      )
    ).toBe("code 503");
  });

  it("returns null on non-JSON body", () => {
    expect(parseBoondErrorBody("Internal Server Error")).toBeNull();
  });

  it("returns null when there are no errors[]", () => {
    expect(parseBoondErrorBody(JSON.stringify({ meta: {} }))).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(parseBoondErrorBody("")).toBeNull();
  });

  it("includes source.parameter so the LLM can see which field triggered the error", () => {
    // Without surfacing source.parameter, "1017 - Missing required attribute"
    // is opaque — it's the parameter name (startMonth, category, etc.) that
    // tells the caller what to add.
    expect(
      parseBoondErrorBody(
        JSON.stringify({
          errors: [{ detail: "1017 - Missing required attribute", source: { parameter: "startMonth" } }],
        })
      )
    ).toBe("1017 - Missing required attribute (parameter: startMonth)");
  });

  it("falls back to source.pointer when parameter is absent", () => {
    expect(
      parseBoondErrorBody(
        JSON.stringify({
          errors: [{ detail: "validation failed", source: { pointer: "/data/attributes/email" } }],
        })
      )
    ).toBe("validation failed (parameter: /data/attributes/email)");
  });
});

describe("formatApiError", () => {
  it("uses the parsed Boond detail in the headline and skips the raw body", () => {
    const body = JSON.stringify({ errors: [{ detail: "422 - password mismatch" }] });
    const msg = formatApiError(422, "Unprocessable Entity", "GET", "/resources", body);
    expect(msg).toContain("BoondManager API 422 Unprocessable Entity: 422 - password mismatch");
    expect(msg).toContain("Endpoint: GET /resources");
    expect(msg).toContain("Hint:");
    // raw body must not be repeated when we have a structured detail
    expect(msg).not.toContain(body);
  });

  it("falls back to a (truncated) raw body when JSON parsing fails", () => {
    const body = "x".repeat(800);
    const msg = formatApiError(500, "Server Error", "GET", "/resources", body);
    expect(msg).toContain("BoondManager API 500 Server Error");
    expect(msg).toContain("Body: " + "x".repeat(500) + "…");
    expect(msg).toContain("Hint:");
  });

  it("emits a 401-specific hint", () => {
    const msg = formatApiError(401, "Unauthorized", "GET", "/resources", "");
    expect(msg).toContain("Authentication failed");
  });

  it("emits a 5xx-specific hint", () => {
    const msg = formatApiError(503, "Service Unavailable", "GET", "/resources", "");
    expect(msg).toContain("BoondManager-side error");
  });

  it("recognises a Cloudflare WAF block and replaces the misleading status hint", () => {
    const cfBody =
      "<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title>" +
      "<meta http-equiv='cf-ray' content='abc'></head><body>Just a moment...</body></html>";
    const msg = formatApiError(403, "Forbidden", "GET", "/advantages", cfBody);
    expect(msg).toContain("blocked by Cloudflare WAF");
    // Generic 403 hint is replaced because it's misleading (the request
    // never reached BoondManager — it isn't a permission issue).
    expect(msg).not.toContain("the user lacks permission");
    // The HTML body itself isn't echoed.
    expect(msg).not.toContain("<html>");
  });
});

describe("401 hint and typed API errors (#234)", () => {
  it("names re-authorization, not a CLI that no longer ships, under the OAuth transport", () => {
    const hint = oauthContext.run({ accessToken: "t" }, () => hintForUnauthorized());
    expect(hint).toContain("Re-authorize the connector");
    expect(hint).toContain("MCP_HTTP_VALIDATE_TOKEN");
    expect(hint).not.toContain("oauth-login");
    expect(hint).not.toContain("BOOND_USER_TOKEN");
  });

  it("points at the env credentials outside the OAuth transport", () => {
    const hint = hintForUnauthorized();
    expect(hint).toContain("BOOND_USER_TOKEN");
    expect(hint).not.toContain("oauth-login");
    expect(hint).not.toContain("Re-authorize");
  });

  it("formatApiError(401) carries the transport-aware hint", () => {
    const inOauth = oauthContext.run({ accessToken: "t" }, () => formatApiError(401, "Unauthorized", "GET", "/x", ""));
    expect(inOauth).toContain("Re-authorize the connector");
    expect(formatApiError(401, "Unauthorized", "GET", "/x", "")).toContain("BOOND_USER_TOKEN");
  });

  it("apiRequest throws a BoondApiError with the status, same message as before", async () => {
    process.env.BOOND_API_TOKEN = "test-token";
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0";
    process.env.BOOND_HTTP_MAX_RETRIES = "0";
    resetRateLimiterForTests();
    resetClientForTests();
    initClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        headers: new Headers(),
        text: () => Promise.resolve('{"errors":[{"detail":"token expired"}]}'),
      })
    );
    try {
      const err = await apiRequest("/application/current-user").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BoondApiError);
      expect((err as BoondApiError).status).toBe(401);
      expect((err as BoondApiError).path).toBe("/application/current-user");
      expect((err as Error).message).toBe(
        formatApiError(
          401,
          "Unauthorized",
          "GET",
          "/application/current-user",
          '{"errors":[{"detail":"token expired"}]}'
        )
      );
    } finally {
      vi.unstubAllGlobals();
      delete process.env.BOOND_API_TOKEN;
      delete process.env.BOOND_HTTP_RATE_LIMIT_RPS;
      delete process.env.BOOND_HTTP_MAX_RETRIES;
      resetRateLimiterForTests();
      resetClientForTests();
    }
  });
});
