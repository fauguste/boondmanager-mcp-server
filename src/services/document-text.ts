import { inflateRawSync } from "node:zlib";
import { extractText } from "unpdf";
import { decodeHtmlEntities } from "./format/html.js";

/**
 * Text extraction for the two document formats a CV or a receipt comes in
 * (issue #263). A 5 MiB PDF costs ~6.6 MB of base64 in the model's context for
 * a content that fits in a few KB of text; extracting server-side is what
 * makes reading resumes in batches affordable.
 *
 * - PDF: `unpdf` (a serverless build of pdf.js, no native binary, ~2 MB).
 * - DOCX: the file is a zip whose `word/document.xml` holds the text; the zip
 *   is read here with `node:zlib` only (STORED and DEFLATE entries) — no
 *   dependency for a 60-line format.
 */

export interface ExtractedText {
  text: string;
  /** Page count for PDFs; absent for DOCX. */
  pages?: number;
}

export const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function isImageMime(mime: string): boolean {
  return IMAGE_MIMES.has(mime.toLowerCase());
}
export function isPdfMime(mime: string): boolean {
  return mime.toLowerCase() === "application/pdf";
}
export function isDocxMime(mime: string, filename?: string): boolean {
  return mime.toLowerCase() === DOCX_MIME || (mime === "application/octet-stream" && /\.docx$/i.test(filename ?? ""));
}

export async function extractPdfText(data: Buffer): Promise<ExtractedText> {
  const result = await extractText(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), { mergePages: true });
  const text = normaliseWhitespace(result.text);
  if (text.length === 0) throw new Error("PDF sans texte extractible (scan ou document chiffré)");
  return { text, pages: result.totalPages };
}

export function extractDocxText(data: Buffer): ExtractedText {
  const xml = readZipEntry(data, "word/document.xml");
  if (xml === undefined) throw new Error("DOCX sans word/document.xml");
  const text = stripTags(
    xml
      .toString("utf8")
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br\/>|<w:cr\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
  );
  const normalised = normaliseWhitespace(decodeHtmlEntities(text));
  if (normalised.length === 0) throw new Error("DOCX sans texte");
  return { text: normalised };
}

/**
 * Drop every XML tag. Applied until a fixed point: a single pass leaves a tag
 * behind when its removal creates a new one (`<<w:t>w:t>`), which is the
 * incomplete-sanitisation pattern CodeQL flags. The output is model-facing
 * plain text, never rendered as HTML, but the loop costs nothing.
 */
function stripTags(text: string): string {
  let previous: string;
  let current = text;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, "");
  } while (current !== previous);
  return current;
}

function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---- Minimal zip reader (central directory → local header → entry data) ----

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** The bytes of one entry of a zip archive, or undefined when the name is absent. */
export function readZipEntry(zip: Buffer, name: string): Buffer | undefined {
  // The end-of-central-directory record is at the very end (minus an optional
  // comment of up to 64 KiB): scan backwards for its signature.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("archive zip invalide (pas de répertoire central)");
  const entryCount = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error("archive zip invalide (entrée du répertoire central)");
    }
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const entryName = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
    if (entryName !== name) continue;

    if (zip.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error("archive zip invalide (en-tête local)");
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = zip.subarray(start, start + compressedSize);
    if (method === 0) return Buffer.from(raw);
    if (method === 8) return inflateRawSync(raw);
    throw new Error(`méthode de compression zip non gérée (${method})`);
  }
  return undefined;
}
