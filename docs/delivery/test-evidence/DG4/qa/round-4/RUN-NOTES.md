# qa-verifier DG4 round 4: run notes (T-DG4-REV-QA-R4)

All evidence of this review is in this directory. The record is `docs/delivery/reviews/DG4/round-4/qa-verifier.json`, with the narrative `qa-verifier.md` and the findings sidecar `qa-verifier.findings.json` next to it. My test files are under `../tests/round-4/` (outside the frozen candidate). They were copied into the disposable clones only to run, then removed. Logs are tee'd with `$TMPDIR` paths replaced; the summaries strip the ANSI codes.

## Clones and environment

- `$TMPDIR/rv`: a complete `git clone` of the repository at `afba46f` (source `ccc37c9`); candidate `sha256:5ff36f6e…`, 1469 files at the start and the end (`00-candidate-start.log`, `00-candidate-end.log`). Used for: install, static, unit, integration, and the BU-limit probe.
- `$TMPDIR/rv2`: a tar copy of `rv` after the build, without `.git` and `docs/delivery`. Used for all the other e2e runs.
- Install: `pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pnpm-store-root/v10`. The 4 `WARN Failed to create bin … mth-db` lines are expected: the bin target `packages/db/dist/cli.js` only exists after `pnpm -r build` (rounds 2 and 3 had the same lines).
- Every direct vitest call used `--configLoader runner` (read-only `node_modules` in the confined sandbox; QA-A's finding). `pnpm test` ran unchanged.
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; `playwright install` was never run. Ports were all in 26500–26699.
- The main repository's HEAD moved during the run, from `afba46f` to `6854a07`. The two new commits only add the other two reviewers' run evidence; I did not read them. The candidate ID is unchanged (`00-candidate-end.log`).

## Index

| Prefix | What |
|---|---|
| `00-` | The candidate check (start and end) and the offline install. |
| `01-` | Static checks (`scripts/run-static.sh`): all seven exit 0. |
| `02-` | `pnpm test` on Node 22 and 24, with the locale unset and with C.UTF-8. All four exit 0, each with 2885/2885, plus 259 passed and 2 skipped. The 2 skips are by design: `it.skipIf(NOCODEGEN)` in `packages/shared/src/formula/fuzz.test.ts`. |
| `03-` | Integration on a disposable PostgreSQL (`scripts/run-chain.sh`), 61 migrations each. <br>• `run1`, `run2`: 208 files / 1975 tests each, exit 0. <br>• `tests-qa-candidate-only`: 15 / 172. <br>• `dlv036-a04-a09-a10-a11`: 7 / 85. <br>• My probe `dg4-qa-r4-value-basis.test.ts`: `r4-probes-try1` (its first run, green) and `r4-probes-run2`, 5/5 each. <br>• `03-pending-lists.txt`: all 47 p4-pending lists evaluated at runtime, total 0 entries. |
| `04-` | e2e on the real stack (`e2e/support/qa-stack.sh`: disposable PostgreSQL, 61 migrations, seed-dev, built API and SPA), `--workers=1`, chromium-en and chromium-ar. See below. |
| `05-` | `tools/gates/validate.mjs`: register DG4, pipeline, and historical DG3, DG2 and DG1. All PASS, exit 0. |
| `06-` | The 137-row requirement trace (`scripts/trace.py`). |
| `results/` | My sweep's recorded checks per run, the BU-limit observations, and 18 screenshots. The screenshots of the other runs were pruned as duplicates. |

## e2e runs, in order (every non-pass explained)

1. **`04-e2e-try1/try2/try3-r4-unset.log`**: my R4 test alone. <br>• Try 1 failed on my probe's bug: psql does not decode the `+` in `options=-c+role=…`. <br>• Try 2 failed correctly: the database refused my initiative fixture without its audit event (`p2_audit_required`, ADR-0004), which is right product behaviour. The fixture now writes the audit event in the same transaction, as the candidate's `insertInitiative` does. <br>• Try 3: 2/2, with the 4 en and 2 ar check failures that became F-DG4-143.
2. **`04-e2e-full-unset.log`**, all 30 spec files, locale unset: 348 passed, 7 failed, 13 did not run, EXIT 1. The load average was 13–16 while the other two reviewers ran. <br>• p2 'Define → G2', en and ar: the 30 s test timeout (31.4 s and 31.8 s). The 3 followers per project did not run (serial). <br>• p4-adoption-bau 6, en: 30 s timeout; tests 7 and 8 did not run. <br>• p4-benefits 8, en: 30 s timeout, then a truncated trace zip (its artifact, written at the timeout); test 9 did not run. <br>• p4-dashboards 3, ar: the 5 s poll for an overview request carrying `transformationId=tidA` after the business-unit chip. Tests 4, 4b, 5 and 6 did not run. Cause: by then the suite had created more than 50 transformations in SYN_RETAIL, so the product's 50-transformation block ('too_many', ADR-0037 §4) sends no request. This is test-data volume, and the BU-limit probe reproduces the mechanism. It led to F-DG4-144, about the block's advice text. <br>• My `Z every recorded check passed`, en and ar: fails by design on the F-DG4-143 checks (R4-t10/overview-na-line-*). In en it also failed on `S2-lead-/dashboards/rag-policy-390px` (no h1 within 20 s under load), which passed in both later sweeps.
3. **`04-e2e-full-cutf8-STOPPED-by-2h-background-limit.log`**, the same set with C.UTF-8. <br>• It was STOPPED by my shell's 2-hour background limit, because the chain ran both full runs back to back. It had reached test 365 of 368, inside the ar half of my own spec. There is no EXIT line and no Playwright summary. <br>• Up to the stop: 354 passed, 3 failed, 7 did not run: p2 'Define → G2' en (30 s timeout), p4-dashboards 3 ar (as above), and my Z en (F-DG4-143 by design). <br>• p4-kpi-unit (3+3), p4-percentage-kpi (2+2) and p4-value-headlines (2+2) all passed.
4. **`04-e2e-solo-failed-unset.log`**: p2-journeys, p4-adoption-bau, p4-benefits and p4-dashboards alone, locale unset: 72/72 passed. 'Define → G2' took 24.6 s (en) and 22.8 s (ar).
5. **`04-e2e-solo-acceptance-r4-and-failed-cutf8.log`**: the stopped tail (all of `e2e/`, my spec included), plus p2-journeys and p4-dashboards, with C.UTF-8: 55 passed, 3 failed, 2 did not run. <br>• My Z, en and ar: F-DG4-143 by design. This run has the complete sweep, 514 checks per language. <br>• p4-dashboards 4b, ar: its last step looks for the SAR net line in the gross/net table, but that table is paginated (25 rows, 'Next' enabled in the error context). My R4 world's USD rows had run earlier in the same stack (en before ar), and pushed the SAR net line to page 2. The spec enlarges only the class-lines table. This is test-data volume, not a product defect: 4b passed in ar in run 4. Tests 5 and 6 did not run.
6. **`04-e2e-solo-p4-dashboards-cutf8.log`**: p4-dashboards alone, C.UTF-8: 14/14 passed.
7. **`04-e2e-probe-bu-limit-try1-unset.log`** and **`04-e2e-probe-bu-limit-unset.log`**: my BU-limit probe. Both EXIT 1 by design. <br>• The assertion that fails is `afterStatus_noteVisible === false`, i.e. "the note's advice lifts the block". <br>• Try 1 used phase 'diagnose' and status 'draft', which every new transformation has, so it could not tell a working remedy from a broken one. <br>• Revision 2 uses phase 'realize' and status 'closed', which no transformation of the unit has. The note stays, and no overview request is sent (F-DG4-144).

'Define → G2' is a DG2 journey cited by no DG4 row. It runs at 22–32 s against a 30 s limit (D-111, D-112, D-115).
