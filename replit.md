# FLYWEIGHT

Build a battle bot, wire its brain from real *Drosophila* connectome circuits, and watch
two of them fight in an arena while their neurons spike on screen.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API + match socket (port 8080 in the container)
- `pnpm --filter @workspace/db run push` — apply Drizzle schema changes (dev only)
- `pnpm run typecheck` — typecheck every package
- `pnpm run build` — typecheck + build all packages
- Seed the house roster: `pnpm --filter @workspace/api-server exec tsx src/cli/seed.ts` (idempotent)
- Prove replay works: `pnpm --filter @workspace/api-server exec tsx src/cli/verify-determinism.ts`
- Required Secrets: `DATABASE_URL`, and `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` for sign-in

**Locally** `pnpm run <script>` fails — the root `preinstall` guard reads
`npm_config_user_agent`, which pnpm-via-corepack doesn't set. Run binaries directly:

```sh
cd artifacts/api-server && set -a; . ../../.env; set +a && PORT=5050 pnpm dlx tsx src/index.ts
```

Port 5000 is taken by macOS ControlCenter, hence 5050. Routes mount under `/api`;
health is `/api/healthz`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + `ws`, Clerk auth, Zod on every boundary
- DB: PostgreSQL + Drizzle ORM
- Sim: pure TypeScript, zero I/O, deterministic fixed timestep
- Build: esbuild (ESM bundle)

## Where things live

| What | Where |
|---|---|
| **Shared contract — source of truth for every boundary** | `lib/contract/src/index.ts` (`@workspace/contract`) |
| DB schema | `lib/db/src/schema/` (one file per table) |
| Simulation core | `lib/sim/src/` (`@workspace/sim`) |
| REST routes | `artifacts/api-server/src/routes/` |
| Data access | `artifacts/api-server/src/services/` |
| Match socket | `artifacts/api-server/src/ws/matchSocket.ts` |
| Forked trainer (evolution) | `artifacts/api-server/src/train/worker.ts` |
| Sim boundary (the only import of `@workspace/sim`) | `artifacts/api-server/src/lib/matchRunner.ts` |
| API reference for client work | `docs/API-backend.md` |

## Architecture decisions

- **A match is `seed + two BotSpec snapshots + squadSize + a sim version`.** No frames are ever
  stored. Replaying means re-running the deterministic sim over the same inputs, so
  watching live and watching a replay are literally the same code path, and a replay
  costs one row.
- **The simulation is versioned too.** Snapshotting the brains stops a *bot* edit from
  rewriting history; nothing stopped a *physics* edit from doing it, and it happened
  during the build — matches replayed with the same winner and a different tick count.
  `SIM_VERSION` in the contract is now recorded on every match, and a cross-version
  replay is reported as stale instead of being passed off as the original fight.
  **Bump `SIM_VERSION` whenever the sim changes.** It has already earned its keep twice:
  the squad release was API-compatible for 1v1 but not numerically identical (the brain
  constructor's RNG draws shifted), so v1 matches replay to a different tick count.
- **Brains are append-only.** Editing a bot inserts `version N+1`; matches reference the
  brain revision *and* carry a full BotSpec snapshot, so retuning a bot cannot rewrite a
  match it already fought.
- **The sim runs headless at create time, not lazily on the socket.** The outcome is what
  the leaderboard is about and it costs milliseconds; the socket then paces the same
  generator to the wall clock.
- **One schema gate.** Every request body crosses `parseBody()` and nothing else. An
  invalid brain cannot reach the database or the simulation — it is rejected at the edge
  with the offending field named.
- **Two-headed identity.** Clerk when a session exists, an httpOnly guest cookie
  otherwise, and ownership accepts either. The demo path has no login wall; signing in
  later is an UPDATE stamping `owner_user_id` onto the guest's rows.
- **Training runs in a forked process.** Neuroevolution is CPU-bound and synchronous
  (~30s); on the request thread it would freeze every 60 Hz match socket and fail health
  checks. `POST /api/train` returns 202 and the `training_runs` row is the job. The fork
  path resolves for both tsx and the esbuild bundle, and the child inherits `execArgv` so
  one code path covers dev and production.
- **Leaderboard is recomputed inside the match-result transaction**, so it cannot claim a
  win that no match row backs.

## Product

You can also **evolve** a bot instead of designing one: `POST /api/train` runs
neuroevolution against the house roster and saves the winner as a real bot, with its
fitness curve kept for charting.

Pick a chassis, spend a weight budget across real neuron modules (`LPLC2 -> DNp01`
looming escape, `LC10a` pursuit, `DNa02` steering, `MDN` reverse, `P1` arousal), fight a
house bot or someone else's, and watch both brains spike through the fight. Every match
is replayable from its seed and the leaderboard tracks Elo.

Claim discipline: this is a faithful model of specific *Drosophila* pathways with
connectivity from FlyWire. It is **not** "running the connectome". Do not say that.

## Gotchas

- **Never `rm -rf node_modules`.** Replit's lockfile pins every platform-specific binary
  to `'-'` except `linux-x64`, so a local install has no darwin-arm64 esbuild / rollup /
  lightningcss / tailwind-oxide. Four native packages are hand-placed in
  `node_modules/.pnpm/*/node_modules/` and a clean install loses them.
- To add a dependency without disturbing that: edit the manifest, run
  `pnpm install --lockfile-only --ignore-scripts`, then place the package by hand.
- `/api/me` returns 401 locally — `.env` holds **placeholder** Clerk keys. Nothing on the
  demo path depends on auth, by design.
- The match socket needs `/ws` in the artifact's `paths`. Without it Replit's router
  never forwards the upgrade and every deployed replay hangs on connect.
- Editing `lib/sim` invalidates every stored match. Bump `SIM_VERSION` and re-run the
  roster round robin, or the leaderboard describes fights nobody can watch.
- `scripts/post-merge.sh` pushes the schema on merge. Its filter must be
  `@workspace/db`; a bare `db` matches nothing and the push silently does nothing.

## Pointers

- `docs/PLAN.md` — the product, the science, and the split of work
- `docs/API-backend.md` — endpoints, wire protocol, identity model
- See the `pnpm-workspace` skill for workspace structure and TypeScript setup
