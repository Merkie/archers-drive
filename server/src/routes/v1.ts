import { Router, Request, Response } from "express";
import { z } from "zod";
import prisma from "../resources/prisma.js";
import { requireApiKey } from "../middlewares/apiKey.js";
import {
  uploadBuffer,
  deleteObject,
  signedDownloadUrl,
  publicUrlFor,
  downloadBuffer,
} from "../lib/r2.js";
import {
  isValidName,
  normalizePath,
  parsePath,
} from "../lib/paths.js";
import {
  resolveFolder,
  resolveOrCreateFolder,
  resolveFileByPath,
} from "../lib/drive.js";
import {
  canConvertToPdf,
  canConvertToText,
  convertToPdf,
  convertToText,
  isAlreadyPlaintext,
} from "../lib/cloudconvert.js";

const router = Router();

// ---- LIST ----------------------------------------------------------------

router.get("/files", requireApiKey({ scope: "read" }), async (req: Request, res: Response) => {
  const userId = req.apiKeyUserId!;
  const path = normalizePath((req.query.path as string) || "/");
  const parsed = parsePath(path);

  // The path could refer to either a folder or a file. Try folder first.
  try {
    const segments = parsed.leaf ? [...parsed.parents, parsed.leaf] : parsed.parents;
    const { folderId } = await resolveFolder(userId, segments);

    const [folders, files] = await Promise.all([
      prisma.folder.findMany({
        where: { userId, parentId: folderId },
        orderBy: { name: "asc" },
        select: { name: true },
      }),
      prisma.file.findMany({
        where: { userId, folderId },
        orderBy: { name: "asc" },
        select: { name: true, size: true, mimeType: true },
      }),
    ]);

    const entries = [
      ...folders.map((f: { name: string }) => ({
        type: "folder" as const,
        name: f.name,
        path: joinChild(path, f.name),
      })),
      ...files.map((f: { name: string; size: number; mimeType: string }) => ({
        type: "file" as const,
        name: f.name,
        path: joinChild(path, f.name),
        size: f.size,
        mimeType: f.mimeType,
      })),
    ];

    res.json({ path, entries });
  } catch {
    res.status(404).json({ error: "Path not found" });
  }
});

function joinChild(parent: string, child: string): string {
  return parent === "/" ? `/${child}` : `${parent}/${child}`;
}

// ---- READ ----------------------------------------------------------------

const readSchema = z.object({
  path: z.string().min(1),
  returnType: z.enum(["url", "blob"]).default("url"),
  convertTo: z.enum(["text", "pdf"]).optional(),
});

router.post("/files/read", requireApiKey({ scope: "read" }), async (req: Request, res: Response) => {
  const userId = req.apiKeyUserId!;
  const parsed = readSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { path, returnType, convertTo } = parsed.data;

  let file;
  try {
    file = await resolveFileByPath(userId, path);
  } catch {
    res.status(404).json({ error: "File not found" });
    return;
  }

  // No conversion requested → return the raw file.
  if (!convertTo) {
    if (returnType === "url") {
      const url = await signedDownloadUrl(file.storageKey, 300);
      res.json({
        path,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
        returnType: "url",
        url,
        cdnUrl: publicUrlFor(file.storageKey),
        expiresInSeconds: 300,
      });
      return;
    }

    const buf = await downloadBuffer(file.storageKey);
    res.json({
      path,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      returnType: "blob",
      encoding: "base64",
      content: buf.toString("base64"),
    });
    return;
  }

  // Conversion requested.
  if (convertTo === "text" && !canConvertToText(file.mimeType)) {
    res.status(415).json({ error: `Cannot convert ${file.mimeType} to text` });
    return;
  }
  if (convertTo === "pdf" && !canConvertToPdf(file.mimeType)) {
    res.status(415).json({ error: `Cannot convert ${file.mimeType} to pdf` });
    return;
  }

  // Plaintext input + text output → skip CloudConvert entirely.
  if (convertTo === "text" && isAlreadyPlaintext(file.mimeType)) {
    const buf = await downloadBuffer(file.storageKey);
    if (returnType === "url") {
      // Return original URL since no conversion is needed.
      const url = await signedDownloadUrl(file.storageKey, 300);
      res.json({
        path,
        name: file.name,
        size: buf.byteLength,
        mimeType: file.mimeType,
        returnType: "url",
        url,
        convertedFrom: file.mimeType,
        convertedTo: "text",
        expiresInSeconds: 300,
      });
      return;
    }
    res.json({
      path,
      name: file.name,
      size: buf.byteLength,
      mimeType: file.mimeType,
      returnType: "blob",
      encoding: "utf8",
      content: buf.toString("utf8"),
      convertedFrom: file.mimeType,
      convertedTo: "text",
    });
    return;
  }

  try {
    // CloudConvert needs a publicly fetchable URL. We use a short-lived signed URL.
    const importUrl = await signedDownloadUrl(file.storageKey, 600);
    const result = convertTo === "text"
      ? await convertToText({ importUrl, originalName: file.name, mimeType: file.mimeType })
      : await convertToPdf({ importUrl, originalName: file.name, mimeType: file.mimeType });

    if (returnType === "url") {
      // Stash the converted bytes in a per-conversion R2 key so we can hand back a URL.
      const tmpKey = `_conversions/${file.id}/${Date.now()}-${result.filename}`;
      await uploadBuffer(tmpKey, result.buffer, result.mimeType);
      const url = await signedDownloadUrl(tmpKey, 600);
      res.json({
        path,
        name: result.filename,
        size: result.buffer.byteLength,
        mimeType: result.mimeType,
        returnType: "url",
        url,
        convertedFrom: file.mimeType,
        convertedTo: convertTo,
        expiresInSeconds: 600,
      });
      return;
    }

    const isText = result.mimeType.startsWith("text/");
    res.json({
      path,
      name: result.filename,
      size: result.buffer.byteLength,
      mimeType: result.mimeType,
      returnType: "blob",
      encoding: isText ? "utf8" : "base64",
      content: isText ? result.buffer.toString("utf8") : result.buffer.toString("base64"),
      convertedFrom: file.mimeType,
      convertedTo: convertTo,
    });
  } catch (err: unknown) {
    console.error("conversion error:", err);
    res.status(502).json({ error: "Conversion failed" });
  }
});

// ---- INFO ----------------------------------------------------------------

const infoSchema = z.object({ path: z.string().min(1) });

router.post("/files/info", requireApiKey({ scope: "read" }), async (req: Request, res: Response) => {
  const userId = req.apiKeyUserId!;
  const parsed = infoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const file = await resolveFileByPath(userId, parsed.data.path);
    res.json({
      path: parsed.data.path,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    });
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});

// ---- WRITE ---------------------------------------------------------------

const writeSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
  mimeType: z.string().optional(),
  overwrite: z.boolean().default(false),
});

router.post("/files/write", requireApiKey({ scope: "write" }), async (req: Request, res: Response) => {
  const userId = req.apiKeyUserId!;
  const parsed = writeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { path, content, encoding, overwrite } = parsed.data;
  const parsedPath = parsePath(path);
  if (!parsedPath.leaf || !isValidName(parsedPath.leaf)) {
    res.status(400).json({ error: "Invalid file path" });
    return;
  }

  const { folderId } = await resolveOrCreateFolder(userId, parsedPath.parents);
  const buffer = Buffer.from(content, encoding);
  const mimeType = parsed.data.mimeType || guessMimeFromName(parsedPath.leaf);

  const existing = await prisma.file.findFirst({
    where: { userId, folderId, name: parsedPath.leaf },
  });

  if (existing && !overwrite) {
    res.status(409).json({ error: "File already exists. Set overwrite: true to replace it." });
    return;
  }

  if (existing) {
    // Replace contents in place under a new storage key, then drop the old object.
    const newKey = `${existing.id}/${parsedPath.leaf}`;
    await uploadBuffer(newKey, buffer, mimeType);
    if (existing.storageKey !== newKey) {
      await deleteObject(existing.storageKey).catch(() => {});
    }
    const updated = await prisma.file.update({
      where: { id: existing.id },
      data: { size: buffer.byteLength, mimeType, storageKey: newKey },
    });
    res.json({
      file: {
        path,
        name: updated.name,
        size: updated.size,
        mimeType: updated.mimeType,
      },
    });
    return;
  }

  const created = await prisma.file.create({
    data: {
      userId,
      folderId,
      name: parsedPath.leaf,
      size: buffer.byteLength,
      mimeType,
      storageKey: `pending/${Date.now()}/${parsedPath.leaf}`,
    },
  });
  const storageKey = `${created.id}/${parsedPath.leaf}`;
  await uploadBuffer(storageKey, buffer, mimeType);
  await prisma.file.update({
    where: { id: created.id },
    data: { storageKey },
  });

  res.status(201).json({
    file: {
      path,
      name: created.name,
      size: buffer.byteLength,
      mimeType,
    },
  });
});

// ---- DELETE --------------------------------------------------------------

const deleteSchema = z.object({ path: z.string().min(1) });

router.post("/files/delete", requireApiKey({ scope: "write" }), async (req: Request, res: Response) => {
  const userId = req.apiKeyUserId!;
  const parsed = deleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const file = await resolveFileByPath(userId, parsed.data.path);
    await prisma.file.delete({ where: { id: file.id } });
    await deleteObject(file.storageKey).catch(() => {});
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});

// ---- MOVE ----------------------------------------------------------------

const moveSchema = z.object({ from: z.string().min(1), to: z.string().min(1) });

router.post("/files/move", requireApiKey({ scope: "write" }), async (req: Request, res: Response) => {
  const userId = req.apiKeyUserId!;
  const parsed = moveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  let file;
  try {
    file = await resolveFileByPath(userId, parsed.data.from);
  } catch {
    res.status(404).json({ error: "Source file not found" });
    return;
  }

  const toParsed = parsePath(parsed.data.to);
  if (!toParsed.leaf || !isValidName(toParsed.leaf)) {
    res.status(400).json({ error: "Invalid destination path" });
    return;
  }

  const { folderId: destFolderId } = await resolveOrCreateFolder(userId, toParsed.parents);

  try {
    await prisma.file.update({
      where: { id: file.id },
      data: { folderId: destFolderId, name: toParsed.leaf },
    });
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: "Destination already exists" });
  }
});

// ---- FOLDERS -------------------------------------------------------------

const createFolderSchema = z.object({ path: z.string().min(1) });

router.post("/folders/create", requireApiKey({ scope: "write" }), async (req: Request, res: Response) => {
  const userId = req.apiKeyUserId!;
  const parsed = createFolderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const parsedPath = parsePath(parsed.data.path);
  const segments = parsedPath.leaf ? [...parsedPath.parents, parsedPath.leaf] : parsedPath.parents;
  if (segments.length === 0) {
    res.status(400).json({ error: "Cannot create root folder" });
    return;
  }
  for (const seg of segments) {
    if (!isValidName(seg)) {
      res.status(400).json({ error: `Invalid folder name: ${seg}` });
      return;
    }
  }
  await resolveOrCreateFolder(userId, segments);
  res.status(201).json({ ok: true, path: parsed.data.path });
});

// Naive ext → mime guesser, used for /v1/files/write when the caller omits mimeType.
function guessMimeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    html: "text/html",
    xml: "application/xml",
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
  return map[ext] ?? "application/octet-stream";
}

export default router;
