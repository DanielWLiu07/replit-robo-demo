import { LADDER_CLEAR_ROUND } from "@workspace/contract";

/**
 * The campaign, as stations on the moon.
 *
 * Five levels laid along the surface rather than a list: the moon is already
 * behind every screen, so the run reads as a journey across it instead of a
 * menu on top of it. Each node is one round — the opponent is generated from
 * (runSeed, round) server-side, so a node is a real fight, not a label.
 *
 * Progress is the only gate. Cleared nodes stay lit behind you, the next one is
 * live, and the rest are dark: you can see the whole run from the start, which
 * is the point of a board over a list.
 */

/** Where each level sits, as a percentage of the stage. Hand-placed along the
 *  moon's horizon so the path curves with the surface rather than cutting it. */
const STATIONS: { x: number; y: number }[] = [
  { x: 14, y: 70 },
  { x: 31, y: 52 },
  { x: 50, y: 43 },
  { x: 69, y: 50 },
  { x: 86, y: 66 },
];

const TITLES = ["FIRST CONTACT", "THE SWARM", "DEEP CRATER", "THE WALL", "CHAMPION"];

export function Campaign({
  roundsCleared,
  onFight,
  onBench,
}: {
  /** rounds already beaten */
  roundsCleared: number;
  onFight: (round: number) => void;
  onBench: () => void;
}) {
  const levels = Math.min(LADDER_CLEAR_ROUND, STATIONS.length);
  const next = Math.min(roundsCleared + 1, levels);
  const done = roundsCleared >= levels;

  return (
    <section className="campaign">
      <div className="section-label">
        <a className="back-link" href="#/select">
          ← Roster
        </a>
      </div>

      <div className="campaign-head">
        <h2>Campaign</h2>
        <p className="mono">
          {done
            ? `CLEARED · ${levels} / ${levels}`
            : `LEVEL ${next} OF ${levels} · ${roundsCleared} CLEARED`}
        </p>
      </div>

      <div className="campaign-map" role="list">
        {/* the path first, so the nodes sit on top of it */}
        <svg className="campaign-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {STATIONS.slice(0, levels - 1).map((s, i) => {
            const b = STATIONS[i + 1]!;
            return (
              <line
                key={i}
                x1={s.x} y1={s.y} x2={b.x} y2={b.y}
                className={i < roundsCleared ? "walked" : ""}
              />
            );
          })}
        </svg>

        {STATIONS.slice(0, levels).map((s, i) => {
          const round = i + 1;
          const cleared = round <= roundsCleared;
          const live = round === next && !done;
          return (
            <button
              key={round}
              role="listitem"
              className={["campaign-node", cleared ? "cleared" : "", live ? "live" : ""]
                .filter(Boolean)
                .join(" ")}
              style={{ left: `${s.x}%`, top: `${s.y}%` }}
              disabled={!live}
              onClick={() => live && onFight(round)}
              aria-label={`Level ${round}, ${TITLES[i]}, ${cleared ? "cleared" : live ? "next" : "locked"}`}
            >
              <span className="node-dot" aria-hidden />
              <span className="node-round mono">{String(round).padStart(2, "0")}</span>
              <span className="node-title mono">{TITLES[i]}</span>
            </button>
          );
        })}
      </div>

      <div className="select-actions">
        <button className="button primary fight-button" onClick={() => onFight(next)} disabled={done}>
          {done ? "CAMPAIGN CLEARED" : `FIGHT LEVEL ${next}`} <span>→</span>
        </button>
        <button className="button" onClick={onBench}>
          ← BRAIN LAB
        </button>
      </div>
    </section>
  );
}
