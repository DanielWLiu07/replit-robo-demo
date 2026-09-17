export const K_FACTOR = 24;

/** Standard Elo. score: 1 win, 0.5 draw, 0 loss. */
export function eloDelta(
  rating: number,
  opponentRating: number,
  score: number,
  k = K_FACTOR,
): number {
  const expected = 1 / (1 + 10 ** ((opponentRating - rating) / 400));
  return Math.round(k * (score - expected));
}
