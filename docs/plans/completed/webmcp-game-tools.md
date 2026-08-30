# Execution Plan: WebMCP Game Teammate Tools

Date: 2026-08-29

## Status

Completed

## Outcome

Expose `join_game`, `observe_game`, and `move_player_two` as document-lifetime
WebMCP tools beside `chat`. A browser agent joins a room created by the human,
is accepted only as Player 2, observes the same safe projection as the stdio
teammate, and receives server-confirmed movement outcomes.

## Authority And Decisions

- The user request authorizes the three WebMCP tools and the human-creates,
  agent-joins room flow.
- `docs/product/gameplay.md` keeps the existing stdio teammate supported; this
  change adds a browser adapter without sharing mutable session state.
- `main.ts` remains the sole browser lifecycle and `CoopNetwork` owner.
- WebMCP handlers register once and read current lifecycle state at execution.
- `join_game` succeeds only after authoritative seat assignment confirms seat
  index 1 and `player-2`; wrong-seat, stale-generation, concurrent, failed, or
  timed-out joins clean up and fail explicitly.
- Observation, target resolution, and movement settlement must remain transport
  neutral and semantically identical between browser and stdio paths.

## Dependency Order

1. Extract or relocate browser-safe observation and movement policy without
   changing behavior.
2. Extend the browser network boundary with validated seat waiting and complete
   move-result messages.
3. Add generation-safe browser lifecycle operations for join, observe, and
   move.
4. Register strict WebMCP contracts and compose them from `main.ts`.
5. Update product/usage documentation and prove parity plus one real two-page
   browser flow.

## Risks And Recovery

- A join may return before seat assignment; verify that the WebMCP promise stays
  pending until authoritative Player 2 confirmation.
- A stale async join may overwrite a newer lifecycle; guard every completion by
  lifecycle generation and dispose stale connections.
- Browser and stdio projections may drift; run both over the same snapshot and
  assert hidden fields remain absent.
- Movement may claim arrival from acceptance alone; require matching move result
  and a later settled authoritative snapshot.
- Recovery is a coherent revert of this plan's source, test, and documentation
  changes; there is no persistent-data migration.

## Progress

- [x] Inspect repository authority, runtime lifecycle, providers, workspaces,
  active seats, and baseline proof.
- [x] Complete independent `FOUNDATION_CHECK v1` and accept the browser-single-
  session/shared-pure-policy design.
- [x] Implement the initial vertical WebMCP lifecycle frontier.
- [x] Run deterministic focused proof and one frozen macro review.
- [x] Correct the frozen finding set: `LIFECYCLE-001`, `MOVEMENT-001`,
  `TERMINAL-001`, `RECONNECT-002`, and `WEBMCP-REG-001`.
- [x] Run bounded close-out against the correction delta and direct regressions.
- [x] Run focused, integration, composition, and repository-wide validation.
- [x] Apply the converged final delta for stale saved-seat cleanup and
  reconnecting WebMCP availability, then rerun only direct proof plus final
  gates owned by Lead.
- [x] Record the final result and move this plan to `docs/plans/completed/`.

## Review Ruling

The exploratory macro review verified the exact candidate and returned one
complete material batch. All five findings were accepted once and frozen:

- fence late/superseded connections and stale callbacks;
- require exact authoritative movement sequence for arrival;
- fail browser tools closed in terminal states;
- prevent scheduled SDK reconnection after disposal; and
- prevent and report partial WebMCP registration.

One writer owns one correction batch. Close-out is limited to these finding IDs,
the correction delta, and direct regressions; it will not restart broad review.

## Convergence Ruling

The bounded close-out resolved `MOVEMENT-001`, `RECONNECT-002`, and
`WEBMCP-REG-001`. It reproduced two remaining cases within the original finding
families:

- `LIFECYCLE-001`: a stale `joinAsPlayerTwo` rejection can call `dispose(true)`
  and clear the saved seat written by a newer lifecycle;
- `TERMINAL-001`: a dropped connection in `reconnecting` state still permits
  browser observation/movement and leaves a pending movement unsettled.

These are accepted as one final bounded correction delta. No third broad review
or duplicate acceptance lane will be opened; Lead owns direct regression proof
and final acceptance after the correction.

## Validation

- Unit: strict schemas/input validation, registration once with fresh lifecycle,
  projection parity, target resolution, and movement settlement edge cases.
- Integration: seat wait, Player 2 enforcement, complete move-result validation,
  concurrent/stale joins, failures, and cleanup.
- E2E: a human browser creates a normal room; a second browser invokes captured
  WebMCP `join_game`, `observe_game`, and `move_player_two`, then reports an
  authoritative arrival.
- Gates: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`,
  targeted Chrome Playwright, full `npm run test:e2e`, and `git diff --check`.

## Final Result

- The page registers `chat`, `join_game`, `observe_game`, and
  `move_player_two` once for the document lifetime.
- `join_game` uses the browser's sole lifecycle/network and succeeds only after
  authoritative Player 2 seating; stale, failed, concurrent, and terminal paths
  fail closed and clean up without disturbing a newer lifecycle.
- Browser and stdio tools share safe observation and movement policy while
  retaining independent transports and sessions.
- Lead acceptance on the final candidate: lint and typecheck passed; 46 focused
  tests passed; all 19 test files and 158 tests passed; production build passed;
  Chrome E2E passed 6/6 on isolated ports; `git diff --check` passed.
- Edge and Firefox remain unexecuted because their Playwright binaries are not
  installed in this environment. The production build retains its pre-existing
  large-chunk warning.
