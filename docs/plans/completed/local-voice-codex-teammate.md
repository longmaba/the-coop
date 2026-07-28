# Execution Plan: Local Voice-Controlled Codex Teammate

Date: 2026-07-27

## Status

Completed

## Outcome

Provide a project-scoped local stdio MCP server that owns the authorized
Player 2 seat in a human-AI Colyseus room, returns a one-time browser pairing
link for Player 1, exposes deterministic observation and movement tools, and
preserves the existing human-human flow.

## Context

- `README.md` documents the current local two-browser game.
- `src/game/` owns deterministic level, pathfinding, simulation, and protocol
  contracts.
- `src/server/CoopRoom.ts` owns room seats, movement authorization,
  reconnection, and abandonment.
- `src/client/network.ts` owns browser join and reconnection behavior.
- The supplied implementation plan is accepted product authority for pairing,
  MCP tools, security boundaries, Codex configuration, and verification.

## Scope

In scope:

- Human-human and human-AI room/join contracts with role-bound seats.
- One-time, expiring, hashed Player 1 pairing tokens.
- Deterministic shared observation projection and named targets.
- Local stdio MCP Player 2 client with start, observe, and move tools.
- Project Codex MCP configuration and Windows usage documentation.
- Unit, integration, stdio protocol, and browser-plus-MCP coverage.

Out of scope:

- Custom speech UI, autonomous solving, remote MCP transport, Player 1 MCP
  control, and MCP restart tools.
- Public hosting or non-loopback operation.

## Approach

1. Map existing room, client, simulation, and test contracts.
2. Add shared join/pairing/inspection primitives with focused unit proof.
3. Extend authoritative room creation, seat assignment, and invite redemption
   while preserving human-human behavior.
4. Implement the single-session MCP client and stdio tool surface.
5. Add browser fragment pairing, project Codex config, and documentation.
6. Add integration, protocol, and end-to-end proof, then run all repository
   gates.

## Risks And Recovery

- Pairing mistakes could expose or swap seats; keep secrets outside schema and
  logs, bind role to mode, and prove one-time atomic redemption.
- MCP stdout contamination breaks protocol framing; route diagnostics to stderr
  and exercise the real subprocess protocol.
- Reconnect changes could regress human-human play; retain the current path and
  rerun its existing lifecycle matrix.
- Recovery is a clean revert of this plan's files and dependency additions; no
  persistent data migration is involved.

## Progress

- [x] Map current authority and test seams.
- [x] Implement shared contracts, pairing, inspection, and named targets.
- [x] Implement human-AI room lifecycle and browser pairing.
- [x] Implement MCP session client and tool server.
- [x] Add project configuration and documentation.
- [x] Complete focused, integration, protocol, and E2E tests.
- [x] Run lint, typecheck, unit/integration, build, and E2E gates.

## Decisions

- 2026-07-27: Use the supplied plan as product authority; no materially open
  policy choices remain.
- 2026-07-27: Keep pairing credentials in room-private memory and client
  reconnection credentials in process/session memory only.

## Validation

- Focused proof: pairing, projection, target resolution, sequence, and movement
  settling unit tests.
- Integration or end-to-end proof: human-AI room lifecycle, real stdio MCP,
  browser-plus-MCP cooperative completion, and unchanged human-human flow.
- Repository-required checks: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`, and `npm run test:e2e`.

## Result

Implemented the project-scoped local stdio MCP teammate with a role-bound
Player 2 seat, one-time hashed Player 1 pairing, deterministic observations,
authoritative named/grid movement, reconnect handling, Codex configuration,
and Windows usage documentation.

Verified on the final dependency state:

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 9 files, 46 tests passed.
- `npm run build`: passed.
- `npm run test:e2e`: 6 tests passed across Chrome, Edge, and Firefox.
- `npm audit --omit=dev`: 0 vulnerabilities. The requested MCP SDK remains
  pinned at 1.29.0 and its Hono transitive is overridden to patched 2.0.12.
- `codex mcp get the_coop_teammate`: confirmed stdio command, three-tool
  allowlist, 20-second tool timeout, and prompt-by-default approval policy.
- `git diff --check`: passed.

Limitation: this environment cannot operate the Codex desktop voice surface, so
the final spoken-command smoke test has not been performed here. The same
start, observe, named/grid movement, stay-on-plate, threshold-stop, and
cooperative completion paths are covered through the real stdio protocol and
browser-plus-MCP tests.
