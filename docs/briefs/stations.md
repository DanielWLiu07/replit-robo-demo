# Brief — one continuous 3D world (lane: 1.3)

Remove the navbar and the page-switching model entirely. The whole app becomes one moon that
you fly the camera across.

## Three camera stations
1. **ARRIVAL** — the landing you already have.
2. **THE BAY** — your fly on a plinth on the **right**, configuration glass panels on the
   **left**, a FIGHT button.
3. **THE RING** — the arena, elsewhere on the surface.

Transitions are eased camera moves. Never cuts, never a page swap. No navbar, header or
footer anywhere.

## Look
Black dark glass throughout: near-black ground, translucent panels with a hairline light
border and backdrop blur, light type, monospace numerics. Instrumentation floating over
space, not a neon game UI.

## Use what exists
- `moonLayout.ts` exports `CAMERA` as one `{position, target}` plus `SCENE_LAYOUT`,
  `applyLayout`, `applyPlacement`. Extend `CAMERA` into a named `STATIONS` record and write
  an eased rig that interpolates between entries.
- `MoonStage.tsx` owns the moon, its GLSL shaders, the wordmark and the fly. It should stay
  **mounted permanently** instead of being one of four exclusive routes in `Flyweight.tsx`.

## The one real risk — resolve it first
`Arena.tsx` runs its own scene and renderer. Both are `THREE.WebGLRenderer` (the comment at
the top of MoonStage claiming WebGPU is stale), so folding the arena into the moon scene as
a group at the ring station should work. Fallback if it proves too tangled: a transparent
canvas stacked over the moon with the cameras kept in sync. Say which you chose and why.

## Keep
Hash routes as invisible deep links, so `#/fight` still flies the camera to the ring.
Verify every station by screenshotting in headless Chrome.

## Also still broken
Dark-on-light text that did not follow the palette inversion. `NeuralScope.tsx` draws on
canvas with hardcoded light colours (`#deded8` grid, `#111` spikes, `#545450` labels) and
`BrainView.tsx` uses `DIM #9c9c9c` / `LIT #101010` — on black the lit state must become
**bright**, not dark. The arena grid and floor in `Arena.tsx` are light too.
