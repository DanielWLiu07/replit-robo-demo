import { useEffect, useRef, useState } from "react";
// BotSpec is a Zod schema — a runtime value as well as a type. Never `import type`.
import { BotSpec } from "@workspace/contract";
import type { Chassis } from "@workspace/contract";
import { ARENA_SIZE } from "@workspace/sim";
import { Arena } from "./Arena";
import { BrainLab } from "./BrainLab";
import { Fight } from "./Fight";
import { Landing } from "./Landing";
import { MoonStage } from "./MoonStage";
import { RosterSelect } from "./RosterSelect";
import { DEFAULT_BOTS } from "./modules";
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
const DEFAULT_OPPONENT = ROSTER.find((r) => r.bot.id === "rusher")!.bot;

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

  const startFight = () => {
    setRound((n) => n + 1);
    go("/fight");
  };

  const stage =
    route === "/fight" ? (
      <Arena frame={match.frame} arenaSize={ARENA_SIZE} chassis={[p1.chassis, p2.chassis]} />
    ) : route === "/select" ? (
      <Arena frame={null} arenaSize={ARENA_SIZE} chassis={[p1.chassis, p2.chassis]} />
    ) : route === "/lab" ? (
      <Arena frame={null} showcase chassis={[labChassis, labChassis]} labChassis={labChassis} />
    ) : (
      <MoonStage chassis={p1.chassis} />
    );

  return (
    <div className={`flyweight ${route === "/" ? "route-home" : `route${route.replace("/", "-")}`}`}>
      <div className="world-stage">{stage}</div>

      <header className="topbar">
        <a className="wordmark" href="#/">
          F/W<span>FLYWEIGHT</span>
        </a>
        <nav aria-label="Main navigation">
          <a className={route === "/select" ? "current" : ""} href="#/select">
            Roster
          </a>
          <a className={route === "/fight" ? "current" : ""} href="#/fight">
            Arena
          </a>
          <a className={route === "/lab" ? "current" : ""} href="#/lab">
            Brain lab
          </a>
        </nav>
        <span className="edition mono">EXPERIMENT 001 / DROSOPHILA</span>
      </header>

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
            onFight={startFight}
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
            onChassisChange={setLabChassis}
            onLaunch={(bot) => {
              setBuild(bot);
              setP1(bot);
              go("/select");
            }}
          />
        )}
      </main>

      {route !== "/fight" && (
        <footer>
          <a className="wordmark" href="#/">
            F/W<span>FLYWEIGHT</span>
          </a>
          <span className="mono">BUILT WITH CURIOSITY. SETTLED IN THE ARENA.</span>
          <a href="#/select">CHOOSE A FIGHTER ↗</a>
        </footer>
      )}
    </div>
  );
}
