import * as THREE from "three";

/**
 * A hand-authored stencil face, drawn as polygons rather than loaded.
 *
 * three ships no typeface JSON in this install and pulling one over the network
 * for a single word is a dependency we do not need, so FLYWEIGHT's nine glyphs
 * are cut by hand on a 10-unit cap height with a 2.2 stem. Straight edges and
 * 1.4 chamfers throughout: it reads as engineering stencil, which is the point —
 * this is a technical study, not a logotype.
 */
type Pt = [number, number];

const GLYPHS: Record<string, { w: number; pts: Pt[] }> = {
  F: { w: 6.0, pts: [[0,0],[2.2,0],[2.2,4],[5.2,4],[5.2,6],[2.2,6],[2.2,8],[6,8],[6,10],[0,10]] },
  L: { w: 6.0, pts: [[0,0],[6,0],[6,2],[2.2,2],[2.2,10],[0,10]] },
  Y: { w: 7.6, pts: [[2.7,0],[4.9,0],[4.9,4.2],[7.6,10],[5.2,10],[3.8,6.6],[2.4,10],[0,10],[2.7,4.2]] },
  W: { w: 9.6, pts: [[0,10],[2,10],[3.3,3.2],[4.4,8.4],[5.2,8.4],[6.3,3.2],[7.6,10],[9.6,10],[7.3,0],[5.4,0],[4.8,3],[4.2,0],[2.3,0]] },
  E: { w: 6.0, pts: [[0,0],[6,0],[6,2],[2.2,2],[2.2,4],[5.2,4],[5.2,6],[2.2,6],[2.2,8],[6,8],[6,10],[0,10]] },
  I: { w: 2.2, pts: [[0,0],[2.2,0],[2.2,10],[0,10]] },
  // the mouth opens on the right between the bar and the top terminal
  G: { w: 7.0, pts: [[7,8.6],[5.6,10],[1.4,10],[0,8.6],[0,1.4],[1.4,0],[5.6,0],[7,1.4],[7,6],[3.6,6],[3.6,4],[4.8,4],[4.8,2],[2.2,2],[2.2,8],[4.8,8],[4.8,7.4],[7,7.4]] },
  H: { w: 6.6, pts: [[0,0],[2.2,0],[2.2,4],[4.4,4],[4.4,0],[6.6,0],[6.6,10],[4.4,10],[4.4,6],[2.2,6],[2.2,10],[0,10]] },
  T: { w: 6.4, pts: [[0,10],[6.4,10],[6.4,8],[4.3,8],[4.3,0],[2.1,0],[2.1,8],[0,8]] },
};

const TRACKING = 1.0;

export interface WordmarkOptions {
  /** extrusion depth in glyph units */
  depth?: number;
  /** cap height in world units — the whole word scales off this */
  size?: number;
}

/**
 * Extrude `text` into a centred group. Origin sits at the wordmark's middle, so
 * the caller positions it without measuring anything.
 */
export function buildWordmark(
  text: string,
  material: THREE.Material,
  { depth = 2.4, size = 1 }: WordmarkOptions = {},
): THREE.Group {
  const group = new THREE.Group();
  const glyphs = [...text].filter((ch) => GLYPHS[ch]);
  const total =
    glyphs.reduce((sum, ch) => sum + GLYPHS[ch]!.w, 0) + TRACKING * (glyphs.length - 1);

  let cursor = 0;
  for (const ch of glyphs) {
    const { w, pts } = GLYPHS[ch]!;
    const shape = new THREE.Shape();
    shape.moveTo(pts[0]![0], pts[0]![1]);
    for (const [x, y] of pts.slice(1)) shape.lineTo(x, y);
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: 0.16,
      bevelSize: 0.14,
      bevelOffset: 0,
      bevelSegments: 1,
      curveSegments: 1,
    });
    // centre the whole word on the origin, and the cap height on y = 0
    geometry.translate(cursor - total / 2, -5, -depth / 2);
    group.add(new THREE.Mesh(geometry, material));
    cursor += w + TRACKING;
  }

  group.scale.setScalar(size / 10);
  return group;
}
