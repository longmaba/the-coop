# Execution Plan: Pre-Game Character Customization

Date: 2026-08-30

## Status

Completed

## Outcome

Replace the fixed Lion and Penguin explorers with player-selected animated human
characters from `assets/new_characters/`. Every browser player chooses a
character before creating or joining a room, both peers see the authoritative
choices in local Colyseus and hosted play, reconnects preserve the choices, and
the legacy `assets/characters/` animal pack is removed.

## Context

- The user request is authority for replacing the current animals and adding a
  chooser before play.
- `docs/product/gameplay.md` owns the two-seat campaign and server-authoritative
  gameplay boundary.
- `docs/decisions/0001-threejs-visual-client.md` owns the presentation-only
  Three.js boundary and currently fixes Lion/Penguin by player ID; this plan
  supersedes only that avatar binding.
- `src/client/main.ts` owns landing, create, join, invite, and reconnect flows.
- `src/client/three/assets.ts` and `src/client/three/facility-renderer.ts` own
  GLB loading and rendered player models.
- `src/game/types.ts`, `src/game/simulation.ts`, `src/server/CoopRoom.ts`, and
  `src/hosted/service.ts` own shared player state across supported transports.
- Beads root `the-coop-nb7` tracks the execution sequence.

## Scope

In scope:

- Offer the 12 animated body models named `character-female-a` through `-f`
  and `character-male-a` through `-f` as selectable avatars.
- Add an accessible visual chooser to the landing screen and use the selected
  avatar for create, join, invite, reconnect fallback, and browser WebMCP join.
- Validate and propagate avatar IDs through local and hosted room state while
  preserving safe defaults for legacy callers and persisted hosted records.
- Keep the current camera, collision, movement, MCP ownership, and campaign
  behavior unchanged.
- Remove every file under `assets/characters/` after references migrate.

Out of scope:

- Composing the separate aid or wheelchair GLBs onto character skeletons.
- Changing gameplay stats, collision, movement speed, seats, or room capacity.
- Public deployment or widening the existing owner-only hosted access policy.

## Approach

1. Lock avatar ID validation, asset integrity, default compatibility, and state
   projection with focused tests.
2. Replace the fixed asset map with a 12-character catalog and reusable landing
   preview renderer.
3. Carry each selection through join options, authoritative player state,
   Colyseus schema, hosted request bodies, D1 compatibility normalization, and
   reconnects.
4. Wire the landing chooser into every browser entry path and render each
   snapshot player by its avatar ID.
5. Remove the animal pack, update product/decision truth, and run visual,
   focused, end-to-end, and repository-wide proof.

## Risks And Recovery

- Loading 12 animated GLBs increases initial transfer and memory. Mitigate with
  explicit bundle/asset budgets and shared immutable templates; retain the
  existing fail-closed preload behavior.
- Old callers and saved hosted JSON have no avatar field. Normalize missing or
  invalid values to deterministic seat defaults before simulation or rendering.
- A chosen model could have incompatible clips or texture paths. Verify every
  selectable GLB is valid GLB v2, uses the new pack colormap, and supplies idle
  and walk clips.
- Preview WebGL must not leak across landing/game transitions. Make preview
  disposal idempotent and cover lifecycle cleanup.
- Recovery is a coherent revert of catalog, UI, schema/API, documentation, and
  asset deletion; no database schema migration is required because hosted game
  state remains JSON.

## Progress

- [x] Create Beads decomposition and inspect repository/product authority.
- [x] Lock shared avatar and asset contracts with focused tests.
- [x] Implement avatar catalog, authoritative propagation, and compatibility.
- [x] Implement and visually verify the pre-game chooser.
- [x] Remove legacy animal assets and update lasting product/decision truth.
- [x] Run local and hosted unit, integration, E2E, build, and visual proof.

## Decisions

- 2026-08-30: Only the 12 skinned body models are standalone choices; aid and
  wheelchair files are unanimated attachments and remain available but are not
  exposed as characters.
- 2026-08-30: Avatar selection is presentation metadata carried in authoritative
  room snapshots; it does not change gameplay mechanics or MCP permissions.
- 2026-08-30: Missing/invalid legacy avatar data falls back deterministically by
  seat so old rooms and non-browser teammates remain playable.

Promote the lasting avatar-selection decision into `docs/decisions/`.

## Validation

- Focused proof: avatar parser/catalog/defaults, all selectable GLBs, snapshot
  normalization, renderer model replacement, lifecycle cleanup, join options,
  local schema propagation, hosted persistence/API bodies.
- Integration or end-to-end proof: two isolated browsers choose different
  characters, see both choices, reconnect with the same choices, and retain the
  existing create/join/solve flow in local and Sites modes.
- Visual proof: desktop and compact landing screenshots pass a structured
  visual-verdict threshold of 90 or higher.
- Repository-required checks: `npm run lint`, `npm run typecheck`,
  `npm run typecheck:site`, `npm test`, `npm run build`, `npm run build:site`,
  focused Playwright, `git diff --check`, and an asset-reference scan.

## Result

Completed on 2026-08-30.

- The landing screen now offers all 12 animated human body models with a live
  preview before room creation or join. Invite and browser WebMCP joins retain
  the visible landing selection; Explorer A is the documented fallback.
- Avatar IDs are validated and carried in authoritative state through local
  Colyseus, hosted Worker/D1 rooms, reconnect, replay, and level transitions.
  Missing legacy values receive deterministic seat defaults.
- The renderer uses snapshot avatar IDs for both peers. All 25 tracked files in
  `assets/characters/` were removed, and active-source plus built-output scans
  found no remaining legacy animal references.
- `npm test` passed 23 files and 207 tests. Lint, both TypeScript configurations,
  both production builds, `git diff --check`, and `npm audit --omit=dev` passed.
- Full local Playwright passed 10 tests with 8 project-intentional skips across
  Chrome, Edge, and Firefox. Sites Playwright passed its Chrome scenario with 3
  project-intentional skips. A post-review focused WebMCP join passed with the
  selected avatar asserted in the authoritative snapshot.
- Desktop and compact landing captures passed visual review at 95/100 against a
  90-point threshold.

Accepted limitations: selectable assets are eagerly preloaded within the
3.5 MiB asset budget, and Vite reports the existing-style chunk warning for the
approximately 821 kB minified client bundle. Aid and wheelchair files are
unanimated attachments, not standalone selectable bodies. Hosted MCP teammate
play remains unsupported as before. No commit, deployment, or access-policy
change was performed.
