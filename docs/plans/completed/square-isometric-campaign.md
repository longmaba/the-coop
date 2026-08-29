# Execution Plan: Square Isometric Campaign

Date: 2026-07-28

## Status

Completed

## Outcome

Replace the stretched 24 by 12 campaign footprint with four 16 by 16
server-authoritative layouts and restore a true isometric orthographic camera,
while preserving each level's cooperative mechanic sequence, replay/campaign
flow, multiplayer authority, and Player-2-only MCP behavior.

## Context And Authority

- Direct user visual feedback owns the new presentation requirement: the
  rectangular footprint is rejected, the levels should be more square, and the
  camera should be isometric.
- `src/game/constants.ts` owns shared grid dimensions and cell size.
- `src/game/level.ts` owns layout walls, spawns, gates, thresholds,
  interactables, and campaign order.
- `src/game/inspection.ts` owns stable named MCP targets and top-left
  projections.
- Server simulation and snapshot state remain authoritative; client scene
  transforms must follow the catalog rather than invent a second layout.

## Scope

In scope:

- Use a 16 by 16 grid for all four levels.
- Remap walls, spawns, doors, thresholds, exits, pressure plates,
  teleporters, keycards, and relays while retaining the four puzzle identities.
- Restore the equal-axis isometric camera at approximately 35.264 degrees
  elevation and 45 degrees azimuth.
- Update coordinate assumptions, named targets, tests, docs, screenshots, and
  renderer framing.

Out of scope:

- New mechanics, new levels, matchmaking, schema changes, movement-speed
  changes, physics, orbit controls, or non-visual asset replacement.

## Approach

1. Map every hard-coded grid coordinate and existing puzzle invariant.
2. Author four deterministic 16 by 16 layouts with a central gated divider and
   square outer shell.
3. Update named targets and coordinate-bound tests without weakening
   authoritative route assertions.
4. Restore true isometric framing and verify physical click projection.
5. Solve all four levels through browser/MCP, inspect desktop/mobile evidence,
   and run the visual-verdict loop to 90 or above.

## Risks And Recovery

- Coordinate drift can silently break named MCP movement; update inspection
  projections and assert exact target cells.
- A visually square board can still be unsolvable; retain end-to-end
  cooperative completion as the release gate.
- Internal walls can occlude characters in isometric view; use the existing
  camera-facing half-wall rule and verify all four screenshots.
- Recovery is a clean revert of this plan's layout, camera, coordinate-test,
  and documentation changes; networking and simulation algorithms are not
  modified.

## Progress

- [x] Record rejected camera variants and choose a 16 by 16 square footprint.
- [x] Map coordinate ownership and existing puzzle invariants.
- [x] Implement all four square authoritative layouts.
- [x] Restore true isometric camera and square framing.
- [x] Update unit, integration, browser, and MCP coordinate proof.
- [x] Pass visual, responsive, build, lifecycle, and production checks.
- [x] Record result and move this plan to completed.

## Decisions

- 2026-07-28: Use 16 by 16 because it preserves a similar cell budget to the
  former 24 by 12 board while producing equal scene extents.
- 2026-07-28: Preserve campaign mechanic order: pressure exchange, powered
  transit, security handshake, then crossed circuits.
- 2026-07-28: Direct user visual review supersedes the earlier 60-degree,
  true-isometric-on-rectangle, and board-aligned camera attempts.
- 2026-07-28: Use a divider at x=7 with two gate cells at y=7 and y=8.
  Standard spawns remain on the left; the exit occupies a 3 by 4 zone on the
  right. Level-specific mechanisms retain their original side and dependency
  order.
- 2026-07-28: Make Playwright client and game-server ports configurable so a
  current-source browser matrix can run without replacing a developer's
  persistent local session.

## Validation

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- Chrome/Edge/Firefox Level 1 browser and MCP proof
- Chrome full four-level browser/MCP campaign and wrap
- Physical projected click on every level
- Desktop four-level montage and Pixel 7 screenshot
- Visual verdict at least 90
- Production asset request and console/page-error checks

## Result

All four authoritative levels now use a 16 by 16 footprint with a central
divider, two-cell gate, left-side spawns, and a shared 3 by 4 exit zone. Pressure
exchange, Alpha transit, the card-return relay handshake, and the Alpha/Beta
crossed-circuit sequence all preserve their original dependency order.

- The camera is true isometric at approximately 35.264 degrees elevation and
  45 degrees azimuth. Camera-facing east and south perimeter edges derive their
  bounds from the shared grid constants.
- MCP grid validation derives its maximum coordinates from the catalog, and
  the semantic exit target now chooses the exit-zone center without a
  level-specific coordinate.
- Browser tests exercise physical projected clicks, two-browser multiplayer,
  Player-2 MCP movement, all four level solves, advancement, wrap, replay,
  reconnect, and asset-load failure.
- Clean desktop captures cover Levels 1 through 4. The visual-verdict score is
  94 of 100, and the 390 by 844 compact proof has no horizontal overflow or
  cropped board corners.
- `npm run lint`, `npm run typecheck`, all 132 Vitest tests, and `npm run build`
  passed. The production bundle retains Vite's non-blocking warning for its
  784.22 kB JavaScript chunk.
- The isolated Chrome/Edge/Firefox Playwright matrix passed 8 tests with 4
  intentional Chrome-only skips. Chrome completed and wrapped the full
  browser/MCP campaign.
- The production preview returned HTTP 200 for the JavaScript, CSS, nine GLBs,
  and two colormaps: 13 of 13 asset responses, with no failed requests,
  warnings, console errors, or page errors.
- `npm audit --omit=dev` reported zero vulnerabilities, and `git diff --check`
  found no whitespace errors.

The supplied asset pack still has no license metadata in the repository, so
redistribution terms remain the only known release risk. A follow-up runtime
parity fix replaced the stale persistent process and changed `npm run dev` to
watch authoritative game/server dependencies. Server-side edits now restart
that process, resetting active rooms instead of leaving new visuals paired with
old pathfinding coordinates.
