import { createHmac } from "crypto";
import { DEFAULT_BASE_URL, CHARACTER_LIMIT } from "../constants.js";
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

  const fetchOptions: RequestInit = { method, headers };
  if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), fetchOptions);

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `BoondManager API error ${response.status} ${response.statusText}: ${errorText}\n` +
      `Endpoint: ${method} ${path}\n` +
      `Suggestion: Check your credentials and permissions for this endpoint.`
    );
  }

  // DELETE may return empty body
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
