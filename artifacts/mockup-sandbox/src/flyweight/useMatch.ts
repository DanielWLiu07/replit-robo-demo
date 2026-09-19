import { useEffect, useRef, useState } from "react";
// ServerMessage is a Zod schema: a value as well as a type. Never `import type`.
import { ServerMessage, TICK_HZ } from "@workspace/contract";
import type { BotSpec, MatchFrame, MatchResult } from "@workspace/contract";
import { runMatch } from "@workspace/sim";

/** Ticks of spike history the rasters scroll through, six seconds at 60 Hz. */
export const SCOPE_WINDOW = 360;

export interface MatchState {
  frame: MatchFrame | null;
  history: MatchFrame[];
  result: MatchResult | null;
  status: string;
  paused: boolean;
  speed: number;
  setSpeed: (speed: number) => void;
  togglePause: () => void;
  live: boolean;
}

/**
 * Drives one match and returns everything the fight HUD renders.
 *
 * Two sources, one shape: a `?match=` id streams authoritative frames over the
 * websocket, and everything else runs the same deterministic generator locally
 * so the page fights even with no server. Restarts whenever `round` changes.
 */
export function useMatch(
  bots: [BotSpec, BotSpec],
  round: number,
  squadSize: number,
  onBots?: (bots: [BotSpec, BotSpec]) => void,
): MatchState {
  const [frame, setFrame] = useState<MatchFrame | null>(null);
  const [history, setHistory] = useState<MatchFrame[]>([]);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [status, setStatus] = useState("LOCAL SIMULATION");
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);

  const pauseRef = useRef(paused);
  const speedRef = useRef(speed);
  const botsRef = useRef(bots);
  const squadRef = useRef(squadSize);
  const onBotsRef = useRef(onBots);
  const socket = useRef<WebSocket | null>(null);
  useEffect(() => { pauseRef.current = paused; }, [paused]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { botsRef.current = bots; });
  useEffect(() => { squadRef.current = squadSize; });
  useEffect(() => { onBotsRef.current = onBots; });

  useEffect(() => {
    setFrame(null);
    setHistory([]);
    setResult(null);
    setPaused(false);
    let disposed = false;
    let raf = 0;

    const receive = (f: MatchFrame) => {
      if (disposed) return;
      setFrame(f);
      setHistory((previous) => [
        ...previous.filter((x) => x.tick < f.tick && x.tick >= f.tick - SCOPE_WINDOW),
        f,
      ]);
    };

    const matchId = new URLSearchParams(location.search).get("match");
    if (matchId) {
      setStatus("CONNECTING");
      const url = new URL(
        `${import.meta.env.BASE_URL}ws/match/${encodeURIComponent(matchId)}`,
        location.href,
      );
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url);
      socket.current = ws;
      ws.onopen = () => {
        setStatus("SERVER MATCH");
        ws.send(JSON.stringify({ type: "play", speed: speedRef.current }));
      };
      ws.onmessage = (e) => {
        try {
          const parsed = ServerMessage.safeParse(JSON.parse(e.data));
          if (!parsed.success) return setStatus("INVALID STREAM DATA");
          const m = parsed.data;
          if (m.type === "frame") receive(m.frame);
          // Every unit is listed; the two distinct loadouts are the team leads.
          else if (m.type === "match_start")
            onBotsRef.current?.([m.bots[0]!, m.bots[m.teamSplit]!]);
          else if (m.type === "match_end") {
            setResult(m.result);
            setStatus("MATCH COMPLETE");
          } else if (m.type === "error") setStatus(m.message);
        } catch {
          setStatus("INVALID STREAM DATA");
        }
      };
      ws.onerror = () => setStatus("CONNECTION UNAVAILABLE");
      ws.onclose = () => { if (!disposed) setStatus("STREAM CLOSED"); };
      return () => {
        disposed = true;
        socket.current = null;
        ws.close();
      };
    }

    setStatus("LOCAL SIMULATION");
    const generator = runMatch(
      `flyweight-demo-${round}`,
      botsRef.current[0],
      botsRef.current[1],
      squadRef.current,
    );
    let last = 0;
    let accumulator = 0;
    const tick = (now: number) => {
      if (disposed) return;
      if (last && !pauseRef.current) {
        accumulator += Math.min(now - last, 100) * speedRef.current;
      }
      last = now;
      while (accumulator >= 1000 / TICK_HZ) {
        accumulator -= 1000 / TICK_HZ;
        const next = generator.next();
        if (next.done) {
          setResult(next.value);
          setStatus("MATCH COMPLETE");
          return;
        }
        receive(next.value);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      generator.return({
        matchId: "", seed: "", winnerBotId: null, outcome: "DRAW", ticks: 0,
      });
    };
    // Restarting is what `round` means; bot edits arrive through botsRef.
  }, [round]);

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    if (socket.current?.readyState === 1) {
      socket.current.send(JSON.stringify(next ? { type: "pause" } : { type: "play", speed }));
    }
  };

  const changeSpeed = (value: number) => {
    setSpeed(value);
    if (socket.current?.readyState === 1) {
      socket.current.send(JSON.stringify({ type: "set_speed", speed: value }));
    }
  };

  return {
    frame, history, result, status, paused, speed,
    setSpeed: changeSpeed, togglePause, live: !!socket.current,
  };
}
