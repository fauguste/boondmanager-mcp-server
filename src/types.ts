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
    totals?: { rows: number };
    [key: string]: unknown;
  };
  links?: Record<string, string>;
}

export interface BoondConfig {
  baseUrl: string;
  authHeaderName: string;
  authHeaderValue: string;
}

export interface SearchParams {
  keywords?: string;
  page?: number;
  pageSize?: number;
  [key: string]: unknown;
}
