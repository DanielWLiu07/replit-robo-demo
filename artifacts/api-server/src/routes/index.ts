import { Router, type IRouter } from "express";
import botsRouter from "./bots";
import healthRouter from "./health";
import ladderRouter from "./ladder";
import leaderboardRouter from "./leaderboard";
import matchesRouter from "./matches";
import trainRouter from "./train";
import meRouter from "./me";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(botsRouter);
router.use(matchesRouter);
router.use(leaderboardRouter);
router.use(trainRouter);
router.use(ladderRouter);

export default router;
