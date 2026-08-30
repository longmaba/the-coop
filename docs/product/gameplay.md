# The Coop Gameplay Contract

## Campaign

The Coop is a four-level, two-explorer campaign played inside one private room.
Every room starts at Level 1. After a completed level, either connected
explorer may replay it or advance; the first accepted action wins. Advancing
after Level 4 starts the campaign again at Level 1.

There is no level selection or progression saved outside the room. Reconnects
restore the current level and its exact authoritative mechanism state.

## Character Customization

Every browser player chooses one of 12 animated human explorers on the landing
page before creating or joining a room. Invite links prefill the room code but
do not skip this choice. The selected avatar is carried in authoritative room
snapshots, rendered consistently for both peers, and preserved through
reconnect, replay, and level advancement.

Avatar choice is visual only: it does not change seats, movement, collision,
mechanics, or MCP permissions. Both players may choose the same character; the
existing P1/P2 labels remain the identity authority. Legacy clients, the local
MCP teammate, and older hosted room records receive deterministic seat-based
defaults when they do not provide a valid avatar.

## Interaction Rules

All interaction is movement-triggered. There are no action buttons, timers,
hazards, or precision-input requirements.

- A pressure plate or power button remains active while an explorer occupies
  its cell.
- A powered teleporter moves an armed explorer between its paired pads. That
  explorer must leave the arrival pad before the same pair can trigger again.
- Keycards are collected automatically and become shared level credentials.
- A security gate that requires relay buttons counts distinct explorers, not
  repeated occupancy by one explorer.
- Once all keycard and relay requirements are satisfied, a security gate stays
  unlocked for the rest of that level.
- Replaying or advancing clears level-local cards, gate latches, routes, and
  teleporter rearm state while preserving the room and seats.

## Levels

1. **Pressure Lock** preserves the original Plate A, Plate B, held gate, and
   shared exit puzzle.
2. **Powered Transit** teaches a held Alpha teleporter and Card Alpha; collecting
   the card permanently unlocks the main gate.
3. **Security Handshake** requires the traveler to return with Card Alpha so
   both explorers can occupy the two relay buttons and latch the gate.
4. **Crossed Circuits** chains Alpha and Beta. Explorer 1 powers Alpha so
   Explorer 2 can collect Card Alpha and power Beta. Explorer 1 uses Beta to
   collect Card Beta and return, then repowers Alpha so Explorer 2 can return.
   Both cards and both relay buttons unlock the final gate.

The authored solution may suggest roles, but reachable mechanisms are not
restricted by player ID. Players continue to pass through each other.

## Authority And MCP

The server owns levels, routes, teleportation, collection, gate state,
completion, replay, and advancement. Browser clients and the local MCP teammate
render or report schema snapshots without local gameplay prediction.

The stdio MCP teammate controls only Player 2 and retains the existing
`start_game`, `observe_game`, and `move_player_two` surface with its independent
game session. The experimental browser WebMCP adapter instead exposes `chat`,
`join_game`, `observe_game`, and `move_player_two` on the page. A human creates a
normal room first; `join_game` accepts exactly one bounded `code` string from an
unseated landing page, uses the character currently selected on that page (or
the deterministic Explorer A default), and succeeds only after the server
confirms Player 2 in seat 2. The browser adapter uses the page's existing network
and snapshot rather than creating a second session.

Successful human room creation opens a host-only onboarding dialog with a
copy-ready prompt. It uses the current game URL without invite query or pairing
details, includes the authoritative room code, and tells the agent to join with
WebMCP as Explorer 2. The agent plays its own explorer but lets the human lead,
does not offer unsolicited solutions, and speaks like a friendly co-player. The
host may reopen the dialog from the HUD while seat 2 is empty; it closes and the
action disables when the partner connects. Clipboard failure leaves the prompt
selected for a normal keyboard copy.

Both teammate adapters use the same transport-neutral observation, target, and
movement-settlement policy. Observations expose the active level, mechanism
geometry and state, players, routes, connectivity, and a neutral cooperative
goal without exposing pairing or reconnection credentials. The player-facing
schema intentionally omits authored solution steps, hidden gate requirements
and latch state, teleporter pairings, and future-level interactable IDs. During
gameplay, the teammate must reason from current observations, authoritative
movement outcomes, and player conversation rather than inspecting repository
source, tests, or design documentation for a solution.
