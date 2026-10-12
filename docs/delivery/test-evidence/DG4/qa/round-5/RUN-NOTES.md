# qa-verifier DG4 round 5: run notes (T-DG4-REV-QA-R5)

All evidence of this review is in this directory. The record is `docs/delivery/reviews/DG4/round-5/qa-verifier.json`, with the narrative `qa-verifier.md`, the verifications `qa-verifier.verifications.json` and the findings sidecar `qa-verifier.findings.json` next to it. My test files are under `../tests/round-5/e2e/` (outside the frozen candidate). They were copied into a disposable clone's `e2e/` only to run, then removed (`scripts/run-e2e.sh`, `EXTRA=`). Logs are tee'd with `$TMPDIR` paths replaced; the summaries strip the ANSI codes.

## Clones and environment

- `$TMPDIR/rv`: a complete `git clone` of the repository at `e29a735` (source `3e3a06e`); candidate `sha256:69b7412a…`, 1472 files at the start and at the end, clean `git status` at the end (`00-candidate-start.log`, `00-candidate-end.log`). Used for: install, static, unit, integration.
- `$TMPDIR/rv2`, `$TMPDIR/rv3`: tar copies of `rv` after the build, without `.git` and `docs/delivery`. Used for the e2e runs.
- `$TMPDIR/rv-ccc`: a clone checked out at the round-4 source `ccc37c9`, used only as the control of the session-bound contention experiment (`02c-`).
- Install: `pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pnpm-store-root/v10` (a copy of the pre-installed store). The `WARN Failed to create bin … mth-db` lines are expected: the bin target `packages/db/dist/cli.js` only exists after `pnpm -r build`.
- Every direct vitest call used `--configLoader runner` (read-only `node_modules` in the confined sandbox; QA-A's finding). `pnpm test` ran unchanged.
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; `playwright install` was never run. Ports were all in 26500–26699 (`env.txt`).
- The main repository's HEAD moved during the run, from `e29a735` to `0279b4e`. The two new commits only add the other two reviewers' auto-committed run evidence; I did not read them. The candidate ID is unchanged (`00-candidate-end.log`).
- Machine load: the three reviews ran at the same time. The load average was 13–19 from 04:40Z to about 06:20Z and 1–6 afterwards. Each log's first and last lines carry `uptime`.

## Index

| Prefix | What |
|---|---|
| `00-` | The candidate check (start and end) and the offline install. |
| `01-` | Static checks (`scripts/run-static.sh`): all seven exit 0. openapi:lint: 652 operations. The build log carries Vite's advisory 'chunks larger than 500 kB', a warning and not an error. |
| `02-` | `pnpm test`, Node 22 and 24, locale unset and C.UTF-8. See "Unit" below. |
| `03-` | Integration on a disposable PostgreSQL (`scripts/run-integration.sh`), 61 migrations (`0001`→`0061`) each. <br>• `run1`, `run2`: 208 files / 1975 tests each, EXIT 0; `contract.test.ts` 45 cases passed in each. <br>• `tests-qa-candidate-only`: 15 / 172, EXIT 0. <br>• `dlv036-a04-a09-a10-a11`: 7 / 85, EXIT 0. <br>• `r4-value-basis-probe`: my round-4 API probe re-run unchanged (regression), 5/5, EXIT 0. <br>• `03-pending-lists.txt`: 47 exported p4-pending arrays in 43 files evaluated at runtime (`scripts/pending-lists.mjs`), 0 entries in total. <br>The 14 'error'/'timeout' text matches in each full run are the stdout of passing tests that probe error paths by design (408 on stalled bodies, a deliberate DB-side ECONNRESET, IdP-unavailable redirects). |
| `04-` | e2e on the real stack (`e2e/support/qa-stack.sh`), `--workers=1`, chromium-en and chromium-ar. See below. |
| `05-` | `tools/gates/validate.mjs`: register DG4, pipeline, and historical DG3, DG2 and DG1. All PASS, exit 0. |
| `06-` | The 137-row requirement trace (`scripts/trace.py`): 137/137 rows with at least one evidence test in this round's logs and no failure left unresolved by a solo re-run. |
| `results/` | My probes' recorded checks per run and language (JSON), and the screenshots of the first probe run (`e2e-probes-unset/screens/`). The other runs' screenshots were pruned as duplicates. |

## Unit (every non-pass explained)

1. **`02-unit-{node22,node24}-{unset,C}.log`** (04:47Z–06:13Z, load 13–15): all four EXIT 1, each with exactly one failure: `apps/web/src/auth/session-bound.test.tsx` › 'F-DG2-530/580 … (en) › Y1c: the same create under one identity still lands on the created record', `expected … to have a length of 2 but got 3` (the count of `GET /me` after the create). 2914/2915 passed in unit-node + unit-web. Because `pnpm test` is `vitest run unit-node unit-web && vitest run unit-formula-nocodegen`, the nocodegen project did NOT run in these four runs.
2. **`02b-unit-session-bound-alone.log`**: the file alone, 3 runs at load 14–15: 34/34 each, EXIT 0.
3. **`02c-unit-session-bound-contention.log`**: the file alone pinned to one CPU with 3 busy loops on it: the same assertion fails 2/2 on this candidate and 2/2 on the round-4 source `ccc37c9` (control). `apps/web/src/auth`, `src/api` and `src/test` are identical in both (`git diff ccc37c9..3e3a06e` is empty there). Mechanism: the test counts `/me` requests with real timers, while the product (D-077, `SESSION_RECHECK_MS = 2_000`) correctly revalidates `/me` before a page GET sent more than 2 s after the last one; under CPU contention the test's steps take longer than 2 s (3.35 s in the failing run), so a third `/me` is correct product behaviour. D-118 already recorded one such failure (BE-R5's run). Pre-existing, not a regression of this repair, not a product defect. Raised as F-DG4-145 (Low; test determinism).
4. **`02-unit-*-rerun.log`** (06:42Z–06:56Z, load 1.5–5): all four EXIT 0, each 152 files / 2915 tests passed, plus 3 files / 259 passed and 2 skipped (unit-formula-nocodegen). The 2 skips are by design: `it.skipIf(NOCODEGEN)` in `packages/shared/src/formula/fuzz.test.ts`.

## e2e runs, in order (every non-pass explained)

1. **`04-e2e-probes-unset.log`**: my round-5 probes (`dg4-qa-r5-bu-remedies.spec.ts`, my round-4 `dg4-qa-r4-bu-limit.spec.ts` unchanged, `dg4-qa-r5.spec.ts` revision 1), locale unset, load 16–17: 20/20, EXIT 0; 546 + 77 recorded checks per language, 0 failed.
2. **`04-e2e-full-unset.log`**, all 30 candidate spec files, locale unset: 352 passed, 5 failed, 7 did not run, EXIT 1 (1.1 h; load 8 at the start, 16–19 in the middle). All 5 failures are `Test timeout of 30000ms exceeded`: p2 'Define → G2' en (32.9 s) and ar (31.5 s); p4-benefits 8 en (30.4 s); p4-gates-closure 9 en (30.2 s); p4-dashboards 6 ar (30.0 s). The 7 not run are the serial followers of those tests. p4-dashboards test 3 (which failed in round 4 on data volume) passed in both projects.
3. **`04-e2e-full-cutf8.log`**, the same 30 files, C.UTF-8: 360 passed, 1 failed, 3 did not run, EXIT 1 (58.8 min). The failure is p2 'Define → G2' en, 30 s timeout (32.3 s); the 3 not run are its serial followers.
4. **`04-e2e-solo-failed-unset.log`**: p2-journeys, p4-benefits, p4-gates-closure and p4-dashboards alone, locale unset, at load 9–15: 63 passed, 4 failed (the same 30 s timeouts: Define → G2 en and ar, p4-benefits 8 en, p4-gates-closure 9 en; each failed mid-journey at a different step, i.e. slow, not stuck), 7 did not run, EXIT 1. p4-dashboards 6 ar passed.
5. **`04-e2e-probes-cutf8.log`**: my probes with C.UTF-8: 19 passed, 1 failed (my `Z`, en), EXIT 1. The one failing recorded check is my own sweep's `S2-lead-/dashboards/rag-policy-390px` = 'no-h1'. Every F-DG4-143/144 check passed in en and ar. Cause: a defect of MY probe, see run 7.
6. **`04-e2e-solo-failed-lowload-unset.log`**: the four specs alone, locale unset, load 3–6: 74/74, EXIT 0.
7. **`04-e2e-solo-failed-and-r5-cutf8.log`**: the four specs plus my `dg4-qa-r5.spec.ts` (revision 1), C.UTF-8: 83 passed, 1 failed (my `Z` en, the same 'no-h1' check), EXIT 1. All 74 candidate tests passed (37 per project).
8. **`04-e2e-ragpolicy-diag-cutf8.log`** (`dg4-qa-r5-ragpolicy-diag.spec.ts`): the lead opens `/dashboards/rag-policy` at 390 px 12 times per language: 24/24 show the h1 AND the no-permission state ('Not found …'), at 1 s and at 20 s. My sweep's `open()` waited on `h1.or(denied)`, which then matches two elements: Playwright's strict-mode error, caught by `open()` and recorded as 'no-h1' whenever both were present at the check. The product is consistent; the probe was wrong.
9. **`04-e2e-r5-rev2-cutf8.log`** and **`04-e2e-r5-rev2-unset.log`**: `dg4-qa-r5.spec.ts` revision 2 (`h1.or(denied).first()`; nothing else changed): 10/10 each, EXIT 0, 546 checks per language, 0 failed; the lead's rag-policy check records 'no-permission'.

'Define → G2' is a DG2 journey cited by no DG4 row. It runs at 22–33 s against a 30 s limit (D-111, D-112, D-115). Every e2e failure of runs 2–4 passed in run 6 (locale unset) and run 7 (C.UTF-8).
