/**
 * What counts as a DECAL: an object drawn on a surface rather than being one.
 *
 * Two passes in this subsystem render the whole scene through a single override material: the position
 * pass (world position per pixel) and the overlay pass's occluder prepass (depth only). An override
 * material cannot see the object's map, so a transparent quad is treated as a solid rectangle by both:
 *
 *   position pass  -> the quad stamps its whole rectangle into the position buffer, and every
 *                     position-driven term downstream styles that rectangle as if it were the surface
 *   occluder pass  -> the quad writes depth over its whole rectangle, so an overlay behind it is culled
 *                     there and those pixels keep the styled frame instead
 *
 * Both show up the same way: a rectangle of subtly different colour around a letter, a contact shadow or
 * a label, with straight edges nowhere near the artwork. So transparent objects are excluded from both by
 * default: they neither define the surface nor occlude it. `userData.compForcePosition` opts one back in
 * (a transparent object that really is the surface, such as a glass panel), and `userData.compNoPosition`
 * forces exclusion for opaque helpers and shadow catchers. A material with `alphaTest` is a cutout, not a
 * decal: it stays in both passes, which is what a revealed table or a rail needs.
 */
export interface DecalCandidate {
  userData?: Record<string, unknown>;
  material?: unknown;
}

/** True when the object must be kept out of the position pass and the occluder prepass. */
export function skipsPosition(o: DecalCandidate): boolean {
  if (o.userData?.compNoPosition) return true;
  if (o.userData?.compForcePosition) return false;
  const m = o.material as { transparent?: boolean } | { transparent?: boolean }[] | undefined;
  if (!m) return false;
  // multi-material: only a mesh that is transparent all over is a decal
  return Array.isArray(m) ? m.length > 0 && m.every((x) => !!x?.transparent) : !!m.transparent;
}
