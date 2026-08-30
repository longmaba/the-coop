# Execution Plan: WebMCP Onboarding Popup

Date: 2026-08-31

## Status

Completed

## Outcome

After a human creates a room, show a focused onboarding dialog containing a
copy-ready prompt with the current game URL and room code. The prompt tells a
WebMCP agent to join as Explorer 2, play its own explorer, let the human lead,
avoid unsolicited solutions, and speak like a friendly co-player.

## Context

- The user request is authority for the prompt behavior and friendly-teammate
  guardrails.
- `src/client/main.ts` owns room creation, room-code display, HUD actions, and
  the document-lifetime WebMCP composition.
- `src/client/webmcp.ts` owns the strict `join_game` tool contract.
- `docs/product/gameplay.md` is the current player and WebMCP behavior contract.
- Existing game overlays use semantic HTML layered above the Three.js facility.

## Scope

In scope:

- Generate a prompt from the current page URL and authoritative room code.
- Open the dialog after successful human room creation and allow reopening from
  the HUD while the second seat is empty.
- Provide one-click copy feedback, keyboard dismissal, focus management, and a
  selectable fallback when clipboard access is unavailable.
- Verify desktop and phone-sized layout plus the existing WebMCP join path.

Out of scope:

- Changing WebMCP tool schemas or autonomous movement policy.
- Opening the dialog for Player 2 or changing the stdio MCP teammate flow.
- Adding new graphical assets or dependencies.
- Deploying or restarting the VPS without a separate release request.

## Approach

1. Lock the generated prompt and URL normalization in unit tests.
2. Add the native dialog, room lifecycle wiring, clipboard state, and HUD
   reopen action.
3. Add authored responsive styling that matches the facility HUD.
4. Add browser assertions for automatic open, copy, close/reopen, focus, and
   compact viewport fit.
5. Update product guidance, run full checks, review, and close Beads.

## Risks And Recovery

- A modal could block normal play after a partner joins; close it automatically
  when the second seat appears and keep it host-only.
- Clipboard permission may be unavailable; select the read-only prompt and show
  the standard keyboard-copy fallback.
- Reverting the isolated prompt module, dialog markup/styles, and tests restores
  the prior room flow without protocol or persisted-state changes.

## Progress

- [x] Define and test the prompt contract.
- [x] Implement the dialog lifecycle and copy interaction.
- [x] Verify accessible responsive presentation.
- [x] Run focused and full validation.
- [x] Record the result and complete review.

## Decisions

- 2026-08-31: Use a native `<dialog>` so Escape, modal focus containment, and
  assistive-technology semantics come from the platform.
- 2026-08-31: Show the prompt only after successful room creation; joining and
  reconnecting players can see the HUD action only while seat 2 is empty.
- 2026-08-31: Keep the human in charge without making the agent passive: it
  plays Explorer 2 but offers puzzle suggestions only when asked.
- 2026-08-31: Reuse the hosted human-human join endpoint for browser WebMCP;
  the hosted service already assigns and authenticates Player 2, while the
  client verifies the authoritative seat before exposing the session.

## Reference Ledger

| Loaded | Reference | Purpose |
| --- | --- | --- |
| yes | `threejs-game-ui-designer/references/ui-patterns.md` | Modal hierarchy, semantic HTML, state wiring, responsive constraints |
| yes | `references/checklists/game-ui-quality.md` | Stable controls, world/UI cohesion, modal-state quality |
| yes | `references/checklists/hud-readability.md` | Avoid covering gameplay except while intentionally modal |
| yes | `references/checklists/responsive-ui-fit.md` | Desktop/phone fit, text wrapping, reachable actions |
| yes | `references/checklists/mobile-input.md` | Touch target and viewport checks |
| yes | `references/prompt-templates.md` | Adapted menu verification constraints; no template copied verbatim |
| no | `threejs-image-generator` | Existing CSS visual language is sufficient; no new art is needed |

## UI States

- Waiting host: dialog opens with populated prompt and enabled copy action.
- Copy success: polite confirmation and stable `Copied` button state.
- Copy unavailable: prompt is selected and keyboard-copy fallback is announced.
- Dismissed: gameplay remains visible; HUD action reopens the dialog.
- Partner connected: dialog closes and the invite-agent action is disabled.
- Joining/agent page: dialog does not auto-open.
- Compact viewport: content scrolls inside safe viewport bounds; actions remain
  reachable with practical touch targets.

## Validation

- Focused proof: 2 prompt-generation unit tests and the Chrome onboarding-dialog
  Playwright path passed.
- Integration proof: the browser WebMCP join path reached Player 2, closed the
  host dialog, and disabled its reopen action.
- Responsive proof: desktop and 390-by-844 screenshots passed the visual-verdict
  gate at 94/100, with viewport bounds and 44-pixel controls asserted.
- Repository proof: lint, both TypeScript configurations, 24 Vitest files with
  210 tests, local and Sites production builds, the local Playwright matrix
  (11 passed, 10 intentionally skipped), the Sites transport path (2 passed,
  3 intentionally skipped), the production dependency audit, secret scan, and
  `git diff --check` all passed.

## Result

The host now receives a copy-ready, human-led WebMCP teammate prompt after room
creation and can reopen it until Explorer 2 arrives. Local Colyseus and hosted
Sites transports both support the prompted `join_game` flow, including
observation and movement. Documentation, clipboard fallback, accessible
responsive presentation, lifecycle behavior, and repository-wide validation
are complete. Independent review found no remaining blockers. No VPS deployment
or restart was performed for this feature.
