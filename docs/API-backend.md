# FLYWEIGHT — backend API (pane 1.2)

Base URL `/api`. Every body is validated against `@workspace/contract`; a body that
fails the schema returns `400` with an `ApiError` naming the offending path, and never
reaches the database or the simulation.

Local dev server:

```sh
cd artifacts/api-server && set -a; . ../../.env; set +a && PORT=5050 pnpm dlx tsx src/index.ts
```

## Identity — there is no login wall

Clerk is wired and authoritative **when a session exists**. It is not required. Every
request also carries `fw_guest`, an httpOnly cookie holding 160 bits of randomness, and
ownership accepts either. So a stranger opens the link, builds a bot and fights it with
no account — which is the whole point of the demo path. Send credentials on fetches:

```ts
fetch("/api/bots", { credentials: "include" })
```

`mine: true` on a bot means *this caller* may edit or delete it. Roster bots are never
editable (`isSeed: true`, `mine: false`).

## REST

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/healthz` | — | `{ status, sim }` — `sim` is `"live"` or `"stub"` |
| GET | `/api/bots` | — | `ListBotsResponse` |
| GET | `/api/bots?mine=1` | — | `ListBotsResponse`, only yours |
| POST | `/api/bots` | `CreateBotRequest` | `Bot` (201) |
| GET | `/api/bots/:id` | — | `Bot` |
| PATCH | `/api/bots/:id` | `UpdateBotRequest` | `Bot` |
| DELETE | `/api/bots/:id` | — | 204 |
| GET | `/api/bots/:id/brains` | — | `{ revisions: BrainRevision[] }`, newest first |
| GET | `/api/bots/:id/brains/:version` | — | `BrainRevision` |
| GET | `/api/matches?botId=&limit=` | — | `ListMatchesResponse` |
| POST | `/api/matches` | `StartMatchRequest` | `MatchWithEvents` (201) |
| GET | `/api/matches/:id` | — | `MatchWithEvents` |
| GET | `/api/leaderboard?limit=` | — | `LeaderboardResponse` |
| POST | `/api/train` | `TrainRequest` | `TrainingRun` (**202**) |
| GET | `/api/train?limit=` | — | `ListTrainingRunsResponse` (yours only) |
| GET | `/api/train/:id` | — | `TrainingRun` |

Status codes: `400` schema/argument failure, `403` not yours, `404` no such row,
`500` our bug. All of them return `ApiError`.

### Starting a fight

`POST /api/matches` with `{ botId, opponentBotId?, squadSize? }`. Omit the opponent to
matchmake; omit `squadSize` for 1v1.

**Squads.** `squadSize` is 1–5 and deploys that many copies of each spec per side. It is
*replay input*, not a display setting, so it is persisted on the match row — a 5v5
replayed as a 1v1 would be a match nobody fought. Out-of-range values are rejected at the
edge (`400`), not clamped.
**The fight is already over when this returns** — the sim runs headless server-side in a
few hundred milliseconds, and the response carries the winner, the outcome and the
highlight events. The socket below then *replays* it at 60 Hz.

If you want the viewer to be surprised, don't render `winnerBotId` until the socket
sends `match_end`. The server is not hiding it from you; it decided it already, which is
what "server-authoritative" means here.

## Training — `POST /api/train`

Spiking networks have no gradient to descend, so training is **neuroevolution**: brains
are scored by actually fighting a panel, and the fittest breed. Determinism is what makes
this work at all — the same brain against the same panel and seeds scores the same exact
number every time, so selection is not chasing noise.

It is also CPU-bound, synchronous and takes about half a minute. **It therefore runs in a
forked process, not on the request thread.** Run it inline and the event loop stops: health
checks fail and every live match socket freezes mid-fight at 60 Hz. Measured with a default
run in flight, `/api/healthz` stays at 11–20 ms.

So `POST /api/train` returns **202 immediately** with a `TrainingRun` row. The row *is* the
job:

```ts
const run = await post("/api/train", { name: "MY EVOLVED BOT" });
// poll — curve grows one point per generation, ~2s apart
const r = await get(`/api/train/${run.id}`);
r.status            // PENDING -> RUNNING -> COMPLETE | FAILED
r.curve             // FitnessPoint[]: { generation, bestScore, meanScore, bestWins, matches }
r.generationsDone   // / r.generationsTotal, for a progress bar
r.botId             // set on COMPLETE — a real bot, fightable like any other
r.bestBrain         // the evolved BrainSpec
```

`curve` is appended a generation at a time, so a chart fills in live rather than appearing
all at once at the end. Points are trimmed to what a chart needs — the per-generation
champion brain is not stored, only the final `bestBrain`.

**Limits, and why.** One run at a time (`429` otherwise): evolution is not parallel work,
and two runs don't finish in half the time, they just make everything else slower. Config
is bounded by `TRAIN_MATCH_BUDGET` (10,000 simulated matches); over that you get a `400`
naming the number rather than a silent clamp. Defaults are 12 generations x 24 population
against the 4-bot house roster ≈ 2,300 matches ≈ 30s.

The evolved bot is created through the same path as a hand-built one — same table, same
brain-revision rules, same leaderboard row. An evolved loadout gets no exemption from the
schema every human loadout has to satisfy.

## WebSocket — `/ws/match/:id`

`/api/ws/match/:id` works identically (Replit's router owns the `/api` prefix for
certain; `/ws` is also routed, but the alias means a routing change can't strand you).

Server sends `ServerMessage`:

- `match_start` — `{ matchId, seed, bots: BotSpec[], teamSplit }`, once, on connect
- `frame` — `{ frame: MatchFrame }`, paced to wall clock at `TICK_HZ` (60)
- `match_end` — `{ result: MatchResult }`, from the **persisted row**, not the replay
- `error` — `{ message }`, then close

Client may send `ClientMessage`:

- `{ type: "play", speed }` — restart from tick 0 at `speed` (0.1–8)
- `{ type: "pause" }` / `{ type: "set_speed", speed }` / `{ type: "ping" }`

**Indices line up.** `match_start.bots` is one spec *per unit*, in the same order the
frames use, so `match_start.bots[i]` is the spec behind `frame.bots[i]`. Everything from
`teamSplit` onward is team B. Squad units are suffixed `#0`, `#1`, … exactly as the sim
names them, because two units off the same design still need separate rows on a raster.
1v1 is simply a squad of one each and keeps the plain bot id.

```ts
const teamA = frame.bots.slice(0, frame.teamSplit);
const teamB = frame.bots.slice(frame.teamSplit);
```

Each unit also streams `arousal` (P1 gain, 1.0 at rest) and `gfFatigue` (Giant Fiber
habituation, 0–1) for the neural HUD, alongside `spiked` and `potentials`.
`match_end`'s result carries `survivors: [aLeft, bLeft]`.

Messages sent in `onopen` are safe — they're buffered until the stream is ready.

A congested socket is skipped forward rather than queued: you get the newest state, not
a backlog of stale frames. The fight stays on the wall clock either way.

## What a match actually is

`seed + two BotSpec snapshots + squadSize + the sim version they were fought under`. No
frames are stored, ever. Watching and replaying are
the same code path — both call `runMatch(seed, botA, botB)` and pace the generator.
`artifacts/api-server/src/cli/verify-determinism.ts` re-runs the newest persisted match
twice and compares SHA-256 over every frame, so the claim is checked rather than asserted.
It exits `1` if the sim is non-deterministic and `2` if the row is merely from an older
sim — two very different problems.

**Replay is only free if you version the thing doing the replaying.** Brain snapshots
stop a bot edit from rewriting history; `SIM_VERSION` (contract) stops a *physics* edit
from doing the same. Change the neuron model, the arena or the RNG and every stored match
replays into a different fight — often the same winner, never the same fight. So matches
carry `simVersion`, and a replay across a version boundary is reported as stale rather
than passed off as the original. **1.1 bumps `SIM_VERSION` whenever the sim changes.**

Editing a bot **appends** a brain revision. Matches store the snapshot they were fought
with, so retuning your bot never rewrites a match it already fought — `GET
/api/bots/:id/brains` is the receipt.

## Schema gate

These are rejected at the edge with a readable message, not silently clamped:

- total slot weight above `BRAIN_WEIGHT_BUDGET` (8) → *"total slot weight must not exceed 8"*
- the same `NeuronModule` twice → *"each neuron module may only be equipped once"*
- more than `BRAIN_MAX_SLOTS` (5) slots, weights outside 0–4, thresholds outside 0.1–5

Show `issues[].path` next to the field. That's what it's for.
