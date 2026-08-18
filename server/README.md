# casino-poc server

Server-authoritative backend for casino-poc: auth, the GC/SC transaction
ledger, packages, playthrough, redemption, skin shop, and the attendant
claim. Node + Express + TypeScript, Prisma against PostgreSQL.

Every economy rule/number here is a deliberate 1:1 port of
`casino-poc/src/economy/*.ts` - see the repo-root `CLAUDE.md` for the rules
themselves and each `src/economy/*.ts` file's header comment for how it maps
to its client-side counterpart.

## Setup (local dev)

```bash
npm install
cp .env.example .env
npm run db:up      # starts a real local Postgres (embedded-postgres - no
                    # Docker/cloud account needed) as an independent daemon
                    # via `pg_ctl start`; first run also initialises it.
                    # Returns immediately - no need to keep a terminal open
                    # or background it yourself. `npm run db:down` stops it.
npm run dev         # applies pending migrations (predev), then starts the
                    # server on http://localhost:8787 with hot reload
```

`npm run db:down` (from another terminal) stops the local Postgres cluster
started above. `npm run db:restart` does both in sequence - see
Troubleshooting below for when that's the fix you want.

## Testing

```bash
npm test
```

Spins up its own throwaway embedded Postgres (separate port/data dir from
the `db:up` one above) in a Vitest `globalSetup`, runs `prisma db push`
against it, then runs every `test/*.test.ts` file with `supertest` driving
the real Express app. No manual setup needed - `npm test` is fully
self-contained.

```bash
npm run typecheck   # tsc --noEmit over src/ and test/
npm run build        # compiles src/ to dist/
```

## API

All request/response bodies are JSON. Authenticated routes require
`Authorization: Bearer <jwt>` (obtained from `/auth/signup` or
`/auth/login`).

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | no | `{ ok: true }` |
| POST | `/auth/signup` | no | `{ username, password, email? }` → `{ token, user, signupBonus }`. GC leg's shuffle-cup multiplier is resolved server-side, never client-supplied. |
| POST | `/auth/login` | no | `{ username, password }` → `{ token, user }` |
| GET | `/me` | yes | → `MeResponse` (balances, skins, equipped skin, last position, playthrough) |
| POST | `/claim-bonus` | yes | Attendant claim - GC via resolved multiplier + flat 1 SC, 30s cooldown. 429 `COOLDOWN` with `remainingMs` if too soon. |
| GET | `/packages` | no | Lists the 6-tier GC package catalog |
| POST | `/packages/purchase` | yes | `{ packageId }` → grants GC + non-linear SC bonus, registers playthrough requirement |
| POST | `/redeem` | yes | `{ amountSc }` → debits SC if playthrough-cleared and above the minimum threshold |
| POST | `/skins/buy` | yes | `{ skinId }` → GC-only purchase |
| POST | `/skins/equip` | yes | `{ skinId }` → must already be owned |
| POST | `/position` | yes | `{ x, y }` → upserts last known overworld position |

Error responses are `{ error: string, code: string, ...details }`. `code`
is a stable machine-readable reason (`INVALID_INPUT`, `USERNAME_TAKEN`,
`UNAUTHORIZED`, `COOLDOWN`, `UNKNOWN_PACKAGE`, `INSUFFICIENT_GC`,
`ALREADY_OWNED`, `NOT_OWNED`, `PLAYTHROUGH_INCOMPLETE`, `BELOW_MINIMUM`,
`INSUFFICIENT_BALANCE`, etc.) - match on `code`, not the human-readable
`error` string.

## Code layout

- `src/economy/ledger.ts` - the ONLY code allowed to write
  `balances.gold_coins`/`stake_coins`. Every other economy module and route
  goes through `applyTransaction`.
- `src/economy/*.ts` - one file per economy concern, each a server-side port
  of the matching `casino-poc/src/economy/*.ts` file.
- `src/routes/*.ts` - Express routers, thin - validate input (zod), call an
  economy function inside `prisma.$transaction(...)`, serialize the result.
- `src/serializers.ts` - the shared `MeResponse` shape returned by
  `/me`, `/auth/signup`, and `/auth/login`.
- `src/skinCatalog.ts` - server-side copy of the client's `SKIN_CATALOG`
  (kept in sync by hand - see that file's header).
- `prisma/schema.prisma` - see its header comment for how each table maps
  to a client-side economy rule.
- `scripts/dev-db.js` - local Postgres lifecycle (`db:up`/`db:down`/`db:restart`).
- `test/` - `globalSetup.ts`/`setupEnv.ts` wire up the throwaway test
  Postgres; everything else is real integration tests against it via
  `supertest`.

## Troubleshooting

**Dev DB is up but every request 500s / signup fails / can't connect, and
`pg-dev.log` has a burst of `could not reserve shared memory region ...
error code 487`.** This is a known, long-standing PostgreSQL-on-Windows bug
(not specific to this project) - Windows lacks `fork()`, so Postgres
re-execs a fresh process per connection and has to remap shared memory at
the exact address the postmaster used, and Windows' ASLR occasionally hands
the new process a layout where that address is taken. It's been documented
upstream since ~2012 (Windows 8/2012 introduced the stricter ASLR that
triggers it); the real fix requires relinking `postgres.exe` with different
flags, which isn't possible here since we use prebuilt binaries.

Fix: `npm run db:restart` (or `db:down` then `db:up`) - a fresh postmaster
gets a working layout again, no data lost (same `.pgdata` directory). If
it's recurring often enough to be worth a more permanent fix, an admin can
disable ASLR for just `postgres.exe` (not system-wide) via one elevated
PowerShell command:
```powershell
Set-ProcessMitigation -Name postgres.exe -Disable ForceRelocateImages
```
This is a real security-mitigation setting change, so it's a manual, opt-in
step for whoever owns the machine - not something any automated tooling in
this repo applies for you.

**`prisma generate`/`prisma migrate` fails with `EPERM ... rename ...
query_engine-windows.dll.node`.** Something else (usually someone's
`npm run dev`) has the generated Prisma client's engine DLL open on
Windows. Ask around for a ~10s pause on anyone's `tsx watch`/dev server,
regenerate, then they can resume - nothing to fix in code, just a
Windows file-locking fact of life with a shared checkout.

## Deploying

See `DEPLOYMENT.md` for the Railway walkthrough (account creation, Postgres
provisioning, env vars, deploy) - that's prep for a human to run, not
automated here.
