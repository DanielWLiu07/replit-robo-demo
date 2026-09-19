# Brief: ragdoll physics (lane: fighting)

Make the fighting feel like *Human Fall Flat*: floppy, physical, comic. Right now the bots
are rigid bodies with rigidly driven arms. You own `lib/sim/src/arena.ts`.

## What to build
- **Floppy limbs.** Arms should overshoot and wobble rather than track exactly. Add angular
  damping plus a spring return so a swing carries past its target and settles.
- **Overbalance.** Torso lean responds to acceleration and to being hit, so a missed swing
  nearly topples you.
- **Knockdown.** A hard enough hit puts a bot on the floor with a get-up timer. It cannot
  block or punch while down.
- **Buckling legs.** When stamina empties, the legs give and the stance sags.

## Hard constraint
The simulation **must stay deterministic**, same seed, identical match. Replay, the
evolution fitness function and six of the 21 tests all depend on it. That means:
no physics engine, no wall-clock, no `Math.random`. Only the seeded rng already threaded
through `runMatch`.

## Verify
```
cd lib/sim && pnpm dlx tsx --test src/sim.test.ts      # 21 tests, all must stay green
cd lib/sim && pnpm dlx tsx src/__balance.ts            # 36-match round robin
```
Keep draws at 0 and matches roughly 20–35s. Measure before and after, and report both.
