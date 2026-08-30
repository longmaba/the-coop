# The Coop

A local-first, two-player realtime puzzle campaign. Two explorers share one
authoritative room across four static facilities, coordinating pressure plates,
powered teleporters, shared keycards, relay buttons, and cooperative exits.

## Run locally

Requirements:

- Node.js 24 (the repository includes `.node-version`)
- A current Chrome, Edge, or Firefox browser

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173` in one browser profile, choose a character,
then select **Create Room**. Open the displayed invite URL in a second browser
profile, choose that player's character, and select **Join**. Session storage is
isolated per profile, so two separate profiles or private windows are the most
reliable local setup.

When the game is open in a WebMCP-capable built-in browser, the page registers
`chat`, `join_game`, `observe_game`, and `move_player_two` once for that page.
`join_game` takes exactly `{ "code": "ROOM_CODE" }` on an unseated landing page
and uses the character currently selected there (Explorer A by default): create
a normal room as Explorer 1 in another browser, copy its room code, and give that
code to the agent. The call succeeds only after the game server assigns the
built-in browser as Explorer 2. The agent can then observe the safe current
level and request server-authoritative Explorer 2 movement, waiting for either
acceptance or confirmed arrival. Explorer 1 pages cannot use the observation or
movement tools. This browser flow differs from the stdio teammate below:
WebMCP joins a room the human already created, while stdio `start_game` creates a
human-AI room and returns a one-time Explorer 1 link.

Calling `chat` with `{ "message": "Hold Plate A" }` displays the message in the
active game for five seconds; a newer message replaces it and restarts that
timer. Messages are limited to 500 Unicode characters. On the landing page
`chat` returns `NO_ACTIVE_GAME`, and ordinary browsers without
`document.modelContext` continue to run the game without registering tools.

Movement is pointer-only: click a reachable destination and the authoritative server computes the route. A click beyond a closed door stops the explorer at the threshold; after a partner opens the door, click the destination again.

The development launcher watches both client and authoritative game/server
dependencies. A game or server source edit restarts the authoritative process
so rendered walls and server pathfinding stay on the same level definition;
active rooms reset after that restart and should be rejoined.

## Run on a VPS

The production runtime serves the compiled Vite client, Colyseus matchmaking,
health checks, and WebSocket upgrades from one origin:

```bash
npm ci
npm run build
npm prune --omit=dev
npm run start:production
```

It binds to `127.0.0.1:6000` by default. `THE_COOP_HOST`, `THE_COOP_PORT`, and
`THE_COOP_STATIC_ROOT` can override the binding and build directory. The
tracked `deploy/ecosystem.config.cjs` runs the service as the single-process
PM2 app `the-coop`; keep it single-process while rooms remain in memory.

For Cloudflare Tunnel, route the public hostname to
`http://127.0.0.1:6000` without path rewriting. Players visit the public HTTPS
hostname on port 443; they should not browse directly to port 6000, which web
Fetch implementations classify as a blocked port. Verify the origin through
`/__healthcheck`. Restarting the process ends active rooms. The Codex teammate
MCP remains a local-only companion and is not hosted by this service.

## Play with a Codex teammate by voice

The repository also includes a project-scoped, local stdio MCP server that
controls only Explorer 2. Codex desktop voice supplies the speech surface; the
game does not capture or synthesize audio itself.

On Windows:

1. From the repository root, run `npm install`, then `npm run dev`. Leave that
   terminal running.
2. Trust and open this repository root in the Codex desktop app. Project MCP
   configuration is ignored for untrusted repositories.
3. Start a new Codex conversation and enter `/mcp`. Confirm
   `the_coop_teammate` is connected and exposes only `start_game`,
   `observe_game`, and `move_player_two`.
4. In desktop voice, say “start a game.” Codex calls `start_game` and returns a
   loopback Player 1 link.
5. Open that link in a browser, choose a character, and select **Join**. Its
   one-time pairing credential is kept in the URL fragment, redeemed through
   Colyseus, saved as a reconnection seat, and then removed from the address
   bar.
6. Give game instructions such as “stand on Plate A,” “power Teleporter
   Alpha,” “use the Alpha teleporter,” “get Card Alpha,” or “stay on Gate
   Button B.” Codex observes the active level before resolving references and
   reports the authoritative outcome. Explorer 2 stays at an arrived target
   until movement or a powered teleporter changes its position.

Casual conversation does not move either explorer. The MCP tools cannot control
Explorer 1, submit positions, choose a player ID, or bypass the server’s
movement validation. A link expires after ten minutes and can be redeemed once.
`observe_game` reports only the current level's visible geometry, mechanisms,
players, and live state plus a neutral shared goal. It does not reveal authored
solution steps, hidden gate requirements, teleporter pairings, or future-level
interactable IDs. During play, the MCP teammate is instructed to solve from
observations, movement outcomes, and your conversation—not repository source,
tests, or design documentation.
If the game server is not running, `start_game` returns an actionable error;
start `npm run dev` and retry. If Codex does not show the server after the
repository is trusted, restart the Codex app or open a new conversation and
check `/mcp` again.

## Four-level campaign

Every room starts at Level 1 and keeps the same two seats through all four
levels. Finishing a level lets either explorer replay it or advance. Finishing
Level 4 offers **Play Again**, which returns the room to Level 1. Campaign
progress is room-local and is not saved after the room ends.

1. **Pressure Lock** — use Plate A and Plate B to hold the original central
   gate while both explorers cross to the exit.
2. **Powered Transit** — one explorer holds Teleporter Alpha’s power button
   while the other retrieves Card Alpha, permanently unlocking the gate.
3. **Security Handshake** — return with Card Alpha, then occupy both gate relay
   buttons to latch the gate open.
4. **Crossed Circuits** — chain Alpha and Beta so each explorer retrieves a
   card, reunite, and occupy both final relay buttons.

All mechanisms are movement-triggered. Teleporter power and relay buttons have
no timer: one explorer can wait indefinitely while the other plans a route. A
teleporter arrival must be stepped off before that explorer can use the same
pair again. Keycards are shared room credentials, and a security gate stays
open once its requirements are met.

Players can pass through each other. If a connection drops during play, the room freezes for a 30-second reconnection window and resumes the exact state when the seat returns. If the window expires, the session is abandoned.

## Architecture

- `src/game`: deterministic level catalog, hidden-grid A*, fixed-step movement, portals, cards, gates, and exits
- `src/server`: private two-seat Colyseus room and schema projection
- `src/mcp`: local Player 2 Colyseus client and stdio MCP tools
- `src/client`: Three.js facility renderer, lobby, networking, HUD, imported low-poly visuals, and audio cues
- `assets`: user-supplied modular facility, animated human character, aid, and mobility GLBs; the production client imports the facility and 12 selectable body models
- `tests/unit`: pathfinding, simulation, client state, and protocol-boundary tests
- `tests/integration`: real Colyseus SDK room lifecycle
- `tests/e2e`: browser/browser and browser/MCP clients solving, progressing, reconnecting, rejecting a third seat, replaying, and wrapping the campaign

The server owns movement, phase changes, collision rules, mechanisms,
completion, replay, and advancement. Clients send sequenced target requests and
render schema snapshots without local gameplay prediction.

## License

Source code and documentation are licensed under the [MIT License](LICENSE).
The 3D files under `assets/` are available under
[Creative Commons CC0 1.0 Universal](ASSET_LICENSES.md).

## Verify

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev
```

The Playwright suite targets installed Chrome, Edge, and Firefox browsers. The
ordinary VPS build uses same-origin Colyseus, while the dedicated ChatGPT Sites
build uses its hosted transport adapter.
