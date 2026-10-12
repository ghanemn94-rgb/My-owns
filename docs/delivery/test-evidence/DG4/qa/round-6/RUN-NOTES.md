# qa-verifier DG4 round 6: run notes (T-DG4-REV-QA-R6)

All evidence of this review is in this directory. The record is `docs/delivery/reviews/DG4/round-6/qa-verifier.json`. Next to it are the narrative `qa-verifier.md`, the verifications `qa-verifier.verifications.json` and the findings sidecar `qa-verifier.findings.json`.

My test files are outside the frozen candidate, under `../tests/round-6/`:
- `e2e/dg4-qa-r6-session-window.spec.ts`: revision 3 was run; revisions 1 and 2 are explained below.
- `unit/qa-r6-session-wait.test.tsx`.

Each was copied into a disposable copy only to run, then removed. My round-5 and round-4 probes were re-run unchanged from `../tests/round-5/e2e/` and `../tests/round-4/e2e/`. Logs are tee'd with `$TMPDIR` paths replaced; the summaries strip the ANSI codes. Every log's first and last lines carry `uptime`.

## Clones and environment

**`$TMPDIR/rv`** is a complete `git clone` of the repository at `0e499f2` (source `1e0dc5d`).
- Candidate `sha256:f966fe57…`, 1472 files at the start and at the end.
- Clean `git status` at the end (`00-candidate-start.log`, `00-candidate-end.log`).
- Used for install, static checks, unit, integration and validate.

**`$TMPDIR/rv2` and `$TMPDIR/rv3`** are tar copies of `rv` after the build, without `.git` and `docs/delivery`. They were used for the e2e runs.

**`$TMPDIR/rv-mut`** is a tar copy of `rv`, used only for:
- the mutants (`02d`/`02e`/`02f`/`02g`);
- the pre-repair controls (`02c`/`02c3`).

Every mutated file was restored, and checked with `cmp` against the candidate (logged).

**Install:** `pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pnpm-store-root/v10` (a copy of the pre-installed store). The two `WARN Failed to create bin … mth-db` lines are expected: the bin target only exists after `pnpm -r build`.

**Tools and ports:**
- Every direct vitest call used `--configLoader runner`, because `node_modules` is read-only in the confined sandbox (QA-A's finding). `pnpm test` ran unchanged.
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; `playwright install` was never run.
- All ports were in 26500–26699 (`env.txt`).

**HEAD moved during the run**, from `0e499f2` to `1159ab5`. The two new commits only add the other two reviewers' auto-committed run evidence; I did not read them. The candidate ID is unchanged (`00-candidate-end.log`).

**Machine load:**
- 12:30Z–14:00Z: load average 20–30, with the three reviews plus my own runs.
- 15:05Z–15:56Z: my controller held it at 13–15.
- Afterwards: 2–9.

## Index

| Prefix | What |
|---|---|
| `00-` | The candidate check (start and end) and the offline install. |
| `01-` | Static checks (`scripts/run-static.sh`): all seven exit 0. The build log carries Vite's advisory "chunks larger than 500 kB", a warning and not an error. |
| `02-` | `pnpm test`: Node 22 and 24 × locale unset and C.UTF-8, three series. See "Unit". |
| `02b`–`02g` | The F-DG4-145 verification: failed files alone, the pinned contention, mutants and my held-`/me` test. See "F-DG4-145". |
| `03-` | Integration on a disposable PostgreSQL (`scripts/run-integration.sh`), with 61 migrations applied (`0001`→`0061`). See "Integration". |
| `04-` | e2e on the real stack (`e2e/support/qa-stack.sh`), `--workers=1`, chromium-en and chromium-ar. See "e2e". |
| `05-` | `tools/gates/validate.mjs`: register DG4, pipeline, and historical DG3, DG2 and DG1. All PASS, exit 0. |
| `06-` | The 137-row requirement trace (`scripts/trace.py`, unit log `02-unit-node24-unset-lowload.log`): 137/137 rows have at least one evidence test in this round's logs and no failure left unresolved by a solo re-run. |
| `results/` | My probes' recorded checks per run and language (JSON), with screenshots of the first probe run. |

**Integration (`03-`):**
- `run1` and `run2`: 208 files / 1975 tests each, EXIT 0. `contract.test.ts` passed its 45 cases in each.
- `tests-qa-candidate-only`: 15 files / 172 tests, EXIT 0.
- `dlv036-a04-a09-a10-a11`: 7 files / 85 tests, EXIT 0.
- `03-pending-lists.txt`: 47 exported p4-pending arrays in 43 files, evaluated at runtime, with 0 entries in total.
- The 14 'error'/'timeout'/'fail' text matches outside passed-test lines in each full run are the stdout of passing tests that probe error paths by design: 408 on stalled bodies, a deliberate DB-side ECONNRESET, IdP-unavailable redirects. They are the same 14 as in round 5.
- `03-integration-run2-killed-by-bg-limit.log` is the first attempt at run2. It was stopped mid-run by the agent tool's 2-hour background limit on the whole chain (`run-chain.sh`), not by a test. It was re-run in full as `03-integration-run2.log` (`scripts/run-chain2.sh`).

## Unit (every non-pass explained)

`pnpm test` is `vitest run unit-node unit-web && vitest run unit-formula-nocodegen`. When the first command fails, the nocodegen project does not run.

1. **`02-unit-{node22,node24}-{unset,C}.log`** (12:33Z–13:45Z, load 20–30, three reviews plus my e2e and mutants). All four EXIT 1:

   | Run | Failures |
   |---|---|
   | node22-unset | 4 |
   | node22-C | 8 |
   | node24-unset | 2 |
   | node24-C | 1 |

   - **The failing tests, every one either a Testing Library wait or a test timeout:**
     - `raid.test.tsx`: T15 register (en), and action register (en/ar);
     - `sustain.test.tsx`: handover checklist (en);
     - `fe-e.test.tsx`: Funding decisions (en);
     - `prioritization.test.tsx`: ranked table (en);
     - `p2-blank-forms.test.tsx`: gate submission note (en), and P1 edit validation.blank (en).
   - **The waits:** "Unable to find role=…" after the 5 s `asyncUtilTimeout` (F-DG2-220).
   - **The timeout:** `apps/api/src/architecture.test.ts` exceeded its 30 s test timeout.
   - **No failure in `session-bound`/`-identity`/`-generation`:** 80/80 in every run.
2. **`02-unit-*-load13-15.log`** (15:09Z–15:56Z). `scripts/run-unit-load-held.sh` held the 1-min load at 13–15 with unpinned busy loops: 203 samples, median 13.9, p10–p90 12.6–14.9 (`02-unit-load-held-samples.log`).
   - **node22-unset:** EXIT 1, 4 failed. These are fe-e Funding (en), prioritization ranked (en), p2-blank-forms gate note (en) and architecture.test (30 s).
   - **node22-C:** EXIT 1, 1 failed (fe-e Funding (en)).
   - **node24-unset and node24-C:** EXIT 0, 2917 + 259 passed and 2 skipped.
   - **Session test files:** 80/80 in all four.
3. **`02b-unit-failed-files-alone.log`**: the six failing files alone, at load 17–20. 256/260 passed. The 4 failures are the same first-render waits in fe-e, prioritization, raid and p2-blank-forms; `architecture.test.ts` and `sustain.test.tsx` passed.
4. **`02-unit-*-lowload.log`** (15:57Z–16:15Z, load 3–9): all four EXIT 0, each with 152 files / 2917 tests passed, plus 3 files / 259 passed and 2 skipped (unit-formula-nocodegen). The 2 skips are by design: `it.skipIf(NOCODEGEN)` in `packages/shared/src/formula/fuzz.test.ts`.

**Mechanism** (raised as F-DG4-148, Low):
- Every failing web test is the first render of its page module in its file. The `en` describe block runs first; for raid action register, it is the first render of the `/actions` route.
- Under CPU contention, that first render (on-demand transform and lazy route import) takes longer than the 5 s wait.
- They pass at load ≤ 9, and the product is unaffected.

## F-DG4-145: the verification runs

| Log | What |
|---|---|
| `02c-unit-session-bound-contention.log` | The round-5 pinned reproduction: session-bound alone, `taskset -c 0` plus 3 busy loops on CPU 0.<br>• **Candidate:** 3 runs. 2 fail Y1c (en) on its 5 s wait for "Transformation created…"; the `/me` count is never reached there. 1 passes 36/36.<br>• **Control** (the pre-repair file from `3e3a06e`, same product code): fails 2/2 on the count ("length of 2 but got 3"), the round-5 defect. |
| `02c2-unit-pinned-generic-control-{raid,sustain}.log` | The same pinned setup on two unrelated page-test files: 2/2 pass each. |
| `02c3-unit-pinned-y1c-variants.log` | The pinned setup, Y1c cases only (`-t Y1c`), 2 runs each:<br>• **A, the candidate:** 6/6 passed in both runs.<br>• **B, the candidate with its controlled clock NOT installed:** fails the count (3 `/me`) and the new window case, both runs.<br>• **C, the pre-repair file:** fails the count, both runs.<br>The controlled clock is what makes the count deterministic. |
| `02d-unit-session-mutants.log` | Six mutants of `apps/web/src/api/client.ts`, against the three session test files. Killed: M1 (window ignored), M2 (window never crossed), M3 (no navigation confirmation) and M5 (no generation check). M4 (a page GET does not wait for the check in flight) survives, 80/80. M6 fails one X3 test, but M6 is near-equivalent; see M6b. |
| `02e-unit-web-mutants-full.log` | M4 and a stronger M6b against the whole unit-web project.<br>• **M4 survives:** 1340/1340.<br>• **M6b** fails only `raid.test.tsx` action register (en), a first-render wait at load 25–29. M6b is equivalent here, because TanStack Query dedupes concurrent fetches of the `/me` query. |
| `02f-unit-held-me-test.log` | My test `../tests/round-6/unit/qa-r6-session-wait.test.tsx` holds the `/me` answer. On the candidate it passes 4/4; under M4 it fails 4/4. |
| `02g-unit-m4-pre-repair-tests.log` | M4 against the pre-repair (`3e3a06e`) versions of the three session files: 78/78 pass. The gap pre-dates the FE-R9B repair. Raised as F-DG4-146 (Low). |

## e2e runs, in order (every non-pass explained)

1. **`04-e2e-full-unset.log`**: all 31 candidate spec files, locale unset, 12:33Z–13:56Z at load 9–30. Result: 334 passed, 13 failed, 17 did not run, EXIT 1; all 364 tests are counted.
   - **12 of the failures** are `Test timeout of 30000ms exceeded`:
     - p2 "Define → G2", en and ar;
     - p3-seams "P3 pages", en;
     - p4-adoption-bau 6, en;
     - p4-benefits 8, en and ar;
     - p4-dashboards 6, en and ar;
     - p4-execution 1, en;
     - p4-gates-closure 9, en and ar;
     - p4-raid-governance 5, en.
   - **The 13th** is `session-end.spec.ts` "a 403 is not a session end" (ar): `Expected: 403, Received: 200`. The trace shows the cause (F-DG4-147, Low).
     - `page.goto("/about")` returned at 13:55:45.200Z, and the test's re-login `POST /auth/dev-login` ran at .202–.234Z.
     - The SPA's boot `GET /me` was sent at .257Z, after both. It received the new session's CSRF token, so `PUT /me/preferences` correctly succeeded.
     - This is a race in the test, not a product defect. The same test passed in the C.UTF-8 full run, and in the solo run in both projects.
   - **The 17 that did not run** are serial followers of the failed tests.
2. **`04-e2e-full-cutf8.log`**: the same 31 files with C.UTF-8, 14:40Z–15:32Z at load 2–15. Result: 359 passed, 2 failed, 3 did not run, EXIT 1 (364 counted). Both failures are 30 s timeouts: p2 "Define → G2" (ar) and p4-dashboards 6 (ar). The 3 that did not run are the p2 serial followers.
3. **`04-e2e-probes-rev1-unset.log`**: my probes, revision 1 of the session probe, at load 13–15. Result: 20 passed, 2 failed.
   - All round-5 and round-4 probes passed: 546 + 77 recorded checks per language, 0 failed.
   - My session probe failed in en and ar, at W3. Its second tab opened `/login` while the shared cookie was signed in, so the sign-in form never appeared. That was a defect of my probe.
   - W1 and W2 passed in both languages.
4. **`04-e2e-session-rev2-unset.log`**: revision 2 re-logs in through the context's request API, as `session-end.spec.ts` does. W3 passed in en and ar.
   - en recorded W1-1 and W2 as failed. The navigation's own `GET /me` and `GET /transformations` were reported after my `clickNav` had returned (networkidle at load 14), so they fell into the W2 idle window.
   - The order and count are correct: one `/me`, first. Again a probe defect.
5. **`04-e2e-session-rev3-{unset,cutf8}.log`**: revision 3 waits for the navigation's first page-data response. 2/2 passed each, with 14/14 checks per language in each locale.
6. **`04-e2e-solo-failed-unset.log`**: the 9 spec files with failures in run 1, alone, locale unset, at load 2–10. Result: 124 passed, 1 failed, 3 did not run. Every run-1 failure passed here, including session-end "a 403" in en and ar, except p2 "Define → G2" (ar), which hit the 30 s timeout again (32.1 s; en passed in 29.9 s).
7. **`04-e2e-solo-failed-cutf8.log`**: p2-journeys and p4-dashboards with C.UTF-8: 38/38, EXIT 0.
8. **`04-e2e-solo-p2-unset.log`**: p2-journeys alone, locale unset, at load ≈2: 24/24, EXIT 0. "Define → G2" took 24.5 s (en) and 23.7 s (ar).
9. **`04-e2e-probes-cutf8.log`**: every probe with C.UTF-8: 22/22.
   - 546 + 77 + 14 recorded checks per language, 0 failed.
   - The round-4 business-unit-limit probe passed in both projects.

"Define → G2" is a DG2 journey cited by no DG4 row. It runs at 24–33 s against a 30 s limit (D-111, D-112, D-115). Every e2e failure of runs 1 and 2 passed in a later solo run in the same locale setting.
