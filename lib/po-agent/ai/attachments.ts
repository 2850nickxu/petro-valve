// Turn email attachments into AI-SDK content parts. PDFs/images pass through as file
// parts (supported across Anthropic/OpenAI/Google — the BYO win). CSV/TSV/plain text is
// decoded to text server-side. Binary spreadsheets (XLSX) are noted for clarification
// until an XLSX→CSV parser is wired (see plan §12 P3 / risks).

export interface Attachment {
  filename: string;
  mediaType: string;
  data: Buffer | Uint8Array;
}

export type ModelContentPart =
  | { type: "text"; text: string }
  | { type: "file"; data: Buffer | Uint8Array; mediaType: string };

export function isImageOrPdf(mediaType: string): boolean {
  return mediaType === "application/pdf" || mediaType.startsWith("image/");
}

export function isCsvLike(mediaType: string, filename: string): boolean {
  return /csv|tab-separated|text\/plain/i.test(mediaType) || /\.(csv|tsv|txt)$/i.test(filename);
}

export function isSpreadsheet(mediaType: string, filename: string): boolean {
  return /spreadsheetml|ms-excel/i.test(mediaType) || /\.(xlsx|xls)$/i.test(filename);
}

function toText(data: Buffer | Uint8Array): string {
  return Buffer.from(data).toString("utf8");
}

/**
 * Build model content parts + human-readable notes (e.g. an unparseable spreadsheet)
 * that the pipeline can surface as a clarification.
 */
export function buildAttachmentParts(attachments: Attachment[]): {
  parts: ModelContentPart[];
  notes: string[];
} {
  const parts: ModelContentPart[] = [];
  const notes: string[] = [];

  for (const a of attachments) {
    if (isImageOrPdf(a.mediaType)) {
      parts.push({ type: "file", data: a.data, mediaType: a.mediaType });
    } else if (isCsvLike(a.mediaType, a.filename)) {
      parts.push({ type: "text", text: `--- ${a.filename} ---\n${toText(a.data).trim()}` });
    } else if (isSpreadsheet(a.mediaType, a.filename)) {
      notes.push(
        `Spreadsheet "${a.filename}" was attached but inline parsing is not yet configured; please resend the line items as a CSV or PDF.`,
      );
    } else {
      const text = toText(a.data);
      // Heuristic: printable-ASCII prefix ⇒ treat as text; else unreadable.
      if (text && /[\x20-\x7e]/.test(text.slice(0, 64))) {
        parts.push({ type: "text", text: `--- ${a.filename} ---\n${text.trim()}` });
      } else {
        notes.push(`Attachment "${a.filename}" (${a.mediaType}) could not be read.`);
      }
    }
  }

  return { parts, notes };
}
