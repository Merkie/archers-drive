/**
 * Drive operations: resolving virtual paths to Folder/File rows,
 * walking the tree, and creating folder chains on demand.
 *
 * All functions are scoped to a userId — the caller never sees rows
 * from another user's drive.
 */

import prisma from "../resources/prisma.js";
import { isValidName, parsePath } from "./paths.js";

export interface ResolvedFolder {
  /** null = drive root (no Folder row). */
  folderId: string | null;
}

export interface ResolvedFile {
  fileId: string;
}

/** Resolve a folder path to a folderId (or null for root). Throws if any segment is missing. */
export async function resolveFolder(
  userId: string,
  pathSegments: string[]
): Promise<ResolvedFolder> {
  let parentId: string | null = null;
  for (const segment of pathSegments) {
    if (!isValidName(segment)) {
      throw new Error(`Invalid path segment: ${segment}`);
    }
    const folder: { id: string } | null = await prisma.folder.findFirst({
      where: { userId, parentId, name: segment },
      select: { id: true },
    });
    if (!folder) throw new Error(`Folder not found: ${segment}`);
    parentId = folder.id;
  }
  return { folderId: parentId };
}

/** Like resolveFolder, but creates intermediate folders that don't exist yet. */
export async function resolveOrCreateFolder(
  userId: string,
  pathSegments: string[]
): Promise<ResolvedFolder> {
  let parentId: string | null = null;
  for (const segment of pathSegments) {
    if (!isValidName(segment)) {
      throw new Error(`Invalid folder name: ${segment}`);
    }
    const existing: { id: string } | null = await prisma.folder.findFirst({
      where: { userId, parentId, name: segment },
      select: { id: true },
    });
    const folder: { id: string } = existing
      ? existing
      : await prisma.folder.create({
          data: { userId, parentId, name: segment },
          select: { id: true },
        });
    parentId = folder.id;
  }
  return { folderId: parentId };
}

export async function resolveFileByPath(userId: string, path: string) {
  const parsed = parsePath(path);
  if (!parsed.leaf) throw new Error("Path does not refer to a file");
  const { folderId } = await resolveFolder(userId, parsed.parents);
  const file = await prisma.file.findFirst({
    where: { userId, folderId, name: parsed.leaf },
  });
  if (!file) throw new Error(`File not found: ${path}`);
  return file;
}

/** Build the human-readable path for a file row. */
export async function pathForFile(userId: string, fileId: string): Promise<string> {
  const file = await prisma.file.findFirst({
    where: { id: fileId, userId },
  });
  if (!file) throw new Error("File not found");
  const segments: string[] = [file.name];
  let cursor = file.folderId;
  while (cursor) {
    const folder: { name: string; parentId: string | null } | null =
      await prisma.folder.findUnique({
        where: { id: cursor },
        select: { name: true, parentId: true },
      });
    if (!folder) break;
    segments.unshift(folder.name);
    cursor = folder.parentId;
  }
  return "/" + segments.join("/");
}
