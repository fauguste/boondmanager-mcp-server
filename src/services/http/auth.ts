/**
 * Client configuration and the three auth providers (JWT built from
 * components, static header, OAuth Bearer read from the request context).
 *
 * Split out of `boond-client.ts` (issue #239): everything here decides *who*
 * the request is sent as; nothing here sends anything.
 */
import { createHmac } from "crypto";
import { readString, readUrl } from "../../config/env.js";
import { DEFAULT_BASE_URL } from "../../constants.js";
import type { BoondAuthProvider, BoondConfig } from "../../types.js";
import { oauthContext } from "../oauth.js";

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
export const oauthContextAuth: BoondAuthProvider = () => {
  const ctx = oauthContext.getStore();
  if (!ctx) {
    return Promise.reject(
      new Error(
        "No OAuth access token in request context. The HTTP transport requires an `Authorization: Bearer <boond_access_token>` header on every request."
      )
    );
  }
  return Promise.resolve({ name: "Authorization", value: `Bearer ${ctx.accessToken}` });
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
  const baseUrl = readUrl("BOOND_BASE_URL") ?? DEFAULT_BASE_URL;

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
  const userToken = readString("BOOND_USER_TOKEN");
  const clientToken = readString("BOOND_CLIENT_TOKEN");
  const clientKey = readString("BOOND_CLIENT_KEY");
  const token = readString("BOOND_API_TOKEN");
  const user = readString("BOOND_USER");
  const password = readString("BOOND_PASSWORD");

  let auth: BoondAuthProvider;

  if (userToken && clientToken && clientKey) {
    const ttlRaw = readString("BOOND_JWT_TTL_SECONDS");
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
 * configured. Used by the HTTP transport in static-auth mode
 * (`BOOND_HTTP_STATIC_AUTH=true`) to fail fast with a readable message before
 * `initClient()` throws; the default HTTP mode is an OAuth2 protected resource
 * and never reads these variables.
 */
export function hasEnvCredentials(): boolean {
  return !!(
    (readString("BOOND_USER_TOKEN") && readString("BOOND_CLIENT_TOKEN") && readString("BOOND_CLIENT_KEY")) ||
    readString("BOOND_API_TOKEN") ||
    (readString("BOOND_USER") && readString("BOOND_PASSWORD"))
  );
}

/**
 * Install a custom auth provider — used by the HTTP transport bootstrap to
 * wire in an OAuth2 token source (where the access token is refreshed
 * transparently per request rather than baked in at startup).
 */
export function initClientWithAuth(auth: BoondAuthProvider, baseUrl?: string): void {
  config = {
    baseUrl: baseUrl ?? readUrl("BOOND_BASE_URL") ?? DEFAULT_BASE_URL,
    auth,
  };
}

/** Test helper — reset the cached config so the next call re-initialises. */
export function resetClientForTests(): void {
  config = null;
}

/** The active configuration, initialising from the environment on first use. */
export function getConfig(): BoondConfig {
  if (!config) {
    initClient();
  }
  return config!;
}
