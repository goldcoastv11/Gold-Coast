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

/**
 * Like `requireAuth`, but never rejects: a valid `Authorization: Bearer
 * <jwt>` sets req.userId/req.username, and ANY other case (no header, a
 * malformed one, an expired/forged token) simply leaves them undefined and
 * calls next(). Added for POST /events (see routes/events.ts), where the
 * pre-login half of the funnel - app boot, the login screen itself - is
 * exactly the data worth having, so an anonymous caller must be a
 * first-class success case rather than a 401.
 *
 * Use this ONLY for routes where "we don't know who this is" is a valid
 * outcome. Anything that reads or writes a specific player's state (money,
 * inventory, rounds) must keep using `requireAuth` - a route that silently
 * degrades to anonymous is a route that silently skips an auth check.
 *
 * Note the asymmetry with `requireAuth` on a BAD token: this treats it as
 * anonymous rather than a 401. That's deliberate for telemetry - a player
 * whose JWT expired mid-session should keep producing (anonymous) events
 * instead of having tracking start erroring - but it's precisely why this
 * must not guard anything that matters.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return next();

  const token = header.slice("Bearer ".length).trim();
  try {
    const payload = verifyToken(token);
    (req as AuthedRequest).userId = payload.sub;
    (req as AuthedRequest).username = payload.username;
  } catch {
    // Anonymous - see doc comment.
  }
  next();
}
