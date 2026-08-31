/**
 * The one file to edit when adding a new route module: add an
 * `import "./whatever";` line below. That import's only job is to run
 * `whatever.ts`'s own top-level `registerRoute(router)` call (see
 * registry.ts) - `app.ts` never lists route files itself.
 *
 * Why a static import list instead of scanning the `routes/` directory at
 * runtime: this file's TypeScript source runs under three different
 * loaders (tsc's CommonJS build for prod, tsx for local dev, Vite's ESM
 * loader for Vitest) and a plain `fs.readdirSync` + `require()` scan works
 * under the first two but breaks under Vitest ("Cannot use import
 * statement outside a module") because `require()` bypasses Vite's
 * TS/ESM transform. A static import list is identical, and equally
 * reliable, under all three.
 *
 * Order here is alphabetical by filename and has no effect on behaviour:
 * every route below owns a distinct path, and no route-level middleware is
 * order-sensitive (checked before writing this - see app.ts). Kept
 * alphabetical purely so this list stays easy to scan.
 */
import "./ads";
import "./auth";
import "./economy";
import "./events";
import "./furniture";
import "./games";
import "./items";
import "./leaderboard";
import "./magazine";
import "./me";
import "./position";
import "./progression";
import "./room";
import "./wardrobe";

export { getRegisteredRoutes } from "./registry";
