import { Router, Request, Response } from "express";
import { z } from "zod";
import prisma from "../resources/prisma.js";
import { requireSession } from "../middlewares/session.js";
import { generateApiKey } from "../middlewares/apiKey.js";

const router = Router();
router.use(requireSession);

router.get("/", async (req: Request, res: Response) => {
  const userId = req.sessionUserId!;
  const keys = await prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      label: true,
      prefix: true,
      scope: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });
  res.json({ keys });
});

const createSchema = z.object({
  label: z.string().min(1).max(120),
  scope: z.enum(["read", "write"]),
});

router.post("/", async (req: Request, res: Response) => {
  const userId = req.sessionUserId!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { raw, prefix, hash } = await generateApiKey();
  const created = await prisma.apiKey.create({
    data: {
      userId,
      label: parsed.data.label,
      scope: parsed.data.scope,
      prefix,
      tokenHash: hash,
    },
    select: {
      id: true,
      label: true,
      prefix: true,
      scope: true,
      createdAt: true,
    },
  });

  // The raw token is returned exactly once.
  res.status(201).json({ key: created, token: raw });
});

router.delete("/:id", async (req: Request, res: Response) => {
  const userId = req.sessionUserId!;
  const id = String(req.params.id);
  const key = await prisma.apiKey.findFirst({
    where: { id, userId },
  });
  if (!key) {
    res.status(404).json({ error: "API key not found" });
    return;
  }
  await prisma.apiKey.delete({ where: { id: key.id } });
  res.json({ ok: true });
});

export default router;
