import { Request, Response, NextFunction } from "express";
import argon2 from "argon2";
import prisma from "../resources/prisma.js";

declare global {
  namespace Express {
    interface Request {
      apiKeyUserId?: string;
      apiKeyScope?: "read" | "write";
      apiKeyId?: string;
    }
  }
}

const KEY_PREFIX = "adk_live_";

/**
 * Generates a new raw API key. Format: `adk_live_<64 hex chars>`.
 * The raw key is shown to the user exactly once. Only its hash is stored.
 */
export async function generateApiKey(): Promise<{ raw: string; prefix: string; hash: string }> {
  const { randomBytes } = await import("node:crypto");
  const random = randomBytes(32).toString("hex");
  const raw = `${KEY_PREFIX}${random}`;
  const prefix = raw.slice(0, 16); // "adk_live_xxxxxxx" — enough to recognize, not enough to guess
  const hash = await argon2.hash(raw);
  return { raw, prefix, hash };
}

async function findKeyMatching(rawToken: string) {
  if (!rawToken.startsWith(KEY_PREFIX)) return null;
  const prefix = rawToken.slice(0, 16);
  // Multiple keys could share a prefix in theory; check each.
  const candidates = await prisma.apiKey.findMany({ where: { prefix } });
  for (const candidate of candidates) {
    const ok = await argon2.verify(candidate.tokenHash, rawToken);
    if (ok) return candidate;
  }
  return null;
}

async function authenticate(req: Request): Promise<{ ok: true; key: Awaited<ReturnType<typeof findKeyMatching>> } | { ok: false; status: number; error: string }> {
  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, error: "Missing bearer token" };
  }
  const token = header.slice(7).trim();
  if (!token) return { ok: false, status: 401, error: "Empty bearer token" };
  const key = await findKeyMatching(token);
  if (!key) return { ok: false, status: 401, error: "Invalid API key" };
  return { ok: true, key };
}

export function requireApiKey(opts: { scope: "read" | "write" }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const result = await authenticate(req);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const key = result.key!;
    if (opts.scope === "write" && key.scope !== "write") {
      res.status(403).json({ error: "This API key is read-only" });
      return;
    }
    req.apiKeyUserId = key.userId;
    req.apiKeyScope = key.scope as "read" | "write";
    req.apiKeyId = key.id;

    // Best-effort lastUsedAt update; don't block the request on it.
    prisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    next();
  };
}
