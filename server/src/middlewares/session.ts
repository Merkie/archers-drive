import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "archers-drive-dev-secret";

export interface SessionPayload {
  userId: string;
}

declare global {
  namespace Express {
    interface Request {
      sessionUserId?: string;
    }
  }
}

export function signSessionToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

export function requireSession(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.session;
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as SessionPayload;
    req.sessionUserId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid session" });
  }
}
