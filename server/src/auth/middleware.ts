import { NextFunction, Request, Response } from "express";
import { verifyToken } from "./jwt";

export interface AuthedRequest extends Request {
  userId: string;
  username: string;
}

/** Requires `Authorization: Bearer <jwt>`. On success, sets req.userId/req.username. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header", code: "UNAUTHORIZED" });
  }

  const token = header.slice("Bearer ".length).trim();
  try {
    const payload = verifyToken(token);
    (req as AuthedRequest).userId = payload.sub;
    (req as AuthedRequest).username = payload.username;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token", code: "UNAUTHORIZED" });
  }
}
