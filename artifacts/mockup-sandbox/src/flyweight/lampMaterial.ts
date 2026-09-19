import { Vector3 } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { float, normalWorld, vec3 } from "three/tsl";
import { eeveeLighting } from "./vendor/blender-to-threejs/primitives/eevee-lighting";

/**
 * One lamp in a dark room.
 *
 * `mechanicalMaterial` fakes its light by reading the world normal, which is
 * fine on white paper where everything is lit anyway. On black it falls apart:
 * a fake gradient has no falloff, so nothing reads as being *near* a light.
 * This is the real thing, a Blender point light with inverse-square falloff,
 * so the near side of the subject blows out to solid halftone and the far side
 * drops to bare page, and the darkness has a source.
 */
export function lampMaterial(dim = false) {
  const shade = eeveeLighting(normalWorld, {
    brightness: float(dim ? 0.68 : 0.95),
    roughness: float(0.34),
    worldAmbient: float(dim ? 0.03 : 0.05),
    // Blender wattage, so inverse-square is real: irradiance is P/(4*pi*r^2) and
    // a lamp 6 m out needs hundreds of watts to read, not tens. Two keys, one
    // per subject, because a single lamp leaves whichever is further in the dark.
    lights: [
      { kind: "point", position: new Vector3(-3.2, 4.4, 5.0), power: 1100 },
      { kind: "point", position: new Vector3(6.2, 3.8, 4.6), power: 950 },
      // a weak rim from behind so the silhouette never closes up
      { kind: "point", position: new Vector3(4.8, 2.2, -5.0), power: 320 },
    ],
  });
  const material = new MeshBasicNodeMaterial();
  material.colorNode = vec3(shade, shade, shade);
  return material;
}
