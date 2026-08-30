# 0003 Use Authoritative Player-Selected Human Avatars

Date: 2026-08-30

## Status

Accepted

## Context

The client previously derived presentation locally from seat identity: Player
1 always rendered as a Lion and Player 2 as a Penguin. Players now need to
choose from the supplied animated human models before play, and both local
Colyseus and hosted Worker/D1 sessions must show the same choice after
reconnects and level transitions.

## Decision

- Offer the 12 skinned `character-*.glb` body models in
  `assets/new_characters/` as the complete selectable avatar catalog.
- Carry a validated avatar ID as presentation metadata in authoritative player
  state and every browser snapshot. It does not replace player ID or seat
  ownership.
- Require normal browser create and join flows to present the chooser first.
  Invite URLs prefill the room but do not join automatically. Saved-seat reload
  remains an automatic reconnect because the authoritative room already owns
  that seat's selection.
- Preserve legacy callers and persisted hosted JSON by assigning deterministic
  seat defaults when avatar data is missing or invalid.
- Allow duplicate selections and retain P1/P2 labels for disambiguation.
- Keep aid and wheelchair GLBs outside the avatar catalog until a separate
  attachment or vehicle contract owns their composition and animation.

## Alternatives Considered

1. Keep avatar choice client-local. Rejected because peers, reconnects, and
   hosted sessions could render different characters for the same player.
2. Encode avatar in browser session storage only. Rejected because the room,
   not a particular tab, owns reconnect state and cross-client consistency.
3. Treat every GLB in the new directory as a character. Rejected because aids
   and wheelchairs are unskinned, unanimated attachments rather than standalone
   bodies under the current renderer contract.
4. Enforce unique choices. Rejected because no product rule requires it and
   seat labels already provide unambiguous identity.

## Consequences

Positive:

- Both supported multiplayer transports render the same selected character.
- Reconnect, replay, advancement, legacy clients, and old hosted records have a
  deterministic compatibility path.
- The old animal asset pack is no longer part of the runtime or repository.

Tradeoffs:

- Eagerly preloading all selectable bodies raises the selected GLB/texture
  budget to 3.5 MiB.
- Avatar selection extends shared player and transport schemas even though it
  has no gameplay effect.

## Follow-Up

- Confirm redistribution rights for the supplied pack before public release.
- Introduce a separate authored attachment system before exposing aid or
  wheelchair assets as composable customization choices.
