/**
 * POST /events - the ingest endpoint for Leg 1 player-activity tracking.
 *
 * Self-hosted on purpose (founder's call): events land in this project's
 * own Postgres `events` table (see prisma/schema.prisma's Event model), not
 * in PostHog/Mixpanel/Amplitude/Segment. No external analytics dependency
 * is added anywhere in this repo.
 *
 * Shape: one request carries a BATCH of events, because the client buffers
 * and flushes (see src/api/track.ts) rather than firing a request per
 * click. A batch is all-or-nothing: one `createMany` insert, so a
 * partially-written batch can't happen.
 *
 * Auth: `optionalAuth`, not `requireAuth` - the pre-login half of the
 * funnel (app boot, the login screen) is precisely the data worth having,
 * so an anonymous caller is a first-class success, not a 401.
 *
 * TRUST BOUNDARY - the important one in this file: `userId` comes ONLY
 * from a verified JWT. The request body has no userId field at all, and
 * even if a caller sends one, the schema strips it (zod objects are
 * non-passthrough by default) and the insert below never reads
 * `req.body`-derived identity. Otherwise anyone could attribute arbitrary
 * activity to any account by guessing a uuid.
 *
 * PRIVACY: this is a compliance-phase social-casino product. Nothing here
 * may record a password, a token, an email, an IP address, or free text a
 * player typed. `props` is deliberately NOT "any JSON" - it's a flat map
 * of short strings / numbers / booleans / null, with both key and string-
 * value length capped (see PropsSchema), so an oversized or nested blob is
 * rejected at the edge rather than trusted to be well-behaved. That cap is
 * a privacy control as much as a size one: a bounded string field is a
 * poor place to smuggle a paragraph of PII into.
 */

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { optionalAuth, AuthedRequest } from "../auth/middleware";
import { asyncHandler } from "../asyncHandler";

const router = Router();

/**
 * Abuse caps. Tracking is unauthenticated by design, so this endpoint is
 * the one place in the API a caller can write rows without an account -
 * every limit here exists to keep that from being a free write amplifier.
 */
/** Max events accepted in one request. The client flushes at 20 (src/api/track.ts), so this is generous headroom, not a tight fit. */
export const MAX_BATCH_SIZE = 50;
/** Max distinct keys in one event's `props`. Events are small facts, not documents. */
const MAX_PROP_KEYS = 20;
/** Max length of a `props` string value - long enough for a game/item id, far too short for prose. */
const MAX_PROP_STRING_LENGTH = 200;

/** Requests one caller may send per RATE_LIMIT_WINDOW_MS. Generous on purpose - see rateLimitOk(). */
const RATE_LIMIT_MAX_REQUESTS = 300;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Dead-simple fixed-window, in-memory rate limiter, applied per client IP.
 *
 * Deliberately NOT a new dependency (express-rate-limit et al.) and
 * deliberately not Redis-backed: this server is a single process on
 * Railway, the thing being protected is a telemetry sink rather than money
 * or auth, and the cost of a limiter that resets on deploy is nil. If a
 * second instance ever runs, each gets its own window - still bounded,
 * just by 2x. Revisit only if this endpoint actually gets abused.
 *
 * PRIVACY: the IP is used as an in-memory bucket key for at most a minute
 * and is NEVER written to the events table or any log line - see this
 * file's header. The bucket map is pruned on write so it can't grow
 * unbounded from one-off addresses.
 */
const rateBuckets = new Map<string, { count: number; windowStart: number }>();

function rateLimitOk(key: string, now = Date.now()): boolean {
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    // Opportunistic prune of anything already expired, so an endpoint
    // hit by many distinct addresses doesn't leak memory.
    for (const [otherKey, other] of rateBuckets) {
      if (now - other.windowStart >= RATE_LIMIT_WINDOW_MS) rateBuckets.delete(otherKey);
    }
    rateBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX_REQUESTS;
}

/**
 * One scalar property value. Deliberately NOT `z.any()`/`z.record(z.unknown())`:
 * no nested objects, no arrays. Everything this product needs to answer a
 * retention question is a flat fact (game name, bet amount, won/lost), and
 * flat-and-bounded is the shape that can't grow into an unreviewed dumping
 * ground for whatever a future call site happens to have in scope.
 */
const PropValue = z.union([
  z.string().max(MAX_PROP_STRING_LENGTH),
  z.number().finite(),
  z.boolean(),
  z.null()
]);

const PropsSchema = z
  .record(z.string().min(1).max(64), PropValue)
  .refine((props) => Object.keys(props).length <= MAX_PROP_KEYS, {
    message: `props may have at most ${MAX_PROP_KEYS} keys`
  });

const EventSchema = z.object({
  name: z.string().trim().min(1).max(64),
  sessionId: z.string().trim().min(1).max(64),
  props: PropsSchema.optional()
});

const BatchSchema = z.object({
  events: z.array(EventSchema).min(1).max(MAX_BATCH_SIZE)
});

router.post(
  "/events",
  optionalAuth,
  asyncHandler(async (req, res) => {
    // May be undefined - anonymous is a valid, expected caller here.
    const userId = (req as AuthedRequest).userId ?? null;

    if (!rateLimitOk(userId ?? req.ip ?? "unknown")) {
      return res.status(429).json({ error: "Too many tracking requests", code: "RATE_LIMITED" });
    }

    const parsed = BatchSchema.safeParse(req.body);
    if (!parsed.success) {
      // Distinguish "too many" from "malformed" so the client can tell a
      // bug from a batching-config mistake, but keep both a 400 - neither
      // is worth retrying as-is.
      const tooLarge = Array.isArray((req.body as { events?: unknown })?.events)
        ? ((req.body as { events: unknown[] }).events.length > MAX_BATCH_SIZE)
        : false;
      return res.status(400).json({
        error: tooLarge ? `Batch too large - at most ${MAX_BATCH_SIZE} events per request` : "Invalid events payload",
        code: tooLarge ? "BATCH_TOO_LARGE" : "INVALID_INPUT",
        maxBatchSize: MAX_BATCH_SIZE
      });
    }

    await prisma.event.createMany({
      data: parsed.data.events.map((event) => ({
        // Server-derived identity only - see this file's trust-boundary note.
        userId,
        name: event.name,
        sessionId: event.sessionId,
        props: event.props ?? undefined
      }))
    });

    // 202, not 200: the batch is accepted and durably written, but the
    // client is explicitly not supposed to do anything with the response
    // (see src/api/track.ts - it ignores the body entirely and swallows
    // failures). Nothing useful to return.
    return res.status(202).json({ accepted: parsed.data.events.length });
  })
);

export default router;
