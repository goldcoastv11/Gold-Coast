import jwt from "jsonwebtoken";
import { env } from "../env";

export interface JwtPayload {
  sub: string; // userId
  username: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] });
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === "string" || !decoded.sub || typeof (decoded as JwtPayload).username !== "string") {
    throw new Error("Malformed token payload");
  }
  return { sub: decoded.sub as string, username: (decoded as JwtPayload).username };
}
