import { createHmac } from "crypto";
import {
  DEFAULT_BASE_URL,
  CHARACTER_LIMIT,
  DEFAULT_HTTP_TIMEOUT_MS,
  DEFAULT_HTTP_MAX_RETRIES,
  DEFAULT_HTTP_RETRY_BASE_MS,
  DEFAULT_HTTP_RETRY_MAX_MS,
} from "../constants.js";
import type { BoondConfig, JsonApiResponse, SearchParams } from "../types.js";

let config: BoondConfig | null = null;

function base64url(data: string | Buffer): string {
  const b64 = Buffer.from(data).toString("base64");
  return b64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function buildJwt(userToken: string, clientToken: string, clientKey: string): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ userToken, clientToken }));
  const signature = base64url(
    createHmac("sha256", clientKey).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${signature}`;
}

/** Return the env value if it is a real user-supplied value, or undefined otherwise. */
function envOrUndefined(key: string): string | undefined {
  const v = process.env[key];
  if (!v || v.startsWith("${")) return undefined;
  return v;
}

export function initClient(): void {
  const baseUrl = envOrUndefined("BOOND_BASE_URL") || DEFAULT_BASE_URL;

  // Auth priority:
  // 1. Build JWT from components (userToken + clientToken + clientKey)
  // 2. Pre-built JWT token
  // 3. BasicAuth (user:password)
  const userToken = envOrUndefined("BOOND_USER_TOKEN");
  const clientToken = envOrUndefined("BOOND_CLIENT_TOKEN");
  const clientKey = envOrUndefined("BOOND_CLIENT_KEY");
  const token = envOrUndefined("BOOND_API_TOKEN");
  const user = envOrUndefined("BOOND_USER");
  const password = envOrUndefined("BOOND_PASSWORD");

  let authHeader: string;

  if (userToken && clientToken && clientKey) {
    const jwt = buildJwt(userToken, clientToken, clientKey);
    authHeader = `Bearer ${jwt}`;
  } else if (token) {
    authHeader = `Bearer ${token}`;
  } else if (user && password) {
    const encoded = Buffer.from(`${user}:${password}`).toString("base64");
    authHeader = `Basic ${encoded}`;
  } else {
    throw new Error(
      "Authentication required. Set BOOND_USER_TOKEN + BOOND_CLIENT_TOKEN + BOOND_CLIENT_KEY, or BOOND_API_TOKEN, or both BOOND_USER and BOOND_PASSWORD."
    );
  }

  config = { baseUrl, authHeader };
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
    const parsed = JSON.parse(body) as { errors?: Array<{ detail?: string; title?: string; code?: string }> };
    const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
    const messages = errors
      .map((e) => {
        const parts: string[] = [];
        if (e.title && e.title !== e.detail) parts.push(e.title);
        if (e.detail) parts.push(e.detail);
        else if (e.code) parts.push(`code ${e.code}`);
        return parts.join(": ").trim();
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
export function isRetryable(
  method: string,
  status: number | undefined,
  isNetworkOrTimeout: boolean
): boolean {
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

/** Status-specific hint to help the LLM (or human) recover from common failures. */
function hintForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Check the request body or query parameters — likely a malformed field.";
    case 401:
      return "Authentication failed. Verify BOOND_USER_TOKEN + BOOND_CLIENT_TOKEN + BOOND_CLIENT_KEY (or BOOND_API_TOKEN, or BOOND_USER + BOOND_PASSWORD).";
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

/** Build the Error message for a non-2xx HTTP response. Exported for testing. */
export function formatApiError(
  status: number,
  statusText: string,
  method: string,
  path: string,
  body: string
): string {
  const detail = parseBoondErrorBody(body);
  const headline = detail
    ? `BoondManager API ${status} ${statusText}: ${detail}`
    : `BoondManager API ${status} ${statusText}`;
  const lines = [headline, `Endpoint: ${method} ${path}`];
  // Only attach the raw body when we couldn't extract a structured detail —
  // otherwise it's noise that buries the useful message.
  if (!detail && body) {
    const trimmed = body.length > 500 ? body.slice(0, 500) + "…" : body;
    lines.push(`Body: ${trimmed}`);
  }
  lines.push(`Hint: ${hintForStatus(status)}`);
  return lines.join("\n");
}

export async function apiRequest(
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
  queryParams?: Record<string, QueryValue>
): Promise<JsonApiResponse> {
  const { baseUrl, authHeader } = getConfig();

  const url = new URL(`${baseUrl}${path}`);

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

  const headers: Record<string, string> = {
    Authorization: authHeader,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const timeoutMs = resolveTimeoutMs();
  const retry = resolveRetryConfig();
  const totalAttempts = retry.maxRetries + 1;

  const buildBody = (): string | undefined =>
    body && (method === "POST" || method === "PUT" || method === "PATCH")
      ? JSON.stringify(body)
      : undefined;
  const serializedBody = buildBody();

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
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
      attemptError = new Error(
        formatApiError(response.status, response.statusText, method, path, errorText)
      );
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

export function formatEntitySummary(entity: {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
}): string {
  const attrs = entity.attributes;
  const parts: string[] = [`[${entity.type} #${entity.id}]`];

  // Common name fields
  if (attrs.firstName || attrs.lastName) {
    parts.push(`${attrs.firstName || ""} ${attrs.lastName || ""}`.trim());
  }
  if (attrs.name) parts.push(String(attrs.name));
  if (attrs.email1) parts.push(`Email: ${attrs.email1}`);
  if (attrs.phone1) parts.push(`Tel: ${attrs.phone1}`);
  if (attrs.city) parts.push(`Ville: ${attrs.city}`);
  if (attrs.state !== undefined) parts.push(`Statut: ${attrs.state}`);
  if (attrs.title) parts.push(`Titre: ${attrs.title}`);

  return parts.join(" | ");
}

export function formatListResponse(
  response: JsonApiResponse,
  entityType: string
): string {
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
