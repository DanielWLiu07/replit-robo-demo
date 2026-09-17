import { LeaderboardResponse } from "@workspace/contract";
import { Router, type IRouter } from "express";
import { getLeaderboard } from "../services/leaderboard";

const router: IRouter = Router();

router.get("/leaderboard", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json(LeaderboardResponse.parse({ rows: await getLeaderboard(limit) }));
});

export default router;
