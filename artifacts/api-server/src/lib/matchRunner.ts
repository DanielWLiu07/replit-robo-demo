import type { MatchFrame, MatchResult, MatchRunner } from "@workspace/contract";
import { runMatch as simRunMatch } from "@workspace/sim";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SIM BOUNDARY.
 *
 * Pane 1.1 owns the physics and the neuron model. This module owns nothing but
 * the import and the two ways we drive it. The type assertion is deliberate:
 * it is the one place where the sim's shape is checked against the contract,
 * so if 1.1 changes the signature this file fails to compile rather than
 * something three layers down failing at runtime.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const runMatch: MatchRunner = simRunMatch;

/** No stub any more, `@workspace/sim` is wired in. Reported on /api/healthz. */
export const SIM_IS_STUB = false;

/**
 * Drain the whole match as fast as the CPU allows. Used when a match is
 * created: the result is what the leaderboard is about and it costs a few
 * hundred milliseconds, so there is no reason to make anyone wait 90 seconds
 * of wall clock to find out who won.
 *
 * `matchId` comes back empty: the sim does not know its own id, and is filled
 * in by the caller that owns the row.
 */
export function runMatchHeadless(
  seed: string,
  botA: Parameters<MatchRunner>[1],
  botB: Parameters<MatchRunner>[2],
  squadSize = 1,
  onFrame: (frame: MatchFrame) => void = () => {},
): MatchResult {
  const gen = runMatch(seed, botA, botB, squadSize);
  for (;;) {
    const step = gen.next();
    if (step.done) return step.value;
    onFrame(step.value);
  }
}
