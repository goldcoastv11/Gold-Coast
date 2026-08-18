import { app } from "./app";
import { env } from "./env";

// Explicitly bind 0.0.0.0 - listen(port) alone can bind in a way that's
// unreachable from outside the container on some Docker/cloud networking
// setups (Railway's healthcheck included). Flush a log line immediately
// on process start too, before anything else runs, so if something later
// in the module (env validation, route registration) throws or hangs,
// there's still a visible marker in the logs showing how far it got.
console.log("casino-poc server starting...");

app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`casino-poc server listening on http://0.0.0.0:${env.PORT}`);
});
