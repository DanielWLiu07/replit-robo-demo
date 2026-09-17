import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  clamp, dot, float, max, mix, normalWorld, screenCoordinate, smoothstep,
  texture, uniform, vec2, vec3,
} from "three/tsl";

/**
 * The gacha reveal's crosshatch ink shader, ported to TSL.
 *
 * Source is the UWDSC gacha prototype (`feat/gacha-reveal-prototype`,
 * `prototype/index.html`, the moon/prop material). That version is raw GLSL in a
 * `ShaderMaterial`, which a WebGPU renderer will not compile, so this is a
 * node-for-node port rather than a copy.
 *
 * The mechanism, unchanged: shade the surface off its own normal, invert it to
 * get ink density, then read a three-channel hatch atlas in SCREEN space — R, G
 * and B are three hatch densities, folded in over their own tone windows so
 * strokes accumulate as the surface darkens. Compositing over a paper texture
 * keeps it a drawing rather than a render.
 *
 * The "boil" is the good part: the screen-space lookup is rotated and offset by
 * a value quantised to 8 frames a second, so the hatching re-draws itself a few
 * times a second instead of sliding around with the camera. That is what reads
 * as hand-drawn. Their own perf pass hoisted those two values to the CPU and
 * this keeps that — `advanceBoil` is called once per frame, not per pixel.
 */
// TSL node handles are heavily generic; the vendored lighting primitive takes the
// same escape hatch, and the call sites below stay readable because of it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSLNode = any;

export interface HatchUniforms {
  boilR: TSLNode;
  boilO: TSLNode;
  hscale: TSLNode;
}

export function loadHatchTextures(base: string) {
  const loader = new THREE.TextureLoader();
  const hatch = loader.load(`${base}gacha/hatch.jpg`);
  hatch.colorSpace = THREE.NoColorSpace;
  hatch.wrapS = hatch.wrapT = THREE.RepeatWrapping;
  const paper = loader.load(`${base}gacha/paper.jpg`);
  paper.colorSpace = THREE.SRGBColorSpace;
  paper.wrapS = paper.wrapT = THREE.RepeatWrapping;
  return { hatch, paper };
}

export function makeHatchUniforms(dpr: number): HatchUniforms {
  return {
    boilR: uniform(new THREE.Vector2(1, 0)),
    boilO: uniform(new THREE.Vector2(0, 0)),
    hscale: uniform(300 * dpr),
  };
}

/** Quantised to 8 fps, exactly as the prototype does it. */
export function advanceBoil(u: HatchUniforms, nowMs: number) {
  const fr = Math.floor((nowMs / 1000) * 8);
  const ja = fr * 1.7;
  (u.boilR.value as THREE.Vector2).set(Math.cos(ja), Math.sin(ja));
  const fract = (x: number) => x - Math.floor(x);
  (u.boilO.value as THREE.Vector2).set(
    fract(Math.sin(fr * 91.7) * 4373.0) * 1200.0,
    fract(Math.sin(fr * 47.3) * 7919.0) * 1200.0,
  );
}

export function hatchMaterial(
  tex: { hatch: THREE.Texture; paper: THREE.Texture },
  u: HatchUniforms,
  lightDir = new THREE.Vector3(-0.62, 0.38, 0.42).normalize(),
) {
  const n: TSLNode = normalWorld;
  const ndl: TSLNode = max(dot(n, vec3(lightDir.x, lightDir.y, lightDir.z)), 0);
  const shade: TSLNode = clamp(ndl.mul(0.85).add(0.17), 0, 1);
  const t: TSLNode = float(1).sub(shade);

  // rotate the screen lookup by the boil matrix, then offset it
  const sc: TSLNode = screenCoordinate;
  const rx: TSLNode = sc.x.mul(u.boilR.x).sub(sc.y.mul(u.boilR.y));
  const ry: TSLNode = sc.x.mul(u.boilR.y).add(sc.y.mul(u.boilR.x));
  const hUv: TSLNode = vec2(rx.add(u.boilO.x), ry.add(u.boilO.y)).div(u.hscale);
  const hx: TSLNode = texture(tex.hatch, hUv);

  const i0 = smoothstep(0.1, 0.42, t);
  const i1 = smoothstep(0.32, 0.66, t);
  const i2 = smoothstep(0.58, 0.95, t);
  const m0: TSLNode = mix(float(1), hx.r, i0);
  const m1: TSLNode = m0.mul(mix(float(1), hx.g, i1));
  const m2: TSLNode = m1.mul(mix(float(1), hx.b, i2));

  const paperTex: TSLNode = texture(tex.paper, sc.div(620));
  const paper: TSLNode = vec3(0.93, 0.93, 0.93).mul(mix(vec3(1, 1, 1), paperTex.rgb, 0.14));

  const material = new MeshBasicNodeMaterial();
  material.colorNode = mix(vec3(0.05, 0.05, 0.05), paper, clamp(m2, 0, 1));
  return material;
}
