import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentTools } from "./documents.js";
import { apiDownload, apiUploadForm, DownloadTooLargeError } from "../services/boond-client.js";
import { MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, CHARACTER_LIMIT } from "../constants.js";
import { buildPdf, buildZip } from "../services/document-text.test.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiDownload: vi.fn(), apiUploadForm: vi.fn() };
});

function createMockServer() {
  return { registerTool: vi.fn() } as unknown as McpServer;
}

function handlerOf(
  server: McpServer,
  name: string
): (params: unknown) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text?: string; resource?: { uri: string; mimeType: string; blob?: string } }>;
  structuredContent?: Record<string, unknown>;
}> {
  const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === name);
  if (!call) throw new Error(`tool ${name} not registered`);
  return call[2] as never;
}

describe("registerDocumentTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiDownload).mockReset();
    vi.mocked(apiUploadForm).mockReset();
  });

  it("should register 3 tools", () => {
    registerDocumentTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(3);
  });

  it("should register all expected tool names", () => {
    registerDocumentTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_documents_get");
    expect(names).toContain("boond_documents_create");
    expect(names).toContain("boond_documents_delete");
  });

  it("get is readOnly, create is not, delete is destructive", () => {
    registerDocumentTools(server);
    const byName = new Map(vi.mocked(server.registerTool).mock.calls.map((c) => [c[0], c[1]]));
    expect(byName.get("boond_documents_get")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("boond_documents_create")?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get("boond_documents_delete")?.annotations?.destructiveHint).toBe(true);
  });

  describe("boond_documents_get handler", () => {
    it("returns binary documents as an embedded base64 resource in raw mode", async () => {
      vi.mocked(apiDownload).mockResolvedValue({
        data: Buffer.from("%PDF-1.4 fake"),
        contentType: "application/pdf",
        filename: "cv-dupont.pdf",
      });
      registerDocumentTools(server);
      const result = await handlerOf(server, "boond_documents_get")({ id: "123", mode: "raw" });
      expect(apiDownload).toHaveBeenCalledWith("/documents/123", expect.any(Function), {
        maxBytes: MAX_DOCUMENT_BYTES,
      });
      expect(result.content[0].text).toContain("cv-dupont.pdf");
      const resource = result.content[1].resource!;
      expect(resource.uri).toBe("boond://documents/123");
      expect(resource.mimeType).toBe("application/pdf");
      expect(Buffer.from(resource.blob!, "base64").toString()).toBe("%PDF-1.4 fake");
    });

    // Entity relations expose suffixed document ids (`123_resume`); rejecting
    // them pushed the caller into stripping the suffix, which silently returns
    // the app shell instead of the file — see issue #186.
    it("accepts the suffixed ids exposed by entity relations", async () => {
      vi.mocked(apiDownload).mockResolvedValue({
        data: Buffer.from("%PDF-1.4 fake"),
        contentType: "application/pdf",
        filename: "cv-dupont.pdf",
      });
      registerDocumentTools(server);
      const config = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_documents_get")![1];
      const schema = config.inputSchema as unknown as {
        shape: { id: { safeParse: (v: unknown) => { success: boolean } } };
      };
      expect(schema.shape.id.safeParse("123_resume").success).toBe(true);
      expect(schema.shape.id.safeParse("../invoices/5").success).toBe(false);

      const result = await handlerOf(server, "boond_documents_get")({ id: "123_resume", mode: "raw" });
      expect(apiDownload).toHaveBeenCalledWith("/documents/123_resume", expect.any(Function), {
        maxBytes: MAX_DOCUMENT_BYTES,
      });
      expect(result.content[1].resource!.uri).toBe("boond://documents/123_resume");
    });

    // Issue #263 — the default mode makes a document readable instead of a blob.
    it("returns images as MCP image content (the shape hosts pass to the model's vision input)", async () => {
      vi.mocked(apiDownload).mockResolvedValue({
        data: Buffer.from("png-bytes"),
        contentType: "image/png",
        filename: "ticket.png",
      });
      registerDocumentTools(server);
      const result = await handlerOf(server, "boond_documents_get")({ id: "7", mode: "text" });
      expect(result.content[1]).toEqual({
        type: "image",
        data: Buffer.from("png-bytes").toString("base64"),
        mimeType: "image/png",
      });
      expect(result.content[0].text).toContain("ticket.png");
    });

    it("falls back to an embedded resource with a note for an image over MAX_IMAGE_BYTES", async () => {
      vi.mocked(apiDownload).mockResolvedValue({
        data: Buffer.alloc(MAX_IMAGE_BYTES + 1, 1),
        contentType: "image/jpeg",
        filename: "poster.jpg",
      });
      registerDocumentTools(server);
      const result = await handlerOf(server, "boond_documents_get")({ id: "8", mode: "text" });
      expect(result.content[0].text).toContain("au-delà des 2 Mo");
      expect(result.content[1].type).toBe("resource");
    });

    it("extracts the text of a PDF, with size and page count, in the default mode", async () => {
      vi.mocked(apiDownload).mockResolvedValue({
        data: buildPdf("Jean Dupont Developpeur TypeScript"),
        contentType: "application/pdf",
        filename: "cv.pdf",
      });
      registerDocumentTools(server);
      const result = await handlerOf(server, "boond_documents_get")({ id: "9", mode: "text" });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain("1 page(s)) — texte extrait :");
      expect(result.content[0].text).toContain("Jean Dupont Developpeur TypeScript");
    });

    it("extracts the text of a DOCX through the native zip reader", async () => {
      const xml = `<w:document><w:body><w:p><w:r><w:t>Profil DOCX</w:t></w:r></w:p></w:body></w:document>`;
      vi.mocked(apiDownload).mockResolvedValue({
        data: buildZip([{ name: "word/document.xml", data: Buffer.from(xml), deflate: true }]),
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename: "cv.docx",
      });
      registerDocumentTools(server);
      const result = await handlerOf(server, "boond_documents_get")({ id: "10", mode: "text" });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain("Profil DOCX");
    });

    it("returns the raw file with a warning when nothing can be extracted (scan, encrypted, malformed)", async () => {
      vi.mocked(apiDownload).mockResolvedValue({
        data: Buffer.from("%PDF-1.4 fake"),
        contentType: "application/pdf",
        filename: "scan.pdf",
      });
      registerDocumentTools(server);
      const result = await handlerOf(server, "boond_documents_get")({ id: "11", mode: "text" });
      expect(result.content[0].text).toContain("Extraction du texte impossible");
      expect(result.content[1].type).toBe("resource");
    });

    it("truncates a long extracted text at CHARACTER_LIMIT and says how to get the whole file", async () => {
      const xml = `<w:document><w:body><w:p><w:r><w:t>${"x".repeat(CHARACTER_LIMIT + 500)}</w:t></w:r></w:p></w:body></w:document>`;
      vi.mocked(apiDownload).mockResolvedValue({
        data: buildZip([{ name: "word/document.xml", data: Buffer.from(xml) }]),
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename: "long.docx",
      });
      registerDocumentTools(server);
      const result = await handlerOf(server, "boond_documents_get")({ id: "12", mode: "text" });
      expect(result.content[0].text).toContain(`[Texte tronqué à ${CHARACTER_LIMIT} caractères`);
      expect(result.content[0].text.length).toBeLessThan(CHARACTER_LIMIT + 400);
    });

    it("defaults mode to text in the advertised schema", () => {
      registerDocumentTools(server);
      const config = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_documents_get")![1];
      const schema = config.inputSchema as unknown as { parse: (v: unknown) => { mode: string } };
      expect(schema.parse({ id: "1" }).mode).toBe("text");
    });

    it("mentions the suffix in its description so the id isn't truncated", () => {
      registerDocumentTools(server);
      const config = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_documents_get")![1];
      expect(config.description).toContain("123_resume");
    });

    it("returns text documents as plain text", async () => {
      vi.mocked(apiDownload).mockResolvedValue({
        data: Buffer.from("Jean Dupont — Développeur TypeScript"),
        contentType: "text/plain",
        filename: "cv.txt",
      });
      registerDocumentTools(server);
      const result = await handlerOf(server, "boond_documents_get")({ id: "5" });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain("Développeur TypeScript");
    });

    // The cap is enforced by `apiDownload` while the bytes arrive (#235); the
    // tool's job is to hand it the ceiling and turn the refusal into a tool
    // error the model can act on, with the size when the API announced it.
    it("refuses documents over the size cap without buffering them (announced size)", async () => {
      vi.mocked(apiDownload).mockRejectedValue(
        new DownloadTooLargeError("/documents/9", 6 * 1024 * 1024, MAX_DOCUMENT_BYTES, true)
      );
      registerDocumentTools(server);
      const result = await handlerOf(server, "boond_documents_get")({ id: "9" });
      expect(apiDownload).toHaveBeenCalledWith("/documents/9", expect.any(Function), { maxBytes: MAX_DOCUMENT_BYTES });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("trop volumineux");
      expect(result.content[0].text).toContain("6.0 Mo (max 5 Mo)");
    });

    it("says 'plus de' when the download was cut mid-stream (no Content-Length)", async () => {
      vi.mocked(apiDownload).mockRejectedValue(
        new DownloadTooLargeError("/documents/9", MAX_DOCUMENT_BYTES + 1, MAX_DOCUMENT_BYTES, false)
      );
      registerDocumentTools(server);
      const result = await handlerOf(server, "boond_documents_get")({ id: "9" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("plus de 5.0 Mo (max 5 Mo)");
    });

    it("lets any other download error propagate", async () => {
      vi.mocked(apiDownload).mockRejectedValue(new Error("BoondManager API error 404"));
      registerDocumentTools(server);
      await expect(handlerOf(server, "boond_documents_get")({ id: "9" })).rejects.toThrow("404");
    });
  });

  describe("boond_documents_create handler", () => {
    it("uploads via multipart form fields and returns the created id", async () => {
      vi.mocked(apiUploadForm).mockResolvedValue({
        data: { id: "777", type: "document", attributes: {} },
      });
      registerDocumentTools(server);
      const result = await handlerOf(
        server,
        "boond_documents_create"
      )({
        parentType: "candidateResume",
        parentId: 42,
        fileUrl: "https://example.com/cv.pdf",
        parsing: true,
      });
      expect(apiUploadForm).toHaveBeenCalledWith("/documents", {
        parentType: "candidateResume",
        parentId: "42",
        fileUrl: "https://example.com/cv.pdf",
        parsing: "true",
      });
      expect(result.structuredContent).toEqual({ id: "777", type: "document" });
      expect(result.content[0].text).toContain("777");
    });
  });
});
