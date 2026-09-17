import { useState } from "react";
import {
  BRAIN_MAX_SLOTS,
  BRAIN_WEIGHT_BUDGET,
  BotSpec,
  BrainSpec,
  CHASSIS_STATS,
  Chassis,
  NeuronModule,
  type ModuleSlot,
} from "@workspace/contract";
import { CONNECTOME_MODULES, MODULES } from "./modules";
import { BrainView } from "./BrainView";
import { CHAMPION_CURVE } from "./champion";

function FitnessCurve() {
  const best = CHAMPION_CURVE.map((x) => x[0]),
    mean = CHAMPION_CURVE.map((x) => x[1]);
  const max = 32,
    min = -2,
    points = (values: readonly number[]) =>
      values
        .map(
          (v, i) => `${(i / 13) * 260},${58 - ((v - min) / (max - min)) * 50}`,
        )
        .join(" ");
  return (
    <div className="fitness">
      <div className="fitness-head">
        <span>FITNESS / UNSEEN SEEDS</span>
        <strong>13.20 → 30.82</strong>
      </div>
      <svg
        viewBox="0 0 260 64"
        role="img"
        aria-label="Champion fitness rises across fourteen generations"
      >
        <line x1="0" y1="58" x2="260" y2="58" />
        <polyline className="fitness-mean" points={points(mean)} />
        <polyline className="fitness-best" points={points(best)} />
      </svg>
      <div className="fitness-key">
        <span>— BEST</span>
        <span>· MEAN</span>
        <span>GEN 00—13</span>
      </div>
    </div>
  );
}
export function BrainLab({
  bot,
  onLaunch,
  onChassisChange,
}: {
  bot: BotSpec;
  onChassisChange: (chassis: Chassis) => void;
  onLaunch: (bot: BotSpec) => void;
}) {
  const [draft, setDraft] = useState<BotSpec>(bot);
  const [message, setMessage] = useState(
    "Drag a circuit into the chassis, or select + to add it.",
  );
  const used = draft.brain.slots.reduce((sum, s) => sum + s.weight, 0);
  const valid = BotSpec.safeParse(draft);
  const edit = (brain: BrainSpec) => setDraft({ ...draft, brain });
  const add = (module: NeuronModule) => {
    if (draft.brain.slots.some((s) => s.module === module)) {
      setMessage("That circuit is already installed.");
      return;
    }
    if (draft.brain.slots.length >= BRAIN_MAX_SLOTS) {
      setMessage(
        `All ${BRAIN_MAX_SLOTS} slots are occupied. Remove a circuit first.`,
      );
      return;
    }
    if (used + 1 > BRAIN_WEIGHT_BUDGET) {
      setMessage("Reduce a synaptic weight to free budget.");
      return;
    }
    edit({
      ...draft.brain,
      slots: [...draft.brain.slots, { module, weight: 1, threshold: 0.7 }],
    });
    setMessage(`${MODULES[module].label} installed.`);
  };
  const update = (index: number, change: Partial<ModuleSlot>) =>
    edit({
      ...draft.brain,
      slots: draft.brain.slots.map((s, i) =>
        i === index ? { ...s, ...change } : s,
      ),
    });
  return (
    <section id="lab" className="lab-section">
      <div className="section-label">
        <span>02 / BRAIN LAB</span>
        <span>BUILD BEHAVIOUR, NOT A SCRIPT</span>
      </div>
      <div className="section-heading">
        <h2>Wire a different instinct.</h2>
        <p>
          Five slots. Eight units of synaptic weight.
          <br />
          Every reflex has a cost.
        </p>
      </div>
      <div className="lab-specimen">
        <div className="lab-specimen-label mono">
          {draft.chassis} / LIVE CHASSIS STUDY
          <br />
          SIX LEGS. ONE NERVOUS SYSTEM.
        </div>
      </div>
      <BrainView equipped={draft.brain.slots.map((s) => s.module)} height={330} />
      <div className="boss-card glass">
        <div className="section-label"><span>BOSS / NEUROEVOLVED</span><span>14 GENERATIONS</span></div>
        <h3>CHAMPION <small>20W · 0L · 0D</small></h3>
        <p>Beats every hand-designed archetype on unseen seeds.</p>
        <FitnessCurve />
      </div>
      <div className="lab-grid">
        <div className="module-library">
          {CONNECTOME_MODULES.map(({ module, count, neurotransmitter, flywireType }) => (
            <button
              className="module-card"
              key={module}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/plain", module)}
              onClick={() => add(module)}
              disabled={draft.brain.slots.some((s) => s.module === module)}
            >
              <span className="module-symbol">
                {MODULES[module].action.slice(0, 1)}
              </span>
              <span>
                <strong>{MODULES[module].label}</strong>
                <small>
                  {MODULES[module].circuit} · {count} CELLS · {neurotransmitter === "glutamate" ? "GLU" : "ACH"}
                </small>
                <p>{MODULES[module].detail}<br /><em>{flywireType}</em></p>
              </span>
              <span className="module-add">+</span>
            </button>
          ))}
        </div>
        <div
          className="chassis-panel glass"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const result = NeuronModule.safeParse(
              e.dataTransfer.getData("text/plain"),
            );
            if (result.success) add(result.data);
          }}
        >
          <div className="section-label">
            <span>YOUR CHASSIS</span>
            <span>
              {draft.brain.slots.length}/{BRAIN_MAX_SLOTS} SLOTS
            </span>
          </div>
          <label className="field-label">
            Bot name
            <input
              value={draft.name}
              maxLength={24}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <div className="chassis-options">
            {Chassis.options.map((c) => (
              <button
                key={c}
                className={draft.chassis === c ? "selected" : ""}
                onClick={() => {
                  setDraft({ ...draft, chassis: c });
                  onChassisChange(c);
                }}
              >
                {c}
                <small>{CHASSIS_STATS[c].hull} HULL</small>
              </button>
            ))}
          </div>
          <div className="slots">
            {draft.brain.slots.map((slot, i) => (
              <div className="slot" key={slot.module}>
                <div className="slot-title">
                  <span className="mono">0{i + 1}</span>
                  <strong>{MODULES[slot.module].circuit}</strong>
                  <button
                    aria-label={`Remove ${MODULES[slot.module].label}`}
                    onClick={() =>
                      edit({
                        ...draft.brain,
                        slots: draft.brain.slots.filter((_, j) => j !== i),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
                <div className="slot-controls">
                  <label>
                    Gain <output>{slot.weight.toFixed(1)}</output>
                    <input
                      aria-label={`${MODULES[slot.module].label} gain`}
                      type="range"
                      min="0"
                      max={Math.min(
                        4,
                        BRAIN_WEIGHT_BUDGET - used + slot.weight,
                      )}
                      step="0.1"
                      value={slot.weight}
                      onChange={(e) => update(i, { weight: +e.target.value })}
                    />
                  </label>
                  <label>
                    Threshold <output>{slot.threshold.toFixed(1)}</output>
                    <input
                      aria-label={`${MODULES[slot.module].label} threshold`}
                      type="range"
                      min="0.1"
                      max="5"
                      step="0.1"
                      value={slot.threshold}
                      onChange={(e) =>
                        update(i, { threshold: +e.target.value })
                      }
                    />
                  </label>
                </div>
              </div>
            ))}
            {Array.from(
              { length: BRAIN_MAX_SLOTS - draft.brain.slots.length },
              (_, i) => (
                <div className="empty-slot" key={i}>
                  + Drop a neuron module
                </div>
              ),
            )}
          </div>
          <div className="budget">
            <span>SYNAPTIC BUDGET</span>
            <strong>
              {used.toFixed(1)} / {BRAIN_WEIGHT_BUDGET}
            </strong>
            <meter min="0" max={BRAIN_WEIGHT_BUDGET} value={used} />
          </div>
          <p className="lab-message" aria-live="polite">
            {!valid.success ? valid.error.issues[0].message : message}
          </p>
          <button
            className="button primary"
            disabled={!valid.success}
            onClick={() => {
              if (valid.success) {
                localStorage.setItem(
                  "flyweight.bot",
                  JSON.stringify(valid.data),
                );
                onLaunch(valid.data);
              }
            }}
          >
            Test this brain <span>↗</span>
          </button>
        </div>
      </div>
    </section>
  );
}
