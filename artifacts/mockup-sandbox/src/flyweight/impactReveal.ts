import type { CompGraph } from "./vendor/blender-to-threejs/comp/builder";
import type { CompNode } from "./vendor/blender-to-threejs/comp/types";
import { valueNoise } from "./vendor/blender-to-threejs/comp/custom-nodes";

/**
 * The gouache reveal, ported from the casino scene's `impact-reveal`.
 *
 * A ragged radial wipe: broad ink lobes with a smaller torn edge, growing from a
 * point at the centre out past every corner. The pattern stays anchored while its
 * strength grows, so the reveal starts as a dot rather than a blotch, and the
 * front always outruns the roughness, which is what stops an already-revealed
 * pixel from being covered again as it expands.
 *
 * Drive `impactReturn` from 0 to 1; `impactNoise` (0..5) sets how torn the edge is.
 */
export function impactRevealMask(c: CompGraph): CompNode {
  const progress = c.uniform("impactReturn", 0);
  const amount = c.math("MINIMUM", 5, c.math("MAXIMUM", 0, c.uniform("impactNoise", 3)));
  // equal units on both axes, so the tear reads the same on wide and tall screens
  const uv = c.coords("uniform");
  const x = c.separate(uv, "r"),
    y = c.separate(uv, "g");
  const radius = c.math("SQRT", c.add(c.mul(x, x), c.mul(y, y)));
  const broad = c.subtract(valueNoise(c, uv, 3.8, [3.1, 7.7]), 0.5);
  const fine = c.subtract(valueNoise(c, uv, 18, [11.2, 4.6]), 0.5);
  const texture = c.add(c.mul(broad, 0.8), c.mul(fine, 0.2));
  const growingAmount = c.mul(amount, progress);
  const roughRadius = c.add(
    radius,
    c.mul(c.mul(c.math("MINIMUM", radius, 0.35), texture), growingAmount),
  );
  const reach = c.add(1.475, c.mul(growingAmount, 0.175));
  const t = c.math("DIVIDE", c.subtract(c.mul(progress, reach), roughRadius), 0.026, 0, {
    clamp: true,
  });
  return c.mul(c.mul(t, t), c.subtract(3, c.mul(t, 2)));
}
