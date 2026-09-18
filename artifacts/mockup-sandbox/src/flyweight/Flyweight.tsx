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
import { isUnspent, UNSPENT_BUILD } from "./modules";
import { Campaign } from "./Campaign";
import { CAMPAIGN_LEVELS, levelFor } from "./campaignLevels";
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

/**
 * The saved Brain Lab build, if it still satisfies the contract.
 *
 * With nothing saved this used to hand back GHOST — a fully solved brain with 166 of
 * the pool already spent on the player's behalf. A new player therefore never made
 * the build decision the lab exists for; they inherited someone else's and could
 * only nudge it. Now they start with the pool untouched and distribute it.
 */
function loadBuild(): BotSpec {
  try {
    const parsed = BotSpec.safeParse(JSON.parse(localStorage.getItem("flyweight.bot") || "null"));
    if (parsed.success) return parsed.data;
  } catch {
    /* fall through to an unspent build */
  }
  return UNSPENT_BUILD;
}

export default function Flyweight() {
  const route = useRoute();
  const [build, setBuild] = useState<BotSpec>(loadBuild);
  const [p1, setP1] = useState<BotSpec>(build);
  const [p2, setP2] = useState<BotSpec>(DEFAULT_OPPONENT);
  const [round, setRound] = useState(0);
  /**
   * Campaign progress, which is NOT the round counter.
   *
   * `round` ticks on every fight — it is what restarts the match — so using it
   * as progress advanced the board whether you won or lost, and the campaign
   * could be finished by losing five times. This counts fights actually won,
   * and a loss ends the run.
   */
  const [cleared, setCleared] = useState(0);
  /**
   * The result object already counted.
   *
   * This keyed on the round number, which is wrong in a way that took a
   * playtest to see: `round` increments when a fight STARTS, and at that moment
   * `match.result` still holds the PREVIOUS fight's result. So every fight was
   * scored one fight late against the next round's key — a win counted twice
   * and the loss that should have ended the run was ignored until the fight
   * after it. Identity is the honest key: a new fight produces a new object,
   * and a stale one is the same object and skipped.
   */
  const scored = useRef<unknown>(null);
  const [runLost, setRunLost] = useState(false);
  const [squad, setSquad] = useState(1);
  const [labChassis, setLabChassis] = useState<Chassis>(build.chassis);

  /**
   * The roster and the bench edit the SAME fighter.
   *
   * They used to edit two: the roster set `p1` while the bench read and wrote
   * `build`, so picking a class on one screen was invisible on the next. Routing
   * both through here keeps the saved build, the fighter that walks out, and the
   * body on the moon in step.
   */
  const setPlayer = (bot: BotSpec) => {
    setBuild(bot);
    setP1(bot);
    setLabChassis(bot.chassis);
  };

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
   * Score the campaign off the match result.
   *
   * Guarded by the round the result belongs to: `match.result` stays set for as
   * long as the fight screen is open, so without this a re-render would count
   * the same win repeatedly and walk the board to cleared on its own.
   */
  useEffect(() => {
    const result = match.result;
    if (!result || scored.current === result) return;
    scored.current = result;
    const won = result.winnerBotId === p1.id;
    if (won) setCleared((c) => Math.min(CAMPAIGN_LEVELS, c + 1));
    else setRunLost(true);
  }, [match.result, p1.id]);

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

  /** Start a campaign level: the opponent is whoever is waiting at that node. */
  const startCampaignRound = (level: number) => {
    setP2(levelFor(level).bot);
    setRunLost(false);
    startFight();
  };

  /**
   * #/fight is a deep link, and an unspent fly cannot fight.
   *
   * Every route INTO the ring passes through the bench, which refuses to release a
   * build with nothing spent — but the hash is typeable and survives a reload, so a
   * stranger who bookmarked the fight would otherwise watch an inert fly stand there
   * being hit and conclude the demo was broken. Send them to the bench instead,
   * which is where that build has to go anyway.
   */
  useEffect(() => {
    if (route === "/fight" && isUnspent(p1)) go("/lab");
  }, [route, p1]);

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
            setP1={setPlayer}
            setP2={setP2}
            squad={squad}
            setSquad={setSquad}
            onNext={() => go("/lab")}
          />
        )}
        {route === "/campaign" && (
          <Campaign
            roundsCleared={cleared}
            runLost={runLost}
            onRetry={() => { setCleared(0); setRunLost(false); }}
            onFight={startCampaignRound}
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
            cleared={cleared}
            onCampaign={() => go("/campaign")}
            onLab={() => go("/lab")}
          />
        )}
        {route === "/lab" && (
          <BrainLab
            bot={build}
            roundsCleared={cleared}
            onChassisChange={setLabChassis}
            onLaunch={(bot) => {
              // straight into a fight: the tuned brain becomes player one and the
              // round counter ticks, which is what makes useMatch start a new match
              setPlayer(bot);
              startFight();
            }}
            onRoster={(bot) => {
              setPlayer(bot);
              go("/select");
            }}
          />
        )}
      </main>

    </div>
  );
}
