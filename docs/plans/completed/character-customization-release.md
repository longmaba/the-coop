# Release Plan: Character Customization

Date: 2026-08-30

## Status

Completed

## Outcome

Commit and push the completed character-customization change to `origin/main`,
publish the exact validated Sites-mode build to the existing ChatGPT Site, and
verify that the owner-only production deployment succeeds without changing its
access policy.

## Authority And Context

- The user explicitly requested push and deployment.
- `origin/main` is the existing GitHub publication target.
- `.openai/hosting.json` identifies the existing Sites project and D1 binding.
- The prior deployment is owner-only. Current access must be re-read before
  deployment; shared or ambiguous access requires a separate approval gate.
- Beads root `the-coop-zp4` tracks this release sequence.

## Sequence

1. Audit the working tree, staged bytes, credentials, whitespace, assets, and
   release validation evidence.
2. Commit the exact release with a Lore-compliant message and push `main` to
   `origin`.
3. Re-read Sites access, obtain a short-lived source credential, push the
   validated commit to the Sites source repository, package `dist`, save one
   version, and deploy it privately.
4. Poll deployment status, verify the production URL and access posture, close
   release tracking, then commit and push bookkeeping so the checkout is clean.

## Recovery

- If GitHub push fails, preserve the local commit and retry only after resolving
  the explicit authentication or non-fast-forward error.
- If the Sites source credential expires, refresh it for the existing project;
  never create a duplicate Site.
- If packaging or version saving fails, retain the validated build and temporary
  archive for inspection, then retry only the failed stage.
- If deployment fails, do not open or claim the live version; report the Sites
  failure and leave the prior successful version active.
- Do not widen access. A non-owner-only result stops the private deployment path.

## Progress

- [x] Create the Beads release sequence and inspect current repository authority.
- [x] Audit and stage the release candidate.
- [x] Commit and push the verified source to `origin/main`.
- [x] Package, save, and privately deploy the Sites version.
- [x] Verify production status and finish clean-tree bookkeeping.

## Validation

- Reuse the fresh passing feature evidence only while source bytes remain
  unchanged: lint, both typechecks, 207 unit/integration tests, local and Sites
  builds, local/Sites Playwright, visual QA, audit, and diff checks.
- Re-run staged whitespace and credential scans immediately before commit.
- Match local `HEAD` to `origin/main` after each push.
- Require Sites deployment status `succeeded` and re-check owner-only access.

## Result

Completed on 2026-08-30.

- Lore-compliant source commit
  `e03c6b3a115c8c2472fe4ea6b424f7bdb3918d84` was pushed to both
  `origin/main` and the existing Sites source repository.
- The verified Sites archive included the Worker entrypoint, client build, D1
  migration, hosting metadata, and all 12 selectable character models. Sites
  version 3 was saved from that commit and its private production deployment
  reached `succeeded` at `https://the-coop-game.longmaba.chatgpt.site`.
- Post-deployment state is active with custom owner-only access: one allowed
  account user, no workspace or tenant groups, and zero external visitors. An
  unauthenticated request returned HTTP 401, and the recent Worker error query
  returned zero events.
- No in-app browser connection was available for a signed-in production
  click-through. Live gameplay proof therefore remains the identical passing
  Sites-mode two-browser E2E rather than a direct production interaction.
- Final Beads and plan-state changes are committed and pushed separately from
  the exact deployed source commit so the production artifact remains auditable.
