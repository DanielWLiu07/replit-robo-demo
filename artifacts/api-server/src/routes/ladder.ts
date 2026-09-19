import {
  LadderLeaderboardResponse,
  ListLadderRunsResponse,
  NextRoundResponse,
  StartLadderRequest,
} from "@workspace/contract";
import { Router, type IRouter } from "express";
import { forbidden, parseBody } from "../lib/http";
import {
  getRun,
  getRunDto,
  ladderLeaderboard,
  listRuns,
  ownsRun,
  playNextRound,
  startRun,
} from "../services/ladder";

const router: IRouter = Router();

/** Furthest round reached. Public: it is a scoreboard. */
router.get("/ladder/leaderboard", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  res.json(LadderLeaderboardResponse.parse({ rows: await ladderLeaderboard(limit) }));
});

router.get("/ladder", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  res.json(ListLadderRunsResponse.parse({ runs: await listRuns(req.identity, limit) }));
});

router.post("/ladder", async (req, res) => {
  const input = parseBody(StartLadderRequest, req.body);
  res.status(201).json(await startRun(req.identity, input.botId));
});

router.get("/ladder/:id", async (req, res) => {
  const row = await getRun(req.params.id);
  // A run in progress is private, otherwise you could scout the ladder by
  // reading somebody else's rounds. Finished runs show up on the leaderboard.
  if (row.status === "ACTIVE" && !ownsRun(req.identity, row)) {
    throw forbidden("That ladder run isn't yours");
  }
  res.json(await getRunDto(req.params.id));
});

/**
 * Fight the next round. Returns the round just fought; `run.status` is ENDED
 * when you lost. The round carries a real `matchId`, watch it on
 * /ws/match/:id, check it with /api/matches/:id/verify.
 */
router.post("/ladder/:id/next", async (req, res) => {
  res.json(NextRoundResponse.parse(await playNextRound(req.identity, req.params.id)));
});

export default router;
