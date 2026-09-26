import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BoondApiError } from "./errors.js";
import { initClient, resetClientForTests } from "./auth.js";
import { resetRateLimiterForTests } from "./rate-limit.js";
import { parseContentDispositionFilename, DownloadTooLargeError, apiDownload } from "./download.js";
import { progressReporterFrom } from "../progress.js";

describe("parseContentDispositionFilename", () => {
  it("parses the quoted form", () => {
    expect(parseContentDispositionFilename('attachment; filename="cv-dupont.pdf"')).toBe("cv-dupont.pdf");
  });

  it("parses the unquoted form", () => {
    expect(parseContentDispositionFilename("attachment; filename=cv.pdf")).toBe("cv.pdf");
  });

  it("parses the RFC 5987 UTF-8 form", () => {
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''CV%20Dupont.pdf")).toBe("CV Dupont.pdf");
  });

  it("returns undefined when absent", () => {
    expect(parseContentDispositionFilename(null)).toBeUndefined();
    expect(parseContentDispositionFilename("inline")).toBeUndefined();
  });
});

describe("apiDownload", () => {
  beforeEach(() => {
    process.env.BOOND_API_TOKEN = "test-token";
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0";
    resetRateLimiterForTests();
    resetClientForTests();
    initClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BOOND_API_TOKEN;
    delete process.env.BOOND_HTTP_RATE_LIMIT_RPS;
    resetRateLimiterForTests();
    resetClientForTests();
  });

  it("returns the raw bytes, content type, and filename", async () => {
    const bytes = Buffer.from("%PDF-1.4");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({
          "content-type": "application/pdf; charset=binary",
          "content-disposition": 'attachment; filename="cv.pdf"',
        }),
        arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
      })
    );
    const doc = await apiDownload("/documents/12");
    expect(doc.data.toString()).toBe("%PDF-1.4");
    expect(doc.contentType).toBe("application/pdf");
    expect(doc.filename).toBe("cv.pdf");
  });

  it("defaults the content type when the header is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(2)),
      })
    );
    const doc = await apiDownload("/documents/12");
    expect(doc.contentType).toBe("application/octet-stream");
    expect(doc.filename).toBeUndefined();
  });

  it("throws a formatted error on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Headers(),
        text: () => Promise.resolve(""),
      })
    );
    await expect(apiDownload("/documents/999")).rejects.toThrow(/404/);
  });

  it("rejects unsafe paths before any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiDownload("/documents/../invoices/5")).rejects.toThrow(/Unsafe API path/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // BoondManager answers an unknown /documents/<id> with the app shell (HTTP
  // 200, text/html) instead of a 404 when the request doesn't ask for JSON.
  // Returning it as the document's content made a truncated id look like a
  // corrupted file — see issue #186.
  describe("HTML app-shell guard", () => {
    function htmlResponse(headers: Record<string, string>) {
      const bytes = Buffer.from("<!DOCTYPE html><html><body>BoondManager</body></html>");
      return vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(headers),
        arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
      });
    }

    it("refuses an HTML page served in place of a document", async () => {
      vi.stubGlobal("fetch", htmlResponse({ "content-type": "text/html; charset=utf-8" }));
      await expect(apiDownload("/documents/123")).rejects.toThrow(/HTML page instead of a document/);
    });

    it("points at the suffixed id in the error", async () => {
      vi.stubGlobal("fetch", htmlResponse({ "content-type": "text/html" }));
      await expect(apiDownload("/documents/123")).rejects.toThrow(/123_resume/);
      await expect(apiDownload("/documents/123")).rejects.toThrow(/GET \/documents\/123/);
    });

    it("still downloads a genuine HTML file (attachment filename present)", async () => {
      vi.stubGlobal(
        "fetch",
        htmlResponse({
          "content-type": "text/html",
          "content-disposition": 'attachment; filename="lettre.html"',
        })
      );
      const doc = await apiDownload("/documents/123_file");
      expect(doc.contentType).toBe("text/html");
      expect(doc.filename).toBe("lettre.html");
      expect(doc.data.toString()).toContain("BoondManager");
    });

    it("leaves other content types untouched", async () => {
      vi.stubGlobal("fetch", htmlResponse({ "content-type": "application/xhtml+xml" }));
      await expect(apiDownload("/documents/123_resume")).resolves.toMatchObject({
        contentType: "application/xhtml+xml",
      });
    });
  });

  describe("byte progress", () => {
    /** A body delivered in `chunks` slices of `chunkBytes`, plus its Content-Length. */
    function streamedResponse(chunks: number, chunkBytes: number, withContentLength = true) {
      const total = chunks * chunkBytes;
      let sent = 0;
      const headers = new Headers({ "content-type": "application/pdf" });
      if (withContentLength) headers.set("content-length", String(total));
      const reader = {
        read: () =>
          Promise.resolve(
            sent++ < chunks
              ? { done: false, value: new Uint8Array(chunkBytes).fill(65) }
              : { done: true, value: undefined }
          ),
        cancel: vi.fn().mockResolvedValue(undefined),
      };
      return {
        ok: true,
        status: 200,
        headers,
        body: {
          getReader: () => reader,
          cancel: vi.fn().mockResolvedValue(undefined),
        },
        reader,
        reads: () => sent,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(total)),
      };
    }

    function reporterSpy() {
      const send = vi.fn().mockResolvedValue(undefined);
      return {
        send,
        reporter: progressReporterFrom({ _meta: { progressToken: 7 }, sendNotification: send }),
        params: () => send.mock.calls.map((c) => c[0].params as { progress: number; total?: number }),
      };
    }

    it("reports bytes received against Content-Length", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamedResponse(20, 50 * 1024)));
      const spy = reporterSpy();

      const doc = await apiDownload("/documents/12", spy.reporter);

      expect(doc.data.length).toBe(20 * 50 * 1024);
      const params = spy.params();
      expect(params.length).toBeGreaterThan(0);
      // Throttled to ~10 steps whatever the number of network chunks.
      expect(params.length).toBeLessThanOrEqual(11);
      expect(params.every((p) => p.total === 20 * 50 * 1024)).toBe(true);
      expect(params.map((p) => p.progress)).toEqual([...params.map((p) => p.progress)].sort((a, b) => a - b));
      expect(new Set(params.map((p) => p.progress)).size).toBe(params.length);
      expect(params.at(-1)?.progress).toBe(20 * 50 * 1024);
    });

    it("streams without emitting anything when there is no progressToken", async () => {
      // Streaming is the single read path (#235: the size cap is applied as
      // bytes arrive); progress is only an observer on top of it.
      const response = streamedResponse(4, 1024);
      const readerSpy = vi.spyOn(response.body, "getReader");
      const send = vi.fn();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      const doc = await apiDownload("/documents/12", progressReporterFrom({ sendNotification: send }));

      expect(readerSpy).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
      expect(doc.data.length).toBe(4 * 1024);
    });

    it("reports nothing when the response has no Content-Length", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamedResponse(4, 1024, false)));
      const spy = reporterSpy();

      const doc = await apiDownload("/documents/12", spy.reporter);

      expect(spy.send).not.toHaveBeenCalled();
      expect(doc.data.length).toBe(4 * 1024);
    });
  });
});

describe("apiDownload size cap (#235)", () => {
  beforeEach(() => {
    process.env.BOOND_API_TOKEN = "test-token";
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0";
    resetRateLimiterForTests();
    resetClientForTests();
    initClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BOOND_API_TOKEN;
    delete process.env.BOOND_HTTP_RATE_LIMIT_RPS;
    resetRateLimiterForTests();
    resetClientForTests();
  });

  /** `chunks` × `chunkBytes` body; `contentLength` sets the header (undefined = none). */
  function chunkedResponse(chunks: number, chunkBytes: number, contentLength?: number) {
    let sent = 0;
    const headers = new Headers({ "content-type": "application/pdf" });
    if (contentLength !== undefined) headers.set("content-length", String(contentLength));
    const reader = {
      read: vi.fn(() =>
        Promise.resolve(
          sent++ < chunks
            ? { done: false, value: new Uint8Array(chunkBytes).fill(65) }
            : { done: true, value: undefined }
        )
      ),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const body = { getReader: vi.fn(() => reader), cancel: vi.fn().mockResolvedValue(undefined) };
    return { response: { ok: true, status: 200, headers, body }, reader, body };
  }

  it("refuses an announced size over the cap before reading a single byte", async () => {
    const { response, reader, body } = chunkedResponse(200, 1024 * 1024, 200 * 1024 * 1024);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const err = await apiDownload("/documents/12", undefined, { maxBytes: 5 * 1024 * 1024 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DownloadTooLargeError);
    expect((err as DownloadTooLargeError).announced).toBe(true);
    expect((err as DownloadTooLargeError).bytes).toBe(200 * 1024 * 1024);
    expect((err as DownloadTooLargeError).maxBytes).toBe(5 * 1024 * 1024);
    expect((err as Error).message).toContain("GET /documents/12");
    expect(body.getReader).not.toHaveBeenCalled();
    expect(reader.read).not.toHaveBeenCalled();
    expect(body.cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels an unannounced body the moment it crosses the cap", async () => {
    // No Content-Length: 20 chunks of 1 MiB, cap at 5 MiB → cut on the 6th.
    const { response, reader } = chunkedResponse(20, 1024 * 1024);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const err = await apiDownload("/documents/12", undefined, { maxBytes: 5 * 1024 * 1024 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DownloadTooLargeError);
    expect((err as DownloadTooLargeError).announced).toBe(false);
    expect((err as DownloadTooLargeError).bytes).toBe(6 * 1024 * 1024);
    expect(reader.read).toHaveBeenCalledTimes(6);
    expect(reader.cancel).toHaveBeenCalledTimes(1);
  });

  it("also cuts a body whose Content-Length under-declares its size", async () => {
    const { response, reader } = chunkedResponse(20, 1024 * 1024, 1024);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(apiDownload("/documents/12", undefined, { maxBytes: 5 * 1024 * 1024 })).rejects.toBeInstanceOf(
      DownloadTooLargeError
    );
    expect(reader.cancel).toHaveBeenCalledTimes(1);
  });

  it("returns the whole payload when it fits, with or without Content-Length", async () => {
    for (const contentLength of [4 * 1024, undefined]) {
      const { response, reader } = chunkedResponse(4, 1024, contentLength);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      const doc = await apiDownload("/documents/12", undefined, { maxBytes: 4 * 1024 });
      expect(doc.data.length).toBe(4 * 1024);
      expect(reader.cancel).not.toHaveBeenCalled();
    }
  });

  it("applies no cap when none is given", async () => {
    const { response } = chunkedResponse(8, 1024 * 1024, 8 * 1024 * 1024);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const doc = await apiDownload("/documents/12");
    expect(doc.data.length).toBe(8 * 1024 * 1024);
  });

  it("checks a bodyless response after buffering it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/pdf" }),
        body: null,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(6 * 1024)),
      })
    );
    await expect(apiDownload("/documents/12", undefined, { maxBytes: 5 * 1024 })).rejects.toBeInstanceOf(
      DownloadTooLargeError
    );
  });
});

describe("apiDownload goes through the retry policy (#239)", () => {
  beforeEach(() => {
    process.env.BOOND_API_TOKEN = "test-token";
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0";
    process.env.BOOND_HTTP_RETRY_BASE_MS = "1";
    process.env.BOOND_HTTP_RETRY_MAX_MS = "1";
    resetRateLimiterForTests();
    resetClientForTests();
    initClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BOOND_API_TOKEN;
    delete process.env.BOOND_HTTP_RATE_LIMIT_RPS;
    delete process.env.BOOND_HTTP_MAX_RETRIES;
    delete process.env.BOOND_HTTP_RETRY_BASE_MS;
    delete process.env.BOOND_HTTP_RETRY_MAX_MS;
    resetRateLimiterForTests();
    resetClientForTests();
  });

  it("retries a transient 5xx on the GET and returns the document", async () => {
    // A document download used to be a single attempt while the same GET
    // through `apiRequest` retried — one policy now.
    process.env.BOOND_HTTP_MAX_RETRIES = "1";
    const bytes = Buffer.from("%PDF-1.4");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: new Headers(),
        text: () => Promise.resolve(""),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="a.pdf"',
        }),
        arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
      });
    vi.stubGlobal("fetch", fetchMock);
    const doc = await apiDownload("/documents/12");
    expect(doc.data.toString()).toBe("%PDF-1.4");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404 (not retryable) and surfaces the typed error", async () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "2";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchMock);
    const err = await apiDownload("/documents/12").catch((e: unknown) => e as BoondApiError);
    expect(err).toBeInstanceOf(BoondApiError);
    expect((err as BoondApiError).status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
