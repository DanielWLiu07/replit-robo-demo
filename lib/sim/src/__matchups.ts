import { runMatch } from "./index.js";
import type { BotSpec } from "@workspace/contract";
import { DEFAULT_BOTS, CHAMPION_BRAIN } from "../../../artifacts/mockup-sandbox/src/flyweight/modules.js";
const mk = (id: string, slots: any[], chassis: any = "HORNET"): BotSpec =>
  ({ id, name: id, chassis, brain: { slots, membraneLeak: 0.2, refractoryTicks: 6 } });
const PURSUE = [{ module: "LC10A", weight: 2.4, threshold: 0.5 }, { module: "DNA02", weight: 1.8, threshold: 0.6 }];
const TIMID  = [{ module: "LPLC2_DNP01", weight: 2.4, threshold: 0.6 }, { module: "MDN", weight: 1.6, threshold: 0.6 }];
const MIXED  = [{ module: "LC10A", weight: 1.2, threshold: 0.8 }, { module: "LPLC2_DNP01", weight: 1.2, threshold: 0.8 },
                { module: "DNA02", weight: 1.0, threshold: 0.8 }];
const pairs: Array<[string, BotSpec, BotSpec]> = [
  ["stock vs champion", DEFAULT_BOTS[0], DEFAULT_BOTS[1]],
  ["champ vs champ    ", { ...CHAMPION_BRAIN, id: "c1" }, { ...CHAMPION_BRAIN, id: "c2" }],
  ["pursuer vs pursuer", mk("p1", PURSUE), mk("p2", PURSUE)],
  ["timid vs timid    ", mk("t1", TIMID), mk("t2", TIMID)],
  ["mixed vs mixed    ", mk("m1", MIXED), mk("m2", MIXED)],
  ["pursuer vs timid  ", mk("p", PURSUE), mk("t", TIMID)],
];
for (const [name, A, B] of pairs) {
  let ko = 0, timeout = 0, ticks = 0, hits = 0;
  for (let s = 0; s < 10; s++) {
    const g = runMatch(`mu-${name}-${s}`, A, B);
    let r = g.next(), n = 0;
    while (!r.done) { n++; hits += (r.value as any).hits?.length ?? 0; r = g.next(); }
    ticks += n;
    if (n >= 5400 - 2) timeout++; else ko++;
  }
  console.log(`  ${name}  KO ${ko}/10  timeout ${timeout}/10  avg ${(ticks/10/60).toFixed(0)}s  hits ${(hits/10).toFixed(1)}`);
}
