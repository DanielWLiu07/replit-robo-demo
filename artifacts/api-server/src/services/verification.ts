import {
  SIM_VERSION,
  VerifierResult,
  VerifyMatchResponse,
  type VerifyVerdict,
} from "@workspace/contract";
import type { MatchRow } from "@workspace/db";
import { forkJob } from "../lib/forkJob";
import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";

/**
 * Verification is cheap next to training but not free: a 5v5 double replay is
 * ~2.4s of CPU. Cap the number in flight so a page full of badges cannot fork
 * a dozen children and turn a small container into a queue.
 */
const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 60_000;
let inFlight = 0;

export class VerifyBusyError extends HttpError {
  constructor() {
    super(429, "Too many verifications running. Try again in a moment.");
    this.name = "VerifyBusyError";
  }
}

/** A short prefix: this is for eyeballing two runs side by side, not a signature. */
const short = (digest: string) => digest.slice(0, 16);

function decide(
  row: MatchRow,
  result: VerifierResult,
): { verdict: VerifyVerdict; explanation: string } {
  const sameSim = row.simVersion === SIM_VERSION;

  // Order matters. The sim disagreeing with *itself* is the worst case and has
  // to be reported as that, never excused as a version difference.
  if (result.digest !== result.digestRepeat) {
    return {
      verdict: "NONDETERMINISTIC",
      explanation:
        "Two replays of this seed produced different frames. The simulation is not " +
        "deterministic, which means no replay in the product can be trusted.",
    };
  }

  const matchesRow =
    result.ticks === row.ticks &&
    result.winnerBotId === row.winnerBotId &&
    result.outcome === row.outcome;

  if (matchesRow) {
    return {
      verdict: "REPRODUCED",
      explanation:
        `Replayed twice from seed ${row.seed}; both runs produced identical frames and ` +
        `the same result the match was persisted with. Nothing but the seed and the two ` +
        `brain snapshots was stored.`,
    };
  }

  if (!sameSim) {
    return {
      verdict: "STALE_SIM",
      explanation:
        `This match was fought under sim v${row.simVersion} and the server now runs ` +
        `v${SIM_VERSION}. The replay is self-consistent but it is a different simulation, ` +
        `so it ends on tick ${result.ticks} rather than ${row.ticks}. Not a defect, a ` +
        `different fight.`,
    };
  }

  return {
    verdict: "DIVERGED",
    explanation:
      `Both replays agree with each other but not with the stored match (tick ` +
      `${result.ticks} vs ${row.ticks}) under the same sim v${SIM_VERSION}. Determinism ` +
      `is broken.`,
  };
}

export async function verifyMatch(row: MatchRow): Promise<VerifyMatchResponse> {
  if (inFlight >= MAX_CONCURRENT) throw new VerifyBusyError();

  inFlight++;
  const started = Date.now();
  try {
    const raw = await forkJob<unknown>(
      "verify",
      {
        seed: row.seed,
        specA: row.botASpec,
        specB: row.botBSpec,
        squadSize: row.squadSize,
      },
      { timeoutMs: TIMEOUT_MS },
    );
    const result = VerifierResult.parse(raw);
    const { verdict, explanation } = decide(row, result);

    if (verdict === "NONDETERMINISTIC" || verdict === "DIVERGED") {
      logger.error({ matchId: row.id, verdict }, "match failed verification");
    }

    return VerifyMatchResponse.parse({
      matchId: row.id,
      reproduced: verdict === "REPRODUCED",
      verdict,
      digest: short(result.digest),
      digestRepeat: short(result.digestRepeat),
      seed: row.seed,
      squadSize: row.squadSize,
      storedTicks: row.ticks,
      replayTicks: result.ticks,
      storedWinnerBotId: row.winnerBotId,
      replayWinnerBotId: result.winnerBotId,
      storedOutcome: row.outcome,
      replayOutcome: result.outcome,
      simVersion: { fought: row.simVersion, current: SIM_VERSION },
      frames: result.frames,
      ms: Date.now() - started,
      explanation,
    });
  } finally {
    inFlight--;
  }
}
