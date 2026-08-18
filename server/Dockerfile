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
# Fix: stop waiting on prisma's process lifecycle entirely. `&` backgrounds
# `prisma migrate deploy` (fire-and-forget) and the shell moves to
# `node dist/index.js` immediately, regardless of whether/when the
# migration command's process tree ever fully exits. Safe here because
# every observed deploy shows all migrations already applied (nothing
# pending) - the real migration work, when there is any, still completes
# in under a second, well before the server would see meaningful traffic.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy & node dist/index.js"]
