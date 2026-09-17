import { WebSocket } from "ws";
const API = "http://localhost:5050";
const j = async (p: string, init?: RequestInit) => {
  const r = await fetch(API + p, init);
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const bots = await j("/api/bots");
const list = bots.body?.bots ?? [];
console.log(`bots available: ${list.length}`);
if (list.length < 2) { console.log("need 2 bots"); process.exit(1); }
const [a, b] = list;
console.log(`  A=${a.name} (${a.chassis})   B=${b.name} (${b.chassis})`);

const m = await j("/api/matches", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ botId: a.id, opponentBotId: b.id }) });
console.log(`POST /api/matches -> ${m.status}`);
if (m.status >= 400) { console.log("  " + JSON.stringify(m.body).slice(0, 300)); process.exit(1); }
const matchId = m.body?.match?.id ?? m.body?.id ?? m.body?.matchId;
console.log(`  matchId=${matchId}`);

await new Promise<void>((resolve) => {
  const ws = new WebSocket(`ws://localhost:5050/ws/match/${matchId}`);
  let frames = 0, hits = 0, spikes = 0, started = false, ended: any = null;
  const seen = new Set<string>();
  const t0 = Date.now();
  ws.on("open", () => console.log("websocket open"));
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "match_start") { started = true; console.log(`  match_start seed=${msg.seed}`); }
    if (msg.type === "frame") {
      frames++;
      hits += msg.frame.hits.length;
      for (const bot of msg.frame.bots) for (const s of bot.spiked) { spikes++; seen.add(s); }
      if (frames === 1) console.log(`  first frame: arenaHalf=${msg.frame.arenaHalf} bots=${msg.frame.bots.length}`);
    }
    if (msg.type === "match_end") { ended = msg.result; ws.close(); }
    if (msg.type === "error") { console.log("  ERROR " + msg.message); ws.close(); }
  });
  ws.on("close", () => {
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nstreamed ${frames} frames in ${secs}s`);
    console.log(`  hits=${hits}  spikes=${spikes}  modules seen=[${[...seen].join(", ")}]`);
    console.log(`  match_start received: ${started}`);
    console.log(`  result: ${ended ? `${ended.outcome} winner=${ended.winnerBotId} ticks=${ended.ticks}` : "NONE"}`);
    const ok = started && frames > 100 && spikes > 50 && ended;
    console.log(`\n${ok ? "END TO END WORKS" : "INCOMPLETE"}`);
    resolve();
  });
  ws.on("error", (e) => { console.log("  ws error: " + e.message); resolve(); });
  setTimeout(() => { try { ws.close(); } catch {} }, 120000);
});
