import { ListTrainingRunsResponse, TrainRequest } from "@workspace/contract";
import { Router, type IRouter } from "express";
import { forbidden, parseBody } from "../lib/http";
import {
  getTrainingRun,
  listTrainingRuns,
  ownsRun,
  startTraining,
  toTrainingRunDto,
} from "../services/training";

const router: IRouter = Router();

/**
 * Starts a run and returns 202 immediately — evolution takes ~30 seconds of
 * solid CPU and does not belong on a request. Poll `GET /api/train/:id` and
 * watch `curve` grow a point per generation.
 */
router.post("/train", async (req, res) => {
  const input = parseBody(TrainRequest, req.body);
  res.status(202).json(await startTraining(req.identity, input));
});

router.get("/train", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  res.json(
    ListTrainingRunsResponse.parse({ runs: await listTrainingRuns(req.identity, limit) }),
  );
});

router.get("/train/:id", async (req, res) => {
  const row = await getTrainingRun(req.params.id);
  // A run is a private thing until it produces a bot; the bot is public.
  if (!ownsRun(req.identity, row)) throw forbidden("That training run isn't yours");
  res.json(toTrainingRunDto(row));
});

export default router;
