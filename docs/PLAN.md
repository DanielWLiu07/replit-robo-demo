# FLYWEIGHT: connectome-driven battle bots

Build a bot. Wire its brain from real *Drosophila* connectome circuits. Send it into
an arena to fight someone else's bot. Watch both brains spike while they do it.

The joke lands first ("fly battle bots"), then it turns out the neurons are real.
Name is a triple: boxing weight class, the insect, and the software design pattern.

## Why this, for Replit

The posting asks for "something you're proud of and excited to share", explicitly to
let managers learn about you. So: memorable, playable in 30 seconds, and technically
real underneath. 444 applicants; nobody else submits a fly.

## The science (this part is not invented)

FlyWire published the complete adult fly connectome in 2024, ~140k neurons. We use a
handful of well-characterised visual-to-motor cells as swappable brain modules:

| Module | Real circuit | Battle behaviour |
|---|---|---|
| `LPLC2 -> DNp01` | looming detection into the Giant Fiber escape reflex | dodge, fires on one spike, no deliberation |
| `LC10a` | small-target visual pursuit (courtship tracking) | chase the opponent |
| `LC11` | small-object detection | target acquisition |
| `DNa02` | steering descending neuron | turn rate |
| `MDN` | moonwalker descending neuron | reverse |
| `P1` | arousal / aggression state | gain on everything |

### What is actually real, and what is modelled

**Real, loaded from data.** Cell populations come from the FlyWire 783 public release
(Schlegel et al., *Nature* 2024), `Supplemental_file1_neuron_annotations.tsv`, 139,249
annotated neurons. Counted across both hemispheres by matching `cell_type` /
`hemibrain_type`:

| Module | Cells | Transmitter | Class |
|---|---:|---|---|
| LC10a | 234 | acetylcholine | visual projection |
| LPLC2 | 210 | acetylcholine | visual projection |
| LC11 | 127 | acetylcholine | visual projection |
| MDN | 4 | acetylcholine | descending |
| DNa02 | 2 | acetylcholine | descending |
| **DNp01 (Giant Fiber)** | **2** | **glutamate** | descending |

The shape of that table is the interesting part: hundreds of visual projection neurons
converge onto two descending cells, and the Giant Fiber is the only glutamatergic member
of the set. Population size drives signal noise in the sim (variance falls as 1/sqrt(N)),
so the 2-cell Giant Fiber is visibly twitchy while 234-cell LC10a pursuit is smooth.

**Modelled, not loaded.** Synaptic weights between modules are not taken from the
connectome: they are the player's loadout, which is the game. Say "cell populations and
transmitter identity from FlyWire; connectivity qualitative from the literature." Do not
say "running the connectome". (Same lesson as the INT8/fp32 resume problem.)

## Machine learning: neuroevolution

Spikes are not differentiable, so there is no gradient to descend. Evolution is the
standard tool for training spiking networks, and it is also what shaped the real circuits.

The deterministic simulator is what makes it work: a (brain, opponent, seed) triple always
produces the same match, so fitness is an **exact reproducible number** rather than a noisy
sample, and `evolve()` itself replays identically from its seed.

Measured: 24 genomes, 14 generations, 40 seconds. Best fitness 26.34 to 27.66, population
mean 6.85 to 15.94, the whole population improves, and by far more than the elite does.
The champion goes **39W 1L 0D against all four hand-designed archetypes on seeds it never
trained on**, so it generalises rather than memorising. Saved with its full fitness curve in
`lib/sim/src/champion.json` and used as the boss opponent.

The flat *best* curve against a fast-rising *mean* is itself a measurement, not a
disappointment: generation 0's best already wins nearly every panel match, so there is
almost no headroom above it, and what evolution actually does over fourteen generations is
drag the rest of the population up to that line. A harder panel would give the elite room
to climb; that is the next pass, not tonight's.

**The champion is an artifact of the physics, and the boxing pass proved it.** Re-measured
against the new arena, the old champion, evolved when the bots fought in a clinch, went
**0W 40L**. It had converged on a steering-only brain with `refractoryTicks: 0`: at zero
metres of spacing, all that mattered was staying pointed at the opponent. Re-evolved against
the same panel under boxing physics, with the same seed, it now equips **all five modules**
(acquisition, guard, arousal, steering, pursuit) and settles at `refractoryTicks: 6`. Same
search, same seed, same code, a different fight, and so a different animal.

That made the refractory period worth re-measuring too: a 216-match round robin holding the
brain fixed and varying only that one number.

```
 before (clinch physics)        after (boxing physics)
 0 ticks: 32 wins                0 ticks:  2 wins    9 ticks: 39 wins
 1 ticks: 28 wins                1 ticks: 10 wins   14 ticks: 39 wins
 2 ticks: 30 wins                2 ticks: 13 wins   20 ticks: 41 wins
 4 ticks: 18 wins                4 ticks: 24 wins   30 ticks: 18 wins
 6 ticks: 12 wins                6 ticks: 30 wins
 9 ticks:  6 wins
14 ticks:  0 wins
```

The ranking inverted, and the dead space is gone. The contract permits 0–30; before,
everything past about 6 was unplayable, so four fifths of that slider did nothing. Now the
curve has an interior optimum: it climbs to a plateau around 9–20 and falls off again by 30,
because stamina is exactly the compensating benefit a long refractory period was missing.
A neuron that never goes deaf throws every punch it can, gasses out, and gets countered on
an empty tank. This was written down as the fix to attempt in a later pass; it turned out to
fall out of the boxing pass for free, which is the kind of thing you only find by measuring
the same experiment twice.

## Architecture: five tiers

1. **Client**, React + Three.js arena, black-and-white glass UI, brain lab, spike rasters.
2. **API**, Express 5, REST + `/ws/match/:id`, Clerk auth, Zod on every boundary.
3. **Sim core**, pure TypeScript, zero I/O. Deterministic fixed timestep, seeded RNG,
   leaky integrate-and-fire neurons. Same module runs on server and in-browser for preview.
4. **Data**, Postgres + Drizzle: users, bots, brains, matches, match_events, leaderboard.
5. **Replay**, a match is `seed + two brain snapshots`. Re-run the sim to replay it.
   No frame storage. Brain snapshots are versioned so old matches still replay after you
   edit your bot.

## Tuning the fight: five bugs found by measuring

1. **They orbited at exactly 90 degrees, forever.** DNa02 fired bang-bang full-turn
   regardless of error, so it could never settle. Real DNa02 is graded: firing rate encodes
   turn magnitude. Made it proportional.
2. **The motor plant could only oscillate.** Spike impulses fed a double integrator with
   proportional control. The physiologically correct fix is also the stable one, a
   neuromuscular junction low-passes spike trains into graded muscle tension.
3. **They welded together at 1.20m.** Momentum exchange ran every overlapping tick and bled
   all the energy. Now it only fires on the tick they are actually closing.
4. **Escape was an unbeatable strategy.** Every draw was a dodger match with zero hits and
   both bots at full hull. Fixed with real biology: the Giant Fiber **habituates** to
   repeated looming. Draws went 15 to 0, KOs 17 to 29, match length 57s to 31s. Crucially
   it habituates to *weak* repeated looming but never to a real charge, which is exactly
   what habituation is for.

5. **They fought in a clinch.** The punches were real, discrete impulses on real arm
   bodies, a tip-speed threshold, recovery frames, but 61% of every match was spent
   welded to the body-contact wall at 1.20m, two torsos leaning on each other and
   swinging. Boxing is a spacing game before it is a punching game, so the fix is
   spacing: forward drive is governed off across the pocket, and a soft break starts
   *before* the torsos touch, so pursuit ends at the end of its own reach instead of
   at the opponent's chest. Median gap 1.20m to 1.50m, clinch 61% to 4%. Built on top
   of that: a punch landing on a bot still inside its own recovery window is a
   **counter** and pays 1.6x, so baiting a whiff beats trading; every swing spends
   **stamina** that a held guard and time out of range pay back, and an empty tank
   swings too slowly to clear the strike threshold, so flailing punishes itself; and
   an uncommitted bot **circles** rather than shuttling in and out on one axis.

   Two modules quietly died in the move, both the same way, a trigger condition that
   the new spacing made unreachable. LC11's target lock decayed before the fight
   arrived, so an LC11 build stopped punching the moment it got there (0 wins in 18);
   MDN fired on the opponent's torso filling the view, which now never happens. Both
   were re-aimed at punching range, and LC11's lock was given a payoff that survives
   into the pocket. The general lesson is worth more than either fix: change where a
   fight happens and every circuit tuned for the old distance silently stops working.

Current: 36-match round robin, 36 KOs, 0 draws, average 30.3s, all four archetypes
winning, 73% of engaged ticks spent at punching range and 4% in a clinch.

## The parts worth discussing in an interview

- **Server-authoritative determinism.** Client renders, server decides. Same seed, same
  result, every time, which is what makes replay free and cheating hard.
- **Brain snapshot versioning.** Editing your bot must not rewrite history.
- **A schema gate between the brain editor and the sim.** Invalid loadouts cannot reach
  the simulation. Direct echo of Pomme, where an unvalidated command drives a real rover
  into a wall.
- **Why a single-spike reflex is the right shape for a safety path**, no deliberation,
  fixed latency. Same argument as putting Pomme's e-stop on the MCU instead of behind the AI.

## Split of work

- `1.1` sim core, neuron model, match engine, tick loop
- `1.2` Drizzle schema, migrations, REST routes, Clerk, WebSocket plumbing, Replit deploy
- `1.3` Three.js arena, B&W glass design system, landing page, spike raster + trace components

Everyone codes against `lib/contract` (below). Build it first, then work in parallel.

## Tonight's bar (deadline 09:00)

Not "finished", **a stranger opens the link and sees two fly-brained bots fight.**
One working loop beats five half-features. Polish ships tomorrow; the app keeps updating
after submission, only the WaterlooWorks documents hard-lock at 09:00.
