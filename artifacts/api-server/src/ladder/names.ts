/**
 * Deterministic names for generated flies. Same (seed, round) gives the same
 * name, so a shared run reads identically for everyone who opens it.
 */
const ADJECTIVES = [
  "ANGRY", "BLIND", "BRISK", "CRUDE", "DIZZY", "EAGER", "FERAL", "GRIM",
  "HOLLOW", "IDLE", "JITTERY", "KEEN", "LUCID", "MANIC", "NERVY", "ODD",
  "PALE", "QUICK", "RABID", "STARK", "TWITCHY", "VAGRANT", "WIRED", "ZEALOUS",
];
const NOUNS = [
  "MIDGE", "GNAT", "DRONE", "MOTE", "SPECK", "HUSK", "WISP", "THORN",
  "SHARD", "EMBER", "SPUR", "CINDER", "FLECK", "BRISTLE", "STING", "MITE",
];

export function opponentName(rng: () => number, round: number): string {
  const a = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)]!;
  const n = NOUNS[Math.floor(rng() * NOUNS.length)]!;
  // Round number keeps names unique within a run even on a collision.
  return `${a} ${n} ${round}`.slice(0, 24);
}
