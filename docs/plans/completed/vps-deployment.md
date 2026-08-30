# Execution Plan: Private VPS Deployment

Date: 2026-08-30

## Status

Completed

## Outcome

Run the existing browser client and Node/Colyseus multiplayer server together on
the user's VPS as one same-origin service, without disrupting the existing VPS
applications or the separately published private ChatGPT Site.

## Context

- `docs/WORKFLOW.md` defines the repository workflow and evidence standard.
- `src/client/network.ts` selects local Colyseus for normal builds and the
  hosted adapter only for ChatGPT Sites builds.
- `src/server/index.ts` is the authoritative local Colyseus server.
- `.openai/hosting.json` remains the authority for the independent ChatGPT Sites
  deployment and is outside this deployment's mutation scope.
- The VPS already runs PM2-managed applications and a remotely managed
  Cloudflare Tunnel. Ports 80 and 443 are not locally terminated.

## Scope

In scope:

- Add a production entrypoint that serves the Vite build and Colyseus HTTP and
  WebSocket traffic on one origin.
- Default production clients to their browser origin while preserving explicit
  `VITE_GAME_SERVER_URL`, development behavior, and Sites transport selection.
- Install an immutable release under `/srv/the-coop/releases`, switch a
  `/srv/the-coop/current` symlink, and manage only a new `the-coop` PM2 process.
- Bind the service to `127.0.0.1:6000` and verify it through an SSH tunnel.
- Document exact public-routing and rollback follow-up.

Out of scope:

- Editing the existing ChatGPT Site or its hosted Worker/D1 adapter.
- Modifying or restarting the VPS's existing PM2 applications.
- Publishing a public Cloudflare hostname before the user chooses a hostname
  and access policy.
- Adding the unrelated untracked `assets/new_characters/` files.
- Hosting the MCP server remotely.

## Approach

1. Add focused tests for production endpoint selection and same-origin static
   plus multiplayer serving.
2. Implement the production server and PM2 release configuration, then run the
   repository's lint, typecheck, tests, and production build.
3. Package only committed repository content, provision the required Node 24
   runtime alongside the existing Node 22 runtime, and deploy an immutable
   release.
4. switch only the `the-coop` PM2 process to the new release, verify loopback
   health, and exercise two-player multiplayer through an SSH tunnel.

## Risks And Recovery

- The VPS has elevated load and exhausted swap. Build and install steps will run
  serially, with health checks before and after deployment.
- Restarting the game service ends active in-memory rooms. Future releases
  should be scheduled when no important room is active.
- The supplied art has no repository license metadata. The service remains
  loopback-only until redistribution rights and public access controls are
  confirmed.
- The existing Cloudflare Tunnel is remotely managed. No tunnel configuration
  will be changed without a selected hostname and access policy.
- Rollback: point `/srv/the-coop/current` at the previous immutable release and
  restart only `the-coop`; on the first deployment, stop and remove only that
  PM2 process.

## Progress

- [x] Inspect repository deployment boundaries and VPS topology.
- [x] Implement and locally validate the same-origin production runtime.
- [x] Deploy an immutable release and start the isolated PM2 process.
- [x] Verify static delivery and real two-player multiplayer through the VPS.
- [x] Record the release, rollback command, and remaining public-route choice.

## Decisions

- 2026-08-30: Bind to loopback on a new port because no public hostname or
  access policy was supplied and the existing deployment posture is private.
- 2026-08-30: Use PM2 because it is already the VPS's supervised process model;
  do not introduce Docker, nginx, or Caddy for this isolated service.
- 2026-08-30: Use one same-origin process so matchmaking and WebSocket traffic
  need no client-visible secondary port or insecure mixed-content exception.
- 2026-08-30: Use port 6000 because the user selected it for their existing
  Cloudflare Tunnel routing workflow.
- 2026-08-30: Use a dedicated top-level runner because PM2 imports its target
  through a process container instead of executing it as Node's direct entry;
  the first two release attempts exposed this before opening the port.

## Validation

- Focused proof: endpoint-selection tests and static-server request tests.
- Integration or end-to-end proof: production build plus two Colyseus clients
  creating and joining a room through the SSH-forwarded VPS origin.
- Repository-required checks: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`, and `git diff --check`.

## Result

Release `e7e44c7be1fd` is the only installed immutable release and is selected by
`/srv/the-coop/current`. PM2 persists `the-coop` as an online fork-mode process
using Node 24.12.0 and listening only on `127.0.0.1:6000`. The two pre-existing
PM2 applications remained online and were not restarted.

The VPS returned HTTP 200 for the compiled client and `OK` for
`/__healthcheck`. Through an SSH forward from a browser-safe local port to VPS
port 6000, two real Colyseus SDK clients created and joined the same room and
reached `playing` with two players. The in-app browser was unavailable, so no
additional visual browser assertion was captured.

The user will route a Cloudflare public hostname to
`http://127.0.0.1:6000`; no Cloudflare state was changed here. Until there is a
subsequent known-good release, rollback means stopping only this application
and saving the PM2 list: `pm2 stop the-coop && pm2 save`. Future releases can
atomically repoint `current` to the previous verified release and restart only
`the-coop`.
