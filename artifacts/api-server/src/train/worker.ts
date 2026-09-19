/**
 * The trainer, in its own process.
 *
 * `evolve()` is CPU-bound and synchronous: a default run is ~2,300 simulated
 * matches and about half a minute of solid compute. Run that on the request
 * thread and the API stops answering, health checks fail, and every live match
 * socket freezes mid-fight at 60 Hz. So it runs here instead, and talks to the
 * API over IPC.
 *
 * This file must stay dependency-light: it is forked, so everything it imports
 * is paid for on every run. Sim and contract only, no express, no database.
 * The parent owns persistence; this process owns arithmetic.
 */
import type { BotSpec, TrainConfig, TrainerMessage } from "@workspace/contract";
import { evolve } from "@workspace/sim";

export interface TrainerInput {
  seed: string;
  config: TrainConfig;
  panel: BotSpec[];
}

function post(message: TrainerMessage): void {
  process.send?.(message);
}

function main(): void {
  const raw = process.argv[2];
  if (!raw) {
    post({ type: "failed", message: "trainer started without input" });
    process.exit(1);
  }

  let input: TrainerInput;
  try {
    input = JSON.parse(raw) as TrainerInput;
  } catch (err) {
    post({ type: "failed", message: `trainer input was not JSON: ${String(err)}` });
    process.exit(1);
  }

  try {
    const { best } = evolve(input.panel, input.config, input.seed, (report) => {
      // Stream the curve as it is produced. The per-generation champion brain is
      // dropped here rather than in the parent: it is the heaviest part of the
      // report and nothing downstream charts it.
      post({
        type: "generation",
        point: {
          generation: report.generation,
          bestScore: report.bestScore,
          meanScore: report.meanScore,
          bestWins: report.bestWins,
          matches: report.matches,
        },
      });
    });
    post({ type: "done", best });
  } catch (err) {
    post({ type: "failed", message: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  }
}

main();
