/**
 * Manga print: a compositor graph that prints a rendered frame as a page of
 * black-and-white manga (fidelity: exact per node; the look is a composition of
 * Blender nodes, no custom node in the screen itself).
 *
 * Sources, and what each one contributes
 * --------------------------------------
 * Praun, Hoppe, Webb and Finkelstein, "Real-Time Hatching", SIGGRAPH 2001
 * (https://hhoppe.com/hatching.pdf). The paper's central idea is the NESTING
 * PROPERTY of a Tonal Art Map, in its own words: "all strokes in a texture image
 * (l, t) appear in the same place in all the darker images of the same
 * resolution and in all the finer images of the same tone". Strokes are added as
 * tone darkens, never exchanged. Their reason is coherence: without it, strokes
 * swim and pop as tone changes, and the paper measures that as the failure mode
 * of the earlier art-map work it builds on.
 *
 * That is the one thing this graph does differently from the hand-written
 * manga-pass primitive next door, which selects a band per tone:
 *
 *     Lg > 0.72 -> paper        Lg > 0.42 -> dots        Lg > 0.2 -> hatch
 *
 * so crossing 0.42 EXCHANGES the dots for hatch rather than adding hatch to
 * them. Here ink coverage is the UNION of the stroke layers, each fading in over
 * its own tone range, so a stroke that exists at one tone still exists at every
 * darker tone. `nesting.test.ts` asserts exactly that as a monotonicity check.
 *
 * The 45 degree screen angle is the print convention for a single black screen,
 * where the dot grid is least conspicuous to the eye (colour work splits the
 * other inks to 15 / 75 / 0 around it). Manga screentone is the same halftone
 * idea sold as adhesive sheets, graded by dot frequency and percentage.
 *
 * Praun et al. choose OBJECT-space coherence and warn that image-space gives the
 * "shower-door effect", the illusion of viewing the scene through a sheet of
 * semi-transmissive glass with the strokes embedded in it. This graph is
 * deliberately image-space anyway, because for this style the shower door is the
 * correct answer: manga screentone is laid on the printed PAGE, not wrapped
 * around the subject, and the paper's objection is about conveying 3D form,
 * which is not the job here. Their other observation about image-space is a
 * straight win for us: it "makes it easier to maintain the relatively constant
 * stroke width that one expects of a drawing".
 */
import type { CompGraph } from '../comp/builder';
import type { CompInput, CompNode } from '../comp/types';
import { paperGrain } from '../comp/custom-nodes';

export interface MangaCompOptions {
  /** halftone cell size in pixels (the screen's frequency) */
  dotScale?: number;
  /** hatch line spacing in pixels */
  hatchScale?: number;
  /** paper and ink, linear */
  paper?: [number, number, number];
  ink?: [number, number, number];
  /** 0..1 paper tooth; 0 turns the grain off entirely */
  grain?: number;
}

/** the print convention for a single black screen: least conspicuous to the eye */
const SCREEN_ANGLE = Math.PI / 4;

/**
 * 1 where a layer's strokes are present, 0 where they are not, ramped over a
 * tone window. `hi` is the tone at which the layer starts to appear and `lo`
 * where it is fully present, so hi > lo: these run DARKWARD.
 *
 * Map Range with clamp rather than a hand-rolled smoothstep, because Blender's
 * clamp is order-aware and that is the part that gets reimplemented wrong.
 */
function darkward(c: CompGraph, tone: CompInput, hi: number, lo: number): CompNode {
  return c.mapRange(tone, { from: [hi, lo], to: [0, 1], clamp: true });
}

/** 0..1, without reaching for Map Range when an endpoint has to be a node */
function clamp01(c: CompGraph, v: CompInput): CompNode {
  return c.math('MINIMUM', c.math('MAXIMUM', v, 0), 1);
}

/** distance from the centre of the cell this pixel falls in, on a rotated grid */
function screenCell(c: CompGraph, px: CompNode, scale: number): CompNode {
  const x = c.separate(px, 'r');
  const y = c.separate(px, 'g');
  const cs = Math.cos(SCREEN_ANGLE);
  const sn = Math.sin(SCREEN_ANGLE);
  const rx = c.divide(c.subtract(c.mul(x, cs), c.mul(y, sn)), scale);
  const ry = c.divide(c.add(c.mul(x, sn), c.mul(y, cs)), scale);
  const cx = c.subtract(c.math('FRACT', rx), 0.5);
  const cy = c.subtract(c.math('FRACT', ry), 0.5);
  return c.math('SQRT', c.add(c.mul(cx, cx), c.mul(cy, cy)));
}

/** diagonal line coverage; `flip` mirrors the diagonal for the cross in crosshatch */
function hatchLines(c: CompGraph, px: CompNode, scale: number, flip: boolean): CompNode {
  const x = c.separate(px, 'r');
  const y = c.separate(px, 'g');
  const v = c.divide(flip ? c.subtract(x, y) : c.add(x, y), scale);
  const f = c.mul(c.math('ABSOLUTE', c.subtract(c.math('FRACT', v), 0.5)), 2);
  return c.mapRange(f, { from: [0.52, 0.86], to: [0, 1], clamp: true });
}

/**
 * Print `scene` as a manga page. Returns the composed image.
 *
 * Runtime knobs are uniforms, so the graph never changes while it runs: `grit`
 * thickens the strokes and pushes the blacks, `collapse` takes every pixel to
 * ink for a page transition. Drive them through Compositor.uniforms[name].value.
 */
export function mangaGraph(c: CompGraph, opts: MangaCompOptions = {}): CompNode {
  const dotScale = opts.dotScale ?? 4;
  const hatchScale = opts.hatchScale ?? 3.4;
  const paper = opts.paper ?? [0.96, 0.96, 0.96];
  const ink = opts.ink ?? [0.07, 0.07, 0.07];

  const grit = c.uniform('grit', 0.3);
  const collapse = c.uniform('collapse', 0);

  const scene = c.renderLayer();
  const px = c.coords('pixel');

  // Tone. Lifted slightly the way the hand pass does, so a mid-grey surface
  // lands in the halftone band rather than on its edge, then pushed DARKWARD by
  // grit. Map Range's endpoints are compile-time numbers, so a runtime knob
  // cannot widen the windows; moving the tone under fixed windows is the same
  // thing and it stays a uniform, which is what keeps the graph from rebuilding.
  const lum = c.mapRange(c.luminance(scene), { from: [0, 1], to: [0.05, 1.2], clamp: true });
  const tone = c.subtract(lum, c.mul(grit, 0.14));

  // The stroke layers, coarsest first: a pattern times how present that layer is
  // at this tone.
  //
  // The dot's radius grows as tone darkens, and its edge has to be softened
  // against a radius that is itself a NODE, so this is written out as clamped
  // arithmetic rather than as Map Range: that node's endpoints are numbers.
  const dotRadius = c.mul(darkward(c, tone, 0.78, 0.12), 0.62);
  const d = screenCell(c, px, dotScale);
  const EDGE = 0.09;
  const t = c.divide(c.subtract(d, c.subtract(dotRadius, EDGE)), 2 * EDGE);
  const dots = c.subtract(1, clamp01(c, t));

  const hatchA = hatchLines(c, px, hatchScale, false);
  const hatchB = hatchLines(c, px, hatchScale * 1.18, true);

  // NESTING. Ink coverage is the UNION of the layers, so once a stroke is on the
  // page it stays there for every darker tone: MAXIMUM, never a select between
  // them. This is the whole difference from the banded hand pass, and the
  // monotonicity test is what holds it.
  const layerDots = c.mul(dots, darkward(c, tone, 0.82, 0.62));
  const layerA = c.mul(hatchA, darkward(c, tone, 0.52, 0.34));
  const layerB = c.mul(hatchB, darkward(c, tone, 0.30, 0.16));
  const layerSolid = darkward(c, tone, 0.16, 0.05);

  let cover: CompNode = c.math('MAXIMUM', layerDots, layerA);
  cover = c.math('MAXIMUM', cover, layerB);
  cover = c.math('MAXIMUM', cover, layerSolid);

  // Ink outlines. Sobel is a real Blender Filter node, so this part is exact
  // rather than an approximation of one.
  const edges = c.filter(c.luminance(scene), 'SOBEL');
  const edge = c.mapRange(c.separate(edges, 'r'), { from: [0, 1.4], to: [0, 1], clamp: true });
  cover = c.math('MAXIMUM', cover, edge);

  // the page transition: every pixel to ink, one uniform, no rebuild
  cover = c.math('MAXIMUM', cover, collapse);
  cover = c.math('MINIMUM', cover, 1);

  const printed = c.mix('MIX', cover, c.rgb(...paper), c.rgb(...ink));
  if ((opts.grain ?? 1) <= 0) return printed;

  // paper tooth, biased into the midtones where a real screen shows it most
  const grain = paperGrain(c);
  return c.mix('ADD', c.mul(0.05, opts.grain ?? 1), printed, grain);
}
