// BoondManager JSON:API response types

export interface JsonApiResource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<
    string,
    {
      data: { id: string; type: string } | { id: string; type: string }[] | null;
    }
  >;
  links?: Record<string, string>;
}

export interface JsonApiResponse {
  data: JsonApiResource | JsonApiResource[];
  included?: JsonApiResource[];
  meta?: {
    // `/reporting-*` endpoints add `dependsOn`: `rows` counts indicator rows,
    // `dependsOn` counts the entities those indicators describe.
    totals?: { rows: number; dependsOn?: number };
    [key: string]: unknown;
  };
  links?: Record<string, string>;
}

/**
 * Async auth provider. Returning a fresh header on every call lets us
 * support both static credentials (returns the same value forever) and
 * OAuth2 (refreshes the access token transparently before expiry).
 */
export type BoondAuthProvider = () => Promise<{ name: string; value: string }>;

export interface BoondConfig {
  baseUrl: string;
  auth: BoondAuthProvider;
}

export interface SearchParams {
  keywords?: string;
  page?: number;
  pageSize?: number;
  [key: string]: unknown;
}
