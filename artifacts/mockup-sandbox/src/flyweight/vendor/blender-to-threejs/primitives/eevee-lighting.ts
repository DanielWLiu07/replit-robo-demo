/**
 * eeveeLighting, EEVEE-faithful manual lighting primitive (fidelity: approximate).
 *
 * MeshBasicNodeMaterial ignores scene lights, so the Principled BSDF -> ShaderToRGB
 * result is reimplemented per spec section 6.1:
 *
 *   shade = max( brightness * (E1*NoL1 + E2*NoL2 + ...) / pi
 *              + worldAmb
 *              + ggxSpec_1 + ggxSpec_2 + ..., 0 )
 *
 * GGX: D = a2 / (pi * denom^2), height-correlated Smith visibility,
 * alpha = roughness^2 (so a2 = roughness^4), F0 = 0.04 (Specular IOR 0.5).
 *
 * All light directions are SURFACE->LIGHT in Three's Y-up space, convert from
 * Blender with (x,y,z) -> (x, z, -y) and negate the emission direction.
 *
 * NO UPPER CLAMP, deliberately. This used to clamp shade to 1, and Blender does
 * not: a plane 0.5 m from a 41.4 W point light reads 3.35, not 1. Everything
 * downstream of a toon graph is a Color Ramp, which clamps its own fac, so the
 * old ceiling was invisible in the usual case and simply wrong in the rest.
 *
 * Measured against Blender 4.5.3, EEVEE Next, Standard view transform, albedo
 * 0.8, Diffuse BSDF -> Shader to RGB, world strength 0 (tests/lighting.test.ts
 * pins these):
 *
 *   point 41.4 W, NoL = 1, r = 1     -> 0.83887   albedo * P / (4 pi^2 r^2)
 *   point 41.4 W, NoL = 1, r = 2     -> 0.20972   = the same over r^2
 *   point 41.4 W, NoL = cos60, r = 1 -> 0.41870   Lambert, no soft falloff
 *   world colour 0.0802479           -> 0.06421   = albedo * colour, no / pi
 *
 * One known deviation, and it is EEVEE's rather than ours: EEVEE Next cuts a
 * light off past an influence radius derived from scene.eevee.light_threshold
 * (default 0.01). At that default a 41.4 W light reads 2% low at 2 m and 9% low
 * at 3 m; set the threshold to 1e-6 in Blender and the measured falloff is
 * exactly inverse-square at every distance out to 8 m. Cycles has no such
 * cutoff. This primitive implements the physical law, not the cutoff.
 */
import { Vector3 } from 'three';
import {
  Fn,
  cameraPosition,
  clamp,
  dot,
  float,
  max,
  normalize,
  oneMinus,
  positionWorld,
  vec3,
} from 'three/tsl';

// TSL node handles are dynamically typed; a graph-builder alias keeps call sites readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TSLNode = any;

/**
 * A Blender SUN: parallel rays, no falloff.
 *
 * `energy` is Blender's own Strength field, which for a sun IS the irradiance in
 * W/m2 on a surface facing it, so it carries straight through with no constant.
 */
export interface SunLight {
  kind?: 'sun';
  /** surface->light unit direction, Y-up. */
  dir: Vector3;
  /** Blender light energy (the 5.0 / 3.0 sun strengths). */
  energy: number;
  /** Blender's per-light Exposure, in stops. See EXPOSURE below. */
  exposure?: number;
}

/**
 * A Blender POINT light: a position, and inverse-square falloff from it.
 *
 * This exists because a directional stand-in is not close for a near light. His
 * manga scene lights its subject with a single 41.4 W point at 1.02 m; the
 * direction swings by tens of degrees across one model and the irradiance by 4x
 * end to end, and no `dir`/`energy` pair can express either.
 *
 * `power` is Blender's Power field in watts. Blender spreads it over the sphere,
 * so the radiant intensity is P / (4 pi) and the irradiance at distance r is
 * that over r^2 (see POINT_INTENSITY).
 */
export interface PointLight {
  kind: 'point';
  /** world position, Y-up (Blender (x,y,z) -> (x, z, -y)). */
  position: Vector3;
  /** Blender light Power, in watts. */
  power: number;
  /** Blender's per-light Exposure, in stops. See EXPOSURE below. */
  exposure?: number;
}

/**
 * Blender's per-light Exposure field, in STOPS, applied as energy * 2^exposure.
 *
 * Easy to miss and expensive to miss. It is a separate field from Power, it does
 * not show up in the Power number, and a light carrying a couple of stops of it
 * is off by a factor of four with nothing in the file looking wrong. The lamp in
 * his manga scene reads 41.4 W and carries -1.095888 stops, so it delivers 19.37
 * W: a plane at 1.02 m measured 0.466 of what a fresh 41.4 W lamp gave at the
 * same spot, against 2^-1.095888 = 0.46785.
 *
 * Finding it took a plane rendered under his light and under a fresh one of the
 * stated power in the same scene, then a property-by-property diff of the two
 * datablocks. Nothing short of that diff would have found it, which is the
 * argument for the diff.
 */
export const exposureGain = (stops = 0): number => 2 ** stops;

/** A light's effective irradiance or wattage, with Exposure folded in. */
export function lightStrength(light: SketchLight): number {
  const base = light.kind === 'point' ? light.power : light.energy;
  return base * exposureGain(light.exposure);
}

export type SketchLight = SunLight | PointLight;

/**
 * Watts to radiant intensity for a Blender point light: I = P / (4 pi).
 * Irradiance at distance r on a surface facing the light is I / r^2.
 *
 * Measured, not remembered. An earlier port had this light as a distant
 * directional at "energy 0.088", which is its irradiance at 6.11 m, and applied
 * that number at 1.02 m, where the true value is 3.16, a factor of 36.
 */
export const POINT_INTENSITY = 1 / (4 * Math.PI);

/** Blender's irradiance from a point light of `power` watts at distance `r`, facing it. */
export function pointIrradiance(power: number, r: number): number {
  return (power * POINT_INTENSITY) / (r * r);
}

export interface EeveeLightingOptions {
  /** Principled Base Color grey (Blender "Brightness", linear). */
  brightness: TSLNode;
  /** Principled roughness. */
  roughness: TSLNode;
  /** World background grey x strength (spec: 0.05). */
  worldAmbient: TSLNode;
  lights: readonly SketchLight[];
}

/** One GGX specular lobe, height-correlated Smith, F0 = 0.04. */
const ggxSpec = /* @__PURE__ */ Fn(([n, v, l, energy, roughness]: TSLNode[]) => {
  const a = roughness.mul(roughness);
  const a2 = a.mul(a);
  const h = normalize(l.add(v));
  const noh = clamp(dot(n, h), 0.0, 1.0);
  const nol = clamp(dot(n, l), 0.0, 1.0);
  const nov = clamp(dot(n, v), 1e-4, 1.0);
  const voh = clamp(dot(v, h), 0.0, 1.0);
  const denom = noh.mul(noh).mul(a2.sub(1.0)).add(1.0);
  const d = a2.div(denom.mul(denom).mul(Math.PI));
  const gv = nol.mul(nov.mul(nov).mul(oneMinus(a2)).add(a2).sqrt());
  const gl = nov.mul(nol.mul(nol).mul(oneMinus(a2)).add(a2).sqrt());
  const vis = float(0.5).div(gv.add(gl).max(1e-5));
  const f = float(0.04).add(float(0.96).mul(oneMinus(voh).pow(5.0)));
  return d.mul(vis).mul(f).mul(nol).mul(energy);
});

/**
 * Build the scalar `shade` node from a shading normal.
 * Keep `normal` injectable so flat-shading (or any custom normal) plugs in.
 */
/**
 * One light resolved at the shading point: a surface->light direction and the
 * irradiance arriving along it. A sun answers with constants; a point light has
 * to be evaluated per fragment, which is the whole reason this split exists.
 */
function resolve(light: SketchLight): { l: TSLNode; energy: TSLNode } {
  const strength = lightStrength(light);
  if (light.kind === 'point') {
    const toLight = vec3(light.position.x, light.position.y, light.position.z).sub(positionWorld);
    // guarded so a fragment sitting exactly on the light is bright, not NaN
    const r2 = max(dot(toLight, toLight), 1e-8);
    return { l: normalize(toLight), energy: float(strength * POINT_INTENSITY).div(r2) };
  }
  return { l: vec3(light.dir.x, light.dir.y, light.dir.z), energy: float(strength) };
}

export function eeveeLighting(normal: TSLNode, opts: EeveeLightingOptions): TSLNode {
  const view = normalize(cameraPosition.sub(positionWorld));

  let diffuseSum: TSLNode = float(0.0);
  let specSum: TSLNode = float(0.0);
  for (const light of opts.lights) {
    const { l, energy } = resolve(light);
    const nol = clamp(dot(normal, l), 0.0, 1.0);
    diffuseSum = diffuseSum.add(nol.mul(energy));
    specSum = specSum.add(ggxSpec(normal, view, l, energy, opts.roughness));
  }

  const diffuse = opts.brightness.mul(diffuseSum).div(Math.PI);
  return max(diffuse.add(opts.worldAmbient).add(specSum), 0.0);
}

/**
 * A neutral one-key rig, for a Diffuse BSDF authored with no rig stated.
 *
 * Deliberately modest: a diffuse node's job here is to land in a range the ramps
 * downstream were authored against, and an over-bright default silently pushes
 * every threshold past its window. Pass the real lights when porting a real
 * scene; this is only so the node has an answer at all.
 */
export const DEFAULT_LIGHTS: readonly SketchLight[] = [
  { kind: 'sun', dir: new Vector3(-0.48, 0.62, 0.62).normalize(), energy: 3.0 },
];
