import { CAMPAIGN, CAMPAIGN_LEVELS } from "./campaignLevels";

/**
 * The campaign, as stations on the moon.
 *
 * Five levels laid along the surface rather than a list: the moon is already
 * behind every screen, so the run reads as a journey across it instead of a
 * menu on top of it. Each node is one round, the opponent is generated from
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

/** Titles and opponents come from the campaign itself, so the board cannot
 *  drift out of step with who is actually waiting at a node. */
const TITLES = CAMPAIGN.map((l) => l.title);
const FOES = CAMPAIGN.map((l) => l.bot);

export function Campaign({
  roundsCleared,
  runLost = false,
  onFight,
  onRetry,
  onBench,
}: {
  /** rounds already beaten */
  roundsCleared: number;
  /** the last fight was lost, so the run is over */
  runLost?: boolean;
  onFight: (round: number) => void;
  onRetry: () => void;
  onBench: () => void;
}) {
  const levels = Math.min(CAMPAIGN_LEVELS, STATIONS.length);
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
            : runLost
              ? `RUN OVER ON LEVEL ${next} · ${roundsCleared} CLEARED`
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
          const live = round === next && !done && !runLost;
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
              aria-label={`Level ${round}, ${TITLES[i]}, versus ${FOES[i]?.name}, ${cleared ? "cleared" : live ? "next" : "locked"}`}
            >
              <span className="node-dot" aria-hidden />
              <span className="node-round mono">{String(round).padStart(2, "0")}</span>
              <span className="node-title mono">{TITLES[i]}</span>
              {live && <span className="node-foe mono">vs {FOES[i]?.name}</span>}
            </button>
          );
        })}
      </div>

      <div className="select-actions">
        {runLost ? (
          <button className="button primary fight-button" onClick={onRetry}>
            RUN OVER · START AGAIN <span>↻</span>
          </button>
        ) : (
          <button className="button primary fight-button" onClick={() => onFight(next)} disabled={done}>
            {done ? "CAMPAIGN CLEARED" : `FIGHT LEVEL ${next} · ${FOES[next - 1]?.name}`} <span>→</span>
          </button>
        )}
        <button className="button" onClick={onBench}>
          ← BRAIN LAB
        </button>
      </div>
    </section>
  );
}
