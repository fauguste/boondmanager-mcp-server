import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { extractDocxText, extractPdfText, isDocxMime, isImageMime, readZipEntry } from "./document-text.js";

/** A minimal, valid zip: local headers + central directory + EOCD (CRC left at 0 — the reader does not verify it). */
export function buildZip(entries: Array<{ name: string; data: Buffer; deflate?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const payload = entry.deflate ? deflateRawSync(entry.data) : entry.data;
    const method = entry.deflate ? 8 : 0;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    locals.push(local, payload);
    centrals.push(central);
    offset += local.length + payload.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

/** A one-page, uncompressed PDF whose only content stream draws `text`. */
export function buildPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const DOCX_XML = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Jean Dupont</w:t></w:r><w:r><w:tab/><w:t>D&#233;veloppeur &amp; architecte</w:t></w:r></w:p><w:p><w:r><w:t>TypeScript</w:t></w:r></w:p></w:body></w:document>`;

describe("readZipEntry", () => {
  it("reads STORED and DEFLATE entries by name, undefined when absent", () => {
    const zip = buildZip([
      { name: "a.txt", data: Buffer.from("stored") },
      { name: "b.txt", data: Buffer.from("deflated content"), deflate: true },
    ]);
    expect(readZipEntry(zip, "a.txt")?.toString()).toBe("stored");
    expect(readZipEntry(zip, "b.txt")?.toString()).toBe("deflated content");
    expect(readZipEntry(zip, "c.txt")).toBeUndefined();
  });

  it("rejects a buffer that is not a zip", () => {
    expect(() => readZipEntry(Buffer.from("%PDF-1.4 not a zip at all, long enough to scan"), "x")).toThrow(/zip/);
  });
});

describe("extractDocxText", () => {
  it("turns word/document.xml into paragraphs, tabs and decoded entities", () => {
    const docx = buildZip([{ name: "word/document.xml", data: Buffer.from(DOCX_XML), deflate: true }]);
    expect(extractDocxText(docx).text).toBe("Jean Dupont\tDéveloppeur & architecte\nTypeScript");
  });

  it("throws on a zip without the document part", () => {
    const zip = buildZip([{ name: "other.xml", data: Buffer.from("<x/>") }]);
    expect(() => extractDocxText(zip)).toThrow(/word\/document\.xml/);
  });
});

describe("extractPdfText", () => {
  it("extracts the text of a PDF and counts its pages", async () => {
    const result = await extractPdfText(buildPdf("Bonjour Jean Dupont"));
    expect(result).toEqual({ text: "Bonjour Jean Dupont", pages: 1 });
  });

  it("throws on a PDF with no extractable text (scan / encrypted / garbage)", async () => {
    await expect(extractPdfText(Buffer.from("%PDF-1.4 fake"))).rejects.toThrow();
  });
});

describe("mime helpers", () => {
  it("recognises images and DOCX (by mime, or by extension on octet-stream)", () => {
    expect(isImageMime("image/PNG")).toBe(true);
    expect(isImageMime("image/svg+xml")).toBe(false);
    expect(isDocxMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
    expect(isDocxMime("application/octet-stream", "cv.docx")).toBe(true);
    expect(isDocxMime("application/octet-stream", "cv.pdf")).toBe(false);
  });
});
