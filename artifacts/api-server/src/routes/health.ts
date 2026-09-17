import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { SIM_IS_STUB } from "../lib/matchRunner";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  // Surfaced deliberately: while the transport stub is in place, nobody should
  // be able to demo this and call it the connectome sim by accident.
  res.json({ ...data, sim: SIM_IS_STUB ? "stub" : "live" });
});

export default router;
