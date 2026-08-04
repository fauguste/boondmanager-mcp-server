import { createHmac } from "crypto";
import {
  DEFAULT_BASE_URL,
  CHARACTER_LIMIT,
  DEFAULT_PAGE_SIZE,
  ROUTE_MAX_RESULTS,
  DEFAULT_MAX_RESULTS,
  DEFAULT_HTTP_TIMEOUT_MS,
  DEFAULT_HTTP_MAX_RETRIES,
  DEFAULT_HTTP_RETRY_BASE_MS,
  DEFAULT_HTTP_RETRY_MAX_MS,
  DEFAULT_HTTP_RATE_LIMIT_RPS,
  DEFAULT_HTTP_RATE_LIMIT_BURST,
} from "../constants.js";
import type { BoondAuthProvider, BoondConfig, JsonApiResource, JsonApiResponse, SearchParams } from "../types.js";
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

/**
 * Return the env value if it is a real user-supplied value, or undefined otherwise.
 *
 * "Real" excludes three things a config form can produce for an option the user
 * left alone — and the MCPB extension and the Claude Code plugin both build
 * their env block by substituting `${user_config.*}` into every var, so all
 * fourteen are always *defined*:
 *
 *  - `""` — an untouched optional field;
 *  - whitespace only — a field that got a stray space or a pasted newline
 *    (`BOOND_BASE_URL=" "` would otherwise become the request base URL);
 *  - `"${…}"` — a placeholder no host resolved.
 *
 * All three must read as "not configured" so the defaults apply. Same rule as
 * `readEnv` in `config/access-policy.ts` and `config/dictionary-overrides.ts`.
 */
function envOrUndefined(key: string): string | undefined {
  const v = process.env[key];
  if (!v || v.startsWith("${") || v.trim().length === 0) return undefined;
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
 * True when env-based credentials (JWT components, API token, or BasicAuth) are
 * configured. Used by the HTTP transport to decide whether static-auth mode is
 * possible without attempting a full `initClient()` call.
 */
export function hasEnvCredentials(): boolean {
  return !!(
    (envOrUndefined("BOOND_USER_TOKEN") &&
      envOrUndefined("BOOND_CLIENT_TOKEN") &&
      envOrUndefined("BOOND_CLIENT_KEY")) ||
    envOrUndefined("BOOND_API_TOKEN") ||
    (envOrUndefined("BOOND_USER") && envOrUndefined("BOOND_PASSWORD"))
  );
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

/**
 * Validates `path` and resolves it against `baseUrl`, returning the
 * constructed URL. Throws if the path is unsafe (see `assertSafeApiPath`) or
 * if the resolved URL escapes the configured API base origin/path. Centralises
 * the guard shared by apiRequest / apiDownload / apiUploadForm. Exported for
 * unit testing.
 */
export function resolveApiUrl(baseUrl: string, path: string): URL {
  assertSafeApiPath(path);
  const url = new URL(`${baseUrl}${path}`);
  // Belt-and-braces: confirm the constructed URL did not escape the API base
  // origin/path despite the textual guard above.
  const base = new URL(baseUrl);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error(`API path escaped the configured base URL: ${path}`);
  }
  return url;
}

export async function apiRequest(
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
  queryParams?: Record<string, QueryValue>
): Promise<JsonApiResponse> {
  const { baseUrl, auth } = getConfig();

  const url = resolveApiUrl(baseUrl, path);

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

/**
 * Parse the filename out of a `Content-Disposition` header. Handles the
 * common `filename="…"`/`filename=…` forms and the RFC 5987
 * `filename*=UTF-8''…` form. Returns undefined when absent. Exported for
 * unit testing.
 */
export function parseContentDispositionFilename(header: string | null): string | undefined {
  if (!header) return undefined;
  const star = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // fall through to the plain form
    }
  }
  const plain = header.match(/filename\s*=\s*"([^"]+)"/) ?? header.match(/filename\s*=\s*([^;]+)/);
  return plain ? plain[1].trim() : undefined;
}

export interface DownloadedDocument {
  data: Buffer;
  contentType: string;
  filename?: string;
}

/**
 * Download a binary payload (documents, justificatifs…) from the BoondManager
 * API. Same auth/safety/rate-limit plumbing as `apiRequest`, but the body is
 * returned raw instead of being parsed as JSON:API. Single attempt: document
 * downloads are interactive one-offs, not worth a retry loop.
 */
export async function apiDownload(path: string): Promise<DownloadedDocument> {
  const { baseUrl, auth } = getConfig();
  const url = resolveApiUrl(baseUrl, path);

  const limiter = getRateLimiter();
  if (limiter) await limiter.acquire();

  const authHeader = await auth();
  const timeoutMs = resolveTimeoutMs();
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: { [authHeader.name]: authHeader.value, Accept: "*/*" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isAbortError(err)) {
      throw new Error(
        [
          `BoondManager API request timed out after ${timeoutMs}ms`,
          `Endpoint: GET ${path}`,
          "Hint: Increase BOOND_HTTP_TIMEOUT_MS or check connectivity to the BoondManager API.",
        ].join("\n"),
        { cause: err }
      );
    }
    throw err instanceof Error ? err : new Error(String(err));
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(formatApiError(response.status, response.statusText, "GET", path, errorText));
  }

  const data = Buffer.from(await response.arrayBuffer());
  return {
    data,
    contentType: response.headers.get("content-type")?.split(";")[0].trim() || "application/octet-stream",
    filename: parseContentDispositionFilename(response.headers.get("content-disposition")),
  };
}

/**
 * POST a multipart/form-data payload to the BoondManager API (document
 * upload). Form values are simple string fields — the file itself travels by
 * reference via the `fileUrl` field (Boond downloads it server-side), so the
 * MCP server never buffers file bytes.
 */
export async function apiUploadForm(path: string, fields: Record<string, string>): Promise<JsonApiResponse> {
  const { baseUrl, auth } = getConfig();
  const url = resolveApiUrl(baseUrl, path);

  const limiter = getRateLimiter();
  if (limiter) await limiter.acquire();

  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }

  const authHeader = await auth();
  // No Content-Type header: fetch derives the multipart boundary from FormData.
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { [authHeader.name]: authHeader.value, Accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(resolveTimeoutMs()),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(formatApiError(response.status, response.statusText, "POST", path, errorText));
  }
  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return { data: [] };
  }
  return (await response.json()) as JsonApiResponse;
}

export function buildSearchQuery(params: SearchParams): Record<string, QueryValue> {
  const query: Record<string, QueryValue> = {};

  if (params.keywords) query["keywords"] = params.keywords;
  if (params.page !== undefined) query["page"] = params.page;
  if (params.pageSize !== undefined) query["maxResults"] = params.pageSize;

  // Forward any additional filter params (strings, numbers, or arrays).
  // `fields` is a client-side projection consumed by formatListResponse,
  // never a BoondManager query parameter.
  for (const [key, value] of Object.entries(params)) {
    if (["keywords", "page", "pageSize", "fields"].includes(key)) continue;
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

/**
 * Search wrapper around `apiRequest` that enforces BoondManager's per-route
 * `maxResults` ceiling (see `ROUTE_MAX_RESULTS`). When the caller requests more
 * results than the route allows, the request is transparently split into
 * chunks of `cap` records and the pages are merged into a single JSON:API
 * response — the caller still receives the full page, but BoondManager never
 * sees `maxResults` above the cap (which overflows memory on `/actions`).
 *
 * Routes whose ceiling already covers the requested page size take the fast
 * path: a single `apiRequest`, byte-for-byte identical to calling it directly.
 * The chunk count is bounded by `ceil((offset + requested) / cap)`, so there is
 * no unbounded loop; the loop also stops early once a page comes back short
 * (end of the result set on the server).
 */
export async function apiSearch(path: string, query: Record<string, QueryValue>): Promise<JsonApiResponse> {
  const cap = ROUTE_MAX_RESULTS[path] ?? DEFAULT_MAX_RESULTS;
  const requested = typeof query["maxResults"] === "number" ? query["maxResults"] : DEFAULT_PAGE_SIZE;
  const page = typeof query["page"] === "number" ? query["page"] : 1;

  // Fast path: one call, maxResults left exactly as the caller built it.
  if (requested <= cap) {
    return apiRequest(path, "GET", undefined, query);
  }

  // Chunked path: fetch `requested` records starting at the absolute offset
  // implied by (page, requested), in BoondManager pages of `cap` records.
  const startRow = (page - 1) * requested;
  const firstBoondPage = Math.floor(startRow / cap) + 1;
  const offsetInFirstChunk = startRow % cap;
  const needed = offsetInFirstChunk + requested;

  const collected: JsonApiResource[] = [];
  let meta: JsonApiResponse["meta"];

  for (let i = 0; collected.length < needed; i++) {
    const chunkQuery: Record<string, QueryValue> = { ...query, page: firstBoondPage + i, maxResults: cap };
    const response = await apiRequest(path, "GET", undefined, chunkQuery);
    if (meta === undefined) meta = response.meta;
    const chunk = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
    collected.push(...chunk);
    // A short page means there is no more data on the server — stop early.
    if (chunk.length < cap) break;
  }

  const data = collected.slice(offsetInFirstChunk, offsetInFirstChunk + requested);
  return meta !== undefined ? { data, meta } : { data };
}

/**
 * Business identifiers used as a last resort when a list row has no
 * human-readable identity (no name, no title, no dictionary `value`).
 *
 * Transactional endpoints (`/invoices`, `/orders`, `/actions`,
 * `/deliveries-groupments`, `/projects`…) key their rows on a reference, a
 * number or a date rather than on a name, so the standard summary rendered
 * them as a bare `[order #1234] | Statut: 1` — a line the model cannot act on
 * without a follow-up `_get` per row.
 *
 * These are deliberately NOT appended unconditionally: `/resources` and
 * `/opportunities` also carry `reference` and amount attributes, and their
 * rows already read well (name, title). Enriching them too would only inflate
 * every line. See `hasIdentity` in formatEntitySummary.
 */
const AMOUNT_FALLBACK_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["turnoverInvoicedExcludingTax", "CA facturé HT"],
  ["turnoverOrderedExcludingTax", "CA commandé HT"],
  ["turnoverSimulatedExcludingTax", "CA simulé HT"],
  ["averageDailyPriceExcludingTax", "TJM HT"],
];

/** Max amount entries appended to a fallback line, to keep it scannable. */
const MAX_FALLBACK_AMOUNTS = 2;

/** Max length (in code points) of the `text` excerpt used to identify an action. */
const MAX_TEXT_EXCERPT = 80;

/**
 * HTML comments, then element tags. The tag pattern requires a tag name right
 * after the `<` (or `</`), so free text such as
 * `Relancer si < 3 jours > sinon cloturer` survives intact — a naive
 * `/<[^>]*>/` swallowed everything between the two operators. Quoted attribute
 * values are matched explicitly so a `>` inside one (`<a href="a>b">`) doesn't
 * end the tag early and leak `b">` into the excerpt. The alternatives are
 * mutually exclusive on their first character, so there is no backtracking
 * blow-up on unterminated input.
 */
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const HTML_TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9:._-]*(?:\s+(?:"[^"]*"|'[^']*'|[^"'<>])*)?\/?>/g;

/** Entities actually seen in BoondManager notes (WYSIWYG output + French text). */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  agrave: "à",
  acirc: "â",
  ccedil: "ç",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  icirc: "î",
  iuml: "ï",
  ocirc: "ô",
  ugrave: "ù",
  ucirc: "û",
  uuml: "ü",
  laquo: "«",
  raquo: "»",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  deg: "°",
  euro: "€",
  ndash: "–",
  mdash: "—",
};

/** Decodes numeric and common named entities so the excerpt reads as text, not as markup. */
function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      // Surrogate code points are rejected on purpose: decoding `&#55296;`
      // would inject the very unpaired surrogate the excerpt guards against.
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return match;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Renders BoondManager's HTML note fields (`/actions`.text is a `<div>…</div>`)
 * as a short single-line excerpt. Only strings are excerpted — `text: null` and
 * nested objects are skipped by the caller rather than printed as `null` /
 * `[object Object]`.
 *
 * Truncation runs on code points (`Array.from`), never on UTF-16 code units, so
 * an emoji sitting on the boundary can't be cut into an unpaired surrogate.
 */
function textExcerpt(raw: string): string | undefined {
  const stripped = decodeHtmlEntities(raw.replace(HTML_COMMENT_RE, " ").replace(HTML_TAG_RE, " "))
    .replace(/\s+/g, " ")
    .trim();
  if (stripped === "") return undefined;
  const chars = Array.from(stripped);
  return chars.length > MAX_TEXT_EXCERPT ? `${chars.slice(0, MAX_TEXT_EXCERPT).join("")}…` : stripped;
}

/**
 * Single rendering rule for a raw JSON:API attribute value, shared by the
 * fallback summary and the `fields` projection — some Boond amounts come back
 * as `{ amount, currency }` objects, and the two paths used to disagree
 * (`[object Object]` on one side, JSON on the other).
 */
function renderAttributeValue(value: unknown): string {
  return value === null || typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * A row is considered to name itself through `value` only when that value is a
 * non-empty string once rendered. `value: null` / `value: ""` used to both
 * print a bogus token *and* suppress the business-identifier fallback.
 */
function hasValueIdentity(value: unknown): boolean {
  return value !== undefined && value !== null && renderAttributeValue(value) !== "";
}

/**
 * Secondary identifiers for rows that have no name/title/value. Order is
 * chosen so the most identifying token comes first (number, then reference,
 * then when it happened, then how much).
 */
function fallbackIdentityParts(attrs: Record<string, unknown>): string[] {
  const parts: string[] = [];

  if (attrs.number) parts.push(`N°: ${attrs.number}`);
  if (attrs.reference) parts.push(`Réf: ${attrs.reference}`);

  if (attrs.date) {
    parts.push(`Date: ${attrs.date}`);
  } else if (attrs.startDate && attrs.endDate) {
    parts.push(`Du ${attrs.startDate} au ${attrs.endDate}`);
  } else if (attrs.startDate) {
    parts.push(`Début: ${attrs.startDate}`);
  } else if (attrs.endDate) {
    parts.push(`Fin: ${attrs.endDate}`);
  }

  let amounts = 0;
  for (const [field, label] of AMOUNT_FALLBACK_FIELDS) {
    if (amounts >= MAX_FALLBACK_AMOUNTS) break;
    const value = attrs[field];
    // 0 is meaningful here (an order with no turnover yet), so only
    // undefined/null are skipped.
    if (value === undefined || value === null) continue;
    parts.push(`${label}: ${renderAttributeValue(value)}`);
    amounts++;
  }

  // `typeOf` is an integer resolved through boond://dictionary/typeOf/* — on
  // its own it is weak, but on an action it is often the only discriminator.
  if (attrs.typeOf !== undefined && attrs.typeOf !== null) parts.push(`Type: ${attrs.typeOf}`);

  // End-user-authored free text: labelled and quoted so the model reads it as
  // a data field of the row and not as server-authored instructions.
  if (typeof attrs.text === "string") {
    const excerpt = textExcerpt(attrs.text);
    if (excerpt !== undefined) parts.push(`Note: "${excerpt}"`);
  }

  return parts;
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
  // `value` covers the `/calendars` and dictionary-style payloads. `0` is a
  // legitimate label there, so only null/undefined/"" are skipped.
  if (!attrs.firstName && !attrs.lastName && !attrs.name && hasValueIdentity(attrs.value)) {
    parts.push(renderAttributeValue(attrs.value));
  }
  if (attrs.email1) parts.push(`Email: ${attrs.email1}`);
  if (attrs.phone1) parts.push(`Tel: ${attrs.phone1}`);
  if (attrs.city) parts.push(`Ville: ${attrs.city}`);
  if (attrs.state !== undefined) parts.push(`Statut: ${attrs.state}`);
  if (attrs.title) parts.push(`Titre: ${attrs.title}`);
  if (attrs.iso !== undefined && String(attrs.iso) !== id) parts.push(`ISO: ${attrs.iso}`);

  // Rows that named themselves are already useful — leave them untouched.
  // Only the ones reduced to `[type #id]` (+ maybe a status integer) get the
  // business identifiers appended.
  const hasIdentity =
    Boolean(attrs.firstName) ||
    Boolean(attrs.lastName) ||
    Boolean(attrs.name) ||
    Boolean(attrs.title) ||
    hasValueIdentity(attrs.value);
  if (!hasIdentity) {
    parts.push(...fallbackIdentityParts(attrs));
  }

  return parts.join(" | ");
}

/**
 * One result line restricted to the caller-selected attribute names.
 * Unknown names are skipped silently (the schemas document this), so a typo
 * degrades to a shorter line rather than an error. Non-primitive values are
 * JSON-serialised — some Boond attributes are nested objects.
 */
function formatProjectedSummary(entity: unknown, fields: string[]): string {
  const e = (entity ?? {}) as Record<string, unknown>;
  const attrs = (e.attributes ?? e) as Record<string, unknown>;
  // Reference endpoints return flat rows keyed on something else than `id`
  // (`/calendars` keys countries on `iso`), so a missing id renders as the same
  // `[item]` token the standard summary uses — not as a `[#?]` that reads like
  // a formatting bug.
  const parts: string[] = [e.id !== undefined ? `[#${String(e.id)}]` : "[item]"];
  for (const field of fields) {
    const value = attrs[field];
    if (value === undefined) continue;
    parts.push(`${field}: ${renderAttributeValue(value)}`);
  }
  return parts.join(" | ");
}

export function formatListResponse(response: JsonApiResponse, entityType: string, fields?: string[]): string {
  const data = Array.isArray(response.data) ? response.data : [response.data];
  const total = response.meta?.totals?.rows;

  if (data.length === 0) {
    return `Aucun(e) ${entityType} trouvé(e).`;
  }

  const projected = fields !== undefined && fields.length > 0;
  const lines = data.map((item) => (projected ? formatProjectedSummary(item, fields) : formatEntitySummary(item)));
  const header = total !== undefined ? `Total: ${total} ${entityType}(s)\n\n` : "";
  const body = lines.join("\n");

  if (header.length + body.length <= CHARACTER_LIMIT) return header + body;

  // Cut on line boundaries and say how many rows were dropped. A mid-line cut
  // produced a half-row indistinguishable from a complete one, and the count
  // is what tells the model to narrow the query (or use `fields`/`pageSize`)
  // instead of trusting an implicitly complete page.
  const notice = (shown: number) =>
    `\n\n[Résultats tronqués : ${shown}/${lines.length} ligne(s) affichée(s) (limite de ${CHARACTER_LIMIT} caractères). ` +
    `Affinez les filtres, réduisez pageSize, ou utilisez 'fields' pour raccourcir chaque ligne.]`;
  const budget = CHARACTER_LIMIT - header.length - notice(lines.length).length;

  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = kept.length === 0 ? line.length : line.length + 1;
    if (used + cost > budget) break;
    used += cost;
    kept.push(line);
  }

  // A single row longer than the whole budget still has to show something.
  if (kept.length === 0) return header + body.substring(0, Math.max(budget, 0)) + notice(0);

  return header + kept.join("\n") + notice(kept.length);
}

/**
 * Formate la réponse d'un endpoint d'onglet (ex: /resources/{id}/positionings).
 * Contrairement à formatDetailResponse, un tableau est restitué en entier :
 * certains onglets renvoient plusieurs entités (positionnements, contacts...)
 * et n'afficher que la première masquait les autres.
 */
export function formatTabResponse(response: JsonApiResponse): string {
  if (!Array.isArray(response.data)) {
    return formatDetailResponse(response);
  }

  const entities = response.data.map((entity) => ({
    id: entity.id,
    type: entity.type,
    attributes: entity.attributes,
    relationships: entity.relationships,
  }));

  let result = `${entities.length} élément(s)\n\n` + JSON.stringify(entities, null, 2);

  if (result.length > CHARACTER_LIMIT) {
    result = result.substring(0, CHARACTER_LIMIT) + "\n\n[Résultat tronqué...]";
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
