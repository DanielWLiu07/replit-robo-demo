# FLYWEIGHT — application description

*Copy-paste blocks for the Replit application. Three lengths.*

---

## One line

Robot flies box each other on a moon, and their brains are real fruit fly circuits.

---

## Short version (~90 words)

FLYWEIGHT is a fighting game where you never touch the controls. You build a robot fly,
wire its nervous system out of circuits taken from the *Drosophila* connectome, deploy up
to five of them onto a lunar arena, and watch what your instincts do under pressure.

They box. They hold range, throw, block, and get punished when they swing and miss. None
of it is scripted — a bot flinches because its Giant Fiber fired, and chases because its
courtship-pursuit circuit did.

Cell counts come from FlyWire's 139,249 annotated neurons. The brains can also be evolved.

---

## The hook, if you only get one sentence

The Giant Fiber is the fly's escape reflex. It is two neurons. Out on the moon those same
two neurons decide whether your robot runs or puts its guard up — and because the real
circuit habituates to repeated looming, a fly that panics too often stops being able to
panic, and loses its block along with it.

---

## Setting

A cratered moon, a black sky, and a marked-out ring. The fighters are grimy industrial
machines with compound eyes and folded wing blades, standing upright like boxers. The
instrumentation is the other half of the screen: two connectomes firing in real time, one
line per real cell, with stamina, arousal and Giant Fiber fatigue read out beside them.

Nothing about the setting is decorative — the arena walls close in after twenty-five
seconds, so there is nowhere to run by the end.

---

## Full version

**Small brain. Big fight.**

FLYWEIGHT is a fighting game where you never touch the controls. You build a robot fly, wire
its nervous system out of real *Drosophila* circuits, and drop it onto a lunar ring to find
out whether your instincts were any good.

**The neurons are real.** Six modules, each a documented *Drosophila* circuit:

| Module | Circuit | Behaviour |
|---|---|---|
| LPLC2 → DNp01 | looming detection into the Giant Fiber escape reflex | dodges, on a single spike |
| LC10a | small-target visual pursuit (courtship tracking) | chases |
| LC11 | small-object detection | acquires targets |
| DNa02 | descending steering neuron | turns |
| MDN | moonwalker descending neuron | reverses |
| P1 | arousal state | amplifies everything else |

Cell populations are counted from the FlyWire 783 public release (Schlegel et al., *Nature*
2024), 139,249 annotated neurons. The counts are the interesting part: LC10a is 234 cells,
LPLC2 is 210, and **DNp01 — the Giant Fiber — is exactly two cells, one per hemisphere, and
the only glutamatergic neuron in the set.** Hundreds of visual neurons converging onto two
descending cells. That asymmetry is in the simulation: population size sets signal noise
(variance falls as 1/√N), so the two-cell Giant Fiber is visibly twitchy while
234-cell pursuit is smooth. It is also in the 3D brain view, which draws one fibre per real
cell — when escape fires you see two thick lines flash; when pursuit fires, hundreds shimmer.

**The brains can be trained.** Spikes are not differentiable, so there is no gradient to
descend — evolution is the standard tool for spiking networks, and it is what shaped the
originals. The simulator is fully deterministic, which is what makes it work: a
(brain, opponent, seed) triple always produces the same match, so fitness is an exact
reproducible number rather than a noisy sample. Twenty-four genomes over fourteen generations
takes twenty-eight seconds and lifts best fitness from 13.2 to 30.82, with the population mean
rising too. The champion beats all four hand-designed archetypes **20–0 on seeds it never
trained on**. It also converged on a zero refractory period, which sent me to measure the
parameter space and find that four fifths of that slider was dead space — a finding about my
bounds, not a bug in the search.

**Things that had to be got right.** The first version had the bots locked in a stable 90°
orbit, circling forever instead of closing, because steering fired bang-bang regardless of
error; real DNa02 is graded, and firing rate encodes turn magnitude. Spike impulses fed
straight into a double integrator could only oscillate — the fix was a neuromuscular junction
that low-passes spike trains into graded muscle tension, which is both the physiological
answer and the stable one. And escape was briefly an unbeatable strategy: a dodging bot never
fought and nobody could catch it, so every draw was a zero-hit stalemate. Real Giant Fibers
habituate to repeated looming, and adding that took draws from 15 to 0. It habituates to weak
repeated looming but never to a genuine charge — which is exactly what habituation is for.

**Built on** pnpm workspaces, Node 24, Express 5, Postgres with Drizzle, Clerk, React, Three.js
and Vite. A match is persisted as a seed plus two brain snapshots — no frames are stored,
because replay just re-runs the simulation. Brain rows are append-only and versioned, so
editing a bot cannot rewrite the history of fights it already had.

---

## Claim discipline

Say: cell populations and transmitter identity from FlyWire; circuits modelled from the
literature; synaptic weights are the player's loadout.
Do **not** say: "runs the connectome", or that the morphology is traced.
