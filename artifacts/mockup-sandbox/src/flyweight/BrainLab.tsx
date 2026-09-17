import { useMemo, useRef, useState } from "react";
import {
  BODY_BY_CHASSIS,
  BotSpec,
  CHASSIS_STATS,
  Chassis,
  type BodySpec,
} from "@workspace/contract";
import {
  REFRACTORY_WINS,
  bestRefractory,
  bodyMechanics,
  profileBot,
  solveBrain,
  tuneBody,
  type TuneStep,
} from "@workspace/sim";
import { CHAMPION_BRAIN } from "./modules";
import { go } from "./route";

/** The four things you can actually change about a body, with their units. */
const DIALS = [
  { key: "mass", label: "MASS", unit: "kg", min: 48, max: 124, step: 1, dp: 0,
    note: "Heavier hits harder and accelerates worse — leg force grows as M^⅔, mass as M." },
  { key: "reach", label: "REACH", unit: "m", min: 0.4, max: 0.76, step: 0.01, dp: 2,
    note: "Shoulder to fist. Longer arms reach further and swing slower: inertia goes with L²." },
  { key: "torque", label: "SHOULDER", unit: "N·m", min: 55, max: 200, step: 1, dp: 0,
    note: "What drives the swing. The only dial that buys fist speed without costing you range." },
  { key: "stance", label: "STANCE", unit: "m", min: 0.24, max: 0.64, step: 0.01, dp: 2,
    note: "Feet apart. A wide base is hard to knock over and slow to turn — same parameter, both ways." },
] as const;

const pctDelta = (mine: number, stock: number) => (mine / stock - 1) * 100;

/** A measured readout: the number, and how far it sits from the stock build. */
function Derived({ label, value, unit, delta, better }: {
  label: string; value: string; unit: string; delta: number; better: "up" | "down";
}) {
  const moved = Math.abs(delta) >= 0.5;
  const good = better === "up" ? delta > 0 : delta < 0;
  return (
    <div className="derived-row">
      <span className="derived-label">{label}</span>
      <span className="derived-value">{value}<em>{unit}</em></span>
      <span className={`derived-delta ${!moved ? "flat" : good ? "up" : "down"}`}>
        {!moved ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(0)}%`}
      </span>
    </div>
  );
}

/** The measured refractory sweep, drawn under its own slider. */
function RefractoryCurve({ value }: { value: number }) {
  const max = Math.max(...REFRACTORY_WINS.map(([, w]) => w));
  const span = 30;
  const pts = REFRACTORY_WINS
    .map(([t, w]) => `${(t / span) * 100},${28 - (w / max) * 26}`)
    .join(" ");
  return (
    <svg className="sweep" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} />
      <line x1={(value / span) * 100} y1="0" x2={(value / span) * 100} y2="30" className="sweep-now" />
    </svg>
  );
}

export function BrainLab({
  bot,
  onLaunch,
  onRoster,
  onChassisChange,
}: {
  bot: BotSpec;
  onChassisChange: (chassis: Chassis) => void;
  onLaunch: (bot: BotSpec) => void;
  onRoster: (bot: BotSpec) => void;
}) {
  const [draft, setDraft] = useState<BotSpec>(bot);
  const [tune, setTune] = useState<TuneStep | null>(null);
  const running = useRef(false);

  const body = draft.body ?? BODY_BY_CHASSIS[draft.chassis];
  const stockBuild = BODY_BY_CHASSIS[draft.chassis];
  const mech = useMemo(() => bodyMechanics(body), [body]);
  const stock = useMemo(() => bodyMechanics(stockBuild), [stockBuild]);
  const profile = useMemo(() => profileBot(draft), [draft]);
  const valid = BotSpec.safeParse(draft);

  const setBody = (patch: Partial<BodySpec>) =>
    setDraft((d) => ({ ...d, body: { ...(d.body ?? BODY_BY_CHASSIS[d.chassis]), ...patch } }));

  /** Re-solve the wiring from three instinct targets — no circuit shopping. */
  const setInstinct = (key: "aggression" | "evasion" | "tracking", v: number) => {
    const t = { aggression: profile.aggression, evasion: profile.evasion, tracking: profile.tracking, [key]: v };
    const sol = solveBrain(t, { leak: draft.brain.membraneLeak, refractory: draft.brain.refractoryTicks });
    setDraft((d) => ({ ...d, brain: sol.brain }));
  };
  const setNerve = (patch: { leak?: number; refractory?: number }) =>
    setDraft((d) => ({
      ...d,
      brain: {
        ...d.brain,
        membraneLeak: patch.leak ?? d.brain.membraneLeak,
        refractoryTicks: patch.refractory ?? d.brain.refractoryTicks,
      },
    }));

  /**
   * Hand the search to the arena.
   *
   * One candidate per animation frame: each costs a few real matches, so running
   * the whole climb in one go would lock the page for a couple of seconds. Stepping
   * it also means the sliders visibly move as it finds things, which is the part
   * worth watching.
   */
  const optimise = () => {
    if (running.current) return;
    running.current = true;
    const g = tuneBody({ ...draft, body }, CHAMPION_BRAIN, { seeds: 2, passes: 2 });
    const step = () => {
      const r = g.next();
      if (r.done) {
        setDraft((d) => ({ ...d, body: r.value.body }));
        setTune(null);
        running.current = false;
        return;
      }
      setTune(r.value);
      setDraft((d) => ({ ...d, body: r.value.best }));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const commit = (next: BotSpec, then: (b: BotSpec) => void) => {
    localStorage.setItem("flyweight.bot", JSON.stringify(next));
    then(next);
  };

  const hull = Math.round(CHASSIS_STATS[draft.chassis].hull * (body.mass / stockBuild.mass));

  return (
    <section id="lab" className="bench">
      <div className="bench-panel glass">
        <div className="bench-top">
          <button className="back" onClick={() => go("/")}>← BACK</button>
          <span className="mono">BENCH</span>
        </div>

        <div className="bench-id">
          <input
            value={draft.name}
            maxLength={24}
            aria-label="Bot name"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <div className="class-row">
            {Chassis.options.map((c) => (
              <button
                key={c}
                className={draft.chassis === c ? "on" : ""}
                onClick={() => {
                  // Switching class adopts that class's stock body, so the dials below
                  // describe the thing now standing on the moon.
                  setDraft((d) => ({ ...d, chassis: c, body: BODY_BY_CHASSIS[c] }));
                  onChassisChange(c);
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="bench-group">
          <h3>BODY</h3>
          {DIALS.map((d) => (
            <label className="dial" key={d.key} title={d.note}>
              <span className="dial-name">{d.label}</span>
              <span className="dial-read">
                {body[d.key].toFixed(d.dp)}<em>{d.unit}</em>
              </span>
              <input
                type="range"
                min={d.min}
                max={d.max}
                step={d.step}
                value={body[d.key]}
                aria-label={d.label}
                onChange={(e) => setBody({ [d.key]: +e.target.value })}
              />
            </label>
          ))}
        </div>

        <div className="bench-group">
          <h3>WHAT THAT BUILDS<small>vs stock {draft.chassis}</small></h3>
          <Derived label="FIST SPEED" value={mech.tipSpeed.toFixed(1)} unit="m/s"
                   delta={pctDelta(mech.tipSpeed, stock.tipSpeed)} better="up" />
          <Derived label="IMPACT" value={mech.impactEnergy.toFixed(0)} unit="J"
                   delta={pctDelta(mech.impactEnergy, stock.impactEnergy)} better="up" />
          <Derived label="STRIKE RANGE" value={(0.6 + mech.reach).toFixed(2)} unit="m"
                   delta={pctDelta(mech.reach, stock.reach)} better="up" />
          <Derived label="ACCELERATION" value={(mech.accel / stock.accel).toFixed(2)} unit="×"
                   delta={pctDelta(mech.accel, stock.accel)} better="up" />
          <Derived label="TURN RATE" value={(mech.turn / stock.turn).toFixed(2)} unit="×"
                   delta={pctDelta(mech.turn, stock.turn)} better="up" />
          <Derived label="TIPS OVER AT" value={(mech.knockdownAngle * 57.3).toFixed(0)} unit="°"
                   delta={pctDelta(mech.knockdownAngle, stock.knockdownAngle)} better="up" />
          <Derived label="HULL" value={String(hull)} unit=""
                   delta={pctDelta(body.mass, stockBuild.mass)} better="up" />
          <p className="bench-note">
            Nothing here is a setting. Each number falls out of the four measurements
            above by the same mechanics that govern a real arm, so a gain in one is
            paid for somewhere you did not choose.
          </p>
        </div>

        <div className="bench-group">
          <h3>INSTINCT</h3>
          {([
            ["PRESSURE", "aggression"],
            ["EVASION", "evasion"],
            ["TRACKING", "tracking"],
          ] as const).map(([label, key]) => (
            <label className="dial" key={key}>
              <span className="dial-name">{label}</span>
              <span className="dial-read">{profile[key]}</span>
              <input
                type="range" min="0" max="100" step="1"
                value={profile[key]}
                aria-label={label}
                onChange={(e) => setInstinct(key, +e.target.value)}
              />
            </label>
          ))}
          <label className="dial with-sweep">
            <span className="dial-name">RECOVERY</span>
            <span className="dial-read">{draft.brain.refractoryTicks}<em>ticks</em></span>
            <RefractoryCurve value={draft.brain.refractoryTicks} />
            <input
              type="range" min="0" max="30" step="1"
              value={draft.brain.refractoryTicks}
              aria-label="Recovery"
              onChange={(e) => setNerve({ refractory: +e.target.value })}
            />
          </label>
          <p className="bench-note">
            The curve is 216 measured matches — identical brains, only this dial moved.
            It peaks at {bestRefractory()}.
          </p>
        </div>

        <div className="bench-actions">
          <button className="button" onClick={optimise} disabled={!!tune}>
            {tune ? `OPTIMISING ${Math.round((tune.done / tune.total) * 100)}%` : "OPTIMISE"}
          </button>
          <button
            className="button"
            onClick={() => setDraft((d) => ({ ...d, body: BODY_BY_CHASSIS[d.chassis] }))}
          >
            RESET
          </button>
        </div>
        {tune && (
          <div className="bench-progress">
            <i style={{ width: `${(tune.done / tune.total) * 100}%` }} />
            <small>fighting the champion · margin {tune.bestScore.toFixed(2)}</small>
          </div>
        )}

        <div className="bench-actions go">
          <button className="button primary" disabled={!valid.success}
                  onClick={() => valid.success && commit(valid.data, onLaunch)}>
            FIGHT ↗
          </button>
          <button className="button" disabled={!valid.success}
                  onClick={() => valid.success && commit(valid.data, onRoster)}>
            OPPONENT →
          </button>
        </div>
      </div>
    </section>
  );
}
