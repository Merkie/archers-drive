/**
 * Path helpers for the user-facing virtual filesystem.
 *
 * Paths look like POSIX: "/", "/notes", "/notes/ideas/foo.md".
 * They map to (Folder, name) tuples in the database.
 */

export interface ParsedPath {
  /** Path segments without the trailing leaf, e.g. ["notes", "ideas"]. */
  parents: string[];
  /** Final segment, e.g. "foo.md". Empty string for the root. */
  leaf: string;
}

export function normalizePath(input: string): string {
  if (!input || typeof input !== "string") return "/";
  // Collapse repeated slashes, strip trailing slash (except for root).
  const collapsed = input.replace(/\/+/g, "/");
  const trimmed = collapsed.length > 1 && collapsed.endsWith("/")
    ? collapsed.slice(0, -1)
    : collapsed;
  if (!trimmed.startsWith("/")) return "/" + trimmed;
  return trimmed;
}

export function parsePath(input: string): ParsedPath {
  const norm = normalizePath(input);
  if (norm === "/") return { parents: [], leaf: "" };
  const segments = norm.split("/").filter(Boolean);
  const leaf = segments.pop() ?? "";
  return { parents: segments, leaf };
}

export function joinPath(parents: string[], leaf: string): string {
  const all = [...parents, leaf].filter(Boolean);
  return "/" + all.join("/");
}

/** Reject names with path separators or control characters. */
export function isValidName(name: string): boolean {
  if (!name || typeof name !== "string") return false;
  if (name === "." || name === "..") return false;
  if (name.length > 255) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\/\\\x00-\x1f]/.test(name)) return false;
  return true;
}
