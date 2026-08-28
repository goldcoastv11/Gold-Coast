/**
 * Client-side player-activity tracking (Leg 1 of the game roadmap).
 *
 * Self-hosted: events go to this project's own `POST /events` (see
 * server/src/routes/events.ts) and land in our own Postgres. There is no
 * PostHog/Mixpanel/Amplitude/Segment SDK in this repo, by design - player
 * data never leaves the founder's database.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: tracking must never break the
 * game. `track()` cannot throw, cannot reject, cannot block, and cannot
 * make a scene wait on the network. Every public function here is
 * synchronous and wrapped in try/catch; every flush is fire-and-forget with
 * its rejection swallowed. A dropped event is always better than a broken
 * game, so failures are silent - no retry storm, no error toast, no
 * console noise in production paths.
 *
 * Batching: call sites just call `track()`. Events accumulate in a small
 * in-memory buffer and go out together when any of three things happens:
 *   1. the flush interval elapses (FLUSH_INTERVAL_MS),
 *   2. the buffer reaches MAX_BUFFERED (so a burst doesn't sit around),
 *   3. the page is hidden or being torn down - the important one on
 *      mobile, where a backgrounded Safari tab may simply never come back.
 *
 * PRIVACY (this is a compliance-phase product - keep it that way): only
 * pass small, bounded, non-identifying facts as props - a game name, a bet
 * amount, a win/lose outcome, a catalog item id. NEVER a password, a
 * token, an email, an IP, a username, or anything a player typed. The
 * server validates that shape too (routes/events.ts), but the first line
 * of defence is what call sites choose to pass.
 */

import { API_BASE_URL, getToken } from "./client";

/**
 * The closed set of event names. Kept here rather than as a DB enum so
 * adding one never needs a destructive schema migration - the `events.name`
 * column is a plain string server-side.
 *
 * Named for retention questions, not for UI internals: "did they come
 * back", "which games do they actually open", "does the free-coin kiosk
 * bring people back tomorrow".
 */
export const EVENTS = {
  /** One per app load, fired before login - the denominator for the whole funnel. */
  SESSION_START: "session.start",
  /** A brand new account was created. */
  SIGNUP: "auth.signup",
  /** An existing account signed in. */
  LOGIN: "auth.login",
  /** A player walked up to a game cabinet and went in. Props: { game }. */
  GAME_OPENED: "game.opened",
  /** One resolved round. Props: { game, betAmount, outcome, payout }. */
  GAME_ROUND_PLAYED: "game.round_played",
  /** The Coin Kiosk's ad-gated free Gold Coins claim landed. Props: { gcAmount }. */
  KIOSK_CLAIM: "kiosk.claim",
  /** An Item Shop purchase (accessory/pet). Props: { itemId, price }. */
  ITEM_PURCHASED: "shop.item_purchased",
  /** A skin purchase. Props: { skinId, price }. */
  SKIN_PURCHASED: "shop.skin_purchased",
  /** An owned cosmetic was equipped. Props: { itemId } or { skinId }. */
  ITEM_EQUIPPED: "shop.item_equipped",
  /**
   * A completed challenge's reward was claimed. Props: { challengeId,
   * period, rewardGc, rewardXp } - all catalog facts, nothing a player
   * typed. This is the "does the challenge system actually bring people
   * back" signal, and it's fired on the server's confirmed success, never
   * on the optimistic click.
   */
  CHALLENGE_CLAIMED: "challenge.claimed"
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** Flat, bounded, non-identifying facts only - see this file's PRIVACY note. */
export type EventProps = Record<string, string | number | boolean | null>;

/** Buffer size that forces an immediate flush. Kept well under the server's MAX_BATCH_SIZE (50). */
const MAX_BUFFERED = 20;
/** How often a non-empty buffer goes out on its own. */
const FLUSH_INTERVAL_MS = 15_000;

// Note on memory: the buffer can never exceed MAX_BUFFERED, because a
// flush empties it unconditionally and `send()` never retries or re-queues
// a failed batch. An offline player therefore loses events rather than
// accumulating them - the deliberate trade (see this file's header), and
// the reason no separate hard cap / eviction policy is needed here.

interface BufferedEvent {
  name: string;
  sessionId: string;
  props?: EventProps;
}

/**
 * Per-app-load random id, so pre-login events (session start, the login
 * screen) can be stitched to the post-login ones from the same visit
 * without needing a user id.
 *
 * Deliberately NOT persisted to localStorage and NOT derived from anything
 * about the device or player - it's a throwaway random value, it resets on
 * every reload, and it identifies a visit rather than a person. That's the
 * conservative choice for a product entering a compliance phase: it can't
 * function as a cross-session tracking identifier because it doesn't
 * survive one.
 */
function makeSessionId(): string {
  try {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === "function") return cryptoObj.randomUUID();
  } catch {
    // Fall through to the Math.random path below.
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const sessionId = makeSessionId();

/** The current visit's session id - exported for debugging only; call sites don't need it. */
export function getSessionId(): string {
  return sessionId;
}

let buffer: BufferedEvent[] = [];
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * Ships whatever's buffered. `keepalive` lets the request outlive the page
 * on the hide/unload path - the reason this uses `fetch` rather than
 * `navigator.sendBeacon`, which cannot set an Authorization header and so
 * would land every end-of-session event as anonymous.
 *
 * Never awaited by any caller and never rethrows. On failure the batch is
 * simply gone: retrying would risk a request storm against a server that's
 * already unhappy, for data that is by definition optional.
 */
function send(batch: BufferedEvent[]): void {
  if (batch.length === 0) return;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    void fetch(`${API_BASE_URL}/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({ events: batch }),
      keepalive: true
    }).catch(() => {
      // Silent by design - see this file's header.
    });
  } catch {
    // Silent by design - see this file's header.
  }
}

/** Flushes the buffer now. Safe to call any time; a no-op when empty. */
export function flushEvents(): void {
  try {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    send(batch);
  } catch {
    // Silent by design.
  }
}

/**
 * Records one event. Synchronous, non-blocking, and swallows everything -
 * a call site never needs a try/catch, an `await`, or a `.catch()` around
 * this.
 */
export function track(name: EventName | string, props?: EventProps): void {
  try {
    if (!started) startTracking();

    buffer.push(props ? { name, sessionId, props } : { name, sessionId });

    if (buffer.length >= MAX_BUFFERED) flushEvents();
  } catch {
    // Silent by design.
  }
}

/**
 * Starts the interval flush and registers the page-lifecycle flushes.
 * Idempotent, and called lazily by `track()` too, so a call site can just
 * track without worrying whether boot ran first.
 *
 * `visibilitychange` -> hidden is the load-bearing one on mobile: iOS
 * Safari frequently never fires `pagehide`/`beforeunload` for a tab the
 * user swipes away from, so a session's tail would otherwise be lost
 * entirely. `pagehide` covers desktop + bfcache navigation. `beforeunload`
 * is a belt-and-braces third for older desktop browsers.
 */
export function startTracking(): void {
  if (started) return;
  started = true;
  try {
    intervalHandle = setInterval(flushEvents, FLUSH_INTERVAL_MS);

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushEvents();
      });
    }
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", flushEvents);
      window.addEventListener("beforeunload", flushEvents);
    }
  } catch {
    // Silent by design - tracking simply stays interval-less rather than
    // taking the app down over a listener registration failure.
  }
}

/** Test/teardown helper - stops the interval. Not used by the game itself. */
export function stopTracking(): void {
  try {
    if (intervalHandle !== null) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    started = false;
  } catch {
    // Silent by design.
  }
}
