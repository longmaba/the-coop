# Execution Plan: WebMCP Onboarding VPS Release

Date: 2026-08-31

## Status

Completed

## Outcome

Deploy committed release `e5dbffd194961212f26a978b50f03d5629688db0` to
the existing VPS game service so room hosts receive the copy-ready WebMCP
teammate popup, without changing the separate ChatGPT Sites deployment or any
unrelated PM2 application.

## Authority And Context

- The user explicitly requested a VPS deployment.
- `docs/decisions/0002-use-a-same-origin-vps-runtime.md` owns the production
  Node/Colyseus topology.
- `deploy/ecosystem.config.cjs` owns the isolated PM2 app `the-coop`.
- `scripts/vps-smoke.mjs` proves static delivery, health, and a two-player room.
- Prior verified releases use `/srv/the-coop/releases/<commit>` with
  `/srv/the-coop/current` as the atomic selection point and loopback port 6000.

## Scope

In scope:

- Audit the selected release, PM2 status, capacity, and health before mutation.
- Package only committed `HEAD` and install one immutable release.
- Atomically switch `current`, restart only `the-coop`, and roll back on a
  failed activation check.
- Verify static delivery, the onboarding build marker, health, and two-player
  Colyseus play through a browser-safe SSH tunnel.

Out of scope:

- Deploying or changing ChatGPT Sites.
- Changing the Cloudflare Tunnel, hostname, firewall, or access policy.
- Restarting `bazi-app-api`, `tuvi-frontend`, or any other PM2 app.
- Packaging unrelated untracked Devpost, marketing, or release artifacts.

## Sequence

1. Capture the live release, PM2 process inventory, resource headroom, and
   loopback health as rollback evidence.
2. Reuse the already-passing source validation while bytes remain unchanged,
   create a tracked-only archive, upload it, and build with VPS Node 24.
3. Atomically select the new release and restart only `the-coop`; automatically
   restore the captured release if static or health checks fail.
4. Verify the exact release path, PM2 runtime, onboarding client content, and a
   real two-player room through an SSH tunnel.
5. Remove temporary archives, record results, close Beads, and push deployment
   bookkeeping separately from the deployed source commit.

## Recovery

- Restarting the in-memory service ends active rooms; the user explicitly
  authorized this VPS deployment.
- Keep the captured prior release intact. Rollback atomically repoints
  `/srv/the-coop/current`, restarts only `the-coop`, and reruns health checks.
- Do not switch `current` if install/build verification fails.
- Do not claim success from PM2 status alone; the smoke test must create and
  join a two-player room.

## Progress

- [x] Audit live VPS state and capture rollback target.
- [x] Package and install the immutable release.
- [x] Activate the release with guarded rollback.
- [x] Verify health, assets, and multiplayer behavior.
- [x] Record evidence and complete release bookkeeping.

## QA Reference Ledger

| Loaded | Reference | Purpose | Failure reason |
| --- | --- | --- | --- |
| yes | `threejs-qa-release/references/qa-release-checklists.md` | Production QA evidence and release gates | — |
| yes | `threejs-qa-release/references/checklists/visual-verification.md` | Reuse the feature's passing desktop/mobile visual proof | — |
| yes | `threejs-qa-release/references/checklists/playtest-qa.md` | Require an actual multiplayer state transition | — |
| yes | `threejs-qa-release/references/checklists/release.md` | Build, asset, debug, and deployment checks | — |
| no | `threejs-qa-release/references/prompt-templates.md` | No reusable QA prompt or task template requested | not applicable |

## Validation Baseline

The exact source commit already passed lint, both TypeScript configurations,
24 Vitest files with 210 tests, local and Sites builds, the local Playwright
matrix (11 passed), the Sites transport path (2 passed), dependency audit,
secret scan, `git diff --check`, and visual QA at 94/100. Re-run production
build and deployment-specific checks if committed source bytes remain exact.

## Result

PASS — release `e5dbffd194961212f26a978b50f03d5629688db0` is the
active immutable VPS release at
`/srv/the-coop/releases/e5dbffd194961212f26a978b50f03d5629688db0`.

- Captured rollback target:
  `/srv/the-coop/releases/1c1575cc6a3fc6ebedd91e6c530214420c5d0cbb`.
- Verified the tracked-only archive locally and remotely with SHA-256
  `765265745e7212bd99e3da603a25ad75df6a8138ea06589f02787acf819b28d2`.
- Built and pruned the immutable release on VPS Node `24.12.0`, atomically
  switched `/srv/the-coop/current`, and restarted only PM2 app `the-coop`.
- `the-coop` is online at PID `2846739`, restart count `9`, with current cwd
  and Node `24.12.0`. `tuvi-frontend` stayed at PID `1388744` / restart count
  `37`; `bazi-app-api` stayed at PID `2601795` / restart count `1`.
- Loopback `/` and `/__healthcheck` returned HTTP 200; health body was `OK`.
- Served asset `/assets/index-Bakql7CJ.js` contains the onboarding dialog,
  WebMCP invitation, and `join_game` markers.
- `scripts/vps-smoke.mjs` passed through a temporary browser-safe loopback
  relay with room `fdIgrRs07eyDk5xCa-1SAWgM`, phase `playing`, and two players.
- PM2 state was saved; the temporary relay and uploaded VPS archive were
  removed. The local tracked-only archive remains under the operating-system
  temporary directory because this environment denied local file deletion; it
  is outside the repository and does not affect the release.
- ChatGPT Sites, Cloudflare Tunnel configuration, and unrelated PM2 apps were
  not changed.
