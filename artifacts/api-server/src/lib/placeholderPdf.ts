/**
 * Shared placeholder-PDF generation. Used by routes/documents.ts (when a
 * document row has no uploaded file) and seed-demo.ts (to ensure every
 * seeded document has a real previewable PDF in object storage).
 */

function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

export interface PlaceholderPdfLine {
  text: string;
  size?: number;
  leading?: number;
}

/**
 * Build a tiny, single-page PDF document.
 *
 * @param title  Big bold title rendered at the top.
 * @param lines  Body lines rendered below the title.
 */
export function buildPdf(title: string, lines: PlaceholderPdfLine[]): Buffer {
  const ops: string[] = [
    "BT",
    "/F1 16 Tf",
    "72 740 Td",
    `(${esc(title)}) Tj`,
  ];
  let first = true;
  for (const l of lines) {
    const size = l.size ?? 11;
    const leading = l.leading ?? (first ? 28 : 18);
    ops.push(`/F1 ${size} Tf`, `0 -${leading} Td`, `(${esc(l.text)}) Tj`);
    first = false;
  }
  ops.push("ET");
  const stream = ops.join("\n");
  const streamBytes = Buffer.from(stream, "latin1");

  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`;
  const obj4 = `4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream\nendobj\n`;
  const obj5 = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;

  const header = `%PDF-1.4\n`;
  const objects = [obj1, obj2, obj3, obj4, obj5];
  const offsets: number[] = [];
  let pos = header.length;
  for (const obj of objects) {
    offsets.push(pos);
    pos += Buffer.byteLength(obj, "latin1");
  }
  const xrefOffset = pos;
  const xref = [
    `xref\n`,
    `0 6\n`,
    `0000000000 65535 f \n`,
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`),
  ].join("");
  const trailer = `trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.concat([
    Buffer.from(header, "latin1"),
    ...objects.map((o) => Buffer.from(o, "latin1")),
    Buffer.from(xref, "latin1"),
    Buffer.from(trailer, "latin1"),
  ]);
}

/**
 * Build the standard "no file attached" placeholder used when a document row
 * has no uploaded asset.
 */
export function buildPlaceholderPdf(
  name: string,
  category: string,
  uploaded: string,
): Buffer {
  const title = "Quail Valley HOA";
  const docTitle = name.replace(/\.pdf$/i, "");
  return buildPdf(title, [
    { text: `Document: ${docTitle}` },
    { text: `Category: ${category}` },
    { text: `Date: ${uploaded}` },
    { text: "This is a placeholder — no file was attached when this record was created.", size: 9, leading: 32 },
    { text: "Upload a real file via the Documents page to replace this placeholder.", size: 9 },
  ]);
}

/**
 * Build a PDF with arbitrary headline + structured body sections (used for
 * vendor COI/W9/contract demo documents in the seed).
 */
export function buildDemoPdf(
  title: string,
  subtitle: string,
  facts: Record<string, string>,
  footer: string,
): Buffer {
  const lines: PlaceholderPdfLine[] = [
    { text: subtitle, size: 12 },
  ];
  for (const [k, v] of Object.entries(facts)) {
    lines.push({ text: `${k}: ${v}` });
  }
  lines.push({ text: footer, size: 9, leading: 28 });
  return buildPdf(title, lines);
}
