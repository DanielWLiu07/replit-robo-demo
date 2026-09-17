import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { SIM_IS_STUB } from "./lib/matchRunner";
import { stopAllTraining } from "./services/training";
import { attachMatchSocket } from "./ws/matchSocket";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// REST and the match socket share one listener: Replit's autoscale router gives
// the deployment a single port, and `/ws/match/:id` upgrades on it.
const server = createServer(app);
attachMatchSocket(server);

// 0.0.0.0 explicitly: the container forwards to the published port from outside
// the namespace, and a loopback-only bind is invisible to it.
server.listen(port, "0.0.0.0", () => {
  logger.info(
    { port, ws: "/ws/match/:id", sim: SIM_IS_STUB ? "stub" : "live" },
    "FLYWEIGHT api listening",
  );
});

server.on("error", (err) => {
  logger.error({ err }, "server error");
  process.exit(1);
});

const shutdown = (signal: string) => () => {
  logger.info({ signal }, "shutting down");
  stopAllTraining();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGTERM", shutdown("SIGTERM"));
process.on("SIGINT", shutdown("SIGINT"));
