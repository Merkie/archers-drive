/**
 * Mime-type helpers shared between the web upload route and the v1 write
 * endpoint. Browsers leave the content type blank (or send the generic
 * `application/octet-stream` default) for a lot of text formats — notably
 * `.md`, `.log`, `.yml` — so we fall back to extension-based detection.
 */

const EXT_TO_MIME: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  yml: "application/x-yaml",
  yaml: "application/x-yaml",
  log: "text/plain",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function guessMimeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return EXT_TO_MIME[ext] ?? "application/octet-stream";
}

/**
 * Pick the best mime type for an uploaded file. If the browser reported a
 * specific mime (anything other than the generic octet-stream fallback) we
 * trust it; otherwise we guess from the file extension so that text files
 * uploaded via the web UI don't come out as opaque binaries.
 */
export function resolveUploadMime(reportedMime: string | undefined, filename: string): string {
  if (reportedMime && reportedMime !== "application/octet-stream") {
    return reportedMime;
  }
  return guessMimeFromName(filename);
}
