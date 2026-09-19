# Brief: rounds against generated opponents (lane: 1.2)

A run: take your tuned fly and fight successive rounds against generated flies, each harder
than the last. Losing ends the run; the round reached is the score.

## Use what exists
- `randomBrain(rng)` from `@workspace/sim` generates a valid random `BrainSpec`.
- `makeRng(seed)` gives a deterministic generator.
- `evolve()` exists if you want genuinely tuned opponents rather than purely random ones.

## Shape
- A run has a seed and a round number. Opponents are generated deterministically from
  `(runSeed, round)`, so a run is reproducible and shareable exactly like a match.
- Difficulty scales with round, more weight budget, or drawn from evolved populations
  rather than random ones.
- Persist runs. Leaderboard by furthest round.

## Constraints
Determinism is load-bearing across the whole architecture. REST plus the existing websocket.
**Do not touch `lib/sim/src/arena.ts`**, the fighting lane owns it.
