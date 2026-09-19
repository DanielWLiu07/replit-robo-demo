import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import {
  ClientMessage,
  ServerMessage,
  TICK_HZ,
  type BotSpec,
  type MatchFrame,
  type MatchResult,
} from "@workspace/contract";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { logger } from "../lib/logger";
import { runMatch } from "../lib/matchRunner";
import { getMatchRow } from "../services/matches";

/**
 * Canonical path is `/ws/match/:id`. The `/api` prefix is accepted as well
 * because Replit's application router forwards by path prefix and `/api` is
 * the one prefix this service is guaranteed to own, so a deployment that
 * loses the `/ws` route still streams instead of hanging on connect.
 */
export const MATCH_WS_PATH = /^(?:\/api)?\/ws\/match\/([A-Za-z0-9_-]+)$/;

/** Stop shovelling frames at a socket that is already this far behind. */
const BACKPRESSURE_BYTES = 1 << 20;
const SEND_INTERVAL_MS = 1000 / TICK_HZ;

interface Stream {
  timer: NodeJS.Timeout | null;
  frames: Generator<MatchFrame, MatchResult, void>;
  speed: number;
  playing: boolean;
  lastAt: number;
  carry: number;
}

/**
 * Transport only. Every byte that leaves here was produced by the sim; this
 * file decides *when* to send, never *what* happened.
 */
export function attachMatchSocket(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    const match = MATCH_WS_PATH.exec(path);
    if (!match) {
      socket.destroy();
      return;
    }
    const matchId = match[1]!;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
      void openMatchStream(ws, matchId);
    });
  });

  return wss;
}

/**
 * Control messages are few and go through the schema on the way out, same as
 * everything else crossing a process boundary. Frames deliberately do not:
 * validating 5,400 of them per viewer would cost more than producing them, and
 * they come straight off a generator that is already typed against the contract.
 */
function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(ServerMessage.parse(message)));
}

/**
 * One BotSpec per *unit*, in the same order the frames use, so a renderer can
 * index straight from `frame.bots[i]` to the spec that produced it. Squad units
 * are suffixed `#0`, `#1`, ... exactly as the sim names them, two units off the
 * same design still need to be distinguishable on a spike raster.
 *
 * `teamSplit` is where team B begins, which for equal squads is the squad size.
 */
function deployedUnits(a: BotSpec, b: BotSpec, squadSize: number): BotSpec[] {
  if (squadSize === 1) return [a, b];
  const fan = (spec: BotSpec) =>
    Array.from({ length: squadSize }, (_, i) => ({ ...spec, id: `${spec.id}#${i}` }));
  return [...fan(a), ...fan(b)];
}

async function openMatchStream(ws: WebSocket, matchId: string): Promise<void> {
  // Setup below is async (one DB read), and `ws` drops 'message' events that
  // arrive before a listener exists. A client that sends `set_speed` in its
  // onopen handler is faster than our own setup, so buffer from tick zero and
  // drain once the stream is ready.
  const pending: RawData[] = [];
  let handle: ((raw: RawData) => void) | null = null;
  ws.on("message", (raw: RawData) => {
    if (handle) handle(raw);
    else pending.push(raw);
  });

  let row;
  try {
    row = await getMatchRow(matchId);
  } catch (err) {
    logger.debug({ err, matchId }, "ws: unknown match");
    send(ws, { type: "error", message: `No match ${matchId}` });
    ws.close(1008, "unknown match");
    return;
  }

  /**
   * "Watch" and "replay" are the same operation: re-run the sim from
   * `seed + snapshots` and pace it to the wall clock. Nothing about a fight is
   * ever stored as frames, and restarting the stream is just a fresh generator.
   */
  const newRun = () => runMatch(row.seed, row.botASpec, row.botBSpec, row.squadSize);

  // The persisted row is authoritative for the outcome, not the replay: if they
  // ever disagreed, the row is what the leaderboard was built from.
  const result: MatchResult = {
    matchId: row.id,
    seed: row.seed,
    winnerBotId: row.winnerBotId,
    survivors: row.survivors ?? undefined,
    outcome: row.outcome ?? "DRAW",
    ticks: row.ticks,
  };

  send(ws, {
    type: "match_start",
    matchId: row.id,
    seed: row.seed,
    bots: deployedUnits(row.botASpec, row.botBSpec, row.squadSize),
    teamSplit: row.squadSize,
  });

  const stream: Stream = {
    timer: null,
    frames: newRun(),
    speed: 1,
    playing: true,
    lastAt: Date.now(),
    carry: 0,
  };

  const stop = () => {
    if (stream.timer) clearInterval(stream.timer);
    stream.timer = null;
  };

  const pump = () => {
    if (ws.readyState !== WebSocket.OPEN) {
      stop();
      return;
    }
    const now = Date.now();
    const elapsed = now - stream.lastAt;
    stream.lastAt = now;
    if (!stream.playing) return;

    stream.carry += (elapsed * stream.speed) / SEND_INTERVAL_MS;
    const due = Math.floor(stream.carry);
    if (due <= 0) return;
    stream.carry -= due;

    // A viewer whose socket is congested gets the newest state rather than a
    // queue of stale ones: keep advancing the sim, send only the last of the
    // window. The fight stays on the wall clock either way.
    const congested = ws.bufferedAmount > BACKPRESSURE_BYTES;

    for (let i = 0; i < due; i++) {
      const step = stream.frames.next();
      if (step.done) {
        stop();
        send(ws, { type: "match_end", result });
        return;
      }
      if (!congested || i === due - 1) {
        ws.send(JSON.stringify({ type: "frame", frame: step.value }));
      }
    }
  };

  stream.timer = setInterval(pump, SEND_INTERVAL_MS);

  handle = (raw: RawData) => {
    let parsed;
    try {
      parsed = ClientMessage.safeParse(JSON.parse(String(raw)));
    } catch {
      send(ws, { type: "error", message: "message was not JSON" });
      return;
    }
    if (!parsed.success) {
      send(ws, { type: "error", message: "message failed ClientMessage validation" });
      return;
    }
    const msg = parsed.data;
    switch (msg.type) {
      case "play":
        // Restart from tick 0, a new generator, same seed, same fight.
        stream.frames = newRun();
        stream.speed = msg.speed;
        stream.playing = true;
        stream.lastAt = Date.now();
        stream.carry = 0;
        stream.timer ??= setInterval(pump, SEND_INTERVAL_MS);
        break;
      case "pause":
        stream.playing = false;
        break;
      case "set_speed":
        stream.speed = msg.speed;
        break;
      case "ping":
        break;
    }
  };
  for (const raw of pending) handle(raw);
  pending.length = 0;

  ws.on("close", stop);
  ws.on("error", (err) => {
    logger.debug({ err, matchId }, "ws error");
    stop();
  });
}
