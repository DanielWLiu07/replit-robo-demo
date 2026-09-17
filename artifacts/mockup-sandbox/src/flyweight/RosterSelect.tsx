import { useState, type ReactElement } from "react";
import type { BotSpec, Chassis } from "@workspace/contract";
import { CHASSIS_STATS, MAX_SQUAD } from "@workspace/contract";
import { profileBot, type BotProfile } from "@workspace/sim";
import { MODULES } from "./modules";
import { ROSTER, type RosterEntry } from "./roster";

/** Top-down line silhouettes, one per chassis. Same ink language as the arena. */
function Silhouette({ chassis }: { chassis: Chassis }) {
  const shapes: Record<Chassis, ReactElement> = {
    DRONE: (
      <>
        <path d="M32 12 L38 20 L36 34 L28 34 L26 20 Z" />
        <path d="M36 18 L58 10 M36 24 L60 26" />
        <path d="M28 18 L6 10 M28 24 L4 26" />
        <circle cx="29" cy="15" r="1.6" />
        <circle cx="35" cy="15" r="1.6" />
      </>
    ),
    HORNET: (
      <>
        <path d="M32 9 L40 19 L38 36 L26 36 L24 19 Z" />
        <path d="M39 17 L59 8 L56 20 Z" />
        <path d="M25 17 L5 8 L8 20 Z" />
        <path d="M38 30 L52 34 M26 30 L12 34" />
        <circle cx="28.5" cy="14" r="1.8" />
        <circle cx="35.5" cy="14" r="1.8" />
      </>
    ),
    TANK: (
      <>
        <path d="M20 14 L44 14 L47 36 L17 36 Z" />
        <path d="M24 14 L24 36 M40 14 L40 36" />
        <path d="M44 20 L58 16 M20 20 L6 16" />
        <path d="M46 31 L57 33 M18 31 L7 33" />
        <circle cx="28" cy="19" r="2" />
        <circle cx="36" cy="19" r="2" />
      </>
    ),
  };
  return (
    <svg className="silhouette" viewBox="0 0 64 44" aria-hidden="true">
      {shapes[chassis]}
    </svg>
  );
}

function Bar({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={accent ? "stat-bar accent" : "stat-bar"}>
      <span className="stat-name">{label}</span>
      <span className="stat-track">
        <i style={{ width: `${value}%` }} />
      </span>
      <span className="stat-value">{String(value).padStart(3, "0")}</span>
    </div>
  );
}

function StatPanel({ entry, profile }: { entry: RosterEntry; profile: BotProfile }) {
  const stats = CHASSIS_STATS[entry.bot.chassis];
  return (
    <aside className="stat-panel glass">
      <div className="section-label">
        <span>{entry.boss ? "BOSS / NEUROEVOLVED" : "FIGHTER DOSSIER"}</span>
        <span>{entry.bot.chassis}</span>
      </div>
      <h3>{entry.bot.name}</h3>
      <p className="playstyle">{profile.playstyle}</p>

      <div className="stat-group-label mono">
        <span>BEHAVIOUR / FROM THE WIRING</span>
      </div>
      <Bar label="AGGRESSION" value={profile.aggression} />
      <Bar label="EVASION" value={profile.evasion} />
      <Bar label="TRACKING" value={profile.tracking} />
      <Bar label="REFLEX" value={profile.reflex} accent />

      <div className="stat-group-label mono">
        <span>CHASSIS / FROM THE FRAME</span>
        <span>
          {stats.hull} HULL · {stats.accel} ACC · {stats.turn} TURN
        </span>
      </div>
      <Bar label="HULL" value={profile.hull} />
      <Bar label="SPEED" value={profile.speed} />
      <Bar label="AGILITY" value={profile.agility} />

      <div className="brain-size">
        <span className="mono">BRAIN SIZE</span>
        <strong>{profile.neuronCount.toLocaleString()}</strong>
        <span className="mono">REAL CELLS / FLYWIRE 783</span>
      </div>

      <ul className="module-readout">
        {profile.modules.map((m) => (
          <li key={m.module}>
            <span className="readout-circuit">{MODULES[m.module].circuit}</span>
            <span className="readout-cells mono">{m.cells} CELLS</span>
            <span className={m.transmitter === "glutamate" ? "readout-tx glu" : "readout-tx"}>
              {m.transmitter === "glutamate" ? "GLU" : "ACH"}
            </span>
            <span className="readout-weight mono">×{m.weight.toFixed(1)}</span>
          </li>
        ))}
      </ul>
      <p className="stat-footnote">
        These bars are read off the equipped circuits and the chassis — the same numbers
        that drive the fight, not decoration.
      </p>
    </aside>
  );
}

function Plate({ entry, slot }: { entry: RosterEntry; slot: 0 | 1 }) {
  const profile = profileBot(entry.bot);
  return (
    <div className={`vs-plate plate-${slot}`}>
      <div className="plate-head">
        <span className="bot-marker">{slot ? "B" : "A"}</span>
        <span className="mono">{slot ? "P2 / OPPONENT" : "P1 / YOU"}</span>
      </div>
      <Silhouette chassis={entry.bot.chassis} />
      <strong>{entry.bot.name}</strong>
      <small className="mono">
        {entry.bot.chassis} · {profile.neuronCount} CELLS
      </small>
      <p>{profile.playstyle}</p>
    </div>
  );
}

export function RosterSelect({
  playerBuild,
  p1,
  p2,
  setP1,
  setP2,
  squad,
  setSquad,
  onNext,
}: {
  playerBuild: BotSpec;
  p1: BotSpec;
  p2: BotSpec;
  setP1: (bot: BotSpec) => void;
  setP2: (bot: BotSpec) => void;
  squad: number;
  setSquad: (n: number) => void;
  /** advance to the brain lab — the roster never starts a fight itself */
  onNext: () => void;
}) {
  const [highlight, setHighlight] = useState(0);

  // Three models, three chassis, three cards. The saved build used to sit here
  // as a fourth entry, which made "pick a class" and "reuse what I tuned" the
  // same control; the bench is where a build gets tuned, this is where a class
  // gets chosen.
  const entries: RosterEntry[] = ROSTER;
  const active = entries[highlight] ?? entries[0];
  const profile = profileBot(active.bot);

  /**
   * One seat to fill. The opponent is not picked here any more — the campaign
   * generates it from the round you are on — so this screen is only ever about
   * your own fighter, and clicking a card no longer silently flips you into
   * "now choose their bot" mode.
   */
  const choose = (entry: RosterEntry) => setP1(entry.bot);

  return (
    <section className="select-section">
      <div className="section-label">
        <a className="back-link" href="#/">
          ← Back
        </a>
        <span>01 / ROSTER SELECT</span>
        <span className="mono">YOUR FIGHTER</span>
      </div>
      <div className="section-heading">
        <h2>Roster Select</h2>
      </div>

      <div className="select-grid">
        <div className="roster-cards">
          {entries.map((entry, i) => {
            const isP1 = entry.bot.id === p1.id;
            return (
              <button
                key={entry.bot.id}
                className={[
                  "roster-card",
                  i === highlight ? "highlighted" : "",
                  isP1 ? "taken-p1" : "",
                  entry.boss ? "boss" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseEnter={() => setHighlight(i)}
                onFocus={() => setHighlight(i)}
                onClick={() => choose(entry)}
                aria-label={`Select ${entry.bot.name} as your fighter`}
              >
                {isP1 && <span className="card-slot mono">SELECTED</span>}
                {entry.boss && <span className="boss-flag mono">BOSS</span>}
                <Silhouette chassis={entry.bot.chassis} />
                <strong>{entry.bot.name}</strong>
                <small className="mono">{entry.bot.chassis}</small>
                <em className="mono">{entry.tag}</em>
              </button>
            );
          })}
        </div>
        <StatPanel entry={active} profile={profile} />
      </div>

      <div className="select-actions">
        <div className="squad-stepper">
          <button
            aria-label="Fewer units per side"
            onClick={() => setSquad(Math.max(1, squad - 1))}
            disabled={squad <= 1}
          >
            −
          </button>
          <span className="squad-count">
            <strong>{squad}</strong>
            <small className="mono">v{squad}</small>
          </span>
          <button
            aria-label="More units per side"
            onClick={() => setSquad(Math.min(MAX_SQUAD, squad + 1))}
            disabled={squad >= MAX_SQUAD}
          >
            +
          </button>
        </div>
        <button className="button primary fight-button" onClick={onNext}>
          Next · Brain lab <span>→</span>
        </button>
      </div>
    </section>
  );
}
