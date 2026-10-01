# DG1 round 3: qa-verifier narrative

- **Candidate:** `sha256:18e150714d29fa67aeaf28e817bb500d2db6191c88cde3ea680b3a64c8056f5b`, 394 files. Source commit `40dbd24`.
  - Recomputed on the working tree (HEAD `4f312cc`, then `3d58455`), in a disposable clone at `40dbd24`, and again after the control experiment was restored.
  - The HEAD delta is metadata only: assignments, manifest, `stages.json`, and the other reviewers' auto-committed records.
- **Run:** `DG1-T-DG1-REV-QA-R3-qa-verifier-20261001T222556Z-616f0029`.
- **Verdict: PASS.** No new findings.
- **Independence:** I formed this verdict without opening any other round-3 record.

## F-DG1-232 (raised by me in round 2): CLOSED_VERIFIED

**The fix.** Between round-2 candidate `485e91f` and `40dbd24`, the only non-record change is `apps/web/e2e/journeys.spec.ts`.
- After `page.reload()`, the spec now calls `expectShellReadyForKeyboard()` before pressing Tab. That helper waits until:
  - the wordmark and the navigation are visible;
  - My Work has `aria-current=page`;
  - the `main#main h1` is visible;
  - the document has focus and nothing is focused.
- Nothing is clicked.
- The assertion is stronger than before: Tab must focus the skip link, then Enter must focus `main#main`.

**Execution** (retries 0, `--workers=1`, logs under `docs/delivery/test-evidence/DG1/qa/round-3/`):

| Run | Result |
|---|---|
| Full journeys EN+AR, run 1 (14) | 18/18, 0 skipped |
| Full journeys EN+AR, run 2 (14f) | 18/18, 0 skipped |
| Full journeys EN+AR under CPU load (14g, loadavg ~16–18 on 4 CPUs) | 18/18, 0 skipped |
| qa-stack e2e (15) | 22/22 |
| Shell journey ×20 per locale (14b) | 40/40 |
| Shell journey ×20 per locale, second unloaded run (14c)¹ | 40/40 |
| Shell journey ×20 per locale **under load** (14d, loadavg 18–20) | 40/40 |
| **Control:** pre-fix spec, same ×20 under the same load (14e) | **1 failed**/39 passed, at the original `toBeFocused` (line 172) |

In total the fixed journey ran 128 times with 0 failures, 42 of them under load. The control shows this harness and load still expose the race, which the fixed spec does not show.

¹ 14c was intended as the loaded run, but the background load had already been reaped when it started. Its log says so, and it is counted as an unloaded run.

## Other checks (all PASS)

- **Static checks:** typecheck, build, lint, OpenAPI lint (3.1.1, 33 operations), no-cdn, format, contrast.
- **Unit tests:** 326/326 on Node 22 and on Node 24.
- **Integration:** 209/209 in two runs on separate disposable PostgreSQL 16 clusters.
  - 9 migrations applied.
  - `bu-hierarchy-guard` passed 7/7.
  - The contract suite passed 9/9, including getBrandingTokens.
  - No 57P01 errors.
- **DB probe:** rerun and passed.
- **Acceptance:**
  - A12/A13/A14: 24/24.
  - A18 clean start: PASS.
  - A20: bilingual shell and token propagation pass (`#6B1D5C` rendered).
- **axe:** 0 violations on 15 EN and 15 AR pages.
- **Probes:** both black-box probes (round 1 and round 2) and the worker-stop probe passed.
- **Validators:** `--register`, `--pipeline` and `--reconcile` all PASS.
- **Static requirement checks:** PASS for REQ-S15-002/005/006, REQ-S16-001…004 and REQ-S19-004/006.
- **Round-2 closures:** F-DG1-230 and F-DG1-231 stay CLOSED_VERIFIED. `requirements.csv` and `docs/architecture` are unchanged since round 2.

## Environmental residuals (recorded as PASS of the offline surface, not BLOCKED)

- **REQ-DLV-025 / A24 (D-058):** the CI config, `check-ci-needs` (46/46 tests), three negative mutations and the gate-tamper simulation were all verified. The live GitHub Actions run cannot be reproduced here and is not claimed.
- **REQ-DLV-042 (D-057):** the install sandbox passes 13/14 offline. AC-1 (effect) fails only because `create` fetches registry metadata (`ERR_PNPM_META_FETCH_FAIL`, ECONNREFUSED via the proxy). The live-registry effect is not claimed.

## Operator errors (kept and labelled, not product results)

- **16a:** the A20 script was called before its copy existed.
- **22a:** the CI script ran in a clone without `node_modules`, so that attempt is void.
- **25a:** my own token-lookup bug in the static checker. The rerun passes.

## Observation (not a finding, carried from round 2)

The REQ-S16-004 register note still says "0001-0008". Migration 0009 adds only a trigger, so the claim in the row still holds.
