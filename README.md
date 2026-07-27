# The Coop

A local-first, two-player realtime puzzle prototype. Two explorers share one authoritative facility: one holds a pressure plate to open the central door, the other crosses to the far plate, and both must reach the exit.

## Run locally

Requirements:

- Node.js 24 (the repository includes `.node-version`)
- A current Chrome, Edge, or Firefox browser

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173` in one browser profile, select **Create Room**, then use the displayed room code or invite URL in a second browser profile. Session storage is isolated per profile, so two separate profiles or private windows are the most reliable local setup.

Movement is pointer-only: click a reachable destination and the authoritative server computes the route. A click beyond a closed door stops the explorer at the threshold; after a partner opens the door, click the destination again.

## Level 1

1. Explorer 1 stands on Plate A, opening the door.
2. Explorer 2 crosses and stands on Plate B.
3. Plate B holds the door while Explorer 1 crosses.
4. Both explorers enter the marked exit zone.
5. Either explorer may restart the level.

Players can pass through each other. If a connection drops during play, the room freezes for a 30-second reconnection window and resumes the exact state when the seat returns. If the window expires, the session is abandoned.

## Architecture

- `src/game`: deterministic hidden-grid A*, fixed-step movement, door/plate/exit rules
- `src/server`: private two-seat Colyseus room and schema projection
- `src/client`: Phaser scene, lobby, networking, HUD, procedural visuals, and audio cues
- `tests/unit`: pathfinding, simulation, client state, and protocol-boundary tests
- `tests/integration`: real Colyseus SDK room lifecycle
- `tests/e2e`: two isolated browser clients solving, reconnecting, rejecting a third seat, and restarting

The server owns movement, phase changes, collision rules, completion, and restart. Clients send sequenced target requests and render schema snapshots without local gameplay prediction.

## Verify

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev
```

The Playwright suite targets installed Chrome, Edge, and Firefox browsers. Production hosting and internet matchmaking are intentionally outside this first local vertical slice.
