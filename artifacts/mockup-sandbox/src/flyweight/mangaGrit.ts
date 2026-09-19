import type { CompGraph } from "./vendor/blender-to-threejs/comp/builder";
import type { CompInput, CompNode } from "./vendor/blender-to-threejs/comp/types";
import { paperGrain } from "./vendor/blender-to-threejs/comp/custom-nodes";

/**
 * The night print: the manga screen run in negative, for a lit subject standing
 * in a dark room.
 *
 * `manga-comp` prints black ink on white paper, so coverage rises as the frame
 * gets DARKER. Inverting the page is not a matter of swapping the two colours,
 * that just prints a photographic negative. The tone itself has to be flipped,
 * so that coverage rises as the frame gets BRIGHTER and the halftone lands on
 * the lit side of the subject with the unlit room staying bare paper. Same
 * nesting property as the daylight version: layers are unioned, never
 * exchanged, so a stroke that exists at one tone exists at every brighter one.
 *
 * Grittier than the daylight print on purpose, a finer screen, tighter hatch
 * and a much heavier tooth, because grain reads as film on black where it
 * reads as paper on white.
 */
export interface MangaGritOptions {
  dotScale?: number;
  hatchScale?: number;
  /** the unlit room, linear */
  paper?: [number, number, number];
  /** the lit strokes, linear */
  ink?: [number, number, number];
  grain?: number;
}

const SCREEN_ANGLE = Math.PI / 4;

/** ramped over a tone window; these run BRIGHTWARD, so lo < hi. */
function brightward(c: CompGraph, tone: CompInput, lo: number, hi: number): CompNode {
  return c.mapRange(tone, { from: [lo, hi], to: [0, 1], clamp: true });
}

function clamp01(c: CompGraph, v: CompInput): CompNode {
  return c.math("MINIMUM", c.math("MAXIMUM", v, 0), 1);
}

function screenCell(c: CompGraph, px: CompNode, scale: number): CompNode {
  const x = c.separate(px, "r");
  const y = c.separate(px, "g");
  const cs = Math.cos(SCREEN_ANGLE);
  const sn = Math.sin(SCREEN_ANGLE);
  const rx = c.divide(c.subtract(c.mul(x, cs), c.mul(y, sn)), scale);
  const ry = c.divide(c.add(c.mul(x, sn), c.mul(y, cs)), scale);
  const cx = c.subtract(c.math("FRACT", rx), 0.5);
  const cy = c.subtract(c.math("FRACT", ry), 0.5);
  return c.math("SQRT", c.add(c.mul(cx, cx), c.mul(cy, cy)));
}

function hatchLines(c: CompGraph, px: CompNode, scale: number, flip: boolean): CompNode {
  const x = c.separate(px, "r");
  const y = c.separate(px, "g");
  const v = c.divide(flip ? c.subtract(x, y) : c.add(x, y), scale);
  const f = c.mul(c.math("ABSOLUTE", c.subtract(c.math("FRACT", v), 0.5)), 2);
  return c.mapRange(f, { from: [0.5, 0.88], to: [0, 1], clamp: true });
}

export function mangaGritGraph(c: CompGraph, opts: MangaGritOptions = {}): CompNode {
  const dotScale = opts.dotScale ?? 3.2;
  const hatchScale = opts.hatchScale ?? 2.8;
  const paper = opts.paper ?? [0.015, 0.015, 0.018];
  const ink = opts.ink ?? [0.93, 0.93, 0.9];

  const grit = c.uniform("grit", 0.62);
  const collapse = c.uniform("collapse", 0);

  const scene = c.renderLayer();
  const px = c.coords("pixel");

  // Flip the page: tone now rises with luminance, so the lit side of the
  // subject is what accumulates strokes and the dark room stays bare.
  const lum = c.mapRange(c.luminance(scene), { from: [0, 1], to: [0, 1.15], clamp: true });
  const tone = c.add(lum, c.mul(grit, 0.16));

  const dotRadius = c.mul(brightward(c, tone, 0.06, 0.72), 0.66);
  const d = screenCell(c, px, dotScale);
  const EDGE = 0.08;
  const t = c.divide(c.subtract(d, c.subtract(dotRadius, EDGE)), 2 * EDGE);
  const dots = c.subtract(1, clamp01(c, t));

  const hatchA = hatchLines(c, px, hatchScale, false);
  const hatchB = hatchLines(c, px, hatchScale * 1.22, true);

  const layerDots = c.mul(dots, brightward(c, tone, 0.05, 0.3));
  const layerA = c.mul(hatchA, brightward(c, tone, 0.26, 0.5));
  const layerB = c.mul(hatchB, brightward(c, tone, 0.44, 0.68));
  const layerSolid = brightward(c, tone, 0.74, 0.95);

  let cover: CompNode = c.math("MAXIMUM", layerDots, layerA);
  cover = c.math("MAXIMUM", cover, layerB);
  cover = c.math("MAXIMUM", cover, layerSolid);

  // Sobel on luminance still finds the silhouette, and on black it reads as a
  // chalk rim rather than an outline, which is what sells the darkness.
  const edges = c.filter(c.luminance(scene), "SOBEL");
  const edge = c.mapRange(c.separate(edges, "r"), { from: [0, 1.1], to: [0, 1], clamp: true });
  cover = c.math("MAXIMUM", cover, edge);

  cover = c.math("MAXIMUM", cover, collapse);
  cover = c.math("MINIMUM", cover, 1);

  const printed = c.mix("MIX", cover, c.rgb(...paper), c.rgb(...ink));
  const grain = opts.grain ?? 1;
  if (grain <= 0) return printed;
  return c.mix("ADD", c.mul(0.075, grain), printed, paperGrain(c));
}
