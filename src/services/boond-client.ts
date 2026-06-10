import { createHmac } from "crypto";
import {
  DEFAULT_BASE_URL,
  CHARACTER_LIMIT,
  DEFAULT_HTTP_TIMEOUT_MS,
  DEFAULT_HTTP_MAX_RETRIES,
  DEFAULT_HTTP_RETRY_BASE_MS,
  DEFAULT_HTTP_RETRY_MAX_MS,
  DEFAULT_HTTP_RATE_LIMIT_RPS,
  DEFAULT_HTTP_RATE_LIMIT_BURST,
} from "../constants.js";
import type { BoondAuthProvider, BoondConfig, JsonApiResponse, SearchParams } from "../types.js";
import { TokenBucket } from "./rate-limiter.js";
import { oauthContext } from "./oauth.js";

let config: BoondConfig | null = null;

/**
 * Auth provider for the HTTP transport: reads the Bearer token from the
 * per-request AsyncLocalStorage populated by the transport layer and
 * forwards it verbatim to BoondManager as `Authorization: Bearer …`.
 *
 * Errors out clearly if called outside a request context — which would
 * indicate that the transport layer forgot to wrap the request in
 * `oauthContext.run(...)`.
 */
export const oauthContextAuth: BoondAuthProvider = async () => {
  const ctx = oauthContext.getStore();
  if (!ctx) {
    throw new Error(
      "No OAuth access token in request context. The HTTP transport requires an `Authorization: Bearer <boond_access_token>` header on every request."
    );
  }
  return { name: "Authorization", value: `Bearer ${ctx.accessToken}` };
};

function base64url(data: string | Buffer): string {
  const b64 = Buffer.from(data).toString("base64");
  return b64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Build the BoondManager HS256 JWT. By default the payload is exactly
 * `{ userToken, clientToken }` (BoondManager's documented scheme). When
 * `expiresInSeconds` is provided, standard `iat`/`exp` claims are added so the
 * generated token is no longer replayable forever if it leaks — this requires
 * regenerating the token per request (see `jwtAuth`). Opt-in because not every
 * BoondManager deployment is known to honour `exp`.
 */
export function buildJwt(
  userToken: string,
  clientToken: string,
  clientKey: string,
  options?: { expiresInSeconds?: number; nowSeconds?: number }
): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims: Record<string, unknown> = { userToken, clientToken };
  if (options?.expiresInSeconds && options.expiresInSeconds > 0) {
    const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
    claims.iat = now;
    claims.exp = now + options.expiresInSeconds;
  }
  const payload = base64url(JSON.stringify(claims));
  const signature = base64url(createHmac("sha256", clientKey).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

/** Return the env value if it is a real user-supplied value, or undefined otherwise. */
function envOrUndefined(key: string): string | undefined {
  const v = process.env[key];
  if (!v || v.startsWith("${")) return undefined;
  return v;
}

export const JWT_HEADER_NAME = "X-Jwt-Client-Boondmanager";

/**
 * Wrap a static header pair in the dynamic AuthProvider contract.
 * Used by the stdio transport, which sticks to the JWT / BasicAuth paths.
 */
function staticAuth(name: string, value: string): BoondAuthProvider {
  const cached = Promise.resolve({ name, value });
  return () => cached;
}

/**
 * JWT auth provider. When `ttlSeconds` is set (via BOOND_JWT_TTL_SECONDS), a
 * fresh token with `iat`/`exp` is minted per request so a leaked token expires;
 * otherwise the token is built once and cached (legacy, never-expiring).
 */
function jwtAuth(
  userToken: string,
  clientToken: string,
  clientKey: string,
  ttlSeconds: number | undefined
): BoondAuthProvider {
  if (!ttlSeconds || ttlSeconds <= 0) {
    return staticAuth(JWT_HEADER_NAME, buildJwt(userToken, clientToken, clientKey));
  }
  return () =>
    Promise.resolve({
      name: JWT_HEADER_NAME,
      value: buildJwt(userToken, clientToken, clientKey, { expiresInSeconds: ttlSeconds }),
    });
}

export function initClient(): void {
  const baseUrl = envOrUndefined("BOOND_BASE_URL") || DEFAULT_BASE_URL;

  // Auth priority (stdio transport):
  // 1. Build JWT from components (userToken + clientToken + clientKey)
  // 2. Pre-built JWT token
  // 3. BasicAuth (user:password)
  //
  // Per BoondManager's JWT spec the token must travel in the
  // `X-Jwt-Client-Boondmanager` header — sending it as `Authorization: Bearer`
  // makes the API reject the request with 422 "Signature verification failed".
  // BasicAuth, on the other hand, uses the standard `Authorization` header.
  //
  // HTTP transport uses OAuth2 exclusively — see `initClientWithAuth`.
  const userToken = envOrUndefined("BOOND_USER_TOKEN");
  const clientToken = envOrUndefined("BOOND_CLIENT_TOKEN");
  const clientKey = envOrUndefined("BOOND_CLIENT_KEY");
  const token = envOrUndefined("BOOND_API_TOKEN");
  const user = envOrUndefined("BOOND_USER");
  const password = envOrUndefined("BOOND_PASSWORD");

  let auth: BoondAuthProvider;

  if (userToken && clientToken && clientKey) {
    const ttlRaw = envOrUndefined("BOOND_JWT_TTL_SECONDS");
    const ttlSeconds = ttlRaw ? Number(ttlRaw) : undefined;
    auth = jwtAuth(userToken, clientToken, clientKey, Number.isFinite(ttlSeconds) ? ttlSeconds : undefined);
  } else if (token) {
    auth = staticAuth(JWT_HEADER_NAME, token);
  } else if (user && password) {
    auth = staticAuth("Authorization", `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`);
  } else {
    throw new Error(
      "Authentication required. Set BOOND_USER_TOKEN + BOOND_CLIENT_TOKEN + BOOND_CLIENT_KEY, or BOOND_API_TOKEN, or both BOOND_USER and BOOND_PASSWORD."
    );
  }

  config = { baseUrl, auth };
}

/**
 * Install a custom auth provider — used by the HTTP transport bootstrap to
 * wire in an OAuth2 token source (where the access token is refreshed
 * transparently per request rather than baked in at startup).
 */
export function initClientWithAuth(auth: BoondAuthProvider, baseUrl?: string): void {
  config = {
    baseUrl: baseUrl ?? envOrUndefined("BOOND_BASE_URL") ?? DEFAULT_BASE_URL,
    auth,
  };
}

/** Test helper — reset the cached config so the next call re-initialises. */
export function resetClientForTests(): void {
  config = null;
}

function getConfig(): BoondConfig {
  if (!config) {
    initClient();
  }
  return config!;
}

export type QueryValue = string | number | Array<string | number> | undefined;

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
 * Resolve the per-request HTTP timeout in milliseconds.
 *
 * Reads BOOND_HTTP_TIMEOUT_MS at call time so tests / runtime overrides take
 * effect without restarting the process. Falls back to the default for
 * unset, non-numeric, or non-positive values.
 *
 * Exported for unit testing.
 */
export function resolveTimeoutMs(): number {
  const raw = envOrUndefined("BOOND_HTTP_TIMEOUT_MS");
  if (!raw) return DEFAULT_HTTP_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_HTTP_TIMEOUT_MS;
  return Math.floor(parsed);
}

/** True when an error from fetch() came from an AbortSignal firing. */
function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // AbortSignal.timeout() rejects with a DOMException whose name is "TimeoutError";
  // generic aborts surface as "AbortError". Both indicate the request never
  // completed end-to-end and should be reported as a timeout.
  return err.name === "TimeoutError" || err.name === "AbortError";
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

function readPositiveInt(name: string, fallback: number, allowZero = false): number {
  const raw = envOrUndefined(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return fallback;
  if (parsed === 0 && !allowZero) return fallback;
  return Math.floor(parsed);
}

/** Resolve retry configuration from env, with safe fallbacks. Exported for tests. */
export function resolveRetryConfig(): RetryConfig {
  return {
    maxRetries: readPositiveInt("BOOND_HTTP_MAX_RETRIES", DEFAULT_HTTP_MAX_RETRIES, true),
    baseDelayMs: readPositiveInt("BOOND_HTTP_RETRY_BASE_MS", DEFAULT_HTTP_RETRY_BASE_MS),
    maxDelayMs: readPositiveInt("BOOND_HTTP_RETRY_MAX_MS", DEFAULT_HTTP_RETRY_MAX_MS),
  };
}

/**
 * Decide whether a failed attempt is worth retrying.
 *
 * Retry policy is intentionally conservative for non-idempotent verbs to avoid
 * silently duplicating writes when the server's response was lost or delayed:
 *   - 429 (Too Many Requests) is always retried — the server explicitly
 *     rejected the request before processing it, so it is safe regardless of
 *     verb.
 *   - For GET only, 5xx responses, network failures, and timeouts are retried
 *     because GET is idempotent.
 *   - 4xx responses (other than 429) are never retried — the client must change
 *     the request before another attempt makes sense.
 *
 * Exported for unit testing.
 */
export function isRetryable(method: string, status: number | undefined, isNetworkOrTimeout: boolean): boolean {
  if (status === 429) return true;
  if (method !== "GET") return false;
  if (isNetworkOrTimeout) return true;
  if (status !== undefined && status >= 500 && status < 600) return true;
  return false;
}

/**
 * Parse a `Retry-After` header value into milliseconds.
 *
 * Accepts either a non-negative number of seconds or an HTTP-date. Returns
 * null when the value is absent or unparseable. Negative computed delays are
 * clamped to 0. Exported for unit testing.
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    // Numeric form is authoritative once we recognise it as a number — falling
    // through to Date.parse on a negative/odd numeric would silently produce
    // weird timestamps (e.g. Date.parse("-1") → year -1).
    return seconds >= 0 ? Math.floor(seconds * 1000) : null;
  }
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return null;
}

/**
 * Compute the next backoff delay using full jitter:
 *   delay = random(0, min(maxMs, baseMs * 2^attempt))
 *
 * Full jitter (vs. exponential-only) reduces thundering-herd risk when many
 * clients retry in lockstep. Exported for unit testing.
 */
export function computeBackoffMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random
): number {
  const exp = baseMs * 2 ** attempt;
  const capped = Math.min(maxMs, exp);
  return Math.floor(random() * capped);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RateLimitConfig {
  rps: number;
  burst: number;
}

/**
 * Read rate-limit env vars. `rps` of 0 (or non-numeric) disables rate
 * limiting entirely. `burst` falls back to `rps * 2` when unset, mirroring
 * the documented default behaviour. Exported for unit testing.
 */
export function resolveRateLimitConfig(): RateLimitConfig | null {
  const rpsRaw = envOrUndefined("BOOND_HTTP_RATE_LIMIT_RPS");
  const rps = rpsRaw === undefined ? DEFAULT_HTTP_RATE_LIMIT_RPS : Number(rpsRaw);
  if (!Number.isFinite(rps) || rps <= 0) return null;
  const burstRaw = envOrUndefined("BOOND_HTTP_RATE_LIMIT_BURST");
  let burst: number;
  if (burstRaw === undefined) {
    burst = rpsRaw === undefined ? DEFAULT_HTTP_RATE_LIMIT_BURST : Math.max(1, Math.ceil(rps));
  } else {
    const parsed = Number(burstRaw);
    burst = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : Math.max(1, Math.ceil(rps));
  }
  return { rps, burst };
}

let rateLimiter: TokenBucket | null = null;
let rateLimiterInitialised = false;

function getRateLimiter(): TokenBucket | null {
  if (rateLimiterInitialised) return rateLimiter;
  const config = resolveRateLimitConfig();
  rateLimiter = config ? new TokenBucket(config.burst, config.rps) : null;
  rateLimiterInitialised = true;
  return rateLimiter;
}

/**
 * Reset the cached rate limiter so the next request re-reads env vars.
 * Intended for tests that toggle `BOOND_HTTP_RATE_LIMIT_*` between cases.
 */
export function resetRateLimiterForTests(): void {
  rateLimiter = null;
  rateLimiterInitialised = false;
}

/** Status-specific hint to help the LLM (or human) recover from common failures. */
function hintForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Check the request body or query parameters — likely a malformed field.";
    case 401:
      return "Authentication failed. Verify BOOND_USER_TOKEN + BOOND_CLIENT_TOKEN + BOOND_CLIENT_KEY (or BOOND_API_TOKEN, or BOOND_USER + BOOND_PASSWORD). On HTTP transport, the OAuth access token may have expired — re-run boondmanager-mcp-oauth-login.";
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

/**
 * Defense-in-depth against path traversal / query injection through entity
 * ids interpolated into API paths at ~40 call sites. Even though the id
 * schemas are now numeric-only, a future tool could forget to validate, so we
 * assert here that the path is well-formed: it must start with `/`, carry no
 * query (`?`) or fragment (`#`) — those arrive via `queryParams`, never the
 * path — and contain no traversal (`..`) or percent/backslash escapes. Built
 * paths only ever combine static segments with numeric ids and hyphenated tab
 * names, so this rejects nothing legitimate. Exported for unit testing.
 */
export function assertSafeApiPath(path: string): void {
  if (!path.startsWith("/")) {
    throw new Error(`Invalid API path (must start with "/"): ${path}`);
  }
  // `?`/`#` would inject a query/fragment; `%`/`\` could encode a traversal;
  // `..` is a literal traversal segment.
  if (/[?#%\\]/.test(path) || path.includes("..")) {
    throw new Error(`Unsafe API path rejected: ${path}`);
  }
}

export async function apiRequest(
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
  queryParams?: Record<string, QueryValue>
): Promise<JsonApiResponse> {
  const { baseUrl, auth } = getConfig();

  assertSafeApiPath(path);

  const url = new URL(`${baseUrl}${path}`);

  // Belt-and-braces: confirm the constructed URL did not escape the API base
  // origin/path despite the textual guard above.
  const base = new URL(baseUrl);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error(`API path escaped the configured base URL: ${path}`);
  }

  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        // BoondManager expects repeated bracket notation: key[]=v1&key[]=v2
        const bracketKey = key.endsWith("[]") ? key : `${key}[]`;
        for (const v of value) {
          if (v !== undefined && v !== null && v !== "") {
            url.searchParams.append(bracketKey, String(v));
          }
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const timeoutMs = resolveTimeoutMs();
  const retry = resolveRetryConfig();
  const totalAttempts = retry.maxRetries + 1;

  const buildBody = (): string | undefined =>
    body && (method === "POST" || method === "PUT" || method === "PATCH") ? JSON.stringify(body) : undefined;
  const serializedBody = buildBody();

  let lastError: Error | undefined;

  const limiter = getRateLimiter();

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    // Acquire a token before each attempt so retries also count toward the
    // rate budget — this is what actually protects us from feedback loops
    // (transient 5xx → retry → transient 5xx → …) saturating the API.
    if (limiter) await limiter.acquire();

    // Resolve the auth header per-attempt so OAuth2 refreshes are picked
    // up between retries (the access token may have expired since the
    // previous attempt).
    const authHeader = await auth();
    const headers: Record<string, string> = {
      [authHeader.name]: authHeader.value,
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      // Each attempt gets its own abort signal — once a signal has fired it
      // can't be reused for the next try.
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (serializedBody !== undefined) {
      fetchOptions.body = serializedBody;
    }

    let response: Response | undefined;
    let networkError: Error | undefined;

    try {
      response = await fetch(url.toString(), fetchOptions);
    } catch (err) {
      if (isAbortError(err)) {
        networkError = new Error(
          [
            `BoondManager API request timed out after ${timeoutMs}ms`,
            `Endpoint: ${method} ${path}`,
            "Hint: Increase BOOND_HTTP_TIMEOUT_MS or check connectivity to the BoondManager API.",
          ].join("\n"),
          { cause: err }
        );
      } else {
        networkError = err instanceof Error ? err : new Error(String(err));
      }
    }

    if (response && response.ok) {
      // DELETE may return empty body
      if (response.status === 204 || response.headers.get("content-length") === "0") {
        return { data: [] };
      }
      return (await response.json()) as JsonApiResponse;
    }

    let attemptError: Error;
    let retryAfterMs: number | null = null;
    let isNetworkOrTimeout = false;

    if (response) {
      const errorText = await response.text().catch(() => "");
      attemptError = new Error(formatApiError(response.status, response.statusText, method, path, errorText));
    } else {
      attemptError = networkError!;
      isNetworkOrTimeout = true;
    }

    const hasMoreAttempts = attempt < totalAttempts - 1;
    const retryable = isRetryable(method, response?.status, isNetworkOrTimeout);

    if (!hasMoreAttempts || !retryable) {
      throw attemptError;
    }

    // Only inspect Retry-After when we've actually decided to retry — keeps
    // the fast path off the headers object and matches existing tests that
    // build minimal Response stubs.
    if (response) {
      retryAfterMs = parseRetryAfter(response.headers?.get("retry-after") ?? null);
    }

    const backoff =
      retryAfterMs !== null
        ? Math.min(retry.maxDelayMs, retryAfterMs)
        : computeBackoffMs(attempt, retry.baseDelayMs, retry.maxDelayMs);
    await sleep(backoff);
    lastError = attemptError;
  }

  // Defensive — the loop always returns or throws. If somehow exhausted:
  throw lastError ?? new Error("BoondManager API request exhausted retries with no recorded error.");
}

export function buildSearchQuery(params: SearchParams): Record<string, QueryValue> {
  const query: Record<string, QueryValue> = {};

  if (params.keywords) query["keywords"] = params.keywords;
  if (params.page !== undefined) query["page"] = params.page;
  if (params.pageSize !== undefined) query["maxResults"] = params.pageSize;

  // Forward any additional filter params (strings, numbers, or arrays)
  for (const [key, value] of Object.entries(params)) {
    if (["keywords", "page", "pageSize"].includes(key)) continue;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      // Pass arrays through so apiRequest emits repeated bracket notation
      query[key] = value as Array<string | number>;
    } else if (typeof value === "string" || typeof value === "number") {
      query[key] = value;
    } else {
      query[key] = String(value);
    }
  }

  return query;
}

export function formatEntitySummary(entity: unknown): string {
  // A few BoondManager endpoints (e.g. `/calendars`, `/application/dictionary`)
  // return reference items as flat objects without a JSON:API `attributes`
  // wrapper. Treating the whole entity as the attribute bag in that case
  // keeps `formatListResponse` from crashing on `attrs.firstName` and yields
  // a still-useful summary.
  const e = (entity ?? {}) as Record<string, unknown>;
  const hasAttrs = e.attributes !== undefined && e.attributes !== null && typeof e.attributes === "object";
  const attrs: Record<string, unknown> = hasAttrs ? (e.attributes as Record<string, unknown>) : e;

  const id = e.id !== undefined ? String(e.id) : undefined;
  const type = e.type !== undefined ? String(e.type) : undefined;
  const header =
    id !== undefined && type !== undefined
      ? `[${type} #${id}]`
      : id !== undefined
        ? `[#${id}]`
        : type !== undefined
          ? `[${type}]`
          : "[item]";
  const parts: string[] = [header];

  // Common name fields
  if (attrs.firstName || attrs.lastName) {
    parts.push(`${attrs.firstName || ""} ${attrs.lastName || ""}`.trim());
  }
  if (attrs.name) parts.push(String(attrs.name));
  // `value` covers the `/calendars` and dictionary-style payloads.
  if (!attrs.firstName && !attrs.lastName && !attrs.name && attrs.value !== undefined) {
    parts.push(String(attrs.value));
  }
  if (attrs.email1) parts.push(`Email: ${attrs.email1}`);
  if (attrs.phone1) parts.push(`Tel: ${attrs.phone1}`);
  if (attrs.city) parts.push(`Ville: ${attrs.city}`);
  if (attrs.state !== undefined) parts.push(`Statut: ${attrs.state}`);
  if (attrs.title) parts.push(`Titre: ${attrs.title}`);
  if (attrs.iso !== undefined && String(attrs.iso) !== id) parts.push(`ISO: ${attrs.iso}`);

  return parts.join(" | ");
}

export function formatListResponse(response: JsonApiResponse, entityType: string): string {
  const data = Array.isArray(response.data) ? response.data : [response.data];
  const total = response.meta?.totals?.rows;

  if (data.length === 0) {
    return `Aucun(e) ${entityType} trouvé(e).`;
  }

  const lines = data.map((item) => formatEntitySummary(item));
  let result = lines.join("\n");

  if (total !== undefined) {
    result = `Total: ${total} ${entityType}(s)\n\n${result}`;
  }

  if (result.length > CHARACTER_LIMIT) {
    result = result.substring(0, CHARACTER_LIMIT) + "\n\n[Résultats tronqués...]";
  }

  return result;
}

export function formatDetailResponse(response: JsonApiResponse): string {
  const entity = Array.isArray(response.data) ? response.data[0] : response.data;
  if (!entity) return "Entité non trouvée.";

  const result = JSON.stringify(
    { id: entity.id, type: entity.type, attributes: entity.attributes, relationships: entity.relationships },
    null,
    2
  );

  if (result.length > CHARACTER_LIMIT) {
    return result.substring(0, CHARACTER_LIMIT) + "\n\n[Résultat tronqué...]";
  }

  return result;
}
