# Execution Plan: Supplied-Style Three.js Facility Reskin

Date: 2026-07-28

## Status

Completed

## Outcome

Replace the Phaser procedural board with a fixed-camera Three.js presentation
using the supplied low-poly facility, lion, and penguin assets while preserving
all four authoritative layouts, interactions, routes, multiplayer behavior,
audio cues, and Player-2-only MCP control.

## Context

- `docs/product/gameplay.md` owns the current player-facing rules and the
  server-authoritative movement contract.
- `src/game/level.ts` owns all four 16 by 16 layouts and mechanism placement.
- `src/client/main.ts` owns the browser lifecycle, HUD, diagnostics, and
  renderer bridge.
- `tests/e2e/coop.spec.ts` and `tests/e2e/mcp-teammate.spec.ts` own the
  browser/browser and browser/MCP behavioral proof.

## Scope

In scope:

- Replace Phaser with Three.js and retain the existing client bridge.
- Load only selected GLBs and their two pack-specific colormaps.
- Render current floors, walls, doors, mechanisms, players, labels, feedback,
  and state transitions in the supplied low-poly style.
- Use a true-isometric orthographic camera at approximately 35.264 degrees
  elevation and 45 degrees azimuth, with pointer projection back to precise
  server-world coordinates.
- Recolor the existing HUD without changing its structure or accessibility.
- Add asset, transform, renderer, browser, visual, and performance proof.

Out of scope:

- Gameplay, pathfinding, simulation, server, network, schema, or MCP changes.
- Orbit or follow cameras, pixel-art treatment, generated assets,
  post-processing, mobile-specific controls, or a Phaser fallback.
- Macro room and corridor modules whose baked openings would change the
  existing walkability.

## Approach

1. Lock the asset and coordinate contracts with focused tests.
2. Build a cached GLB asset library and deterministic visual plan derived only
   from `LEVEL_CATALOG`.
3. Implement the Three.js renderer, camera, input projection, animation,
   mechanism feedback, lifecycle, and diagnostics.
4. Integrate asynchronous loading and the supplied-style HUD palette, then
   remove Phaser.
5. Validate gameplay parity, all four visual layouts, production asset URLs,
   renderer budgets, teardown, and cross-browser behavior.

## Risks And Recovery

- The environment and character packs both reference
  `Textures/colormap.png`; separate `LoadingManager` URL modifiers map each
  relative request to the correct Vite-imported texture.
- The 3D camera can desynchronize clicks; a single tested world-to-scene
  transform owns both projection and ground-plane unprojection.
- GLB animation and async loading can outlive a room; teardown is idempotent,
  disposed renderers ignore late completions, and shared source assets remain
  immutable.
- Visual walls can occlude players; the camera-facing perimeter uses supplied
  half walls while internal collision authority remains unchanged.
- Recovery is a clean revert of the renderer/client/dependency changes; game,
  server, and MCP modules are not modified.

## Progress

- [x] Inspect current renderer, level authority, asset inventory, model bounds,
  clips, textures, and baseline validation.
- [x] Add Three.js dependency, asset contracts, and asset library.
- [x] Add deterministic level visual plan and coordinate tests.
- [x] Implement renderer, camera, input, animation, visual state, and disposal.
- [x] Integrate loading UI, HUD palette, diagnostics, and remove Phaser.
- [x] Run visual iteration and browser/performance verification.
- [x] Update documentation, record result, and move this plan to completed.

## Decisions

- 2026-07-28: This is a visual-only reskin; `LEVEL_CATALOG` remains the sole
  layout authority and server-world units remain unchanged.
- 2026-07-28: Explorer 1 uses `animal-lion.glb`; Explorer 2 uses
  `animal-penguin.glb`, bound by stable player ID.
- 2026-07-28: Missing controls, teleporter pads, card bases, relay controls,
  and exits use `template-floor-layer.glb` with restrained procedural emissive
  markers and a maximum of four active point lights.
- 2026-07-28: Assets preload from the landing screen; create/join waits for
  readiness and fails closed before opening a room.
- 2026-07-28: The lasting renderer, camera, and authority boundary is recorded
  in `docs/decisions/0001-threejs-visual-client.md`.
- 2026-07-28: Direct visual review superseded the initial rectangular
  board-aligned framing. The current baseline is a 16 by 16 catalog at true
  isometric 35.264-degree elevation and 45-degree azimuth.

## Validation

- Focused proof: GLB contracts, external texture resolution, world/scene
  round trips, camera fit, visual-plan placement, animation state, and teardown.
- Integration or end-to-end proof: physical projected pointer movement,
  browser/browser Level 1 lifecycle, browser/MCP four-level campaign, replay,
  resize, load failure, and production asset requests.
- Repository-required checks: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`, production preview inspection, `npm run test:e2e`, and
  `npm audit --omit=dev`.

## Result

The procedural Phaser client was replaced with a Three.js renderer without
changing game, server, schema, pathfinding, networking, or MCP modules.

- All four authoritative layouts now render from the supplied modular facility
  kit. Explorer 1 uses the animated Lion and Explorer 2 the animated Penguin.
- Missing mechanisms use the supplied floor-layer model plus distinct,
  state-driven emissive markers and a four-light cap.
- The orthographic camera is true isometric at approximately 35.264 degrees
  elevation and 45 degrees azimuth. Physical browser clicks round-trip through
  the exact scene/world transform.
- Asset loading fails closed before room creation, while resize, replay,
  advancement, reconnect, and renderer teardown retain their existing
  contracts.
- The final visual-verdict score is 94 of 100. Desktop evidence covers all four
  square levels, and a 390 by 844 compact viewport has no horizontal overflow
  or cropped board corners.
- The original rectangular reskin baseline reported 106 calls, 213,724
  triangles, 56 geometries, and 14 textures. Ten completed create/leave cycles
  left no canvas, label-layer, animation-frame, or console residue.
- The production preview requested the JavaScript, CSS, nine selected GLBs, and
  two colormaps successfully: 13 of 13 responses were HTTP 200 with no request
  failures or console warnings/errors.
- `npm run lint`, `npm run typecheck`, 124 unit tests, the production build,
  and the cross-browser Playwright suite passed. Playwright reported 8 passed
  and 4 intentional project skips; Chrome also solved and wrapped the full
  four-level browser/MCP campaign.
- Phaser is absent from runtime source and the dependency graph. The production
  JavaScript is 784.27 kB raw and 209.69 kB gzip; Vite still reports its default
  warning because the single chunk exceeds 500 kB.
- `npm audit --omit=dev` reports zero vulnerabilities. The remaining release
  risk is that the supplied asset pack has no license metadata in this
  repository, so redistribution terms must be confirmed before publishing.
