import {
  BrainRevision,
  CreateBotRequest,
  ListBotsResponse,
  UpdateBotRequest,
} from "@workspace/contract";
import { Router, type IRouter } from "express";
import { badRequest, parseBody } from "../lib/http";
import {
  createBot,
  deleteBot,
  listBots,
  listBrainRevisions,
  loadBot,
  loadBrainRevision,
  toBotDto,
  updateBot,
} from "../services/bots";

const router: IRouter = Router();

router.get("/bots", async (req, res) => {
  const loaded = await listBots(req.identity, { mineOnly: req.query.mine === "1" });
  res.json(
    ListBotsResponse.parse({
      bots: loaded.map(({ bot, brain }) => toBotDto(bot, brain, req.identity)),
    }),
  );
});

router.post("/bots", async (req, res) => {
  const input = parseBody(CreateBotRequest, req.body);
  const { bot, brain } = await createBot(req.identity, input);
  res.status(201).json(toBotDto(bot, brain, req.identity));
});

router.get("/bots/:id", async (req, res) => {
  const { bot, brain } = await loadBot(req.params.id);
  res.json(toBotDto(bot, brain, req.identity));
});

router.patch("/bots/:id", async (req, res) => {
  const input = parseBody(UpdateBotRequest, req.body);
  const { bot, brain } = await updateBot(req.identity, req.params.id, input);
  res.json(toBotDto(bot, brain, req.identity));
});

router.delete("/bots/:id", async (req, res) => {
  await deleteBot(req.identity, req.params.id);
  res.status(204).end();
});

// ── Brain revisions ──────────────────────────────────────────────────────────
// Append-only history. This is the endpoint that proves editing a bot doesn't
// rewrite the matches it already fought.

const toRevision = (r: { id: string; botId: string; version: number; spec: unknown; createdAt: Date }) =>
  BrainRevision.parse({
    id: r.id,
    botId: r.botId,
    version: r.version,
    spec: r.spec,
    createdAt: r.createdAt.toISOString(),
  });

router.get("/bots/:id/brains", async (req, res) => {
  await loadBot(req.params.id); // 404 before we return an empty list
  const revisions = await listBrainRevisions(req.params.id);
  res.json({ revisions: revisions.map(toRevision) });
});

router.get("/bots/:id/brains/:version", async (req, res) => {
  const version = Number(req.params.version);
  if (!Number.isInteger(version) || version < 1) {
    throw badRequest("version must be a positive integer");
  }
  const revision = await loadBrainRevision(req.params.id, version);
  res.json(toRevision(revision));
});

export default router;
