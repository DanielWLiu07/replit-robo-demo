import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);

export default router;
