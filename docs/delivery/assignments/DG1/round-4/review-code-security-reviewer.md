# DG1 round-4: code-security-reviewer
Read `review-common.md` first. Task ID: `T-DG1-REV-SEC-R4`.

## Findings you verify (file:line + a re-test)
- **F-DG1-118 / F-DG1-113 / F-DG1-114** (installer copy-back). `tools/deps/install-sandbox.sh` copy-back now enumerates workspace members from the REAL tree and copies ONLY their node_modules (NUL-safe, non-symlink). **Re-run the round-3 escape repro** AND confirm a dependency that plants a `node_modules` at a non-member path (e.g. `tools/gates/node_modules`, or a crafted/newline name) is NOT copied into the real repo and no path outside `$REPO_ROOT` is touched. Run `tools/deps/tests/install-sandbox.test.sh` (expect 13/13, incl. AC-9). Confirm create/frozen still install correctly.
- **F-DG1-009** (integration determinism). Run the full integration suite **at least 3 times** on fresh disposable PostgreSQL (unique port e.g. 5491): deterministic exit 0, 200/200, no unhandled 57P01, no a12 false red. Inspect `vitest.config.ts` (singleFork) and `packages/db/test/global-setup.ts` (`dropScratchDatabase` waits for no client + owner pool error listener) and `scratch-drop.test.ts`.
- **F-DG1-121** (lint): `architecture.test.ts` catches an aliased function-`.constructor` loader; plant one and confirm it fails.
- **F-DG1-120 / F-DG1-107** (check-ci-needs): the installed `.github/workflows/ci.yml` passes `check-ci-needs.mjs`; the gate checkout/setup-node `with:` inputs are restricted (ref/repository/path/token rejected). Run `node --test deploy/scripts/tests/check-ci-needs.test.mjs`.
- **F-DG1-119** (format): `pnpm format:check` passes on the committed tree.

## Checks (real output; BLOCKED if a tool/DB is missing)
`pnpm -r typecheck/build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`, `pnpm test`, the integration suite x3 on disposable PostgreSQL, `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs`, `node --test deploy/scripts/tests/*.test.mjs`, `tools/deps/tests/install-sandbox.test.sh`, `node tools/gates/validate.mjs --stage DG0 --historical`. Evidence under `docs/delivery/test-evidence/DG1/code-security/round-4/`.

## Requirements to check (record exactly these)
`REQ-DLV-025`, `REQ-DLV-033`, `REQ-DLV-042`, `REQ-S16-001`, `REQ-S16-003`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`.
