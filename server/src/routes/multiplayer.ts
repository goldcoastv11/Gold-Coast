import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { registerRoute } from "./registry";
import { RoomService, RoomError, SHIRTS, SKINS, HAIR } from "../multiplayer/room";

const rooms = new RoomService();
const color = (choices: string[]) => z.string().refine(v => choices.includes(v));
const LookSchema = z.object({ shirt: color(SHIRTS), skin: color(SKINS), hair: color(HAIR) });
const Code = z.string().regex(/^[A-F0-9]{6}$/);
const router = Router();
router.use("/multiplayer", requireAuth);
const schemas = {
  join: z.object({ code: Code.optional(), look: LookSchema }),
  sync: z.object({ code: Code, pose: z.object({ x: z.number().finite().min(-10).max(10), z: z.number().finite().min(-7).max(9), yaw: z.number().finite().min(-100).max(100), look: LookSchema }).optional() }),
  action: z.object({ code: Code, action: z.enum(["sit", "leave", "deal", "hit", "stand"]), revision: z.number().int().nonnegative() }),
  leave: z.object({ code: Code })
};
for (const kind of ["join", "sync", "action", "leave"] as const) {
  router.post(`/multiplayer/${kind}`, (req, res, next) => {
    const parsed = schemas[kind].safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid room request." }); return; }
    const { userId, username } = req as AuthedRequest;
    res.setHeader("Cache-Control", "no-store");
    try {
      // Each branch parses its specific discriminated payload after the common validation.
      if (kind === "join") { const b = schemas.join.parse(req.body); res.json(rooms.join(userId, username, b.code, b.look)); }
      if (kind === "sync") { const b = schemas.sync.parse(req.body); res.json(rooms.sync(userId, b.code, b.pose)); }
      if (kind === "action") { const b = schemas.action.parse(req.body); res.json(rooms.action(userId, b.code, b.action, b.revision)); }
      if (kind === "leave") { const b = schemas.leave.parse(req.body); rooms.leave(userId, b.code); res.json({ ok: true }); }
    } catch (e) { if (e instanceof RoomError) res.status(e.status).json({ error: e.message }); else next(e); }
  });
}
registerRoute(router);
