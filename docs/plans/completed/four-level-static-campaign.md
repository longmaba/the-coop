# Execution Plan: Four-Level Static Coop Campaign

Date: 2026-07-28

## Status

Completed

## Superseding Layout Amendment

The campaign originally shipped on the 24 by 12 footprint documented below.
Direct visual review on 2026-07-28 later moved all four levels to 16 by 16 under
`docs/plans/active/square-isometric-campaign.md`. The mechanic cadence,
teleporter behavior, keycard sharing, relay requirements, campaign order, room
authority, and MCP surface described here remain unchanged.

## Outcome

Turn the current single-level vertical slice into a four-level campaign that
stays inside one room. Preserve Level 1, add three progressively harder static
cooperative levels using powered teleporters, shared keycards, and latched
two-player security gates, and keep both browser and MCP Player 2 control
authoritative and truthful.

## Context

- `README.md` describes the current single-level human-human and human-AI flow.
- `src/game/` owns deterministic geometry, pathfinding, simulation, and
  inspection.
- `src/server/CoopRoom.ts` owns seats, schema projection, reconnects, and level
  transitions.
- `src/client/` and `src/mcp/` consume authoritative snapshots without local
  gameplay prediction.
- The accepted implementation plan in the current task is product authority
  for progression, mechanics, MCP behavior, and verification.

## Scope

In scope:

- A frozen four-level 24x12 catalog with stable mechanism IDs.
- Static powered teleporters, shared keycards, relay-button gate latching, and
  deterministic replay/next-level transitions.
- Level-aware browser rendering, HUD, completion controls, and procedural
  feedback.
- Level-aware MCP observation and movement with no additional MCP tools.
- Unit, integration, stdio, and browser-plus-MCP coverage.

Out of scope:

- Timers, hazards, precision actions, pushable crates, level selection,
  persistent progression, remote hosting, or new dependencies.

## Approach

1. Generalize the level definition and authoritative simulation, then encode
   and validate all four level flows.
2. Project level and mechanism state through the existing Colyseus room while
   preserving seats, pairing, reconnect, and abandonment.
3. Render the active catalog level and add replay/next-level UX.
4. Extend the existing MCP observation and named movement contracts without
   adding a tool.
5. Complete focused and full verification, update product documentation, and
   move this plan to completed.

## Risks And Recovery

- Portal bounce or stale routes could misreport arrival; use per-player rearm
  state, clear routes on teleport, and settle MCP waits from authoritative
  post-teleport snapshots.
- Transition races could advance twice; retain monotonic authoritative
  sequences and accept exactly one completed-level action.
- Reconnect could lose mechanism progress; store cards, gate latches, level,
  and epoch in authoritative state and project them in snapshots.
- Level geometry could allow bypasses or soft locks; validate references and
  execute prescribed solve traces for every authored level.
- Recovery is a clean revert of this campaign's source, tests, and docs; no
  persistence migration or external service change is involved.

## Progress

- [x] Confirm accepted product decisions and map current single-level seams.
- [x] Record clean baseline proof: typecheck and 46 tests passed.
- [x] Implement level catalog and authoritative static mechanisms.
- [x] Project progression and mechanism state through the room.
- [x] Implement browser campaign rendering and controls.
- [x] Extend MCP observation and movement.
- [x] Add full automated proof and record the unavailable desktop-voice check.
- [x] Update documentation and complete this plan.

## Decisions

- 2026-07-28: Keep every level 24x12 and pathfinding portal-unaware; traversal
  is an explicit move to a powered pad followed by a new destination.
- 2026-07-28: Teleporter power has no timer. Arrival blocks only that explorer
  from immediately retriggering until they leave the pad.
- 2026-07-28: Keycards are shared level state and security gates permanently
  latch once their card and distinct-player relay requirements are met.
- 2026-07-28: Level 4 chains Alpha and Beta retrievals so both explorers take
  turns powering a portal and retrieving a card.
- 2026-07-28: Keep the MCP surface at three tools and expand observations and
  stable interactable targets instead of adding an interaction tool.
- 2026-07-28: Derive replay and advancement commands from the authoritative
  level epoch. Rejecting any other generation prevents a client from poisoning
  future transitions with an extreme sequence.
- 2026-07-28: Completion clears remaining routes, while MCP movement accepts
  every valid exit cell and both teleporter endpoints. Outcomes therefore
  report the actual authoritative cell when completion or held power changes
  the physical destination.
- 2026-07-28: The Playwright harness may explicitly reuse a verified running
  local server so validation does not stop or replace a developer's session.

## Validation

- Focused proof: catalog validation, prescribed solve traces, portal rearm,
  keycard collection, relay requirements, gate latching, transitions, client
  parsing, named targets, and movement settling.
- Integration or end-to-end proof: room progression/reconnect, unchanged
  human-human and human-AI lifecycle, real stdio framing, and full browser-plus-
  MCP campaign completion.
- Repository-required checks: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`, `npm run test:e2e`, `npm audit --omit=dev`, and
  `git diff --check`.

## Result

Implemented the four-level campaign in one authoritative room. The catalog,
portal/card/relay simulation, schema projection, browser rendering and controls,
MCP observation and movement, replay, advancement, reconnect preservation, and
Level 4 wrap are complete.

Verified on 2026-07-28:

- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm test` passed: 12 files and 71 tests.
- `npm run build` passed; Vite retained its non-blocking large-chunk warning.
- `THE_COOP_E2E_REUSE_SERVER=1 npm run test:e2e` passed: 7 tests, with the
  intentionally Chrome-only full-campaign test skipped on Edge and Firefox.
- `npm audit --omit=dev` reported zero vulnerabilities.
- `git diff --check` passed with only Windows line-ending conversion warnings.
- Independent code review returned APPROVE with no remaining findings.

The local dev process was restarted so its non-watching server half is running
the completed source. A real stdio MCP session was exercised directly, but the
Codex desktop voice surface was not available to automate in this environment;
that remains a manual user-surface check rather than a repository defect.
