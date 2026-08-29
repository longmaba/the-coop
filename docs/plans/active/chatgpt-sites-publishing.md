# Execution Plan: ChatGPT Sites Publishing

Date: 2026-08-29

## Status

Active

## Outcome

Publish an owner-only ChatGPT Site where two browser sessions can create, join,
and play the existing four-level cooperative campaign, while the established
local Node/Colyseus server and local MCP teammate continue to work unchanged.

## Context

- `README.md` defines the local-first split between the Vite client, the
  authoritative Colyseus room, and the local stdio MCP teammate.
- `src/game` is the deterministic, server-owned gameplay authority shared by
  runtime adapters.
- `src/client/network.ts` currently assumes a Colyseus WebSocket endpoint and
  falls back to loopback.
- ChatGPT Sites accepts Cloudflare Worker-compatible output and offers D1 and
  R2 bindings, but the supported Sites project manifest does not expose the
  Durable Object binding needed to coordinate this multiplayer room through
  the existing WebSocket transport.
- The untracked `assets/new_characters/` directory is unrelated user work and
  must remain untouched and outside the deployment.

## Scope

In scope:

- Add the minimal Sites build and D1 binding metadata.
- Add a same-origin hosted API adapter that persists authoritative room state
  in D1 and advances it with the existing deterministic game simulation.
- Select the hosted adapter only for the Sites build; preserve the local
  Colyseus and MCP flows.
- Add focused concurrency, protocol, build, and browser proof.
- Publish privately and verify the production URL.

Out of scope:

- Public or workspace-wide sharing without a separate access approval.
- Replacing the local Colyseus server or local MCP teammate.
- A hosted MCP teammate transport.
- Importing or publishing `assets/new_characters/`.

## Approach

1. Preserve the existing local transport and add a Sites-only client transport
   selected at build time.
2. Store one JSON-serializable `GameState` plus seat-token hashes, last-seen
   timestamps, and an optimistic revision in D1. Use compare-and-swap updates
   so concurrent player commands cannot overwrite one another.
3. Advance the same pure simulation from elapsed wall time during hosted API
   requests, and poll snapshots from clients frequently enough for the
   renderer's existing interpolation.
4. Emit a Cloudflare Worker-compatible Sites artifact with migrations, then run
   local regression and hosted-runtime checks before publishing.

## Risks And Recovery

- D1 polling has higher latency than the local WebSocket path. Keep the poll
  interval bounded, retain renderer interpolation, and verify a complete
  two-browser campaign flow.
- Concurrent requests could lose commands. Protect every mutation with a
  revision compare-and-swap retry and test simultaneous updates.
- Publishing supplied art may require redistribution rights. Keep the first
  deployment owner-only; do not widen access in this task.
- Recovery: deploy the previous saved Site version or remove the new Site. The
  local runtime remains available because its server and transport stay intact.

## Progress

- [x] Confirm the current frontend/server boundary and Sites runtime limits.
- [ ] Implement the Sites build, D1 schema, hosted API, and client transport.
- [ ] Run focused, repository-wide, and two-browser validation.
- [ ] Save and privately deploy the validated Site version.

## Decisions

- 2026-08-29: Preserve Node/Colyseus as the local and MCP transport. It relies
  on a listening Node HTTP server and cannot run unchanged in the Sites Worker.
- 2026-08-29: Use D1-backed optimistic room state for the hosted browser path.
  The Sites manifest exposes D1 but not the Durable Object coordination binding
  recommended for multiplayer WebSockets.
- 2026-08-29: Keep the initial deployment owner-only. This avoids widening
  access before the supplied asset pack's redistribution terms are confirmed.

## Validation

- Focused proof: hosted room-store/service unit tests, client protocol tests,
  migration generation, and Sites artifact structure checks.
- Integration or end-to-end proof: local Colyseus integration and MCP tests,
  existing two-browser Playwright suite, plus hosted-worker create/join/move
  checks against local D1.
- Repository-required checks: lint, typecheck, unit/integration tests, normal
  build, Sites build, E2E, dependency audit, and `git diff --check`.

## Result

Complete after implementation. Record the production URL, verified multiplayer
behavior, local-server regression status, access limitation, and any remaining
hosting risks before moving this plan to `docs/plans/completed/`.
