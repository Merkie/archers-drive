import { Router, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import prisma from "../resources/prisma.js";
import { requireSession } from "../middlewares/session.js";
import {
  uploadBuffer,
  deleteObject,
  publicUrlFor,
} from "../lib/r2.js";
import { isValidName } from "../lib/paths.js";

const router = Router();
router.use(requireSession);

// 50 MB cap for the MVP web uploader.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

/**
 * Browse a single folder. `folderId=null` (or omitted) means root.
 * Returns child folders + files for that folder.
 */
router.get("/list", async (req: Request, res: Response) => {
  const userId = req.sessionUserId!;
  const folderId = (req.query.folderId as string | undefined) || null;

  if (folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: folderId, userId },
    });
    if (!folder) {
      res.status(404).json({ error: "Folder not found" });
      return;
    }
  }

  const [folders, files] = await Promise.all([
    prisma.folder.findMany({
      where: { userId, parentId: folderId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    }),
    prisma.file.findMany({
      where: { userId, folderId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        size: true,
        mimeType: true,
        storageKey: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  // Build breadcrumbs from this folder up to root.
  const breadcrumbs: Array<{ id: string | null; name: string }> = [
    { id: null, name: "Drive" },
  ];
  let cursor: string | null = folderId;
  const chain: Array<{ id: string; name: string }> = [];
  while (cursor) {
    const node: { id: string; name: string; parentId: string | null } | null =
      await prisma.folder.findUnique({
        where: { id: cursor },
        select: { id: true, name: true, parentId: true },
      });
    if (!node) break;
    chain.unshift({ id: node.id, name: node.name });
    cursor = node.parentId;
  }
  breadcrumbs.push(...chain);

  res.json({
    folderId,
    breadcrumbs,
    folders,
    files: files.map((f) => ({
      ...f,
      url: publicUrlFor(f.storageKey),
    })),
  });
});

const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
  parentId: z.string().nullable().optional(),
});

router.post("/folders", async (req: Request, res: Response) => {
  const userId = req.sessionUserId!;
  const parsed = createFolderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { name, parentId = null } = parsed.data;
  if (!isValidName(name)) {
    res.status(400).json({ error: "Invalid folder name" });
    return;
  }

  if (parentId) {
    const parent = await prisma.folder.findFirst({
      where: { id: parentId, userId },
    });
    if (!parent) {
      res.status(404).json({ error: "Parent folder not found" });
      return;
    }
  }

  // Pre-check: SQLite NULL semantics let multiple root-level folders share a name
  // even with @@unique([userId, parentId, name]).
  const conflict = await prisma.folder.findFirst({
    where: { userId, parentId, name },
    select: { id: true },
  });
  if (conflict) {
    res.status(409).json({ error: "A folder with that name already exists here" });
    return;
  }

  try {
    const folder = await prisma.folder.create({
      data: { userId, parentId, name },
    });
    res.status(201).json({ folder });
  } catch (err: unknown) {
    res.status(409).json({ error: "A folder with that name already exists here" });
  }
});

router.delete("/folders/:id", async (req: Request, res: Response) => {
  const userId = req.sessionUserId!;
  const id = String(req.params.id);
  const folder = await prisma.folder.findFirst({
    where: { id, userId },
  });
  if (!folder) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }

  // Recursively gather all descendant files so we can clean up R2.
  const fileIds: string[] = [];
  const stack: string[] = [folder.id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const [childFiles, childFolders] = await Promise.all([
      prisma.file.findMany({ where: { folderId: current, userId }, select: { storageKey: true } }),
      prisma.folder.findMany({ where: { parentId: current, userId }, select: { id: true } }),
    ]);
    for (const f of childFiles) fileIds.push(f.storageKey);
    for (const c of childFolders) stack.push(c.id);
  }

  await prisma.folder.delete({ where: { id: folder.id } });

  // Best-effort R2 cleanup.
  await Promise.allSettled(fileIds.map((key) => deleteObject(key)));

  res.json({ ok: true });
});

router.post(
  "/files/upload",
  upload.single("file"),
  async (req: Request, res: Response) => {
    const userId = req.sessionUserId!;
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const folderId = (req.body.folderId as string | undefined) || null;
    if (folderId) {
      const parent = await prisma.folder.findFirst({
        where: { id: folderId, userId },
      });
      if (!parent) {
        res.status(404).json({ error: "Folder not found" });
        return;
      }
    }

    const originalName = req.file.originalname;
    if (!isValidName(originalName)) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }

    // Pre-check for conflicts. SQLite/Postgres treat NULL as distinct in unique
    // constraints, so root-level (folderId == null) collisions slip past the
    // schema-level @@unique and must be caught explicitly.
    const conflict = await prisma.file.findFirst({
      where: { userId, folderId, name: originalName },
      select: { id: true },
    });
    if (conflict) {
      res.status(409).json({ error: "A file with that name already exists here" });
      return;
    }

    // Reserve the DB row first; the storageKey embeds the new file's cuid for uniqueness.
    try {
      const created = await prisma.file.create({
        data: {
          userId,
          folderId,
          name: originalName,
          size: req.file.size,
          mimeType: req.file.mimetype || "application/octet-stream",
          // Temporary placeholder; rewritten below using the row's id.
          storageKey: `pending/${Date.now()}/${originalName}`,
        },
      });

      const storageKey = `${created.id}/${originalName}`;
      await uploadBuffer(storageKey, req.file.buffer, created.mimeType);
      const updated = await prisma.file.update({
        where: { id: created.id },
        data: { storageKey },
      });

      res.status(201).json({
        file: { ...updated, url: publicUrlFor(updated.storageKey) },
      });
    } catch (err: unknown) {
      console.error("upload error:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

router.delete("/files/:id", async (req: Request, res: Response) => {
  const userId = req.sessionUserId!;
  const id = String(req.params.id);
  const file = await prisma.file.findFirst({
    where: { id, userId },
  });
  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  await prisma.file.delete({ where: { id: file.id } });
  await deleteObject(file.storageKey).catch(() => {});

  res.json({ ok: true });
});

const renameSchema = z.object({ name: z.string().min(1).max(255) });

router.patch("/files/:id", async (req: Request, res: Response) => {
  const userId = req.sessionUserId!;
  const parsed = renameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  if (!isValidName(parsed.data.name)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  const id = String(req.params.id);
  const file = await prisma.file.findFirst({
    where: { id, userId },
  });
  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  try {
    const updated = await prisma.file.update({
      where: { id: file.id },
      data: { name: parsed.data.name },
    });
    res.json({ file: { ...updated, url: publicUrlFor(updated.storageKey) } });
  } catch {
    res.status(409).json({ error: "A file with that name already exists here" });
  }
});

export default router;
