/**
 * Express app wiring, separated from src/index.ts (the listener) so tests
 * can import `app` and drive it with supertest without binding a port.
 */

import express from "express";
import cors from "cors";
import { env } from "./env";
import { getRegisteredRoutes } from "./routes/index";
import { InsufficientBalanceError } from "./economy/ledger";

export const app = express();

app.use(
  cors({
    origin: env.CORS_ORIGIN.split(",").map((o) => o.trim())
  })
);
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// Every route module self-registers - see routes/index.ts and
// routes/registry.ts. Add a new route module there; nothing here needs to
// change.
for (const { router, prefix } of getRegisteredRoutes()) {
  if (prefix) {
    app.use(prefix, router);
  } else {
    app.use(router);
  }
}

app.use((req, res) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

// Central error handler - catches anything a route's async handler threw
// (Express 4 doesn't auto-catch async rejections, but each route here is
// short/simple enough that a top-level try/catch per-route would be
// boilerplate; this backstop plus the routes' own discriminated-union
// error handling covers the real cases).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof InsufficientBalanceError) {
    return res.status(400).json({ error: err.message, code: "INSUFFICIENT_BALANCE" });
  }
  console.error(err);
  return res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
});
