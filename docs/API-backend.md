# FLYWEIGHT: backend API (pane 1.2)

Base URL `/api`. Every body is validated against `@workspace/contract`; a body that
fails the schema returns `400` with an `ApiError` naming the offending path, and never
reaches the database or the simulation.

Local dev server:

```sh
cd artifacts/api-server && set -a; . ../../.env; set +a && PORT=5050 pnpm dlx tsx src/index.ts
```

## Identity: there is no login wall

Clerk is wired and authoritative **when a session exists**. It is not required. Every
request also carries `fw_guest`, an httpOnly cookie holding 160 bits of randomness, and
ownership accepts either. So a stranger opens the link, builds a bot and fights it with
no account, which is the whole point of the demo path. Send credentials on fetches:

```ts
fetch("/api/bots", { credentials: "include" })
```

`mine: true` on a bot means *this caller* may edit or delete it. Roster bots are never
editable (`isSeed: true`, `mine: false`).

## Bot profile: the character card

Every `Bot` ships a derived `profile`: seven 0–100 stat bars (aggression, evasion,
tracking, reflex, hull, speed, agility), a one-line `playstyle`, the **character type**,
plus `neuronCount` and the per-module cell counts and transmitters from FlyWire.

```
CHAMPION    HORNET  agg 23  eva  0  trk 54  rfx 86   296 cells
            "Locks on fast and never loses the line"
AROUSAL     HORNET  agg 97  eva  0  trk 74  rfx 57   423 cells
            "Grinds forward and wears you down"
```

It is computed server-side by `profileBot` from `@workspace/sim`, not in the client: the
sim owns what a loadout means, and a second implementation would drift the moment one of
them changed. Render it, don't re-derive it.

## REST

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/healthz` |, | `{ status, sim }`, `sim` is `"live"` or `"stub"` |
| GET | `/api/bots` |, | `ListBotsResponse` |
| GET | `/api/bots?mine=1` |, | `ListBotsResponse`, only yours |
| POST | `/api/bots` | `CreateBotRequest` | `Bot` (201) |
| GET | `/api/bots/:id` |, | `Bot` |
| PATCH | `/api/bots/:id` | `UpdateBotRequest` | `Bot` |
| DELETE | `/api/bots/:id` |, | 204 |
| GET | `/api/bots/:id/brains` |, | `{ revisions: BrainRevision[] }`, newest first |
| GET | `/api/bots/:id/brains/:version` |, | `BrainRevision` |
| GET | `/api/matches?botId=&limit=` |, | `ListMatchesResponse` |
| POST | `/api/matches` | `StartMatchRequest` | `MatchWithEvents` (201) |
| GET | `/api/matches/:id` |, | `MatchWithEvents` |
| POST | `/api/matches/:id/verify` |, | `VerifyMatchResponse` |
| GET | `/api/leaderboard?limit=` |, | `LeaderboardResponse` |
| POST | `/api/ladder` | `StartLadderRequest` | `LadderRun` (201) |
| POST | `/api/ladder/:id/next` |, | `NextRoundResponse` |
| GET | `/api/ladder/:id` |, | `LadderRun` |
| GET | `/api/ladder?limit=` |, | `ListLadderRunsResponse` (yours) |
| GET | `/api/ladder/leaderboard?limit=` |, | `LadderLeaderboardResponse` |
| POST | `/api/train` | `TrainRequest` | `TrainingRun` (**202**) |
| GET | `/api/train?limit=` |, | `ListTrainingRunsResponse` (yours only) |
| GET | `/api/train/:id` |, | `TrainingRun` |

Status codes: `400` schema/argument failure, `403` not yours, `404` no such row,
`500` our bug. All of them return `ApiError`.

### Starting a fight

`POST /api/matches` with `{ botId, opponentBotId?, squadSize? }`. Omit the opponent to
matchmake; omit `squadSize` for 1v1.

**Squads.** `squadSize` is 1–5 and deploys that many copies of each spec per side. It is
*replay input*, not a display setting, so it is persisted on the match row, a 5v5
replayed as a 1v1 would be a match nobody fought. Out-of-range values are rejected at the
edge (`400`), not clamped.
**The fight is already over when this returns**, the sim runs headless server-side in a
few hundred milliseconds, and the response carries the winner, the outcome and the
highlight events. The socket below then *replays* it at 60 Hz.

If you want the viewer to be surprised, don't render `winnerBotId` until the socket
sends `match_end`. The server is not hiding it from you; it decided it already, which is
what "server-authoritative" means here.

## The ladder: `POST /api/ladder`

Take your tuned fly and fight successive rounds against generated flies. Losing (or
drawing) ends the run. Win **10 rounds** (`LADDER_CLEAR_ROUND`) and the run is `CLEARED`.
Opponents come from `(runSeed, round)`, so a run is reproducible and shareable exactly
like a match.

**The board ranks cleared runs by clear time, fastest first.** Clear time is
`clearTicks`, simulated ticks summed across every round fought, not wall clock. Wall
clock measures how fast somebody clicks, punishes a slow connection and is trivially
faked; ticks measure how decisively the fly actually won, are computed server-side, and
replay to the same number forever. Runs that did not finish rank below every cleared run,
ordered by how far they got. Runs still in progress are not on the board at all.

```ts
const run   = await post("/api/ladder", { botId });        // 201
const { run: after, round } = await post(`/api/ladder/${run.id}/next`);
round.won            // false -> after.status === "ENDED"
round.matchId        // a REAL match: watch it, verify it
round.opponent       // the generated fly, snapshotted
round.difficulty     // { candidatesSearched, budgetFraction, bestScore }
after.round          // furthest round cleared
after.clearTicks     // clear time so far, in simulated ticks (÷60 for seconds)
after.status         // ACTIVE | ENDED | CLEARED
```

**A ladder round is an ordinary match.** The generated fly becomes a real bot row with a
real brain revision, and the fight becomes a real `matches` row, so a round streams on
`/ws/match/:id`, passes `/api/matches/:id/verify`, and its brain is readable at
`/api/bots/:id`. You can go and read what knocked you out. The ladder adds **no transport
and no second replay path of its own.**

Generated bots are flagged and excluded from `/api/bots` and the Elo `/api/leaderboard`,
those are about bots somebody actually built. The ladder has its own board, by furthest
round.

Your fly is **pinned at run start**: retuning mid-run cannot retroactively change rounds
you already cleared. A run is also locked to the sim version it started under; if the sim
moves, `/next` returns `400` rather than mixing two simulations in one run.

### Difficulty is selection pressure

Each round generates a field of candidate brains, fights every one of them against *your
actual bot*, and sends you one of them. Round 1 sends a middling candidate; by round 13 it
sends the one that beat you hardest. The field widens as you climb (3 → 8), so "best of"
means more.

That is the cheap half of the same neuroevolution the trainer runs, and it degrades
honestly: there is no stat inflation, the opponent is always a brain you could legally
have built. Every generated loadout goes through `BrainSpec`, during development the gate
caught the generator itself emitting an over-budget brain.

The curve, measured (`src/cli/ladder-curve.ts`, 5 roster bots × 5 seeds per round):

| round | tier | win rate |
|---|---|---|
| 1 | HORNET | 92% |
| 2–3 | HORNET | 72%, 68% |
| 4–5 | HORNET | 52%, 60% |
| 6–11 | DRONE (evasive) | 44–64% |
| 12+ | TANK (the wall) | 8–20% |

Expected furthest round for a roster bot is ~2.6; a strong one reaches 10. Re-run the
harness after touching `src/ladder/difficulty.ts`, the notes there record three
plausible-sounding difficulty schemes that measurement killed.

Opponent search is CPU-bound, so a round runs in a **forked process**: `/api/healthz`
stayed at 18–23 ms through a round on the production bundle. Two rounds at a time (`429`
beyond).

## Verifying a match: `POST /api/matches/:id/verify`

The whole architecture rests on one claim: **a seed reproduces a fight exactly.** Replay
is free, a match costs one row and a forged result is impossible *only* because that is
true. So it is checkable from the product, not asserted in a README.

The endpoint re-fights the persisted match from `seed + snapshots + squadSize` **twice**,
SHA-256s every frame of each run, and compares both to each other and to the stored row:

```json
{
  "matchId": "mch_axq9jdngrvmy", "reproduced": true, "verdict": "REPRODUCED",
  "digest": "2a8244cf8b6c4f48", "digestRepeat": "2a8244cf8b6c4f48",
  "seed": "seed_tghcjvj6fc", "squadSize": 1,
  "storedTicks": 1433, "replayTicks": 1433,
  "storedWinnerBotId": "bot_sna…", "replayWinnerBotId": "bot_sna…",
  "simVersion": { "fought": "3", "current": "3" },
  "frames": 1434, "ms": 218,
  "explanation": "Replayed twice from seed seed_tghcjvj6fc; both runs produced…"
}
```

Four verdicts, and the distinction between them is the point:

| `verdict` | Means | Badge |
|---|---|---|
| `REPRODUCED` | both runs agreed, and agreed with the stored row | ✅ |
| `STALE_SIM` | runs agreed; the sim has moved on since the fight | ⚠️ different sim, not a defect |
| `DIVERGED` | runs agreed, sim unchanged, row disagrees | ❌ determinism broken |
| `NONDETERMINISTIC` | the two runs disagreed **with each other** | ❌ worse, the sim isn't deterministic |

`reproduced` is true only for `REPRODUCED`. `explanation` is a full sentence meant to be
rendered verbatim. Two runs rather than one because "deterministic" has to mean the sim
agrees with *itself* before it can mean it agrees with the database.

**Why it's a POST.** It does real work: a 5v5 double replay is ~10,200 frames and ~0.5s of
CPU (measured 2.4s under an older sim). That runs in a **forked process**, inline it would
freeze every live match socket at 60 Hz. Measured with a 5v5 verify in flight, `/api/healthz`
stayed at 10–15 ms and a live socket held 59.3 Hz. Two concurrent verifications max (`429`
beyond), and nothing is cached: a cached "verified" is a weaker claim than one you just
watched happen.

Nothing changed on the socket, `/ws/match/:id` still does playback exactly as before.

## Training: `POST /api/train`

Spiking networks have no gradient to descend, so training is **neuroevolution**: brains
are scored by actually fighting a panel, and the fittest breed. Determinism is what makes
this work at all, the same brain against the same panel and seeds scores the same exact
number every time, so selection is not chasing noise.

It is also CPU-bound, synchronous and takes about half a minute. **It therefore runs in a
forked process, not on the request thread.** Run it inline and the event loop stops: health
checks fail and every live match socket freezes mid-fight at 60 Hz. Measured with a default
run in flight, `/api/healthz` stays at 11–20 ms.

So `POST /api/train` returns **202 immediately** with a `TrainingRun` row. The row *is* the
job:

```ts
const run = await post("/api/train", { name: "MY EVOLVED BOT" });
// poll, curve grows one point per generation, ~2s apart
const r = await get(`/api/train/${run.id}`);
r.status            // PENDING -> RUNNING -> COMPLETE | FAILED
r.curve             // FitnessPoint[]: { generation, bestScore, meanScore, bestWins, matches }
r.generationsDone   // / r.generationsTotal, for a progress bar
r.botId             // set on COMPLETE, a real bot, fightable like any other
r.bestBrain         // the evolved BrainSpec
```

`curve` is appended a generation at a time, so a chart fills in live rather than appearing
all at once at the end. Points are trimmed to what a chart needs, the per-generation
champion brain is not stored, only the final `bestBrain`.

**Limits, and why.** One run at a time (`429` otherwise): evolution is not parallel work,
and two runs don't finish in half the time, they just make everything else slower. Config
is bounded by `TRAIN_MATCH_BUDGET` (10,000 simulated matches); over that you get a `400`
naming the number rather than a silent clamp. Defaults are 12 generations x 24 population
against the 4-bot house roster ≈ 2,300 matches ≈ 30s.

The evolved bot is created through the same path as a hand-built one, same table, same
brain-revision rules, same leaderboard row. An evolved loadout gets no exemption from the
schema every human loadout has to satisfy.

## WebSocket: `/ws/match/:id`

`/api/ws/match/:id` works identically (Replit's router owns the `/api` prefix for
certain; `/ws` is also routed, but the alias means a routing change can't strand you).

Server sends `ServerMessage`:

- `match_start`: `{ matchId, seed, bots: BotSpec[], teamSplit }`, once, on connect
- `frame`: `{ frame: MatchFrame }`, paced to wall clock at `TICK_HZ` (60)
- `match_end`: `{ result: MatchResult }`, from the **persisted row**, not the replay
- `error`: `{ message }`, then close

Client may send `ClientMessage`:

- `{ type: "play", speed }`: restart from tick 0 at `speed` (0.1–8)
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

Messages sent in `onopen` are safe, they're buffered until the stream is ready.

A congested socket is skipped forward rather than queued: you get the newest state, not
a backlog of stale frames. The fight stays on the wall clock either way.

## What a match actually is

`seed + two BotSpec snapshots + squadSize + the sim version they were fought under`. No
frames are stored, ever. Watching and replaying are
the same code path, both call `runMatch(seed, botA, botB)` and pace the generator.
`artifacts/api-server/src/cli/verify-determinism.ts` re-runs the newest persisted match
twice and compares SHA-256 over every frame, so the claim is checked rather than asserted.
It exits `1` if the sim is non-deterministic and `2` if the row is merely from an older
sim, two very different problems.

**Replay is only free if you version the thing doing the replaying.** Brain snapshots
stop a bot edit from rewriting history; `SIM_VERSION` (contract) stops a *physics* edit
from doing the same. Change the neuron model, the arena or the RNG and every stored match
replays into a different fight, often the same winner, never the same fight. So matches
carry `simVersion`, and a replay across a version boundary is reported as stale rather
than passed off as the original. **1.1 bumps `SIM_VERSION` whenever the sim changes.**

Editing a bot **appends** a brain revision. Matches store the snapshot they were fought
with, so retuning your bot never rewrites a match it already fought, `GET
/api/bots/:id/brains` is the receipt.

## Schema gate

These are rejected at the edge with a readable message, not silently clamped:

- total slot weight above `BRAIN_WEIGHT_BUDGET` (8) → *"total slot weight must not exceed 8"*
- the same `NeuronModule` twice → *"each neuron module may only be equipped once"*
- more than `BRAIN_MAX_SLOTS` (5) slots, weights outside 0–4, thresholds outside 0.1–5

Show `issues[].path` next to the field. That's what it's for.
