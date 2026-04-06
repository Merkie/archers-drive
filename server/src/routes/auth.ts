import { Router, Request, Response } from "express";
import argon2 from "argon2";
import { z } from "zod";
import prisma from "../resources/prisma.js";
import { requireSession, signSessionToken } from "../middlewares/session.js";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

router.post("/register", async (req: Request, res: Response) => {
  try {
    const { email, name, password } = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: "Email already in use" });
      return;
    }

    const hashed = await argon2.hash(password);
    const user = await prisma.user.create({
      data: { email, name, password: hashed },
    });

    res.cookie("session", signSessionToken(user.id), COOKIE_OPTS);
    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0]?.message ?? "Invalid input" });
      return;
    }
    console.error("register error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const valid = await argon2.verify(user.password, password);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    res.cookie("session", signSessionToken(user.id), COOKIE_OPTS);
    res.json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0]?.message ?? "Invalid input" });
      return;
    }
    console.error("login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/me", requireSession, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.sessionUserId },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user });
});

router.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie("session");
  res.json({ ok: true });
});

export default router;
