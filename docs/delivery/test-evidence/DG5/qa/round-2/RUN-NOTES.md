# qa-verifier DG5 round 2 (corrected clean re-gate): run notes (T-DG5-RG2-QA-R2; the assignment file names T-DG5-REV-QA-R5)

Candidate `sha256:55a411ae9f4e87473478988f3d9909752a934a547ba40acc1479f2b2bc3a24ce` (2207 files), source `660f40c7d141b6fb73c145e0ee7a053ceb5905de`, freeze `7a02e7d`.
Every build and test ran in one disposable COMPLETE clone, `$TMPDIR/review` (env.txt). The F-DG5-140 mutant ran in a hard-link copy, `$TMPDIR/review-mut`. Both were removed at the end.
I read no other reviewer's round-2 record. My own round-1 record, run notes and probes were reused as the plan; every result cited here comes from this run.

## Order of work (UTC)
1. 00:3x: identity check. The clone at 660f40c and at 7a02e7d, and the repository working tree, give the same id and 2207 files (00-candidate.log). Offline install and `pnpm -r build` (00-install.log, 01-pnpm-r-build.log).
2. 00:53: first attempt to start INT1 and the product e2e with `nohup`. It was killed when the shell call returned (the sandbox ends a call's processes). The logs are kept as `*-attempt1-ABORTED-harness*`; they hold no test result. Every long run was then started as a tool background job.
3. 00:57-02:09: INT1 (locale unset): 321 files, 3087 passed + 1 skipped, EXIT 0. 00:57-02:48: product e2e unset. 00:57-01:12: static checks (7/7 EXIT 0).
4. 00:58-01:09: F-DG5-140 verification. The mutant (20), the real-stack probe on the fixed build and on the mutated worker (21), and the Arabic XML-character probe on the real stack (22). Their probe-error attempts are kept and labelled.
5. 01:12-02:34: unit series and validators (09-validate.log, 6/6 EXIT 0). 02:09-02:22: tests/qa alone with the A15 dump (336/336), tests/qa/unit (22/22) and my inspection (62 files, 0 problems). 02:09-03:04: INT2 (C.UTF-8), same counts, EXIT 0.
6. 02:2x-03:14: root and demo specs in both settings, the failed-spec re-run, my probes in both settings, and the exec-pack probe. Then F-140 and the XML probe again in C.UTF-8 (23).
7. 03:00-04:10: full product e2e in C.UTF-8: 470/470, EXIT 0.
8. 04:11: end identity check (00-candidate-end.log), then clean-up.

## Every failure, error line or skip in my logs, explained
- **`04-integration-run1-attempt1-ABORTED-harness.log` and `05-e2e-product-unset-attempt1-ABORTED-harness.log`:** my own harness error (nohup inside a sandboxed shell call). No test had finished. Both were re-run in full.
- **`02-unit-node22-unset-attempt1-VITEST-RPC-TIMEOUT.log` EXIT 1:** 147 files and 2366 tests passed, plus unit-web 1746 and nocodegen 259 + 2 skipped. Vitest reported 1 unhandled error, `[vitest-worker]: Timeout calling "onTaskUpdate"`. This is the runner's internal worker-to-main RPC timing out at a 1-minute load of 25.6 on 4 cores. No test failed or errored. Re-run alone: EXIT 0, same counts (02-unit-node22-unset.log).
- **`05-e2e-product-unset.log` EXIT 1 (462 passed, 3 failed, 5 did not run):** each failure is "Test timeout of 30000ms exceeded" at a load of up to 25.5 (three reviews at once). No assertion failed:
  - `p3-seams.spec.ts:38` [en] (33.8 s) timed out inside axe's `page.evaluate`;
  - `p4-benefits.spec.ts:454` "8. Auditor read-only …" [en] (30.2 s) failed at `context.close` after the timeout;
  - `p4-gates-closure.spec.ts:372` "6. Modular G3 …" [en] (30.0 s) timed out at `browserContext.newPage`.
  - The 5 "did not run" are serial followers in those files. Re-run alone (05-e2e-product-unset-rerun-failed-specs.log, both projects): 42/42. The three tests took 19.8 s, 27.4 s and 14.0 s in en, and 17.3 s, 21.0 s and 12.7 s in ar.
  - The C.UTF-8 run passed all 470. These are timing observations, not product defects: the same class the history branch carried to DG6 as F-DG5-145/146. p4-benefits 8 needed 27.4 s alone while my other runs were going, close to its 30 s budget.
- **`01-pnpm-format-check-attempt1-OVERLAP.log`:** EXIT 0, but its window overlapped the minutes when my probe spec was copied into the clone's e2e/. It was re-run on the clean tree: EXIT 0 (01-pnpm-format-check.log).
- **Probe errors (mine), each kept and labelled:**
  - `21-f140-real-stack-attempt1-PROBE-ERROR.log` and `21-…-MUTANT-attempt1-PROBE-ERROR.log`: my header rule took the first PPTX text run. On a demo export the title slide draws the REQ-PB-089 demo label first, so the probe now skips the demo label. In that same attempt the fixed build already had zero name problems.
  - `22-xmlchars-ar-real-stack-attempt1-PROBE-ERROR.log`: `xmlTexts` reads only `<a:t>`/`<w:t>`, but an XLSX inline string is `<t>`. The probe now reads `<t>`.
  - `11-inspect-samples-attempt1-PROBE-ERROR.log`: my PDF header rule took the first text piece, which in an Arabic PDF is a lone glyph. It now takes the first visual line (pdf/read.ts `lines`), read right to left. That attempt also showed every Arabic file with the Arabic name and none with the English one.
- **`20-f140-mutant.log`, `21-f140-real-stack-MUTANT.log` EXIT 1:** BY DESIGN. Against a mutant that reverts the fix:
  - the candidate's branding.test.ts test "version 0: an Arabic export's header carries «منصة موبايلي للتحوّل»" fails, at `ar docx header`;
  - my inspection fails with 87 problems, all on the 31 Arabic files and none on English files. Each Arabic file has no Arabic name and prints the English name; the other 25 are header problems on the PDF/DOCX/PPTX files, counted by the older PDF rule;
  - the real-stack probe fails with exactly 6 problems, all on Arabic files.
  - The A15 matrix itself passed under the mutant (30 passed with branding.test.ts); see the observation below.
- **Unit (all four final logs):** 18 stderr blocks per run, all from passing tests:
  - 10 from percentKpi.test.tsx and 2 from kpiUnit.test.tsx (React "two children with the same key");
  - 4 from extension-fields.test.tsx and 1 from extension-hosts-twelve.test.tsx (generic mocks lack payload fields; the page section falls into React Router's error boundary, and the test still asserts its strip);
  - 1 from branding.test.ts (Ajv "unknown format date-time ignored").
  - 0 ×/FAIL lines. The 2 skips are by design (fuzz.test.ts `it.skipIf(NOCODEGEN)`).
- **Integration (both runs):** 1 skip by design (governance/presentation.test.ts `it.runIf(!hasMeetingPackAssembler)`). The error, timeout and 408 lines are stdout from passing fault-injection tests: connection-hygiene SWEEP 408, request-io F-DG2-412 BE17 R6a-e/R8/db-econnreset, and BE18 Q7 idp_unavailable.
- **Build:** Vite's advisory "Some chunks are larger than 500 kB" (EXIT 0). Contrast: "3 prohibited pairs fail as documented" (by design, EXIT 0). Install: two "Failed to create bin … mth-db" warnings before the build; a second offline install after the build linked it (EXIT 0).
- **e2e logs:** three "npm warn Unknown project config" lines each (npm reading the pnpm .npmrc), with no effect. The real-stack logs end with the worker's info-level "outbox relay … failed:0" lines (no failure).

## Commits that landed during my run
HEAD moved from 7a02e7d to 550d3bd and c3031e6. Both are the other reviewers' auto-committed run records; 0 files outside docs/delivery changed. I did not open their records. The candidate id was unchanged at the end (00-candidate-end.log).

## Observations (not findings)
- The candidate's A15 matrix (tests/qa) does not detect a version-0 product-name language regression; it passed under the F-DG5-140 mutant. The guard is the implementer's branding.test.ts plus labels.test.ts, which did catch it. A future QA suite could assert the product name per language.
- Timing: three product e2e tests crossed 30 s only at a 1-minute load of about 25. They pass alone and passed in the C.UTF-8 run. p4-benefits 8 took 27.4 s alone under background load.
- Demo record texts are stored in English and so show in English on Arabic screens (for example the seeded approval's title and note, screens/ar-qa-r2-unset-d2-inbox-approval.png). They are synthetic record data, not catalogue strings; the shell, labels and the synthetic-approval notice are Arabic.
- Integration tests leave many `mth-evidence-it-*` temporary directories under TMPDIR (618, 90 MB in this run). A shell sweep of them was refused by the permission classifier. They are in this run's private TMPDIR, which the runner removes.

## Clean-up
`$TMPDIR/review`, `$TMPDIR/review-mut`, the pnpm store copy, the A15 dump, the Playwright outputs and the screenshot scratch were removed. Kept: 12 screenshots in screens/ and 8 export samples in samples/ (charter PDF/DOCX, executive-pack PPTX and register XLSX, each in en and ar).
