/**
 * Route self-registration.
 *
 * Before this file existed, every new route module had to be manually
 * imported and `app.use()`'d in `app.ts` - a shared file every feature
 * touched, which is how unrelated features collided in merges.
 *
 * Now: a route file calls `registerRoute(router)` once, near its own
 * `export default router` line, instead of `app.ts` importing and mounting
 * it directly. `routes/index.ts` is the single list of `import "./whatever"`
 * side-effect imports that makes each file's own `registerRoute` call run
 * (see that file for why a plain filesystem scan doesn't work here - it
 * broke under Vitest's module loader). `app.ts` imports only
 * `routes/index.ts` and mounts whatever ended up registered; it never names
 * an individual route file.
 *
 * Adding a feature: create `server/src/routes/whatever.ts`, build an
 * Express `Router`, call `registerRoute(router)` at the bottom, and add one
 * `import "./whatever";` line to `routes/index.ts`. `app.ts` doesn't
 * change.
 */
import { Router } from "express";

export interface RegisteredRoute {
  router: Router;
  /** Mount prefix, e.g. "/auth". Omit to mount at the app root. */
  prefix?: string;
}

const registered: RegisteredRoute[] = [];

/**
 * Called by a route file at module scope (not inside a request handler) to
 * add itself to the app.
 */
export function registerRoute(router: Router, prefix?: string): void {
  registered.push({ router, prefix });
}

/**
 * Snapshot of every route registered so far. Only meaningful after
 * `routes/index.ts` has been imported (that's what triggers each route
 * file's own `registerRoute` call) - `app.ts` does exactly that before
 * calling this.
 */
export function getRegisteredRoutes(): RegisteredRoute[] {
  return registered;
}
