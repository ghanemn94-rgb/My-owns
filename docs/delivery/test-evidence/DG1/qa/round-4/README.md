# DG1 round-4 QA evidence (qa-verifier, T-DG1-REV-QA-R4)

Candidate sha256:3b76021be348356f6cead57bff8fce358fac7acbfe9da42bdd8262f143308fb1, source commit 016433db8bb24e870fa4190856a2f188b30bd70d.
HEAD at start was the freeze commit e8ed6e29670f5a4c7e56db0be70525184014b38f. Its diff from 016433d contains only candidate-excluded metadata (round-4 assignments, the manifest and stages.json). `candidate.mjs --stage DG1` recomputes the same ID in the repository and in a full (non-shallow) disposable clone, and `--diff` reports matches=true. At the end, HEAD was 30379e7: another reviewer's run evidence had been auto-committed (excluded from the candidate), and the recomputed ID was unchanged.
All execution ran in a disposable full clone under $TMPDIR, removed after the run. No product file was modified. Negative controls changed the clone only, and were restored and verified clean.
Each log starts with its cwd/environment and command, and ends with `exit=<status>`. All data is SYNTHETIC (dev seed). ANSI colour codes were stripped. The logs contain no secrets: dev auth mode, with no credentials.

| File | Check | Result |
|---|---|---|
| 01-install.log | `pnpm install --frozen-lockfile --offline` (store = scratch copy of the read-only local store). Lockfile unchanged, `git status` clean | PASS |
| 02..05, 06, 06b, 07 | `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint` (33 operations), `pnpm check:no-cdn`, **`pnpm format:check`** (F-DG1-119), contrast (50 pairs AA; 3 documented prohibited pairs) | PASS |
| 08-unit.log | `pnpm test`: 21 files, 247/247 | PASS |
| 09-integration-run{1,2,3}.log | `pnpm test:integration`, 3 times, each on a FRESH PostgreSQL 16.13 cluster (port 5492): 8 migrations applied, 19 files, 200/200, exit 0 each time. No Unhandled, 57P01 or "terminating connection" anywhere: the only grep hit is the scratch-drop test's own title | PASS (F-DG1-009) |
| 10-serial-probe.log | independent probe ../tests/dg1-r4-serial-probe-{a,b}.test.ts (O_EXCL lock file per integration file). (A) Candidate config: both files run in the same pid, one after the other, 2/2. (B) Negative control with `pool`/`singleFork` removed (the round-3 config shape): the files overlap in two pids and the probe fails, exit 1. So the probe detects concurrency, and the fix is what makes the files serial | PASS (F-DG1-009) |
| 11-schema-probe.log | ../tests/dg1-r2-schema-probe.sh (unchanged): 8 migrations; 0007/0008 columns and constraints; audit_event rejects owner UPDATE/DELETE (trigger) and app UPDATE/DELETE (privilege); audit rows unchanged | PASS |
| 12-e2e.log | full e2e (e2e/** + apps/web/e2e/**), chromium-en + chromium-ar, `--workers=1`, PG port 5493: 22 passed, 0 failed, 0 skipped. Axe: 0 violations of any impact on 15 pages per language (screenshots/journeys/*/axe-summary.json) | PASS |
| 13-lead-no-reload.log | independent spec ../tests/dg1-r4-lead-create-edit-archive-no-reload.spec.ts (EN + AR): BU Lead create, then Edit visible, then edit and save, then Archive with a reason. No document reload (the window marker survives; 0 load events). The /me read after the 201 adds exactly one grant, a transformation-scope grant for the new id (no over-grant). The server confirms the edited name and archivedAt. Also my round-3 spec dg1-r3-derived-audit-localized (unchanged): its pre-reload probe now reads auditTrailRegions=1, editLinks=1 (round 3: 0/0) | PASS (F-DG1-210) |
| 14-lead-no-reload-negative-control.log | the same spec with the `refreshEffectivePermissions` call removed in the clone and the web app rebuilt: fails in EN and AR (Edit link not found), exit 1. The clone was restored and rebuilt | (control) |
| 15-a18-clean-start.log | A18 clean start, real frozen offline install, commit 016433d | PASS |
| 16-a20-token-propagation.log | A20: a token change propagates to the rendered CSS (copy only; restored) | PASS |
| 17-validate-*.log | `validate.mjs --register / --pipeline / --reconcile DG1` | PASS |
| 18-req-evidence.log | 12 DG1-final rows IMPLEMENTED, final gate DG1; every cited evidence file exists | PASS |
| 19-ci-needs-selftests.log | `node --test` check-ci-needs + pin-images self-tests 59/59; `check-ci-needs.mjs` OK on ci.yml (REQ-DLV-025) | PASS |
| 20-install-sandbox-tests.log | tools/deps/tests/install-sandbox.test.sh with the default store: 8 PASS. The 5 install-dependent cases fail only on environment: HOME is read-only (EROFS on the pnpm store), and with a scratch store there is no registry network (ECONNREFUSED). Diagnosis included | (environment) |
| 20b-install-sandbox-tests-scratch-store.log | the same suite with a WRITABLE scratch copy of the store: 12/13 PASS (AC-1 read-only, AC-2 x2, AC-3 x2, AC-4, AC-5, AC-6 x2, AC-7 F-DG1-113, AC-8 F-DG1-114, AC-9 F-DG1-118). The suite's AC-1 (effect) needs registry metadata. Its property passes in an offline equivalent: unchanged wrapper; fixture lockfile with the published is-number integrity, matching the store index; offline .npmrc; `create` populated node_modules, exit 0. REQ-DLV-042 acceptance (1)-(4) is covered. The register still cites the old 7-case log: F-DG1-211 (Low) | PASS |
| 21-worker-stop-api-probe.log | REQ-S16-001: start the built worker, SIGTERM it (exit 0); the API /readyz is 200 before and after | PASS |
| 22-branding-fonts-wordmark.log | round-1 spec ../tests/dg1-r1-branding-fonts-wordmark.spec.ts (unchanged), EN + AR: tokens API 401/200 with 7 tokens and provenance=provisional; no external requests; bundled Plex fonts; provisional text wordmark | PASS |

Notes:
- A12/A13/A14 run inside the integration project (tests/qa/integration: a12 14 tests, a13 5, a14 5) and were green in all 3 runs. A18: file 15. A20: files 12 (a20-bilingual-shell, EN/AR) and 16.
- Contract: apps/api/test/integration/contract/contract.test.ts (9 tests) passes in all 3 runs. It asserts 33 operations and covers getBrandingTokens.
- F-DG1-119: `deploy/images.lock.json` is in .prettierignore, and the rationale is recorded in the .prettierignore comment and commit 39284cd. `prettier --file-info` reports ignored=true, and the rest of the tree is still checked. `pin-images --check` still fails, but only on the keycloak digest, the known BLOCKED residual (D-049, test-only IdP; quay.io denied). It is unrelated to format:check.
- Observation (not a finding, outside this QA scope): on the detail page "Owners: Transformation Lead: Not assigned" still shows after the creator received the derived TL access grant. The owner fields are record attributes, separate from access assignments.
