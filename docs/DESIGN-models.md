# FLYWEIGHT: mechanical manga model direction

A salvaged laboratory instrument that learned to fight. All insects are machines.
The interface stays restrained and precise; the robots carry the grime.

## Reference and rendering

Reference: Daniel's local blender-to-threejs workflow and portfolio /resume scene.
Reuse the separation of meaningful surface shading and screen-space printing.
For this project the print is strictly monochrome: white paper, black ink,
nested halftone dots, crosshatch in deeper shadows, heavy silhouette accents.
No sepia, neon, coloured eyes, glow, glossy toy plastic, or organic insect flesh.
This is an authored adaptation, not a claim of an exact Blender scene conversion.

## General art style: apply to EVERY generation

Mechanical manga, drawn like a grimy black-and-white engineering plate. One coherent
manufacturing family: bone-white enamel, charcoal steel, exposed fasteners, chipped
corners, deep oily crevices. Shapes are angular and functional, with occasional rounded
optical housings. Broad readable armour surfaces carry the light; thin gaps carry black.
Use asymmetry in wear, not anatomy. Proportions are slightly exaggerated for readability,
never cute, glossy, colourful, steampunk-brass or photoreal organic insects.

The model provides silhouette, joints and surface relief. The runtime provides paper,
halftone dots, nested diagonal crosshatch and ink outlines; do not bake camera-facing
hatching, cast shadows or highlights into the geometry. Keep the UI quiet so the
mechanical subjects remain the expressive part of the composition.

REUSABLE PROMPT SUFFIX (all current generation prompts share this direction):
Mechanical insect battle robot, isolated full body, neutral standing pose, six separate
articulated piston legs with claw feet level on ground. Large compound camera eyes in
bolted housings. Two rigid perforated metal wing blades. Chipped white armour over black
steel, rivets, dents, vents, recessed cables. Grimy industrial manga machinery, readable
hard surface silhouette. All parts connected. No organic tissue, fur, transparent wings,
colour, glow, text, pedestal or scenery.

## Typography and composition

Barlow Condensed 700 for oversized specimen headlines; DM Sans for readable prose;
IBM Plex Mono for labels, clocks, budgets and neural measurements. Paper-white ground,
near-black ink, generous whitespace, frosted panels and hairline rules. The hero is an
oversized specimen plate, the arena an observation chamber, the editor a lab instrument.

## Shared construction

- Compact, readable silhouette at arena scale; head, thorax, abdomen identifiable.
- Two oversized faceted optical housings; black glass inside chipped white metal.
- Six articulated mechanical legs, with chunky hinges, exposed pistons and claws.
- Two rigid wing blades: perforated metal spars, visible hinges, no transparent membrane.
- Layered riveted armour; panel seams, dents, cut vents and exposed cable bundles.
- Grime comes from recesses, dents and roughness. Hatching comes from the renderer.
- No base, environment, floating parts, smoke, writing, logo, weapons held in hands.
- Neutral standing pose, every leg clear of the body, all feet on a common plane.
- GLB, Y-up after import, centred on the ground, forward aligned by inspection.
- Target 12,000 triangles per bot; normalize once on load. No runtime geometry repair.

## 01: DRONE / robotic Drosophila (first generation)

Lightweight scouting chassis. Large compound camera eyes, thin abdominal plates,
six spring-steel legs, small exposed flywheel in the thorax, twin narrow wing spars.
It should look agile but repairable with a screwdriver. Not a cute toy or real fly.

Meshy prompt:
A complete mechanical fruit fly battle robot, isolated full body in a neutral standing pose. Compact segmented metal head, thorax and tapered abdomen. Two oversized faceted compound camera eyes in bolted housings. Exactly six articulated piston legs with chunky hinges and claw feet, separated from the body. Two rigid swept-back perforated metal wing blades with exposed spars. Chipped white armour over blackened steel, rivets, panel seams, dents, vents and recessed cable bundles. Grimy industrial manga machinery, strong readable silhouette, hard surface geometry. All parts connected, feet level. No organic tissue, no fur, no transparent wings, no colour, no glow, no text, no logo, no pedestal, no scenery.

## 02: HORNET

Same manufacturing family; longer pointed abdomen, heavier shoulders, narrow visor,
longer swept wing blades. A black wedge between bone-white armour plates. Reinforced
front legs give a pursuing, forward-leaning silhouette. Geometry changes, not colour.

## 03: TANK

Low, wide, beetle-like mechanical fly; overlapping thorax plates and heavy hydraulic
legs. Short folded metal wings, thick impact bumper, protected camera eyes. Keep six
legs and insect anatomy readable; no tank treads or human cockpit.

## Acceptance

Inspect front, side and top views before import. Reject organic anatomy, fused legs,
missing wings, pedestal or unreadable blobs. Preview geometry is sufficient: the
runtime owns monochrome materials, so do not spend a texture pass to bake shading.
Keep generation task IDs and prompts as provenance, never API credentials.

## Credential handling

The Meshy key is entered in /private/tmp/flyweight-meshy-key.txt (mode 0600).
Generation tooling reads it in a local process and sends it only to api.meshy.ai.
Never use a VITE_ variable, browser request, source constant, public file or git file
for this credential. Only downloaded models and non-secret provenance ship.
