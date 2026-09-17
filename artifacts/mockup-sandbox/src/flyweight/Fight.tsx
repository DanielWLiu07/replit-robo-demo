import { CHASSIS_STATS, MATCH_MAX_TICKS, SUDDEN_DEATH_TICK, TICK_HZ } from "@workspace/contract";
import type { ArenaBotState, BotSpec, NeuronModule } from "@workspace/contract";
import { profileBot } from "@workspace/sim";
import { BrainView } from "./BrainView";
import type { MatchState } from "./useMatch";

/**
 * Every unit on a side runs the same brain, so a population lights when any of them
 * fires it. That is what makes the 3D brain readable during a squad fight: you are
 * watching the circuit, not one individual.
 */
const teamSpikes = (units: ArenaBotState[]): NeuronModule[] => {
  const set = new Set<NeuronModule>();
  for (const u of units) for (const m of u.spiked) set.add(m);
  return [...set];
};

/** Mean across the squad, so the meters do not jump between individuals. */
const teamMean = (units: ArenaBotState[], pick: (u: ArenaBotState) => number) =>
  units.length ? units.reduce((s, u) => s + pick(u), 0) / units.length : 0;

/**
 * The character type, off the same `profileBot` the API serves on every bot —
 * one implementation, so the card on the roster and the chip in the fight can
 * never disagree about what a fly is.
 */
const CHARACTER = {
  aggression: { label: "BRAWLER", glyph: "▲" },
  evasion: { label: "EVADER", glyph: "◆" },
  tracking: { label: "HUNTER", glyph: "●" },
} as const;

function character(bot: BotSpec) {
  const p = profileBot(bot);
  const top = (["aggression", "evasion", "tracking"] as const).reduce((a, b) =>
    p[b] > p[a] ? b : a,
  );
  const { label, glyph } = CHARACTER[top];
  return { glyph, label: p.reflex > 62 ? `TWITCH ${label}` : label, profile: p };
}

const clock = (ticks: number) => {
  const seconds = Math.max(0, (MATCH_MAX_TICKS - ticks) / TICK_HZ);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    Math.floor(seconds % 60),
  ).padStart(2, "0")}`;
};

/** A row of pips per side: how many units are still standing, at a glance. */
function SquadHud({
  bot,
  units,
  squad,
  slot,
}: {
  bot: BotSpec;
  units: ArenaBotState[];
  squad: number;
  slot: 0 | 1;
}) {
  const perUnit = CHASSIS_STATS[bot.chassis].hull;
  // before the first frame arrives, show the squad at full strength
  const roster = units.length ? units : null;
  const total = roster ? roster.length : squad;
  const alive = roster ? roster.filter((u) => u.hull > 0).length : squad;
  const hull = roster ? roster.reduce((sum, u) => sum + Math.max(0, u.hull), 0) : perUnit * squad;

  return (
    <div className={`hud-hull hull-${slot}`}>
      <div className="hud-hull-head">
        <span className="bot-marker">{slot ? "B" : "A"}</span>
        <strong>{bot.name}</strong>
        <span className="mono">
          {hull.toFixed(0)}
          <small> / {perUnit * total}</small>
        </span>
      </div>
      <progress aria-label={`${bot.name} hull`} max={perUnit * total} value={hull} />
      <div className="hud-pips" aria-label={`${alive} of ${total} units standing`}>
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={i < alive ? "pip live" : "pip down"} />
        ))}
        <span className="hud-chassis mono">
          {bot.chassis} · {alive}/{total} UP
        </span>
      </div>
    </div>
  );
}

export function Fight({
  bots,
  match,
  round,
  squad,
  onRematch,
  onRoster,
}: {
  bots: [BotSpec, BotSpec];
  match: MatchState;
  round: number;
  squad: number;
  onRematch: () => void;
  onRoster: () => void;
}) {
  const { frame, result, paused, speed, setSpeed, togglePause } = match;
  const tick = frame?.tick ?? 0;
  const suddenDeath = tick >= SUDDEN_DEATH_TICK;
  const split = frame?.teamSplit ?? squad;
  const teamA = frame ? frame.bots.slice(0, split) : [];
  const teamB = frame ? frame.bots.slice(split) : [];

  return (
    <section className="fight-section">
      <div className="fight-hud">
        <SquadHud bot={bots[0]} units={teamA} squad={squad} slot={0} />
        <div className="hud-centre">
          <div className="hud-clock mono">{clock(tick)}</div>
          <div className="hud-round mono">ROUND {String(round + 1).padStart(2, "0")}</div>
          {suddenDeath && !result && (
            <div className="sudden-death mono" role="status">
              <i /> SUDDEN DEATH — WALLS CLOSING
            </div>
          )}
        </div>
        <SquadHud bot={bots[1]} units={teamB} squad={squad} slot={1} />
      </div>

      {result && (
        <div className="result-overlay glass" role="status">
          <span className="mono">{result.outcome.replaceAll("_", " ")}</span>
          <h3>
            {result.winnerBotId
              ? `${bots.find((b) => b.id === result.winnerBotId)?.name ?? "BOT"} WINS`
              : "DRAW"}
          </h3>
          <div className="result-actions">
            <button className="button primary" onClick={onRematch}>
              Rematch <span>↗</span>
            </button>
            <button className="button" onClick={onRoster}>
              Back to roster <span>↗</span>
            </button>
          </div>
        </div>
      )}

      <div className="fight-controls mono">
        <button onClick={togglePause} disabled={!!result}>
          {paused ? "▶ Resume" : "Ⅱ Pause"}
        </button>
        <button onClick={onRematch}>↻ New match</button>
        <select
          aria-label="Playback speed"
          value={speed}
          onChange={(e) => setSpeed(+e.target.value)}
        >
          <option value="1">1× speed</option>
          <option value="2">2× speed</option>
          <option value="4">4× speed</option>
        </select>
        <a href="#/select">← Roster</a>
      </div>

      {/* the arena canvas sits behind this screen; keep a window clear so the
          fight is actually visible instead of covered by instrumentation */}
      <div className="fight-viewport" aria-hidden="true" />

      <div className="fight-brains">
        {([0, 1] as const).map((slot) => {
          const units = slot ? teamB : teamA;
          const bot = bots[slot];
          const equipped = bot.brain.slots.map((s) => s.module);
          const arousal = teamMean(units, (u) => u.arousal);
          const fatigue = teamMean(units, (u) => u.gfFatigue);
          const stamina = teamMean(units, (u) => u.stamina ?? 1);
          // any unit with its arms up, or any unit caught in recovery
          const guarding = units.some((u) => u.guard > 0.45);
          const openNow = units.some((u) => u.recovery > 0);
          const who = character(bot);
          return (
            <div className={`fight-brain brain-${slot}`} key={slot}>
              <div className="fight-brain-head mono">
                <i className="char-glyph" aria-hidden="true">
                  {who.glyph}
                </i>
                <strong>{bot.name}</strong>
                <span className="char-type">{who.label}</span>
                <span className="char-cells">{who.profile.neuronCount} cells</span>
              </div>
              <BrainView equipped={equipped} spiked={teamSpikes(units)} height={104} />
              <div className="brain-meters mono">
                <div className="meter">
                  <span>AROUSAL</span>
                  <progress max={1.65} value={arousal} />
                  <b>{arousal.toFixed(2)}×</b>
                </div>
                <div className="meter">
                  <span>GF FATIGUE</span>
                  <progress max={1} value={fatigue} />
                  <b>{(fatigue * 100).toFixed(0)}%</b>
                </div>
                <div className="meter">
                  <span>STAMINA</span>
                  <progress max={1} value={stamina} />
                  <b>{(stamina * 100).toFixed(0)}%</b>
                </div>
                <div className="fight-state">
                  {/* the two states that decide every exchange: arms up, or caught open */}
                  <i className={guarding ? "state on" : "state"}>GUARD</i>
                  <i className={openNow ? "state warn" : "state"}>OPEN</i>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
