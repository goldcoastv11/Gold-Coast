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
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

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

# Applies any pending migrations, then starts the server. Safe to run on
# every deploy - a no-op when the schema's already up to date.
#
# Calls the local prisma binary directly (node_modules/.bin/prisma) rather
# than through `npx` - npx's own resolution/update-check overhead was
# observed to hang indefinitely after migrate deploy finished its actual
# work (migrations applied successfully every time, but control never
# returned to the shell to run the next command), even with
# CHECKPOINT_DISABLE=1 set. The local binary is already guaranteed present
# (prisma is a devDependency, installed above) so there's nothing for npx
# to resolve or fetch in the first place.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/index.js"]
