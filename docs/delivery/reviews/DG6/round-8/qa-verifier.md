# DG6 round 8: qa-verifier narrative (T-DG6-REV-QA-R8, run d340cd64)

**Verdict: FAIL.** Candidate `sha256:6cda8b33…142f21d` (source `d84d11a6`, 2754 files) was confirmed on a disposable clone.

## Findings (new)

| ID | Severity | Summary |
|---|---|---|
| F-DG6-560 | Medium | The automation re-save rule (`keepRestrictedLiterals`) pairs hidden condition literals by ordinal and list position. A rule author who cannot see the literals removes "condition 1" in the editor and saves. The server then keeps the **removed** condition's hidden literal, and the one the author kept is silently lost. This was reproduced in the UI on the real demo stack in en and ar, under both locale settings. In the integration probe, deleting a visible literal ahead of a restricted one destroys the hidden literal: the rule stores the string `[restricted]`. An `in` list behaves the same way. This contradicts D-222 (2), "a re-save keeps the hidden literal unchanged", and no ADR or handback discloses it. |
| F-DG6-561 | Low | The "Includes restricted records" label always carries the title and screen-reader text "This total includes records you are not admitted to…". It says that on My Work rows, automation conditions and register rows too, where there is no total (en and ar). This is copy only. |

Under D-192, a Medium finding must be repaired before the gate, so the verdict is FAIL. Nothing else failed.

## Verifications

None of my earlier findings is open, so `qa-verifier.verifications.json` has an empty list.

## What passed (details in `qa-verifier.json`)

- **Static checks:** build, typecheck, lint, OpenAPI lint (932 operations), no-CDN, format and contrast all pass.
- **Unit:** all three projects pass on Node 24.21.0 and Node 22.22.0 (22.22.2 is not installed), with the locale unset and with C.UTF-8. One file failed in the first run because my sparse clone lacked an evidence folder; it passed after the folder was restored.
- **Integration (two runs):**
  - Run 2: 430/430 files, 4296 passed, 1 skipped, 1 todo.
  - Run 1: one file, `oidc.test.ts`, failed in setup with ENOSPC on the shared volume. Re-run alone it passed 33/33.
  - Contract: 932/932 operations validated, and every p6-pending list is empty. There are 118 migrations, 0001 to 0126.
- **tests/qa alone:** 45 files, 437 tests passed.
- **e2e, product journeys:**
  - C.UTF-8: 556 passed, 2 skipped (the keyboard walkthrough, which needs the demo database).
  - Unset: the same 556 and 2. It took two parts, because the background-task time limit stopped the first part.
- **e2e, root specs:** 288 passed and 18 skipped in each locale setting. The 18 are the declared NOT SCANNED axe routes.
- **e2e, demo stack:** all in-tree demo specs pass.
- **BE-Z12/Z12B before and after:**
  - The candidate passes 21/21 integration tests and 75/75 web tests.
  - With `apps/api/src` reverted to the round-7 source, 12 integration tests fail; with the web source reverted too, 9 web tests fail.
- **D-225 screens:** My Work and the workspace header with a restricted work item are correct in en and ar. They carry no record id, link to the transformation home, show the label, pass axe, and have no overflow at 360 or 390 px. The automation editor shows the markers and the label correctly; the re-save is the defect above.
- **Reliability:** the A13 drills and the D-203 burst pass.
- **Load and export (provisional):** every p95 is within target. The one export sub-check failure is the known LOAD-T20 residual.
- **Validators:** `--historical` passes for DG5 to DG1, and `--register DG6` and `--pipeline` pass.

## Disclosures

- **Record round number.** The assignment's record format says `round: 7`. This is round 8 (directory `round-8`), so the record uses `round: 8`.
- **Discarded product run 30.** The shared volume ran out of space. Playwright's trace files in my product run 30 had grown to about 690 MB, and I deleted them. That broke 7 tests of that run with trace-file errors. The run is discarded and was repeated with `--trace=off`.
- **Earlier attempt's files.** The files directly under `docs/delivery/test-evidence/DG6/qa/round-8/` (outside `r8/`) and the probe revisions without a `b`–`e` suffix come from the interrupted attempt `b78ab910`. They are not cited as evidence of this run. The one exception: the `zz-qa-dg6r8-*` probes copied from round 7 were re-run here, and their outputs are in `r8/`.
- **Product gates.** Nothing here is a G1–G6 business approval. All data is synthetic, and product G6 never implies DG7.
