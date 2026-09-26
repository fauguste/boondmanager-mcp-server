/**
 * BoondManager client — public surface.
 *
 * This module is a barrel: the 38 tool files, the transports and the
 * resources import from here, and the tests mock this path
 * (`vi.mock("../services/boond-client.js", …)`). The implementation lives in
 * one module per responsibility (issue #239):
 *
 *   http/auth.ts        who the request is sent as (JWT / static / OAuth), config
 *   http/errors.ts      error envelope parsing, Cloudflare detection, hints, BoondApiError
 *   http/retry.ts       retry policy: config, retryability, Retry-After, backoff
 *   http/rate-limit.ts  per-identity token buckets
 *   http/transport.ts   the single `send()` path + apiRequest / apiUploadForm
 *   http/download.ts    apiDownload: streaming under a byte cap, progress, guards
 *   search.ts           buildSearchQuery + apiSearch (per-route chunking)
 *   format/*.ts         list / detail / tab rendering, summaries, HTML excerpts
 *
 * Add a new export here when a tool needs it; do not add implementation.
 */
export {
  oauthContextAuth,
  buildJwt,
  JWT_HEADER_NAME,
  initClient,
  hasEnvCredentials,
  initClientWithAuth,
  resetClientForTests,
} from "./http/auth.js";
export { parseBoondErrorBody, hintForUnauthorized, BoondApiError, formatApiError } from "./http/errors.js";
export {
  type RetryConfig,
  resolveRetryConfig,
  isRetryable,
  parseRetryAfter,
  computeBackoffMs,
} from "./http/retry.js";
export {
  type RateLimitConfig,
  resolveRateLimitConfig,
  MAX_RATE_LIMIT_BUCKETS,
  getRateLimiter,
  rateLimiterBucketCountForTests,
  resetRateLimiterForTests,
} from "./http/rate-limit.js";
export {
  type QueryValue,
  type HttpMethod,
  resolveTimeoutMs,
  assertSafeApiPath,
  resolveApiUrl,
  apiRequest,
  apiUploadForm,
} from "./http/transport.js";
export {
  parseContentDispositionFilename,
  type DownloadedDocument,
  DownloadTooLargeError,
  type DownloadOptions,
  apiDownload,
} from "./http/download.js";
export { buildSearchQuery, apiSearch } from "./search.js";
export { formatEntitySummary } from "./format/summary.js";
export { formatListResponse } from "./format/list.js";
export { projectEntity, formatDetailResponse } from "./format/detail.js";
export { formatTabResponse } from "./format/tab.js";
