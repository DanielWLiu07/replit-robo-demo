import { ListMatchesResponse, StartMatchRequest } from "@workspace/contract";
import { Router, type IRouter } from "express";
import { parseBody } from "../lib/http";
import { getMatchWithEvents, listMatches, startMatch } from "../services/matches";

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

export default router;
