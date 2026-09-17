import { graph } from './vendor/blender-to-threejs/graph/builder';
import { compileMaterial } from './vendor/blender-to-threejs/graph/compile';
export function mechanicalMaterial(dark = false) {
 const g = graph(), n = g.normal('world');
 const light = g.add(g.multiply(g.separate(n, 'y'), .62), g.multiply(g.separate(n, 'x'), -.38));
 const lift = g.mapRange(light, { from: [-1, 1], to: [dark ? .015 : .06, dark ? .45 : .88], clamp: true });
 return compileMaterial(g.multiplyColor(1, g.rgb(1,1,1), g.combine(lift,lift,lift)));
}
