import { ListMatchesResponse, StartMatchRequest } from "@workspace/contract";
import { Router, type IRouter } from "express";
import { parseBody } from "../lib/http";
import { getMatchRow, getMatchWithEvents, listMatches, startMatch } from "../services/matches";
import { verifyMatch } from "../services/verification";

const router: IRouter = Router();

router.get("/matches", async (req, res) => {
  const botId = typeof req.query.botId === "string" ? req.query.botId : undefined;
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  res.json(ListMatchesResponse.parse({ matches: await listMatches({ botId, limit }) }));
});

router.post("/matches", async (req, res) => {
  const input = parseBody(StartMatchRequest, req.body);
  res.status(201).json(await startMatch(req.identity, input));
});

router.get("/matches/:id", async (req, res) => {
  res.json(await getMatchWithEvents(req.params.id));
});

/**
 * Re-fight the persisted match from `seed + snapshots` and report whether it
 * comes out identical. The whole architecture rests on this being true — replay
 * is free and a match costs one row *only* because the seed reproduces the
 * fight — so it is checkable from the product rather than asserted in a README.
 *
 * Runs in a forked process (a 5v5 double replay is ~2.4s of CPU) and returns
 * the verdict directly; nothing is cached, because a cached "verified" is a
 * weaker claim than one you just watched happen.
 */
router.post("/matches/:id/verify", async (req, res) => {
  const row = await getMatchRow(req.params.id);
  res.json(await verifyMatch(row));
});

export default router;
