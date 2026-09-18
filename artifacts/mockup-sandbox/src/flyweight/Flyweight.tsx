import { useEffect, useRef, useState } from "react";
// BotSpec is a Zod schema — a runtime value as well as a type. Never `import type`.
import { BotSpec } from "@workspace/contract";
import type { Chassis } from "@workspace/contract";
import { ARENA_SIZE } from "@workspace/sim";
import { BrainLab } from "./BrainLab";
import { Fight } from "./Fight";
import { Landing } from "./Landing";
import { MoonStage } from "./MoonStage";
import type { StationName } from "./moonLayout";
import { RosterSelect } from "./RosterSelect";
import { DEFAULT_BOTS } from "./modules";
import { Campaign } from "./Campaign";
import { ROSTER } from "./roster";
import { go, useRoute } from "./route";
import { useMatch } from "./useMatch";
import "./flyweight.css";

/**
 * The champion closes out every matchup in about 15 seconds and the stock build has
 * never taken one off it — 0-12 across the demo seeds — so it is the boss you choose,
 * never the opponent you are handed. RUSHER is a peer: the stock build wins that one
 * 10-2 and the fight runs about 26 seconds, which is the length a stranger watches.
 */
const DEFAULT_OPPONENT = ROSTER.find((r) => r.bot.id === "hornet")!.bot;

/** The saved Brain Lab build, if it still satisfies the contract. */
function loadBuild(): BotSpec {
  try {
    const parsed = BotSpec.safeParse(JSON.parse(localStorage.getItem("flyweight.bot") || "null"));
    if (parsed.success) return parsed.data;
  } catch {
    /* fall through to the stock build */
  }
  return DEFAULT_BOTS[0];
}

export default function Flyweight() {
  const route = useRoute();
  const [build, setBuild] = useState<BotSpec>(loadBuild);
  const [p1, setP1] = useState<BotSpec>(build);
  const [p2, setP2] = useState<BotSpec>(DEFAULT_OPPONENT);
  const [round, setRound] = useState(0);
  const [squad, setSquad] = useState(1);
  const [labChassis, setLabChassis] = useState<Chassis>(build.chassis);

  const bots: [BotSpec, BotSpec] = [p1, p2];
  const onBots = useRef((next: [BotSpec, BotSpec]) => {
    setP1(next[0]);
    setP2(next[1]);
  }).current;

  // The match only exists on the fight screen, so it starts when you arrive —
  // which is the whole reason a stranger now sees a fight instead of a result.
  const match = useMatch(bots, round, squad, onBots);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  /**
   * Keep the ring alive.
   *
   * A match runs about twenty seconds and then the generator is done, the frame loop
   * stops, and the last frame stays on screen for ever. Walk up to the fight screen
   * a minute after it loaded and you find two fighters frozen mid-stride — which
   * reads, entirely reasonably, as "the limbs aren't moving". Give the result a beat
   * to be read, then run the next round.
   */
  useEffect(() => {
    if (route !== "/fight" || !match.result) return;
    // 4.2s was most of a round's worth of dead air. A match now runs about 11s
    // with roughly 2.4s of approach inside it, so a long pause on top meant the
    // ring was idle a third of the time and it read as nothing happening.
    const t = setTimeout(() => setRound((n) => n + 1), 2000);
    return () => clearTimeout(t);
  }, [route, match.result]);

  const startFight = () => {
    setRound((n) => n + 1);
    go("/fight");
  };

  // Hash routes survive as invisible deep links: they pick a camera station on
  // the one moon, they never swap a page. #/fight still flies to the ring.
  const station: StationName =
    // NOT ARRIVAL for the campaign: that station frames the landing, so the 3D
    // wordmark and ENTER sit in shot and bury the board. BAY looks across the
    // surface with none of that furniture in the way.
    route === "/fight" ? "RING" : route === "/" ? "ARRIVAL" : "BAY";

  return (
    <div className={`flyweight ${route === "/" ? "route-home" : `route${route.replace("/", "-")}`}`}>
      <div className="world-stage">
        <MoonStage
          // On the bench the moon shows the build being tuned, not the saved one —
          // otherwise picking a class changes nothing you can see.
          chassis={route === "/lab" ? labChassis : p1.chassis}
          station={station}
          frame={match.frame}
          fighters={bots}
        />
      </div>

      <main>
        {route === "/" && <Landing />}
        {route === "/select" && (
          <RosterSelect
            playerBuild={build}
            p1={p1}
            p2={p2}
            setP1={setP1}
            setP2={setP2}
            squad={squad}
            setSquad={setSquad}
            onNext={() => go("/lab")}
          />
        )}
        {route === "/campaign" && (
          <Campaign
            roundsCleared={round}
            onFight={startFight}
            onBench={() => go("/lab")}
          />
        )}
        {route === "/fight" && (
          <Fight
            bots={bots}
            match={match}
            round={round}
            squad={squad}
            onRematch={() => setRound((n) => n + 1)}
            onRoster={() => go("/select")}
          />
        )}
        {route === "/lab" && (
          <BrainLab
            bot={build}
            roundsCleared={round}
            onChassisChange={setLabChassis}
            onLaunch={(bot) => {
              // straight into a fight: the tuned brain becomes player one and the
              // round counter ticks, which is what makes useMatch start a new match
              setBuild(bot);
              setP1(bot);
              startFight();
            }}
            onRoster={(bot) => {
              setBuild(bot);
              setP1(bot);
              go("/select");
            }}
          />
        )}
      </main>

    </div>
  );
}
