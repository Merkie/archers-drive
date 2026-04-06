import CloudConvert from "cloudconvert";

let client: CloudConvert | null = null;

function getClient(): CloudConvert {
  const key = process.env.CLOUD_CONVERT_KEY;
  if (!key) throw new Error("CLOUD_CONVERT_KEY is not configured");
  if (!client) client = new CloudConvert(key);
  return client;
}

// MIME types that are already plain text — no conversion round-trip needed.
const PLAINTEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/xml",
  "text/xml",
]);

// Spreadsheet inputs convert to CSV; everything else convertible converts to TXT.
const SPREADSHEET_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "application/vnd.google-apps.spreadsheet",
]);

// Inputs we know how to feed into CloudConvert for text extraction.
export const TEXT_CONVERTIBLE_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-word",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
  "application/pdf",
  "text/html",
]);

// Inputs we know how to feed into CloudConvert for PDF rendering.
export const PDF_CONVERTIBLE_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.ms-excel",
  "application/vnd.ms-word",
  "application/msword",
  "text/csv",
  "text/html",
  "text/plain",
  "text/markdown",
]);

// MIME → extension. CloudConvert needs a filename with the right ext.
const MIME_TO_EXT: Record<string, string> = {
  "application/json": ".json",
  "application/msword": ".doc",
  "application/pdf": ".pdf",
  "application/vnd.google-apps.document": ".docx",
  "application/vnd.google-apps.presentation": ".pptx",
  "application/vnd.google-apps.spreadsheet": ".xlsx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.ms-word": ".doc",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "text/csv": ".csv",
  "text/html": ".html",
  "text/markdown": ".md",
  "text/plain": ".txt",
};

export function isAlreadyPlaintext(mime: string): boolean {
  return PLAINTEXT_MIME_TYPES.has(mime);
}

export function canConvertToText(mime: string): boolean {
  return PLAINTEXT_MIME_TYPES.has(mime) || TEXT_CONVERTIBLE_MIME_TYPES.has(mime);
}

export function canConvertToPdf(mime: string): boolean {
  return mime === "application/pdf" || PDF_CONVERTIBLE_MIME_TYPES.has(mime);
}

function textOutputFormat(mime: string): "csv" | "txt" {
  return SPREADSHEET_MIME_TYPES.has(mime) ? "csv" : "txt";
}

function sanitizeFilename(name: string, mime: string): string {
  const ext = MIME_TO_EXT[mime] || ".bin";
  const base = name
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (base || "file") + ext;
}

interface ConvertResult {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

async function downloadFromUrl(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Conversion download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Run a sync CloudConvert job that imports a publicly-fetchable URL,
 * converts to the requested target, and returns the result buffer.
 */
async function runConvertJob(opts: {
  importUrl: string;
  filename: string;
  outputFormat: string;
}): Promise<Buffer> {
  const cc = getClient();
  const job = await cc.jobs.create({
    tasks: {
      "import-file": {
        operation: "import/url",
        url: opts.importUrl,
        filename: opts.filename,
      },
      "convert-file": {
        operation: "convert",
        input: "import-file",
        output_format: opts.outputFormat,
      },
      "export-file": {
        operation: "export/url",
        input: "convert-file",
      },
    },
  });

  const finished = await cc.jobs.wait(job.id);
  const failed = (finished.tasks ?? []).filter((t: any) => t.status === "error");
  if (failed.length > 0) {
    const messages = failed.map((t: any) => t.message ?? t.code).join("; ");
    throw new Error(`CloudConvert error: ${messages}`);
  }

  const exportTask = (finished.tasks ?? []).find((t: any) => t.name === "export-file");
  const fileUrl: string | undefined = exportTask?.result?.files?.[0]?.url;
  if (!fileUrl) throw new Error("CloudConvert did not return an output file");

  return downloadFromUrl(fileUrl);
}

export async function convertToText(opts: {
  importUrl: string;
  originalName: string;
  mimeType: string;
}): Promise<ConvertResult> {
  if (isAlreadyPlaintext(opts.mimeType)) {
    // Caller should bypass conversion, but handle gracefully if not.
    const buf = await downloadFromUrl(opts.importUrl);
    return { buffer: buf, mimeType: opts.mimeType, filename: opts.originalName };
  }
  const format = textOutputFormat(opts.mimeType);
  const buffer = await runConvertJob({
    importUrl: opts.importUrl,
    filename: sanitizeFilename(opts.originalName, opts.mimeType),
    outputFormat: format,
  });
  return {
    buffer,
    mimeType: format === "csv" ? "text/csv" : "text/plain",
    filename: opts.originalName.replace(/\.[^.]+$/, "") + (format === "csv" ? ".csv" : ".txt"),
  };
}

export async function convertToPdf(opts: {
  importUrl: string;
  originalName: string;
  mimeType: string;
}): Promise<ConvertResult> {
  if (opts.mimeType === "application/pdf") {
    const buf = await downloadFromUrl(opts.importUrl);
    return { buffer: buf, mimeType: "application/pdf", filename: opts.originalName };
  }
  const buffer = await runConvertJob({
    importUrl: opts.importUrl,
    filename: sanitizeFilename(opts.originalName, opts.mimeType),
    outputFormat: "pdf",
  });
  return {
    buffer,
    mimeType: "application/pdf",
    filename: opts.originalName.replace(/\.[^.]+$/, "") + ".pdf",
  };
}
