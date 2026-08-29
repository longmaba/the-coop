# 0001 Use Three.js For The Supplied-Asset Facility Client

Date: 2026-07-28

## Status

Accepted

## Context

The browser client previously drew the facility through a procedural Phaser
scene. The supplied modular facility, Lion, and Penguin assets are GLBs with
pack-specific colormaps and animations, and the requested presentation is a
fixed, elevated 3D view. The server remains authoritative for gameplay and
movement, and the Player-2-only MCP contract must remain unchanged.

## Decision

Use Three.js as a presentation-only client over the existing snapshot and
target-command bridge.

- `LEVEL_CATALOG` remains the sole level-layout authority.
- The catalog uses a square 16 by 16 footprint. Server-world coordinates
  convert through one exact world-to-scene transform.
- The camera is a true-isometric orthographic view at approximately 35.264
  degrees elevation above the ground plane and 45 degrees azimuth.
- Explorer 1 renders as the supplied Lion and Explorer 2 as the supplied
  Penguin.
- Missing mechanisms reuse the supplied floor-layer model with restrained
  emissive geometry and no more than four active point lights.
- Asset readiness gates room creation or joining, and the client does not keep
  a Phaser fallback.

## Alternatives Considered

1. Keep the procedural Phaser renderer and approximate the asset pack in 2D.
   Rejected because it would not use the supplied models or deliver the agreed
   elevated 3D presentation.
2. Rebuild gameplay and collision in the 3D client. Rejected because it would
   duplicate server authority and risk changing cooperative rules.
3. Apply a pixel-art treatment. Rejected because the supplied low-poly style is
   the accepted visual direction.
4. Keep the original 24 by 12 footprint at either 45 or zero degrees azimuth.
   Rejected by direct visual review because it reads as either a long diagonal
   strip or a wide compressed strip rather than a balanced isometric facility.

## Consequences

Positive:

- The four existing levels share one coherent supplied-asset visual language.
- Click projection, animation, resize, and renderer lifecycle are independently
  testable without changing simulation code.
- The selected production bundle is materially smaller than the former Phaser
  client bundle.

Tradeoffs:

- WebGL and GLB loading are now required before opening a room.
- The supplied pack has no license metadata in this repository, so its public
  redistribution terms must be confirmed.
- A single client chunk remains above Vite's default 500 kB warning threshold.

## Follow-Up

- Preserve server authority, the square footprint, and the fixed isometric
  camera unless a new accepted decision explicitly changes those contracts.
- Recheck renderer budgets and asset licensing before a public release.

## Follow-Up Amendment

On 2026-07-28, direct visual review rejected three intermediate combinations:
60 degrees above the ground flattened the walls; true isometric projection on
the 24 by 12 board produced a long diagonal strip; and zero-degree azimuth
compressed that same board into a wide horizontal strip. The accepted follow-up
changes the authoritative layouts to 16 by 16 and restores the true-isometric
35.264-degree elevation and 45-degree azimuth. This amendment changes layout
coordinates and presentation only; cooperative mechanic order, server
authority, and MCP ownership remain intact.
