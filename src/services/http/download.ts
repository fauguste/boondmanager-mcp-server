/**
 * Binary downloads (`/documents/{id}`): streaming read under a byte cap
 * (issue #235), byte-level progress, and the two guards a document download
 * needs that a JSON request does not — the application-shell detection and
 * the `Content-Disposition` filename.
 */
import type { ProgressReporter } from "../progress.js";
import { send } from "./transport.js";

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

/** Human-readable byte count for progress messages (same units as the tool output). */
function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} Mo` : `${Math.round(bytes / 1024)} Ko`;
}

/** Progress steps emitted while streaming a download (≈ every 10 %). */
const DOWNLOAD_PROGRESS_STEPS = 10;

/**
 * Thrown by `apiDownload` when the payload exceeds `maxBytes` — before the
 * body is read when the response announces its size, otherwise the moment the
 * running total crosses the cap (the stream is cancelled, nothing more is
 * buffered). `bytes` is the announced size in the first case and a lower
 * bound (bytes received so far) in the second; `announced` tells which.
 */
export class DownloadTooLargeError extends Error {
  readonly bytes: number;
  readonly maxBytes: number;
  readonly announced: boolean;
  constructor(path: string, bytes: number, maxBytes: number, announced: boolean) {
    super(
      `Document exceeds the ${formatBytes(maxBytes)} limit (${announced ? "announced size" : "more than"} ${formatBytes(bytes)}).\nEndpoint: GET ${path}`
    );
    this.name = "DownloadTooLargeError";
    this.bytes = bytes;
    this.maxBytes = maxBytes;
    this.announced = announced;
  }
}

/** Options for `apiDownload`. */
export interface DownloadOptions {
  /** Refuse payloads larger than this many bytes (see `DownloadTooLargeError`). */
  maxBytes?: number;
}

/**
 * Read a download body chunk by chunk, enforcing `maxBytes` as the bytes
 * arrive and reporting progress as it goes.
 *
 * Streaming is the single path (#235): the cap has to be applied *while*
 * reading, or a 200 MB file is fully buffered before it is refused. Progress
 * is only an observer on top of it — emitted when someone is listening and the
 * response announced a `Content-Length` (without a total there is nothing
 * meaningful to report). A response without a readable stream falls back to
 * `arrayBuffer()` and is checked afterwards.
 */
async function readDownloadBody(
  response: Response,
  path: string,
  maxBytes: number,
  onProgress?: ProgressReporter
): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length"));
  const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : undefined;
  const body = response.body;
  if (!body) {
    const buffered = Buffer.from(await response.arrayBuffer());
    if (buffered.byteLength > maxBytes) throw new DownloadTooLargeError(path, buffered.byteLength, maxBytes, true);
    return buffered;
  }

  const reporting = onProgress?.enabled === true && totalBytes !== undefined;
  const reader = body.getReader();
  const step = totalBytes !== undefined ? Math.max(1, Math.floor(totalBytes / DOWNLOAD_PROGRESS_STEPS)) : Infinity;
  const chunks: Uint8Array[] = [];
  let received = 0;
  let reported = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      // Stop pulling: what is already in `chunks` is dropped with this frame.
      await reader.cancel().catch(() => undefined);
      throw new DownloadTooLargeError(path, received, maxBytes, false);
    }
    chunks.push(value);
    // Throttled to ~10 notifications: a 5 MiB file arrives in ~80 network
    // chunks, and one notification each would be its own kind of flood.
    if (reporting && received - reported >= step) {
      reported = received;
      onProgress(received, totalBytes, `Téléchargement — ${formatBytes(received)} / ${formatBytes(totalBytes)}`);
    }
  }

  if (reporting && received > reported) {
    onProgress(received, totalBytes, `Téléchargement terminé — ${formatBytes(received)}`);
  }
  return Buffer.concat(chunks);
}

/**
 * Download a binary payload (documents, justificatifs…) from the BoondManager
 * API. Same pipeline as `apiRequest` (`send()`: auth, path guard, rate limit,
 * timeout, retry policy for a GET), but the body is streamed raw instead of
 * being parsed as JSON:API.
 *
 * `onProgress` reports bytes received when the client asked for progress and
 * the response carries a `Content-Length`; otherwise nothing is emitted.
 *
 * `options.maxBytes` bounds memory: a `Content-Length` above it is refused
 * before a single body byte is read, and a body without one is cancelled the
 * moment it crosses the cap (`DownloadTooLargeError` either way).
 */
export async function apiDownload(
  path: string,
  onProgress?: ProgressReporter,
  options: DownloadOptions = {}
): Promise<DownloadedDocument> {
  const maxBytes = options.maxBytes ?? Infinity;
  const response = await send(path, { method: "GET", headers: { Accept: "*/*" } });

  const contentType = response.headers.get("content-type")?.split(";")[0].trim() || "application/octet-stream";
  const filename = parseContentDispositionFilename(response.headers.get("content-disposition"));

  // BoondManager only answers 404 on an unknown document when the request asks
  // for JSON. With the `Accept: */*` this function sends, it serves the
  // application shell instead — HTTP 200, `text/html`, ~9 KB — which the caller
  // would happily surface as the document's text content. A truncated id then
  // looks like a corrupted file rather than a wrong id, so refuse the shell
  // here. An HTML *document* is still downloadable: a real file download
  // carries a `Content-Disposition` filename, the shell doesn't.
  if (contentType === "text/html" && !filename) {
    throw new Error(
      [
        "BoondManager returned an HTML page instead of a document (HTTP 200, text/html).",
        `Endpoint: GET ${path}`,
        "Hint: The document id is most likely wrong or truncated. Entity relations expose suffixed ids " +
          "(e.g. `123_resume`, `123_file`) — pass the id verbatim, suffix included. BoondManager serves its " +
          "application shell for an unknown /documents/<id> instead of a 404.",
      ].join("\n")
    );
  }

  // Announced size over the cap: refuse without reading the body. The
  // 30 s timeout used to be the only bound on a 200 MB document (#235).
  const announced = Number(response.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new DownloadTooLargeError(path, announced, maxBytes, true);
  }

  const data = await readDownloadBody(response, path, maxBytes, onProgress);
  return { data, contentType, filename };
}
