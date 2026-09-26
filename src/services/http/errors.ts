/**
 * Error shaping for BoondManager responses: JSON:API error envelope parsing,
 * Cloudflare block detection, status-specific hints and the typed
 * `BoondApiError`. Pure functions — nothing here touches the network.
 */
import { oauthContext } from "../oauth.js";

/**
 * Pull the human-readable bits out of a BoondManager error body.
 *
 * Boond returns JSON:API errors of the form:
 *   { "errors": [ { "status": "422", "code": "422", "detail": "...", "title": "..." } ] }
 *
 * Surfacing `detail` (and `title` when present) gives the model a focused
 * message like `422 - password mismatch` instead of the full ~500-char body
 * dump that previously made it hard for the LLM to reason about the failure.
 *
 * Exported for unit testing.
 */
export function parseBoondErrorBody(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as {
      errors?: Array<{
        detail?: string;
        title?: string;
        code?: string;
        source?: { parameter?: string; pointer?: string };
      }>;
    };
    const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
    const messages = errors
      .map((e) => {
        const parts: string[] = [];
        if (e.title && e.title !== e.detail) parts.push(e.title);
        if (e.detail) parts.push(e.detail);
        else if (e.code) parts.push(`code ${e.code}`);
        // Boond's JSON:API errors put the offending query/body field in
        // source.parameter (or source.pointer). Surfacing it turns the
        // otherwise-opaque "1017 - Missing required attribute" into
        // "1017 - Missing required attribute (parameter: startMonth)".
        const ref = e.source?.parameter ?? e.source?.pointer;
        const head = parts.join(": ").trim();
        if (!head) return ref ? `parameter: ${ref}` : "";
        return ref ? `${head} (parameter: ${ref})` : head;
      })
      .filter((m) => m.length > 0);
    if (messages.length === 0) return null;
    return messages.join(" | ");
  } catch {
    return null;
  }
}

/**
 * What a caller can do about a BoondManager 401, which depends on who holds
 * the credentials (issue #234). Under the HTTP OAuth transport the token
 * belongs to the MCP client, and the only remedy is a new authorization —
 * there is no CLI to re-run (the historical hint named one that is no longer
 * shipped). With env credentials it is the operator's configuration.
 */
export function hintForUnauthorized(): string {
  if (oauthContext.getStore()) {
    return (
      "The BoondManager access token was rejected (expired or revoked). Re-authorize the connector from the MCP client. " +
      'With MCP_HTTP_VALIDATE_TOKEN=true the server answers the next request with HTTP 401 + `error="invalid_token"`, ' +
      "which makes spec-compliant clients restart the OAuth flow on their own; otherwise disconnect and reconnect the server in the client."
    );
  }
  return "Authentication failed. Verify BOOND_USER_TOKEN + BOOND_CLIENT_TOKEN + BOOND_CLIENT_KEY (or BOOND_API_TOKEN, or BOOND_USER + BOOND_PASSWORD).";
}

/**
 * A non-2xx answer from BoondManager, with the status kept as data so callers
 * (the HTTP transport's token validation, #234) can branch on it instead of
 * parsing the message. The message is unchanged from the plain `Error` this
 * replaces — `formatApiError()` output.
 */
export class BoondApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  constructor(message: string, status: number, method: string, path: string) {
    super(message);
    this.name = "BoondApiError";
    this.status = status;
    this.method = method;
    this.path = path;
  }
}

/** Status-specific hint to help the LLM (or human) recover from common failures. */
function hintForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Check the request body or query parameters — likely a malformed field.";
    case 401:
      return hintForUnauthorized();
    case 403:
      return "Authenticated, but the user lacks permission for this endpoint or scope.";
    case 404:
      return "Endpoint or entity not found. Double-check the id and the API path.";
    case 422:
      return "Unprocessable: typically wrong credentials (the API returns 422 for password mismatch) or a query parameter the API rejects.";
    case 429:
      return "Rate-limited. Back off and retry after a few seconds.";
    default:
      if (status >= 500) return "BoondManager-side error. Retrying after a short delay usually helps.";
      return "Check your credentials and permissions for this endpoint.";
  }
}

/**
 * Detect whether the response body looks like a Cloudflare WAF challenge or
 * block page rather than a BoondManager JSON:API response. When this is true,
 * the upstream service is unreachable and the JSON:API hint above is
 * misleading — the request never reached BoondManager.
 */
function containsCloudflareChallengeHost(htmlSnippet: string): boolean {
  const urlMatches = htmlSnippet.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  for (const rawUrl of urlMatches) {
    try {
      const hostname = new URL(rawUrl).hostname.toLowerCase();
      if (hostname === "challenges.cloudflare.com" || hostname.endsWith(".challenges.cloudflare.com")) {
        return true;
      }
    } catch {
      // Ignore unparsable URL fragments in HTML.
    }
  }
  return false;
}

function looksLikeCloudflareBlock(body: string): boolean {
  if (!body) return false;
  const head = body.slice(0, 1000).toLowerCase();
  if (!head.includes("<!doctype html") && !head.includes("<html")) return false;
  return (
    head.includes("cloudflare") ||
    head.includes("attention required") ||
    head.includes("just a moment") ||
    head.includes("cf-ray") ||
    containsCloudflareChallengeHost(head)
  );
}

/** Build the Error message for a non-2xx HTTP response. Exported for testing. */
export function formatApiError(status: number, statusText: string, method: string, path: string, body: string): string {
  const detail = parseBoondErrorBody(body);
  const cloudflareBlocked = looksLikeCloudflareBlock(body);
  const headline = cloudflareBlocked
    ? `BoondManager API ${status} ${statusText} — request blocked by Cloudflare WAF before reaching the API`
    : detail
      ? `BoondManager API ${status} ${statusText}: ${detail}`
      : `BoondManager API ${status} ${statusText}`;
  const lines = [headline, `Endpoint: ${method} ${path}`];
  // Only attach the raw body when we couldn't extract a structured detail
  // and we don't already know it's a Cloudflare HTML page — in either case
  // the raw HTML/error chunk just buries the useful message.
  if (!detail && !cloudflareBlocked && body) {
    const trimmed = body.length > 500 ? body.slice(0, 500) + "…" : body;
    lines.push(`Body: ${trimmed}`);
  }
  if (cloudflareBlocked) {
    lines.push(
      "Hint: The BoondManager edge (Cloudflare) blocked this request. " +
        "This often means the endpoint is restricted on this tenant, or you've made too many calls in a short window. " +
        "Wait a few seconds and retry; if it persists, the endpoint is not enabled for this account."
    );
  } else {
    lines.push(`Hint: ${hintForStatus(status)}`);
  }
  return lines.join("\n");
}

/** The error every helper raises when an attempt never completed within `BOOND_HTTP_TIMEOUT_MS`. */
export function timeoutError(timeoutMs: number, method: string, path: string, cause: unknown): Error {
  return new Error(
    [
      `BoondManager API request timed out after ${timeoutMs}ms`,
      `Endpoint: ${method} ${path}`,
      "Hint: Increase BOOND_HTTP_TIMEOUT_MS or check connectivity to the BoondManager API.",
    ].join("\n"),
    { cause }
  );
}

/**
 * A 2xx whose body is not JSON. Before #239 this surfaced as a bare
 * `SyntaxError: Unexpected token '<'` with no endpoint — indistinguishable
 * from a bug in the server — although it almost always means the request hit
 * the application shell or a WAF page rather than the API.
 */
export function nonJsonResponseError(status: number, method: string, path: string, cause: unknown): Error {
  return new Error(
    [
      `BoondManager API answered HTTP ${status} with a body that is not JSON.`,
      `Endpoint: ${method} ${path}`,
      "Hint: The response is probably an HTML page (application shell, Cloudflare challenge). Check the path and the tenant's access to this endpoint.",
    ].join("\n"),
    { cause }
  );
}
