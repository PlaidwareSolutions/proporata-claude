// OCR provider abstraction.
//
// Dispatch by content type:
//   - text/* → UTF-8 passthrough.
//   - application/pdf → first try `pdf-parse` to pull native embedded text +
//     page count (free, no model call). If the resulting text is empty or
//     too sparse relative to the page count, treat the document as scanned
//     and fall back to OpenAI's Responses API with `input_file` to OCR the
//     PDF page images. This keeps the common case (digital PDFs from
//     vendors / lawyers) cheap while still handling scanned roof reports
//     and insurance declarations.
//   - image/* → OpenAI vision (chat/completions with `image_url`).
//
// When `OPENAI_API_KEY` is missing, image OCR and the scanned-PDF fallback
// are skipped (`null`) but the rest of the importer continues to work —
// heuristic suggestions just won't have any text to feed on.

import { logger } from "./logger.js";

export interface OcrResult {
  text: string;
  pageCount: number;
}

export interface OcrInput {
  storageKey: string;
  fileName: string;
  contentType: string | null;
  bytes: Buffer;
}

const MAX_OUTPUT_CHARS = 50_000;
// Heuristic threshold: if `pdf-parse` yields fewer than this many extractable
// characters per page, we treat the PDF as scanned and fall back to vision
// OCR. 60 chars/page is well below "any real text content" — even a sparse
// title page typically has 200+.
const SCANNED_PDF_CHARS_PER_PAGE = 60;

const SYSTEM_OCR_PROMPT =
  "You are an OCR engine. Read the document and return ONLY the literal text " +
  "it contains, preserving line breaks. Do not summarise, do not add commentary. " +
  "If the document is unreadable, return an empty string.";

export function isOcrConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function canExtract(contentType: string | null | undefined): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.startsWith("text/")) return true;
  if (ct === "application/pdf") return true;
  if (ct.startsWith("image/")) return true;
  return false;
}

async function pdfParseNative(bytes: Buffer): Promise<OcrResult> {
  // pdf-parse ships a CJS default with a runtime that probes the filesystem
  // when imported at the package root, so we point at the implementation
  // directly to keep the bundle clean.
  const mod = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = (mod as { default: (b: Buffer) => Promise<{ text: string; numpages: number }> }).default;
  const out = await pdfParse(bytes);
  return {
    text: (out.text ?? "").slice(0, MAX_OUTPUT_CHARS),
    pageCount: Math.max(1, out.numpages ?? 1),
  };
}

function looksScanned(result: OcrResult): boolean {
  const trimmed = result.text.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return true;
  return trimmed.length < SCANNED_PDF_CHARS_PER_PAGE * result.pageCount;
}

function openAIBaseUrl(): string {
  return process.env.OPENAI_BASE_URL?.replace(/\/$/, "") ?? "https://api.openai.com/v1";
}

function openAIHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  };
}

// Vision OCR for image bytes via chat/completions + `image_url` data URL.
async function visionOcrImage(input: OcrInput): Promise<string> {
  const ct = input.contentType!.toLowerCase();
  const dataUrl = `data:${ct};base64,${input.bytes.toString("base64")}`;
  const body = {
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: SYSTEM_OCR_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `Extract all readable text from "${input.fileName}".` },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    max_completion_tokens: 4000,
  };

  const res = await fetch(`${openAIBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: openAIHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI image OCR failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (json.choices?.[0]?.message?.content ?? "").slice(0, MAX_OUTPUT_CHARS);
}

// Vision OCR for scanned-PDF bytes via the Responses API, which accepts a
// PDF as an `input_file` content block with a base64 `file_data` data URL.
// This handles PDFs that are pure page images (no text layer).
async function visionOcrScannedPdf(input: OcrInput): Promise<string> {
  const dataUrl = `data:application/pdf;base64,${input.bytes.toString("base64")}`;
  const body = {
    model: "gpt-5-mini",
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: SYSTEM_OCR_PROMPT }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: `Extract all readable text from "${input.fileName}".` },
          { type: "input_file", filename: input.fileName, file_data: dataUrl },
        ],
      },
    ],
    max_output_tokens: 4000,
  };

  const res = await fetch(`${openAIBaseUrl()}/responses`, {
    method: "POST",
    headers: openAIHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI PDF OCR failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  // Prefer the `output_text` shortcut when present; fall back to walking
  // `output[*].content[*].text`.
  if (typeof json.output_text === "string" && json.output_text.length > 0) {
    return json.output_text.slice(0, MAX_OUTPUT_CHARS);
  }
  const parts: string[] = [];
  for (const item of json.output ?? []) {
    for (const c of item.content ?? []) {
      if (typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("\n").slice(0, MAX_OUTPUT_CHARS);
}

async function extractPdf(input: OcrInput): Promise<OcrResult> {
  const native = await pdfParseNative(input.bytes);
  if (!looksScanned(native)) return native;
  // Scanned-PDF fallback. If we don't have an OpenAI key configured, return
  // whatever pdf-parse gave us (likely empty) and let the heuristics report
  // no suggestions — better than throwing.
  if (!isOcrConfigured()) {
    logger.info(
      { storageKey: input.storageKey, pageCount: native.pageCount },
      "Scanned PDF detected but OPENAI_API_KEY missing — skipping vision fallback",
    );
    return native;
  }
  try {
    const text = await visionOcrScannedPdf(input);
    return { text, pageCount: native.pageCount };
  } catch (err) {
    logger.warn({ err, storageKey: input.storageKey }, "scanned-PDF vision OCR failed; using pdf-parse output");
    return native;
  }
}

async function extractImage(input: OcrInput): Promise<OcrResult | null> {
  if (!isOcrConfigured()) return null;
  const text = await visionOcrImage(input);
  return { text, pageCount: 1 };
}

// Pre-count pages without running the OCR model, so the scheduler can
// enforce a hard daily page cap before dispatching expensive provider
// calls. Text and images count as 1 page; PDFs use pdf-parse's numpages.
export async function estimatePages(input: OcrInput): Promise<number> {
  const ct = (input.contentType ?? "").toLowerCase();
  if (ct.startsWith("text/")) return 1;
  if (ct.startsWith("image/")) return 1;
  if (ct === "application/pdf") {
    try {
      const out = await pdfParseNative(input.bytes);
      return out.pageCount;
    } catch {
      return 1;
    }
  }
  return 1;
}

export async function extractText(input: OcrInput): Promise<OcrResult | null> {
  const ct = (input.contentType ?? "").toLowerCase();

  if (ct.startsWith("text/")) {
    return { text: input.bytes.toString("utf8").slice(0, MAX_OUTPUT_CHARS), pageCount: 1 };
  }

  if (ct === "application/pdf") {
    try {
      return await extractPdf(input);
    } catch (err) {
      logger.warn({ err, storageKey: input.storageKey }, "PDF OCR failed");
      throw err;
    }
  }

  if (ct.startsWith("image/")) {
    try {
      return await extractImage(input);
    } catch (err) {
      logger.warn({ err, storageKey: input.storageKey }, "image OCR failed");
      throw err;
    }
  }

  return null;
}
