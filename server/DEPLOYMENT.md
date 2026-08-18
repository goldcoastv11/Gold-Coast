# Deploying casino-poc's server to Railway

This is a walkthrough for **you** to run - no cloud account was created and
no cloud resource was provisioned as part of building this. Everything up to
this point (`railway.toml`, `Dockerfile`, `.env.example`) is just prep so
this walkthrough is short.

Railway is a reasonable default for this POC: it provisions a managed
Postgres with one click, deploys straight from a Dockerfile, and has a free
tier. Nothing here is Railway-specific at the application level though -
`DATABASE_URL`/`JWT_SECRET`/etc. as plain env vars and a standard
Dockerfile - so the same setup works on Render, Fly.io, a plain VM, etc. if
you'd rather use one of those.

## 1. Create a Railway account

1. Go to [railway.app](https://railway.app) and sign up (GitHub login is the
   easiest path since you'll be connecting a GitHub repo anyway).
2. You'll land on the Railway dashboard once your account is created.

## 2. Create a new project

1. Click **New Project**.
2. Choose **Deploy from GitHub repo** and pick this repository. If Railway
   asks which directory to deploy, point it at `casino-poc/server` (this
   repo has the game client at the repo root and the server in that
   subdirectory - Railway needs to build from `casino-poc/server`, not the
   repo root, so the Dockerfile/railway.toml here are found).
   - If your Railway plan/UI doesn't support a subdirectory root, set the
     **Root Directory** in the service's Settings to `casino-poc/server`
     after creating it instead.

## 3. Provision Postgres

1. In the same Railway project, click **New** → **Database** → **Add
   PostgreSQL**.
2. Railway spins up a managed Postgres instance and automatically exposes a
   `DATABASE_URL` variable *to other services in the same project* - you
   generally do not need to copy/paste the connection string by hand.
3. On the server service (not the Postgres service), go to **Variables**
   and confirm `DATABASE_URL` is present (Railway usually offers to
   "reference" the Postgres service's `DATABASE_URL` automatically - accept
   that rather than pasting a static value, so it stays correct if the DB
   ever moves/restarts).

## 4. Set the remaining environment variables

On the server service's **Variables** tab, add everything else from
`.env.example` except `DATABASE_URL` (that comes from step 3):

| Variable | Value |
|---|---|
| `JWT_SECRET` | A long random string - **generate a real one**, don't reuse the `.env.example` placeholder. Locally: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | `7d` (or whatever session length you want) |
| `PORT` | Railway sets its own `PORT` automatically for the container to bind to - you can usually leave this unset and let Railway's injected `PORT` take priority, but `8787` as a fallback default (already baked into `src/env.ts`) is harmless either way. |
| `CORS_ORIGIN` | The deployed client's real origin, e.g. `https://your-game.vercel.app`. Use the client's actual production URL, not `localhost` - **do not leave this as `localhost:3000` in production**, or every deployed-client request will be blocked by CORS. Comma-separate multiple origins if you have more than one (e.g. a staging + prod client). |

## 5. Deploy

1. Railway auto-deploys on every push to the connected branch by default.
   For the first deploy, trigger it manually from the service's
   **Deployments** tab if it didn't already start.
2. Railway builds the image from `casino-poc/server/Dockerfile`.
3. On container start, the entrypoint runs `prisma migrate deploy` (applies
   every migration in `prisma/migrations/` that isn't already applied) and
   then starts the server - see `railway.toml`'s `startCommand` and the
   Dockerfile's `CMD`. You do not need to run migrations by hand; this
   happens automatically on every deploy and is a no-op if nothing's
   pending.
4. Watch the **Deploy Logs** for the migration step and
   `casino-poc server listening on http://localhost:<port>` - that
   confirms it came up cleanly.

## 6. Verify

1. Railway assigns a public URL under **Settings** → **Networking** →
   **Public Networking** (click **Generate Domain** if one isn't there
   yet).
2. Hit `https://<your-service>.up.railway.app/health` - should return
   `{"ok":true}`.
3. Point the client at that URL (wherever it currently points at
   `http://localhost:8787`) and confirm signup/login work end-to-end.

## Ongoing: running a new migration

Whenever `prisma/schema.prisma` changes locally:

```bash
cd casino-poc/server
npm run prisma:migrate   # prisma migrate dev --name <something> - creates + applies locally
git add prisma/migrations
git commit -m "..."
git push
```

Pushing triggers a Railway redeploy, which runs `prisma migrate deploy`
automatically against the production database as described in step 5 above
- no manual migration step needed in production.

## Rolling back

Railway keeps previous deploys - use **Deployments** → pick an earlier
build → **Redeploy** if a bad deploy needs to be rolled back. Note this does
**not** automatically roll back a database migration that already ran;
Prisma migrations are forward-only by design, so a schema rollback (if ever
needed) means writing a new migration that undoes the change, not
reverting an old one.

## What's intentionally NOT done here

- No account was created, no Postgres instance was provisioned, no
  deployment was triggered - all of the above is for you to click through.
- No production secrets exist anywhere in this repo - `.env` is
  gitignored, and `.env.example` only has placeholder/dev values.
- Local dev continues to use `npm run db:up` (embedded-postgres, no
  Docker/cloud needed) - that's a completely separate, throwaway Postgres
  instance from whatever you provision on Railway. See `server/README`-style
  comments in `scripts/dev-db.js` and `package.json`'s `db:up`/`db:down`
  scripts for local dev.
