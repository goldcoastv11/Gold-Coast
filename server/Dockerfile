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
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

EXPOSE 8787

# Applies any pending migrations, then starts the server. Safe to run on
# every deploy - a no-op when the schema's already up to date.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
