# Execution Plan: VPS Character Release

Date: 2026-08-30

## Status

Completed

## Outcome

Deploy the current `main` commit, including pre-game character customization and
the `assets/new_characters` roster, to the existing private VPS game service
without disturbing any other PM2 application.

## Context

- `docs/plans/completed/vps-deployment.md` records the existing immutable
  release layout, loopback port, Node runtime, PM2 process, and smoke test.
- `docs/decisions/0002-use-a-same-origin-vps-runtime.md` is the authority for
  serving the browser client and multiplayer transport from one origin.
- `deploy/ecosystem.config.cjs` owns the isolated `the-coop` PM2 process.
- `scripts/vps-smoke.mjs` proves static delivery, health, and a two-player room.
- Target source is clean `main` commit
  `1c1575cc6a3fc6ebedd91e6c530214420c5d0cbb`.

## Scope

In scope:

- Audit the currently selected VPS release and capture a rollback target.
- Build and install one immutable release from committed source.
- Atomically repoint `/srv/the-coop/current` and restart only `the-coop`.
- Verify the health endpoint, new character assets, and two-player gameplay.

Out of scope:

- Changing the Cloudflare Tunnel, public hostname, firewall, or access policy.
- Restarting or changing the two unrelated PM2 applications.
- Changing the separately published ChatGPT Sites release.

## Approach

1. Inspect VPS capacity, current release, PM2 status, and loopback health.
2. Run focused production validation and package only committed `main` content.
3. Upload and build a new immutable release with the VPS Node 24 runtime.
4. Switch the release symlink atomically, restart only `the-coop`, and
   automatically roll back if activation or smoke checks fail.
5. Verify the release through an SSH tunnel, then record and push evidence.

## Risks And Recovery

- Restarting the in-memory game process ends active rooms; this deployment is
  explicitly requested and restarts only the game service.
- VPS capacity may make dependency installation or build fail; inspect capacity
  first and leave the selected release unchanged until the new build is ready.
- Rollback: atomically point `/srv/the-coop/current` to the captured prior
  release and restart only `the-coop` with its existing PM2 configuration.
- Preserve all immutable releases during this task so rollback remains local.

## Progress

- [x] Audit the current runtime and rollback target.
- [x] Validate and package the current `main` release.
- [x] Install and atomically activate the release.
- [x] Verify health, character assets, and two-player multiplayer.
- [x] Record the result and complete deployment bookkeeping.

## Decisions

- 2026-08-30: Reuse the verified immutable-release and PM2 topology because the
  requested change does not alter the production runtime contract.
- 2026-08-30: Keep public routing unchanged because the request authorizes a VPS
  release, not Cloudflare or access-policy changes.
- 2026-08-30: Capture
  `/srv/the-coop/releases/d3f8f25079aed35714d9abb0d7dceaaf910c24d1` as the
  rollback target; the service and both unrelated PM2 apps were online before
  mutation.
- 2026-08-30: Package committed `HEAD` only. The archive contains 27 files under
  `assets/new_characters` and no files under the removed `assets/characters`
  path.
- 2026-08-30: Run the multiplayer smoke test through a browser-safe local SSH
  port because Fetch correctly rejects direct HTTP requests to port 6000. The
  activation rollback path restored the prior release when the direct-port
  validation attempt failed, before the corrected activation succeeded.

## Validation

- Focused proof: the production-server integration coverage passed within the
  207-test Vitest run, and the production build emitted all 12 character GLBs.
- Integration or end-to-end proof: HTTP health and new-asset requests plus the
  real two-client Colyseus smoke test passed through an SSH tunnel.
- Repository-required checks: lint, typecheck, all tests, production build,
  dependency audit, and diff checks passed for the target source and release
  bookkeeping.

## Result

Release `1c1575cc6a3fc6ebedd91e6c530214420c5d0cbb` is installed under
`/srv/the-coop/releases` and selected by `/srv/the-coop/current`. PM2 persists
`the-coop` online in fork mode through Node 24.12.0, listening only on
`127.0.0.1:6000`.

Local release proof passed lint, typecheck, 23 Vitest files with 207 tests, the
production build, and `npm audit --omit=dev` with zero vulnerabilities. The
committed archive contained 27 new-character files and no old-character path.
The VPS returned HTTP 200 and health `OK`, served all 12 compiled character GLB
files, and retained no `assets/characters` directory.

Through local port 61234 forwarded to VPS port 6000, two Colyseus clients
created and joined room `bXp6-aK98PfEoBeiTAH13dXg`, reached phase `playing`,
and observed two players. The unrelated `bazi-app-api` and `tuvi-frontend`
process IDs and restart counts were unchanged across the deployment. Temporary
archives were removed. The verified rollback target remains
`/srv/the-coop/releases/d3f8f25079aed35714d9abb0d7dceaaf910c24d1`.
