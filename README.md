# FLYWEIGHT

**Small brain. Big fight.**

Build a robot. Wire its brain from real *Drosophila* circuits. Send it into an arena to
fight someone else's. Watch both brains spike while they do it.

No joystick. No scripted moves. Just neurons.

---

## What this actually is

Every bot is driven by a spiking neural network assembled from six circuits found in the
fruit fly brain. You pick which circuits to equip and how strongly to wire them; the fly
does the rest. A bot that equips the Giant Fiber escape reflex flinches away from charges.
One that equips the courtship pursuit circuit chases. Neither behaviour is scripted —
both fall out of the neurons.

| Module | Real circuit | What it does in a fight |
|---|---|---|
| `LPLC2 → DNp01` | looming detection into the Giant Fiber escape reflex | dodges — one spike, no deliberation |
| `LC10a` | small-target visual pursuit (courtship tracking) | chases |
| `LC11` | small-object detection | acquires a target |
| `DNa02` | descending steering neuron | turns |
| `MDN` | moonwalker descending neuron | reverses |
| `P1` | arousal / aggression state | amplifies everything else |

## The neurons are real

Cell populations are counted from the [FlyWire](https://flywire.ai) 783 public release
(Schlegel et al., *Nature* 2024) — 139,249 annotated neurons:

```
LC10a   234 cells   acetylcholine   visual projection
LPLC2   210 cells   acetylcholine   visual projection
LC11    127 cells   acetylcholine   visual projection
MDN       4 cells   acetylcholine   descending
DNa02     2 cells   acetylcholine   descending
DNp01     2 cells   GLUTAMATE       descending    ← the Giant Fiber
```

Hundreds of visual neurons converge onto **two** descending cells, and the Giant Fiber is
the only glutamatergic one in the set. That shape is in the simulation: population size
sets signal noise (variance falls as `1/√N`), so the 2-cell Giant Fiber is visibly twitchy
in the membrane trace while 234-cell pursuit is smooth.

Synaptic weights between modules are **not** from the connectome — those are your loadout.
That is the game.

## The brains can be evolved

Spikes are not differentiable, so there is no gradient to descend. Evolution is the standard
tool for training spiking networks, and it is what shaped the originals.

The simulator is fully deterministic, which is what makes this work: a `(brain, opponent,
seed)` triple always produces the same match, so fitness is an exact reproducible number
rather than a noisy sample.

```
24 genomes · 14 generations · 28 seconds
best fitness   13.2  →  30.82
population mean -0.33 →  13.94     (the whole population improves, not just the elite)

champion vs all four hand-designed archetypes, on seeds it never trained on:
  20W  0L  0D
```

The evolved champion is the boss. It also found an exploit — it converged on
`refractoryTicks: 0`, because a neuron that never goes deaf can steer every tick. That is a
finding about the parameter bounds, not a bug in the search.

## Architecture

```
Brain Lab  →  Zod schema gate  →  simulation core  →  WebSocket  →  3D arena
                     ↓                   ↑                            spike raster
                 rejected           FlyWire cell                      membrane traces
              (invalid loadouts       populations
            cannot reach the sim)
```

- **Simulation core** — pure TypeScript, zero I/O. 60 Hz fixed timestep, seeded RNG,
  leaky integrate-and-fire neurons. Runs identically on the server and in the browser.
- **Persistence** — a match is stored as `seed + two brain snapshots`. No frames are kept;
  replay re-runs the simulation. Brain rows are append-only and versioned, so editing a bot
  cannot rewrite the history of matches it already fought.
- **Stack** — pnpm workspaces, Node 24, Express 5, Postgres + Drizzle, Clerk, React,
  Three.js, Vite.

## Things that had to be got right

**Graded steering, not bang-bang.** The first version fired full-magnitude turns regardless
of bearing error, and the bots settled into a stable 90° orbit — circling each other forever
instead of closing. Real DNa02 is graded: firing rate encodes turn magnitude.

**A neuromuscular junction.** Spike impulses fed straight into a double integrator can only
oscillate. Real motor neurons low-pass spike trains into graded muscle tension, and that
filter is also what makes the controller stable. The physiologically correct fix was the
engineering fix.

**Habituation.** Escape was an unbeatable strategy — a dodging bot never fought and nobody
could catch it, so every draw was a zero-hit stalemate. The Giant Fiber habituates to
repeated looming in the real fly, and adding that took draws from 15 to 0 and average match
length from 57s to 31s. It habituates to *weak* repeated looming but never to a real charge,
which is exactly what habituation is for.

## Running it

```bash
pnpm install

# API  (routes are under /api; health is /api/healthz)
cd artifacts/api-server && PORT=5000 pnpm dev

# Web
cd artifacts/mockup-sandbox && PORT=5173 BASE_PATH=/ pnpm dev
```

Requires `DATABASE_URL`. Clerk keys are optional for local play.

```bash
cd lib/sim && node --test src/sim.test.ts    # 14 tests
```

---

Built on [Replit](https://replit.com).
