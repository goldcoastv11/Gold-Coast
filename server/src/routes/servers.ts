/**
 * The server browser: list the public servers, create a private one, or
 * resolve a join code.
 *
 * Over HTTP rather than the socket because none of it is realtime - a
 * browser screen that refreshes when you open it is exactly right, and
 * keeping it here means a player can see what's available before their
 * WebSocket has even connected.
 *
 * Nothing in this file moves money or touches the database. A "server" is
 * an in-memory room (see realtime/gameServers.ts); these routes are its
 * front door.
 */

import { Router } from "express";
import { registerRoute } from "./registry";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { asyncHandler } from "../asyncHandler";
import { gameServers } from "../realtime/gameServers";
import { presenceHub } from "../realtime/presence";
import { JOIN_CODE_LENGTH } from "../realtime/protocol";

const router = Router();

/** Live head count for a server, read from presence - the only thing that actually knows who is where. */
const occupancy = (serverId: string) => presenceHub.occupancy(serverId);

/**
 * The browser's list.
 *
 * Public servers only. Private ones are deliberately absent - not even
 * their names - because "reachable only by code" is the entire point of
 * them. Listing a private server's existence would let anyone enumerate
 * which rooms exist and how busy they are.
 */
router.get(
  "/servers",
  requireAuth,
  asyncHandler(async (_req, res) => {
    return res.json({ servers: gameServers.listPublic(occupancy) });
  })
);

const CreateServerSchema = z.object({
  // Optional: a private server is perfectly usable with a default name, and
  // requiring one is a keyboard on a phone for no benefit.
  name: z.string().trim().min(1).max(24).optional()
});

/**
 * Creates a private server and returns its join code.
 *
 * The code comes back ONLY in this response - the browser never lists it,
 * and no other route hands it out. Whoever creates the server is the one
 * who shares it.
 */
router.post(
  "/servers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { username } = req as AuthedRequest;
    const parsed = CreateServerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid server payload", code: "INVALID_INPUT" });
    }

    const name = parsed.data.name ?? `${username}'s table`;
    const server = gameServers.createPrivate(name);

    return res.status(201).json({
      server: { ...gameServers.summarize(server, occupancy), joinCode: server.joinCode }
    });
  })
);

const JoinSchema = z.object({
  code: z
    .string()
    .trim()
    .min(JOIN_CODE_LENGTH)
    .max(JOIN_CODE_LENGTH * 2)
});

/**
 * Resolves a join code to a server.
 *
 * Resolving is NOT joining: this hands back the server's id, and the client
 * then enters it over the socket like any other. Keeping the two separate
 * means there is exactly one code path for "walk into a server", whether it
 * was found in the list or via a code.
 */
router.post(
  "/servers/join",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = JoinSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Enter a join code", code: "INVALID_INPUT" });
    }

    const server = gameServers.resolveCode(parsed.data.code);
    if (!server) {
      // Deliberately the same answer for "never existed" and "expired": a
      // different message for each would turn this into an oracle for
      // testing whether a given code is live.
      return res
        .status(404)
        .json({ error: "No server with that code", code: "SERVER_NOT_FOUND" });
    }

    return res.json({ server: gameServers.summarize(server, occupancy) });
  })
);

registerRoute(router);

export default router;
