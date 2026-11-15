# Handback T-DG7-AN-P7E (transformation-analyst): register update after the round-1 repairs

- **Stage:** DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` `7e5ff626bf51254b562799362d7467e259807484`. At the start the tree was clean apart from this run's own `docs/delivery/runs/...` folder.
- **Invocation:** run `DG7-T-DG7-AN-P7E-transformation-analyst-20261115T115114Z-4b6e9b3a`, session `4b6e9b3a-efd5-400a-8a28-8f907cad0def`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-AN-P7E.md`, sha256 `9fb2a4c1…903f96df6` (verified with `sha256sum`).
- **Time:** start 11:51:26 UTC, end 12:13:40 UTC (`date -u`), about 22 minutes.
- **Read:** p7-work-split §1 and §2, p7-plan (the rows and sections for REQ-S16-024, A22 and Q3), decisions D-243 to D-272, the FE-C2, BE-R6 and DO-K2 handbacks and their evidence logs, and findings F-DG7-913, 914, 954 and 956 in `findings.json`.
- **Approvals:** this pass grants no business, Finance or IT approval. Product gates G1–G6 are not touched, and no DG gate is claimed. No finding is closed here: closure belongs to non-author reviewers.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/delivery/requirements.csv` | Rows REQ-S16-024, REQ-S17-004, REQ-S19-015, REQ-S20-022 and REQ-S20-026 only. In each one I added evidence and appended a pass-5 note, and in REQ-S16-024 I removed one evidence path. No status, increment, final gate or other field changed. No other row changed: a diff against the `HEAD` copy shows exactly those five lines. The register's SHA-256 is now `fc8ece8b…ad465ba23` (it was `e4805087…f7715b09`). |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7E-transformation-analyst.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7E-evidence/*` | Logs of the checks in §3, plus the release-notes drift diff. |

I made the edit with a small script in `$TMPDIR`. Before it changed a row, it checked that the row serialised back to the same bytes, and it refused any evidence path that does not exist. I changed no code, test, `p7-pending*.ts` entry or handover document. This task is register-only, and those files are outside the analyst's write scope.

## 2. Behaviour per requirement (what the rows now say)

### REQ-S16-024 (F-DG7-913): status IMPLEMENTED, unchanged

- **Correction of pass 1.** "Administration > Retention by FE-C" was not true. At that base the five routes were placeholders, and the cited `T-DG7-FE-C-evidence/pnpm-test.log` tested no Retention screen. I **removed that citation** and say so in the note.
- **Added evidence from FE-C2:**
  - `RetentionPages.tsx`, `retention-screens.test.tsx`, `apps/web/e2e/p7-retention.spec.ts`;
  - the FE-C2 handback;
  - FE-C2's `pnpm-test.log` (retention-screens 20/20, exit 0);
  - `e2e-p7-retention.log` (4 passed in en and ar, exit 0);
  - the two axe summaries (0 violations; a measurement only);
  - `integration-contract-retention.log` (128/128, exit 0).
- **FE-C2's gaps are kept visible in the note:**
  1. The e2e stack starts no worker, so no run or dry run is queued on the real stack, and a run's detail screen is checked there only in its 404 state.
  2. The 409 path is component-tested only.
  3. 146 Arabic leaves are provisional, and 122 of them have not been checked by a qualified Arabic reviewer.
  4. A22 is qa-verifier's test.
  5. The inbox-effect text is component-tested only.
- The note also says that F-DG7-913 stays OPEN and that the repaired tree has no full integration or e2e run yet.

### REQ-S20-022 (A22): final gate DG6 and status IMPLEMENTED, unchanged

- **New note:** the "admin job visibility" part now also covers the P7 retention job on screen. Before FE-C2 it was visible through the API only.
- **Added evidence:** the component test, the e2e spec and its log.
- **Gaps stated:** no worker on the e2e stack, the 409 path component-tested only, and A22 itself not re-run on the DG7 tree. That run is qa-verifier's (REQ-DLV-039).

### REQ-S20-026 (F-DG7-954): status IMPLEMENTED, unchanged

- **New note:** BE-R6 ported the A26 K6 regression tests into `apps/api/test/integration/organizations.test.ts`. The change is test-only.
- **Results:**
  - the tree passes 15/15, exit 0;
  - the exact A26 defect makes 4 tests fail, exit 1;
  - a PATCH-only `requireAction` downgrade makes the same 4 fail, exit 1;
  - contract plus touched files pass 133/133, exit 0.
- **Disclosed:** the route-label-only mutant survives (15/15). BE-R6 judges it equivalent, and the static-pin question is open. Only the listed integration files were run.
- **Added evidence:** the test file, the handback and the five logs.

### REQ-S19-015 (F-DG7-956): status SPECIFIED, unchanged; still a release blocker

- **Closed since pass 4:** `check-handover.test.mjs` now resolves the protocol-audit report from the hash in `known-limitations.md`.
  - DO-K2 logs: 51/51 (01, and strict 02); check-handover all six parts PASS (13).
  - FE-C2 later re-ran the test, 51/51, and both release-doc `--check`s exited 0.
- **Stated as not green:** the full release-tool suite exited 1 in both runs on this tree's ancestors.
  - The cause is T-A5 failing with EROFS on the sandbox's read-only HOME pnpm store.
  - T-A5 alone passes 2/2 with a writable store (DO-K2 log 05).
  - No full-suite run exists on the current tree.
- **Still missing (as in pass 4):** T-I10 at the freeze, and the A28 archive listing and register byte check at the seal.

### REQ-S17-004 (F-DG7-914): status IMPLEMENTED, unchanged

- **Correction of pass 1's "generated and checked":** the generated `connectors.md` carried stale status text from `environment.md`.
- **Now:** DO-K2 regenerated it. `--check` exited 1 before the write and 0 after. I confirmed that `grep` finds no "not yet written", "to be confirmed" or "owner: slice B" in the file at `HEAD`.
- **Residual, Low:** the "(DO-B)" / "DO-B's e2e" tags and the `http_pull` row's self-referencing guide cell remain.
- F-DG7-914 stays OPEN until the domain reviewer verifies it.

## 3. Checks run (Node 24.21.0, `MTH_PNPM_OFFLINE=1`; logs in `T-DG7-AN-P7E-evidence/`)

All checks ran on the tree at `7e5ff626b` with my register edit applied, between 11:54 and 12:13 UTC.

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 01 | `node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out docs/handover/release-notes.md --check` | **1** | "out of date (run with --write)". This is caused by this pass: the file embeds the register hash and the S19-015 note. The diff of a fresh generation into `$TMPDIR` shows only those three lines. A first attempt without arguments exited 2 (usage, `--csv and --out are required`) and was overwritten. See gap 1. | `01-release-notes-check.log`, `01c-release-notes-diff.txt` |
| 02 | `node tools/release/known-limitations.mjs --protocol-audit docs/delivery/test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-prefreeze.json --check` | 0 | PASS, both files current | `02-known-limitations-check.log` |
| 03 | `node tools/release/connector-handover.mjs --check` | 0 | `connectors.md` equals a fresh generation | `03-connector-handover-check.log` |
| 04 | `node --test tools/release/tests/check-handover.test.mjs` | 0 | 51 pass, 0 fail | `04-check-handover-test.log` |
| 05 | `MTH_STRICT_HANDOVER=1 node tools/release/check-handover.mjs --protocol-audit <pre-freeze report>` | 0 | All six parts PASS | `05-check-handover.log` |
| 06 | `node tools/gates/validate.mjs --historical --stage DG6` | 0 | PASS | `06-validate-historical-DG6.log` |
| 07 | `pnpm openapi:lint` | 0 | PASS | `07-pnpm-openapi-lint.log` |
| 08 | `pnpm lint` | 0 | clean | `08-pnpm-lint.log` |
| 09 | `pnpm -r typecheck` | 0 | done | `09-pnpm-typecheck.log` |
| 10 | `pnpm test` | **1**, BLOCKED | Every project failed at startup: vitest writes its bundled config to `node_modules/.vite-temp/`, and that is **read-only in the analyst sandbox** (`EROFS`). No test ran. | `10-pnpm-test.log` |
| 10b | The same three projects as `pnpm test`, with `npx vitest run --configLoader runner --project <p>` (the runner loader writes no temp file) | **1** | unit-node: 3041 passed, **1 failed**. unit-web: 2199 passed. unit-formula-nocodegen: 259 passed, 2 skipped. The one failure is `tests/qa/unit/a20-p6-token-contrast.test.ts`, which is environmental: `EROFS` writing `test-results/qa-a20/contrast-pairs.txt`, because the analyst sandbox makes the repository top level read-only. Its contrast assertions did not get to run. **BLOCKED here, not passed.** | `10b-unit-tests-runner-loader.log` |
| 11 | `QA_PG_PORT=27731 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | **1**, BLOCKED | Same `.vite-temp` `EROFS` at startup. No test ran. | `11-contract-with-pg.log` |
| 11b | The same, with `--configLoader runner` (disposable PostgreSQL 16.15) | 0 | 1 file, 111/111 passed | `11b-contract-with-pg-runner-loader.log` |
| 12 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | All files pass. It was re-run on this handback after its final edit (see the last line of the log). | `12-prettier-check.log` |

The acceptance's "`pnpm test` exits 0" is therefore **not met in this sandbox**. The literal command is BLOCKED by a read-only `node_modules`. The equivalent run fails one test, and only because of a read-only output folder. My change touches no code or test. FE-C2's `pnpm test` on `4e8676de2`'s parent tree (`16b2bdd35`) exited 0. The binding run is the orchestrator's freeze verification. I touched no integration test, so only the contract test was required on PostgreSQL (row 11b).

## 4. Known gaps

1. **`docs/handover/release-notes.md` is out of date after this pass, and I cannot regenerate it.** It embeds the register's SHA-256 and quotes the REQ-S19-015 notes. My write scope excludes `docs/handover/`. The check exits 1, and `01c-release-notes-diff.txt` shows the three changed lines: the hash in English and Arabic, and the quoted S19-015 note. **The orchestrator must run** `node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out docs/handover/release-notes.md --write`, then `--check`, before the round-2 freeze. `known-limitations.md` is still current (log 02, exit 0).
2. **No new product evidence came from this pass.** Every behaviour claim in the five rows rests on the repair runs cited there. I re-ran only the cheap handover checks and the repository-wide checks in §3. I did not re-run the retention e2e, the BE-R6 mutants or the full release-tool suite.
3. **REQ-S10-001 is untouched.** BE-R6's handback also covers it, but it is not in my assignment ("Do not change any other row"), so its register row does not yet cite the BE-R6 tests.
4. **The generic acceptance lines** (pending entries removed, mutation tests) do not apply to a register-only task. I touched no `p7-pending*.ts` file or integration test.

## 5. Open questions

1. Should REQ-S10-001 (scoped RBAC) cite BE-R6's `organizations.test.ts` and its mutant logs? Doing so needs an assignment that names that row.
2. Should REQ-S02-005 (the requirement of F-DG7-913) get a note about the corrected Retention claim? It is outside this assignment.
3. Routing of the remaining `connectors.md` residuals (DO-K2 question to the orchestrator: drop "DO-B" tags and the `http_pull` self-reference in `environment.md`, then regenerate `connectors.md` and `known-limitations.md`).
4. **Merge:** commit `requirements.csv` with this handback and its evidence. Then regenerate `release-notes.md` (gap 1). No migration or code change is involved.
