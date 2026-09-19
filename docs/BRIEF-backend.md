# Brief: backend platform (pane 1.2)

Project: **FLYWEIGHT**, connectome-driven battle bots. Read `docs/PLAN.md` first.
Repo: `~/Dev/projects/2026/replit-robo-demo` (a Replit project, synced via GitHub).

**Your lane: persistence, API surface, auth, deploy. You own the data tier.**
Do NOT write simulation logic (pane 1.1 owns it) or any Three.js / visual work (pane 1.3).

## Source of truth
`lib/contract/src/index.ts`, Zod schemas + types for brains, bots, frames, wire protocol,
REST payloads. Import from `@workspace/contract`. If you need a shape that isn't there,
add it to the contract and say so, rather than defining a local duplicate.

## Build
1. **Drizzle schema** in `lib/db/src/schema/`:
   - `users` (clerk_user_id unique): already partly exists, check first
   - `bots` (id, owner_id, name, chassis, created_at)
   - `brains` (id, bot_id, spec jsonb, version int): append a new row per edit, never mutate.
     Matches reference a brain *version*, so editing a bot must not rewrite past matches.
   - `matches` (id, seed, bot_a_brain_id, bot_b_brain_id, winner_bot_id, outcome, ticks, created_at)
   - `match_events` (match_id, tick, kind, payload jsonb): append-only, KO/hits only, not frames
   - `leaderboard`: wins/losses/elo per bot; recompute on match end
2. **REST** in `artifacts/api-server/src/routes/`: bots (CRUD, Clerk-scoped), brains,
   matches (start/get/list), leaderboard. Validate every body with the contract schemas.
3. **WebSocket** `/ws/match/:id` streaming `ServerMessage`. Pane 1.1 gives you a
   `runMatch(seed, botA, botB, onFrame)` generator: you own transport, it owns physics.
4. **Deploy to Replit** and confirm it boots in the container with real Secrets.

## Local gotchas already solved: do not rediscover these
- `pnpm run <script>` fails: the root `preinstall` guard tests `npm_config_user_agent`,
  and pnpm-via-corepack doesn't set it. Run binaries directly instead.
- Replit's lockfile has **no darwin-arm64 entries**. Four native binaries were hand-placed
  into `node_modules/.pnpm/*/node_modules/`. Don't `rm -rf node_modules` or you'll redo it.
- API server: `cd artifacts/api-server && set -a; . ../../.env; set +a && PORT=5050 pnpm dlx tsx src/index.ts`
- Routes mount under `/api`; health is `/api/healthz`. Port 5000 is taken by macOS ControlCenter.
- `.env` holds a local Postgres URL (`replit_robo_demo`) and **placeholder** Clerk keys,
  `/api/me` will always 401 locally. Don't put auth on the demo path.

## Bar for 09:00
A match can be created, run, persisted, and replayed from its seed. Leaderboard updates.
Not "complete", the app keeps updating after submission; only the WaterlooWorks documents hard-lock.
