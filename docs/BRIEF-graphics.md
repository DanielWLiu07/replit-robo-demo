# Brief — arena, graphics, landing (pane 1.3 / Astra)

Project: **FLYWEIGHT**, connectome-driven battle bots. Read `docs/PLAN.md` first.
Repo: `~/Dev/projects/2026/replit-robo-demo`. Frontend lives in `artifacts/mockup-sandbox`.

**Your lane: everything visual. You own the look.**
Do NOT write simulation logic (pane 1.1) or DB/API code (pane 1.2).

## The look
Black and white, glass, Apple-grade restraint. Think a Nature figure that happens to be
a fighting game. White/near-black ground, hairline strokes, frosted glass panels
(backdrop-filter, 1px hairline border, generous padding), monospace for all numerics.
No colour anywhere — so that when a Giant Fiber spike fires and the bot dodges, the single
accent you allow yourself reads like a gunshot. That restraint IS the design.

## Build
1. **Landing page** — the hook. A slow-rotating bot, the name, one line of copy, one button.
   It should be obvious in three seconds that this is fly brains driving battle robots.
2. **Arena** (Three.js) — top-down or 3/4 view, two bots, grid floor, hit sparks, camera shake
   on impact. Consume `MatchFrame` from `@workspace/contract` — `{tick, bots:[a,b], hits[]}`.
   Interpolate between frames; the server streams at 60 Hz but don't assume it arrives evenly.
3. **Spike raster + membrane traces** — the thing that makes people lean in. Per bot, a scrolling
   raster of which neuron modules fired, plus membrane potential climbing toward threshold.
   `ArenaBotState.spiked[]` and `.potentials{}` give you exactly this per tick.
4. **Brain Lab** — drag neuron modules onto a chassis. 5 slots, weight budget 8, no duplicates.
   Constants are in the contract (`BRAIN_MAX_SLOTS`, `BRAIN_WEIGHT_BUDGET`).

## Source of truth
`lib/contract/src/index.ts`. Import types from `@workspace/contract`. Don't invent shapes —
if you need one, ask for it to be added to the contract.

## Running the frontend — exact incantation
```
cd ~/Dev/projects/2026/replit-robo-demo/artifacts/mockup-sandbox
PORT=5173 BASE_PATH=/ ./node_modules/.bin/vite
```
- `vite.config.ts` requires **PORT and BASE_PATH as env vars** — the `--port` flag is not enough.
- Use `./node_modules/.bin/vite`, NOT `pnpm dlx vite` (dlx fetches Vite 8; project is on 7.3.6).
- Don't `rm -rf node_modules` — four darwin-arm64 native binaries were hand-placed and
  Replit's Linux lockfile cannot restore them.
- API runs on :5050, routes under `/api`.

## Bar for 09:00
A stranger opens the link and sees two fly-brained bots fight, with brains visibly spiking.
One working loop beats five half-features.
