# casino-poc server - production image.
#
# Single build stage that keeps devDependencies (tsc + the prisma CLI for
# `prisma migrate deploy` at container start) - this is a small POC backend,
# not worth a slimmer multi-stage copy that risks missing the prisma CLI at
# runtime and falling back to `npx` fetching it over the network.
#
# NOTE: `embedded-postgres` (devDependency, used only by `npm test`'s
# throwaway local Postgres) is never used here - production always talks to
# a real, separately-provisioned Postgres via DATABASE_URL (see
# DEPLOYMENT.md). This image does not run or bundle a database.

FROM node:20-slim
WORKDIR /app

# node:20-slim (Debian) doesn't ship OpenSSL, which Prisma's native query-
# engine binary needs at runtime to load correctly - without this, prisma
# itself warns "failed to detect the libssl/openssl version" and explicitly
# suggests this exact fix for Docker. Migrations (a separate binary) worked
# without it; @prisma/client at actual server runtime is what needs this.
RUN apt-get update -y && apt-get install -y openssl coreutils && rm -rf /var/lib/apt/lists/*

# NODE_ENV=production must NOT be set yet here - `npm install` treats it as
# an implicit --omit=dev, which would skip typescript/@types/*/prisma (all
# devDependencies) and break both `npm run build` (tsc) and `prisma migrate
# deploy` at container start below. Set it only after the build is done and
# these steps no longer need devDependencies.

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production

EXPOSE 8787

# Runs migrations in the BACKGROUND and starts the server immediately,
# unconditionally - not `&&`, not even `timeout ...;`.
#
# History: `prisma migrate deploy && node dist/index.js` was observed on
# Railway to hang forever after printing its own final success output
# ("No pending migrations to apply.") - migration work completes in under a
# second every time, but the CLI process itself never returns control to
# the shell. A `timeout 20 ...; node dist/index.js` wrapper was tried next,
# expecting the server to start at most 20s later either way - but the
# healthcheck still failed after its full 30s timeout with ZERO server
# output (confirmed via staged boot logging that the very first line of
# dist/index.js never printed). Root cause: `timeout` only signals the
# direct child it spawns (the prisma CLI process) - Prisma's Rust
# query-engine runs as a grandchild subprocess that can survive that signal
# and keep holding the shell open past when `timeout` was expected to force
# a return.
#
# Migrations are NOT run here anymore - see "Ongoing: running a new
# migration" in DEPLOYMENT.md for the decoupled replacement. History, in
# order, all on Railway specifically (never reproduced locally):
#   1. `prisma migrate deploy && node dist/index.js` - prisma's CLI hung
#      forever after printing its own final success line; never returned
#      control to the shell.
#   2. `timeout 20 prisma migrate deploy; node dist/index.js` - still no
#      server output after the full healthcheck window. `timeout` only
#      signals the direct child it spawns; Prisma's Rust query-engine
#      grandchild can survive that and keep the shell blocked.
#   3. `prisma migrate deploy & node dist/index.js` (background, fire-and-
#      forget) - deploy log went completely silent in the exact same place
#      as attempt 1, immediately after launching the backgrounded prisma
#      process and BEFORE a second, completely independent `echo` even had
#      a chance to run - i.e. something took the whole container down right
#      at that moment, not merely "prisma hung." The likely mechanism: two
#      Node-based processes (the prisma CLI and, moments later, node itself)
#      starting concurrently on a memory-constrained container is a classic
#      OOM trigger, and an OOM kill of the container would explain silence
#      that abrupt and that total.
# Every attempt's logs, when prisma ran alone/sequentially, showed
# migrations already fully applied - so it's provably safe to stop running
# it here at all. Also: plain exec-form CMD now (no shell, no `;`/`&`
# scripting at all) - node runs directly as PID 1, which also removes the
# whole shell-scripting failure class from the equation.
CMD ["node", "dist/index.js"]
