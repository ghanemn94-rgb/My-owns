# DG1 round-3: code-security-reviewer

Read `review-common.md` first. Task ID: `T-DG1-REV-SEC-R3`. You review the source of `apps/api/**`, `apps/worker/**`, `packages/**`, `tools/deps/**`, `deploy/**`, `.github/workflows/ci.yml`, `docs/api/openapi.yaml`.

## Findings you verify (with file:line and a re-test)
- **F-DG1-113 / F-DG1-114 / F-DG1-102 (installer redesign, D-051).** `tools/deps/install-sandbox.sh` now binds the real repo `--ro-bind` and runs pnpm in a disposable copy; only node_modules (+ create lockfile) is copied back. **Re-run the round-2 escape** (`docs/delivery/test-evidence/DG1/code-security/round-2/repro-installer-escape.sh` against a disposable clone) and confirm the parent-rename, installer-append, delivery-write and config-surface-creation are now ALL refused and the real repo is unchanged. Run `tools/deps/tests/install-sandbox.test.sh` (expect 12/12, incl. AC-7/AC-8). Confirm `create`/`frozen` still install correctly (node_modules populated; lockfile stable under frozen).
- **F-DG1-115** (derived-assignment race). The derive step locks the source BU grant `FOR SHARE` and re-checks in the create transaction. Re-run `apps/api/test/integration/access-derived-race.test.ts` (and try your own interleaving): no active derived assignment survives a concurrent revoke; an unauthorized create is 403 + rollback + audited. F-DG1-106 behaviour intact.
- **F-DG1-117** (module lint): `architecture.test.ts` now rejects `process.getBuiltinModule`, computed `process`/`globalThis` members, process aliasing and `new Function`. Plant one; confirm it fails.
- **F-DG1-116** (check-ci-needs): the installed `.github/workflows/ci.yml` passes `node deploy/scripts/check-ci-needs.mjs`, and the checker rejects the round-2 vectors (NODE_OPTIONS env, working-directory, shell, workflow defaults) + job defaults/env/container/services/if. Run `node --test deploy/scripts/tests/check-ci-needs.test.mjs`.
- **F-DG1-108 / F-DG1-203** (image pinning): node/postgres/playwright pinned by digest in the committed lock; the CI `images` job resolves any missing digest at runtime then `--check`; keycloak (quay.io) is the disclosed D-049 test-only residual (`pin-images --check` still exits 1 locally — confirm that is the only remaining unpinned image, and that it is marked `blockedReason`). Run `node --test deploy/scripts/tests/pin-images.test.mjs`.
- **F-DG1-106, F-DG1-107, F-DG1-112, F-DG1-202** — re-verify (round 2 could not, due to the interrupted run).

## Checks (real output; BLOCKED if a tool/DB is missing)
`pnpm -r typecheck/build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm test`, the integration suite on a disposable PostgreSQL (unique port e.g. 5471), `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs`, `node --test deploy/scripts/tests/*.test.mjs`, `tools/deps/tests/install-sandbox.test.sh`, and `node tools/gates/validate.mjs --stage DG0 --historical` (DG0 controls intact). Evidence under `docs/delivery/test-evidence/DG1/code-security/round-3/`.

## Requirements to check (record exactly these)
`REQ-DLV-025`, `REQ-DLV-033`, `REQ-DLV-042`, `REQ-S16-001`, `REQ-S16-003`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`.
