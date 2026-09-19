/**
 * The verifier, in its own process.
 *
 * Replaying a match twice and hashing every frame costs up to ~2.4s of solid
 * CPU for a 5v5, measured, not guessed. On the request thread that would
 * freeze every live match socket at 60 Hz for two seconds, which is the exact
 * mistake the trainer already taught us not to make. So it forks.
 *
 * Dependency-light on purpose: sim and contract only, no express, no database.
 * Two *independent* replays, because "deterministic" has to mean the sim agrees
 * with itself before it can mean it agrees with the database.
 */
import { createHash } from "node:crypto";
import type { BotSpec, MatchFrame, VerifierResult } from "@workspace/contract";
import { runMatch } from "@workspace/sim";

export interface VerifierInput {
  seed: string;
  specA: BotSpec;
  specB: BotSpec;
  squadSize: number;
}

function replay(input: VerifierInput): {
  digest: string;
  frames: number;
  result: ReturnType<typeof runMatch> extends Generator<unknown, infer R, unknown> ? R : never;
} {
  const hash = createHash("sha256");
  let frames = 0;
  const gen = runMatch(input.seed, input.specA, input.specB, input.squadSize);
  for (;;) {
    const step = gen.next();
    if (step.done) {
      return { digest: hash.digest("hex"), frames, result: step.value };
    }
    const frame: MatchFrame = step.value;
    frames++;
    hash.update(JSON.stringify(frame));
  }
}

function main(): void {
  const raw = process.argv[2];
  if (!raw) {
    process.send?.({ error: "verifier started without input" });
    process.exit(1);
  }
  try {
    const input = JSON.parse(raw) as VerifierInput;
    const first = replay(input);
    const second = replay(input);
    const payload: VerifierResult = {
      digest: first.digest,
      digestRepeat: second.digest,
      frames: first.frames,
      ticks: first.result.ticks,
      winnerBotId: first.result.winnerBotId,
      outcome: first.result.outcome,
      survivors: first.result.survivors ?? null,
    };
    process.send?.({ ok: payload });
  } catch (err) {
    process.send?.({ error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  }
}

main();
