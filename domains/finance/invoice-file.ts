/**
 * Read text that is already inside an invoice file.
 * Images have no text layer here, so their fields stay blank.
 * This does not call an accounts package or an outside reader.
 */
import { inflateSync } from "node:zlib";
import { readInvoiceFields, type KnownSupplier, type ReadInvoice } from "./invoice-spend.ts";

export const MAX_INVOICE_BYTES = 4_000_000;

export function parseInvoiceDataUrl(dataUrl: string): { ok: true; mime: string; bytes: Buffer } | { ok: false; error: string } {
  if (typeof dataUrl !== "string" || dataUrl.length > 8_000_000) return { ok: false, error: "Attach an image or a PDF." };
  const match = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl.trim());
  if (!match) return { ok: false, error: "Attach an image or a PDF." };
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (bytes.length < 8 || bytes.length > MAX_INVOICE_BYTES) return { ok: false, error: "That file is empty or too large." };
  if (!magicOk(match[1], bytes)) return { ok: false, error: "That file is not a readable image or PDF." };
  return { ok: true, mime: match[1], bytes };
}

function magicOk(mime: string, bytes: Buffer): boolean {
  if (mime === "application/pdf") return bytes.subarray(0, 5).toString("latin1").startsWith("%PDF");
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mime === "image/webp") return bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
  return false;
}

export function textFromInvoiceBytes(mime: string, bytes: Buffer): string {
  if (mime.startsWith("image/")) return "";
  if (mime !== "application/pdf") return "";
  return pdfText(bytes);
}

export function readInvoiceFile(mime: string, bytes: Buffer, suppliers: readonly KnownSupplier[]): ReadInvoice {
  return readInvoiceFields(textFromInvoiceBytes(mime, bytes), suppliers);
}

function pdfText(bytes: Buffer): string {
  const src = bytes.toString("latin1");
  const parts: string[] = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  let remaining = 4_000_000, streams = 0;
  while ((match = re.exec(src))) {
    if (++streams > 100 || remaining <= 0) break;
    const body = Buffer.from(match[1].replace(/\r?\n$/, ""), "latin1");
    let content: string;
    try {
      content = inflateSync(body, { maxOutputLength: Math.min(remaining, 1_000_000) }).toString("latin1");
    } catch {
      content = body.subarray(0, remaining).toString("latin1");
    }
    remaining -= content.length;
    parts.push(stringsFromPdf(content));
  }
  return parts.filter(Boolean).join("\n");
}

function stringsFromPdf(content: string): string {
  const out: string[] = [];
  const re = /\((?:\\.|[^\\)])*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) out.push(decodePdfString(match[0].slice(1, -1)));
  return out.join("\n");
}

function decodePdfString(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") { out += ch; continue; }
    const next = raw[++i];
    if (next == null) break;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "b") out += "\b";
    else if (next === "f") out += "\f";
    else if (next === "(" || next === ")" || next === "\\") out += next;
    else if (next >= "0" && next <= "7") {
      let oct = next;
      for (let k = 0; k < 2 && i + 1 < raw.length && raw[i + 1] >= "0" && raw[i + 1] <= "7"; k++) oct += raw[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += next;
  }
  return out;
}
