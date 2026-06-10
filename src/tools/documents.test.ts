import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentTools } from "./documents.js";
import { apiDownload, apiUploadForm } from "../services/boond-client.js";

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
    it("returns binary documents as an embedded base64 resource", async () => {
      vi.mocked(apiDownload).mockResolvedValue({
        data: Buffer.from("%PDF-1.4 fake"),
        contentType: "application/pdf",
        filename: "cv-dupont.pdf",
      });
      registerDocumentTools(server);
      const result = await handlerOf(server, "boond_documents_get")({ id: "123" });
      expect(apiDownload).toHaveBeenCalledWith("/documents/123");
      expect(result.content[0].text).toContain("cv-dupont.pdf");
      const resource = result.content[1].resource!;
      expect(resource.uri).toBe("boond://documents/123");
      expect(resource.mimeType).toBe("application/pdf");
      expect(Buffer.from(resource.blob!, "base64").toString()).toBe("%PDF-1.4 fake");
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

    it("refuses documents over the size cap", async () => {
      vi.mocked(apiDownload).mockResolvedValue({
        data: Buffer.alloc(6 * 1024 * 1024),
        contentType: "application/pdf",
        filename: "gros.pdf",
      });
      registerDocumentTools(server);
      const result = await handlerOf(server, "boond_documents_get")({ id: "9" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("trop volumineux");
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
