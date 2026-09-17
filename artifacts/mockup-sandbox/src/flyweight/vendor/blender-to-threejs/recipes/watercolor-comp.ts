/**
 * Watercolour as a compositor graph.
 *
 * Transcribed step for step from pomme's WATERCOLOR_FRAG (web/public/scene/
 * styles2.js), which itself follows the watercolour-NPR literature
 * (Montesdeoca et al. gaps-and-overlaps, inkwash per-channel bleed,
 * Beer-Lambert pigment compositing). Every step below names the shader step it
 * mirrors. Where a step is a Blender node it is that node (Displace, Filter,
 * MixRGB, Math); where it is not (value noise, fbm) it is a tagged custom node.
 *
 * Deviations, stated:
 *  - noise is anchored to WORLD position through the Render Layers 'position'
 *    pass (pomme reconstructs the same from depth); where there is no geometry
 *    (paper) it falls back to screen coordinates.
 *  - edge darkening uses the Filter node's Sobel on luminance (a 3x3 kernel at
 *    1 px) rather than central differences at 1.6 px; thresholds are rescaled
 *    to match.
 *  - the mono impact frame uses the mangaTone custom node (dots + hatch) in
 *    place of the shader's inline halftone/hatch, same numbers.
 *  - the posterise dither is masked by scene coverage (blurred render-layer
 *    alpha) so blank paper stays paper; pomme's frame has no blank paper.
 *
 * Uniforms (drive by name on Compositor.uniforms): bleed (px), loose (px),
 * posterize (0..1), strength, impact (0 | 1 | 2), after (0..1), grit.
 *
 * Display: pomme writes this pass to the canvas RAW (a GLSL3 ShaderMaterial
 * with no tone-mapping or colour-space chunk), so its look is linear values
 * shown as sRGB. To match it, run the Compositor with `rawOutput: true`.
 */
import type { Texture } from 'three';
import type { CompGraph } from '../comp/builder';
import { fbm, mangaTone, valueNoise } from '../comp/custom-nodes';
import type { CompInput, CompNode } from '../comp/types';

export interface WatercolorOptions {
  bleed?: number;
  loose?: number;
  posterize?: number;
  strength?: number;
  /** Paper texture, stretched over the frame; falls back to flat cream. */
  paper?: Texture;
  paperColor?: [number, number, number];
  /** Image to paint instead of the render layer (tests, probes). */
  source?: CompInput;
  /**
   * Anchor the paint noise to world position (Render Layers 'position' pass),
   * as pomme does from depth, so washes stick to objects under camera motion.
   * Default: true when painting the render layer, false for a `source` image.
   */
  worldAnchor?: boolean;
  /** Debug: return an intermediate instead of the paint. */
  debug?: 'edge' | 'dens' | 'bled';
  /** Jittered bleed taps (pomme ships 4; 3 is visually the same at 3/4 the Displace cost). */
  bleedTaps?: number;
  /**
   * How pigment meets paper. 'multiply' is pomme: transmittance times light paper. 'gouache' is the
   * dark-paper mode: opaque paint laid through the bled coverage, then a Screen pass so light pigments
   * chalk-glow; use with a charcoal paperColor. Impact frames flip to white hatch on black.
   */
  compose?: 'multiply' | 'gouache';
  /**
   * Lamp pool: an Ellipse-Mask style radial falloff in normalized screen coordinates multiplied onto the
   * frame (uniforms poolX, poolY, poolR, poolFloor). Everything outside the pool sinks toward black.
   */
  pool?: { centre?: [number, number]; radius?: number; floor?: number; soft?: number };
  /**
   * Smoke in the lamp light: two octaves of fbm over screen coordinates, tinted, gated by the pool,
   * Screened onto the frame (uniform hazeAmt). Gives the dark room air instead of a black void.
   */
  haze?: { amount?: number; tint?: [number, number, number]; scale?: number };
  /** dark paper: how strongly the paper texture reads as grain (0 flat .. 1 full) */
  grain?: number;
}

/** smoothstep(e0, e1, x) out of Math nodes (not a Blender op; built from ones that are). */
function smooth(c: CompGraph, x: CompInput, e0: number, e1: number): CompNode {
  const t = c.math('DIVIDE', c.subtract(x, e0), e1 - e0, 0, { clamp: true });
  return c.mul(c.mul(t, t), c.subtract(3, c.mul(t, 2)));
}

/** Apply a scalar->scalar graph function to each rgb channel; alpha from the source. */
function perChannel(c: CompGraph, color: CompInput, fn: (ch: CompNode) => CompInput): CompNode {
  return c.combine(fn(c.separate(color, 'r')), fn(c.separate(color, 'g')), fn(c.separate(color, 'b')), c.separate(color, 'a'));
}

export function watercolorGraph(c: CompGraph, opts: WatercolorOptions = {}): CompInput {
  // defaults are pomme's shipped values (styles2.js WatercolorPass uniforms)
  const uBleed = c.uniform('bleed', opts.bleed ?? 8);
  const uLoose = c.uniform('loose', opts.loose ?? 9);
  const uPosterize = c.uniform('posterize', opts.posterize ?? 0.3);
  const uStrength = c.uniform('strength', opts.strength ?? 0.74);
  const uImpact = c.uniform('impact', 0);
  const uAfter = c.uniform('after', 0);
  const uGrit = c.uniform('grit', 0.35);

  const paperRGB = opts.paperColor ?? [0.97, 0.95, 0.9];

  // the scene, straight alpha over white so an empty background is blank paper; in gouache mode over the
  // paper colour itself, so anti-aliased edges (lettering, silhouettes) blend to the dark ground instead of
  // printing a white rim
  const scene = opts.source ?? c.renderLayer();
  const ground = opts.compose === 'gouache' ? c.rgb(paperRGB[0], paperRGB[1], paperRGB[2]) : c.rgb(1, 1, 1);
  const base = c.alphaOver(1, ground, scene, { straightAlpha: true });

  // anchor coordinates. World-anchored like pomme: wpc = wp * 4 / (4 + |wp|),
  // aa = wpc.xy + (wpc.z * 0.83, wpc.z * 0.31); paper (no geometry) uses
  // centred aspect-corrected screen coordinates instead.
  const screenAA = c.coords('uniform');
  const worldAnchor = opts.worldAnchor ?? !opts.source;
  let aa: CompInput = screenAA;
  if (worldAnchor) {
    const pos = c.renderLayer('position');
    const px = c.separate(pos, 'r');
    const py = c.separate(pos, 'g');
    const pz = c.separate(pos, 'b');
    const len = c.math('SQRT', c.add(c.add(c.mul(px, px), c.mul(py, py)), c.mul(pz, pz)));
    const k = c.divide(4, c.add(4, len));
    const wx = c.mul(px, k);
    const wy = c.mul(py, k);
    const wz = c.mul(pz, k);
    const worldAA = c.combine(c.add(wx, c.mul(wz, 0.83)), c.add(wy, c.mul(wz, 0.31)));
    aa = c.blend(c.separate(pos, 'a'), screenAA, worldAA);
  }
  const shift = (dx: number, dy: number) => c.combine(c.add(c.separate(aa, 'r'), dx), c.add(c.separate(aa, 'g'), dy));

  // 1) paper distortion: uv0 = vUv + wobble * px * 5, wobble = fbm(aa*9) - 0.5.
  //    Displace subtracts, so the scale is negative.
  const wobble = c.combine(c.subtract(fbm(c, aa, 9), 0.5), c.subtract(fbm(c, shift(19.3, 19.3), 9), 0.5));
  const uv0Layer = c.displace(base, wobble, -5, -5);

  // 1b) gaps and overlaps: the colour layer misregistered by low-frequency noise
  const misreg = c.combine(c.subtract(fbm(c, shift(4.2, 4.2), 1.9), 0.5), c.subtract(fbm(c, shift(13.1, 13.1), 1.9), 0.5));
  const negLoose = c.mul(uLoose, -1);
  const colorLayer = c.displace(uv0Layer, misreg, negLoose, negLoose);

  // 2) bleed with chromatographic separation: 4 jittered taps, per-channel radii 1.7 / 1.0 / 0.5
  const taps: { r: CompNode; g: CompNode; b: CompNode; w: CompNode }[] = [];
  const nTaps = opts.bleedTaps ?? 4;
  for (let k = 0; k < nTaps; k++) {
    const dir = c.combine(
      c.subtract(valueNoise(c, aa, 3.5, [k * 13.1, k * 13.1]), 0.5),
      c.subtract(valueNoise(c, aa, 3.5, [k * 7.7 + 31, k * 7.7 + 31]), 0.5),
    );
    const w = c.add(0.5, c.mul(0.5, valueNoise(c, aa, 5.7, [k * 3.3, k * 3.3])));
    const sR = c.mul(uBleed, -1.7);
    const sG = c.mul(uBleed, -1.0);
    const sB = c.mul(uBleed, -0.5);
    taps.push({
      r: c.separate(c.displace(colorLayer, dir, sR, sR), 'r'),
      g: c.separate(c.displace(colorLayer, dir, sG, sG), 'g'),
      b: c.separate(c.displace(colorLayer, dir, sB, sB), 'b'),
      w,
    });
  }
  const wsum = taps.reduce<CompInput>((acc, t) => c.add(acc, t.w), 0);
  const weighted = (ch: 'r' | 'g' | 'b') => c.divide(taps.reduce<CompInput>((acc, t) => c.add(acc, c.mul(t.w, t[ch])), 0), wsum);
  const bled = c.combine(weighted('r'), weighted('g'), weighted('b'));

  // 3) pigment density: dens = -log(clamp(bled, 0.05, 1)) * (0.82 + 0.36 * fbm(aa*1.05 + 5.5))
  // on dark ground (gouache) the log makes that turbulence a huge relative swing, so it is damped there
  const turbAmp = opts.compose === 'gouache' ? 0.14 : 0.36;
  const turb = c.add(1 - turbAmp * 0.5, c.mul(turbAmp, fbm(c, shift(5.5, 5.5), 1.05)));
  let dens = perChannel(c, bled, (ch) =>
    c.mul(c.mul(c.math('LOGARITHM', c.math('MINIMUM', c.math('MAXIMUM', ch, 0.05), 1), Math.E), -1), turb),
  );

  // 4) posterise density into dithered bands: q = (floor(dens*2.6 + dith) + 0.5) / 2.6.
  //    Only where the scene has coverage: on blank paper dens is 0 and the dither
  //    alone would print grey continents (pomme never shows blank paper, so its
  //    shader never met this case). Coverage is the render layer's alpha,
  //    softened so the bands fade in at silhouettes instead of cutting.
  const dith = c.mul(c.subtract(fbm(c, aa, 4.2), 0.5), 0.55);
  const coverage = c.separate(c.blur(scene, 3), 'a');
  const posterizeHere = c.mul(uPosterize, coverage);
  dens = perChannel(c, dens, (ch) => {
    const q = c.divide(c.add(c.math('FLOOR', c.add(c.mul(ch, 2.6), dith)), 0.5), 2.6);
    return c.add(ch, c.mul(c.subtract(q, ch), posterizeHere));
  });

  // 5) edge darkening: pigment pools at wash boundaries. Sobel on the wobbled layer's luminance.
  const sobel = c.separate(c.filter(c.combine(c.luminance(uv0Layer), 0, 0), 'SOBEL'), 'r');
  // shader: |grad| = central difference over +-1.6 px (a 3.2 px baseline).
  // Sobel sums three rows weighted 1,2,1 over a 2 px baseline: magnitude ~ 4 * 2 * slope,
  // the shader's ~ 3.2 * slope, so grad ~ sobel * 0.4 (per-pixel edge measured
  // against pomme's DBG_EDGE: this brings the two edge fields into line).
  const edge = smooth(c, c.mul(sobel, 0.4), 0.05, 0.5);
  const edgeGain = c.add(1, c.mul(0.9, edge));
  dens = perChannel(c, dens, (ch) => c.mul(ch, edgeGain));
  if (opts.debug === 'edge') return c.combine(edge, edge, edge, 1);
  if (opts.debug === 'dens') return c.setAlpha(c.multiply(1, dens, c.rgb(0.25, 0.25, 0.25)), 1);
  if (opts.debug === 'bled') return c.setAlpha(bled, 1);

  // 6) granulation, clumpy, strongest in mid washes
  const meanDens = c.divide(c.add(c.add(c.separate(dens, 'r'), c.separate(dens, 'g')), c.separate(dens, 'b')), 3);
  const presence = c.mul(smooth(c, meanDens, 0.08, 0.6), c.subtract(1, smooth(c, meanDens, 1.4, 2.4)));
  const gclump = c.mul(valueNoise(c, aa, 13), valueNoise(c, shift(17, 17), 22));
  const granGain = c.add(1, c.mul(c.mul(c.subtract(gclump, 0.28), 0.34), presence));
  dens = perChannel(c, dens, (ch) => c.mul(ch, granGain));

  // 7) compose on paper
  const gouache = opts.compose === 'gouache';
  const cream = c.rgb(paperRGB[0], paperRGB[1], paperRGB[2]);
  // light paper: texture blended in; dark paper: texture as a grain multiplier so it stays dark
  const paper = opts.paper
    ? gouache
      ? c.multiply(1, cream, c.blend(opts.grain ?? 0.6, c.rgb(1, 1, 1), c.image(opts.paper, 'stretch')))
      : c.blend(0.65, cream, c.image(opts.paper, 'stretch'))
    : cream;
  const transmit = perChannel(c, dens, (ch) => c.math('EXPONENT', c.mul(c.mul(ch, uStrength), -1)));
  let col: CompInput;
  if (gouache) {
    // opaque paint through the bled coverage (blank paper stays paper, feathered like the bleed),
    // then Screen the paint back in for the chalk glow of light pigments on dark ground
    const covBled = c.separate(c.blur(scene, Math.max(2, Math.round((opts.bleed ?? 8) * 1.2))), 'a');
    const presence = smooth(c, covBled, 0.04, 0.55);
    col = c.blend(presence, paper, transmit);
    col = c.screen(c.mul(presence, 0.35), col, transmit);
  } else {
    col = c.multiply(1, paper, transmit); // col = paper * exp(-dens * strength)
  }

  // lamp pool: radial falloff in normalized screen space, multiplied on (Ellipse Mask + Blur + Multiply)
  let poolMask: CompInput = 1;
  if (opts.pool) {
    const uPoolX = c.uniform('poolX', opts.pool.centre?.[0] ?? 0.5);
    const uPoolY = c.uniform('poolY', opts.pool.centre?.[1] ?? 0.5);
    const uPoolR = c.uniform('poolR', opts.pool.radius ?? 0.5);
    const uPoolFloor = c.uniform('poolFloor', opts.pool.floor ?? 0.1);
    const soft = opts.pool.soft ?? 0.8;
    const sc = c.coords('normalized');
    const dx = c.divide(c.subtract(c.separate(sc, 'r'), uPoolX), uPoolR);
    const dy = c.divide(c.subtract(c.separate(sc, 'g'), uPoolY), uPoolR);
    const r = c.math('SQRT', c.add(c.mul(dx, dx), c.mul(dy, dy)));
    const pool = c.subtract(1, smooth(c, r, 1 - soft * 0.5, 1 + soft * 0.5));
    poolMask = pool;
    const gain = c.add(uPoolFloor, c.mul(c.subtract(1, uPoolFloor), pool));
    col = c.multiply(1, col, c.combine(gain, gain, gain, 1));
  }
  // haze: smoke drifting in the light (fbm over screen coordinates), Screened on, gated by the pool
  if (opts.haze) {
    const uHaze = c.uniform('hazeAmt', opts.haze.amount ?? 0.35);
    // drift: uniforms hazeX/hazeY offset the smoke field (drive per frame for slow movement)
    const uHazeX = c.uniform('hazeX', 0);
    const uHazeY = c.uniform('hazeY', 0);
    const tint = opts.haze.tint ?? [1.0, 0.86, 0.66];
    const hs = opts.haze.scale ?? 2.2;
    const sc0 = c.coords('uniform');
    const sc = c.combine(c.add(c.separate(sc0, 'r'), uHazeX), c.add(c.separate(sc0, 'g'), uHazeY));
    const smoke = c.add(c.mul(fbm(c, sc, hs), 0.6), c.mul(fbm(c, c.combine(c.add(c.separate(sc, 'r'), 3.7), c.subtract(c.separate(sc, 'g'), 1.9)), hs * 2.1), 0.4));
    // thinner where paint covers (the smoke is in the air, not on the felt)
    const thin = gouache ? c.subtract(1, c.mul(0.65, smooth(c, c.separate(c.blur(scene, 6), 'a'), 0.1, 0.8))) : 1;
    const lit = c.mul(c.mul(c.mul(smooth(c, smoke, 0.38, 0.85), poolMask), uHaze), thin);
    col = c.screen(1, col, c.combine(c.mul(lit, tint[0]), c.mul(lit, tint[1]), c.mul(lit, tint[2]), 1));
  }

  // afterimage veil, then the impact frames (mono hatch frame, inverted flash frame); on dark paper the
  // hatch prints white on black and the veil is the paper itself
  col = c.blend(uAfter, col, gouache ? cream : c.rgb(0.97, 0.95, 0.9));
  const lum = c.luminance(col);
  const tone = mangaTone(c, lum, uGrit);
  const monoFrame = gouache
    ? c.blend(tone, c.rgb(0.96, 0.96, 0.96), c.rgb(0.04, 0.04, 0.04))
    : c.blend(tone, c.rgb(0.04, 0.04, 0.04), c.rgb(0.96, 0.96, 0.96));
  /**
   * The inverted frame prints ink where the image is BRIGHT or where it is COLOURED.
   *
   * Luminance alone is not enough and cannot be made enough by moving the threshold. On this paper the
   * composited red of a chip lands at about 0.134 luminance and the paper itself at 0.122 - twelve
   * thousandths apart - so no cut separates them, and a red object prints as paper with only its
   * speculars surviving. Saturation separates them completely.
   *
   * The window has to clear the SET without clipping the subject, and both edges were found by measuring.
   * Down at 0.25 it caught everything and printed the whole table as ink, which is not a flash any more.
   * Up at 0.6 it missed the chip's SIDE, which is the part that tells you the chip has a thickness: the
   * side reads at about 0.48 saturation against the top's 0.35, so it is MORE coloured than the face and
   * was still falling outside. 0.44 to 0.6 takes both, and the felt at 0.23 and the room at 0.21 are far
   * enough below to stay paper.
   */
  const cr = c.separate(col, 'r');
  const cg = c.separate(col, 'g');
  const cb = c.separate(col, 'b');
  const cMax = c.math('MAXIMUM', cr, c.math('MAXIMUM', cg, cb));
  const cMin = c.math('MINIMUM', cr, c.math('MINIMUM', cg, cb));
  const sat = c.math('DIVIDE', c.math('SUBTRACT', cMax, cMin), c.math('MAXIMUM', cMax, 0.001));
  const ink = c.math('MAXIMUM', smooth(c, lum, 0.58, 0.66), smooth(c, sat, 0.52, 0.72));
  /**
   * CONTOURS SURVIVE THE TWO-TONE, and without them a solid shape has no interior.
   *
   * A two-tone is binary, so a chip's top face and its side both land on the ink side and merge into one
   * black silhouette - the thing that separates them in colour is a tonal step, and a tonal step is
   * exactly what gets thrown away. It reads as a flat disc.
   *
   * The comp already has a Sobel edge field for the pigment pooling. Forcing it back to PAPER lays the
   * contour lines over the ink as white, which is what gives a filled shape its interior: the rim against
   * the face, the face against the side. On areas that are already paper it changes nothing, so it costs
   * only the lines it draws.
   */
  const two = c.math('MAXIMUM', c.subtract(1, ink), smooth(c, edge, 0.3, 0.62));
  const invertedFrame = c.combine(two, two, two);
  const isMono = c.greaterThan(uImpact, 0.5);
  const isInverted = c.greaterThan(uImpact, 1.5);
  col = c.blend(isMono, col, monoFrame);
  col = c.blend(isInverted, col, invertedFrame);
  return c.setAlpha(col, 1);
}
