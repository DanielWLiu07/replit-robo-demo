/**
 * Ladder round, in its own process.
 *
 * Building a late-round opponent means generating up to eight brains and
 * fighting each against the player to pick the meanest — then fighting the real
 * round on top. That is up to nine simulated matches, which is CPU-bound and
 * synchronous, so it forks for the same reason training and verification do:
 * on the request thread it would stutter every live match socket at 60 Hz.
 *
 * Dependency-light on purpose: sim and contract only. No express, no database.
 * The parent owns persistence; this process owns arithmetic.
 */
import {
  type BotSpec,
  type LadderRoundResult,
  type MatchFrame,
} from "@workspace/contract";
import { fitness, makeRng, runMatch } from "@workspace/sim";
import { planRound } from "./difficulty";
import { pickOpponentBrain } from "./generate";
import { opponentName } from "./names";

export interface LadderWorkerInput {
  runSeed: string;
  round: number;
  player: BotSpec;
  matchSeed: string;
}

function buildOpponent(input: LadderWorkerInput): {
  opponent: BotSpec;
  candidates: number;
  budgetFraction: number;
  bestScore: number;
} {
  const plan = planRound(input.round);

  // Every opponent in a run derives from (runSeed, round): same run, same
  // ladder, forever — which is what makes a run shareable the way a match is.
  const rng = makeRng(`${input.runSeed}:round:${input.round}`);
  const name = opponentName(rng, input.round);

  const picked = pickOpponentBrain(rng, plan, input.round, (brain) => {
    // Scored against the player's actual fly: a late opponent is tuned to beat
    // *you*, not tuned in the abstract.
    return fitness(brain, plan.chassis, [input.player], 1).score;
  });

  return {
    opponent: {
      id: `gen:${input.runSeed}:${input.round}`,
      name,
      chassis: plan.chassis,
      // Already validated in generateCandidate — a generated loadout goes
      // through the same gate a human loadout does.
      brain: picked.brain,
    },
    candidates: plan.candidates,
    budgetFraction: +plan.budgetFraction.toFixed(3),
    bestScore: picked.chosenScore,
  };
}

function main(): void {
  const raw = process.argv[2];
  if (!raw) {
    process.send?.({ error: "ladder worker started without input" });
    process.exit(1);
  }
  try {
    const input = JSON.parse(raw) as LadderWorkerInput;
    const built = buildOpponent(input);

    // The real round. The parent persists this seed, so it replays on the
    // ordinary /ws/match/:id socket like any other fight.
    const hits: LadderRoundResult["hits"] = [];
    const gen = runMatch(input.matchSeed, input.player, built.opponent);
    let result;
    for (;;) {
      const step = gen.next();
      if (step.done) {
        result = step.value;
        break;
      }
      const frame: MatchFrame = step.value;
      for (const hit of frame.hits) {
        if (hits.length < 200) {
          hits.push({
            tick: frame.tick,
            attacker: hit.attacker,
            damage: +hit.damage.toFixed(3),
          });
        }
      }
    }

    const payload: LadderRoundResult = {
      opponent: built.opponent,
      difficulty: {
        candidatesSearched: built.candidates,
        budgetFraction: built.budgetFraction,
        bestScore: built.bestScore,
      },
      winnerBotId: result.winnerBotId,
      outcome: result.outcome,
      ticks: result.ticks,
      survivors: result.survivors ?? null,
      hits,
    };
    process.send?.({ ok: payload });
  } catch (err) {
    process.send?.({ error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  }
}

main();
