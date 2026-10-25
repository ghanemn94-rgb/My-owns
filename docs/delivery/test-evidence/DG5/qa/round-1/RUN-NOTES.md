# qa-verifier DG5 round 1 (corrected clean re-gate): run notes (T-DG5-RG2-QA-R1; the assignment file names T-DG5-REV-QA-R5)

Candidate `sha256:ff3bc2c42889d232a84658da7ff850117a8c0c1ba1de6b4c8e32bcc30dae1008` (2203 files), source `2fe8f853e54ef7ab7b88527f11633c0c3542edd6`, freeze `f816fb2`.
Every build and test ran in a disposable COMPLETE clone `$TMPDIR/rv` and its copy `$TMPDIR/rv-e2e` (env.txt). Both, the store copy and all scratch are removed at the end of the run.
I read no other reviewer's round-1 record. The 5a7c189 history was read only for context (durations to plan the runs; its findings ids); I cite only evidence produced in this run.

## Order of work (UTC)
1. 16:10 identity on the clone (f816fb2 and 2fe8f85) and in the repository working tree: same id, 2203 files; 0 files outside docs/delivery differ from 2fe8f85, and 0 product files differ from 5a7c189 (00-candidate.log). 16:10-16:12 offline install, `pnpm -r build` (00-install.log, 01-pnpm-r-build.log).
2. 16:13-17:31 integration run 1 (320 files, 3084 passed + 1 skipped, EXIT 0). 16:14-18:11 full product e2e, locale unset (455 passed, 5 failed, 10 did not run; explained below), at a 1-minute load of 9-18.
3. 16:16-17:24 my probes (exec pack, PB-093 Studio UI, AUD sweep, demo), with their invalid attempts kept and labelled (below).
4. 16:5x-17:10 validators (09-validate.log, 6/6 EXIT 0); 16:58-17:05 static checks (7/7 EXIT 0).
5. 17:24-17:34 tests/qa alone (31 files, 336/336) with the 64 A15 files dumped; 17:24 tests/qa/unit (22/22); 17:35 my sample inspection (62/62 files clean); 17:31-18:26 integration run 2 (same counts, EXIT 0).
6. 17:37-18:12 root acceptance specs unset (30/30) and C.UTF-8 (30/30); demo specs unset (12/12) and C.UTF-8 with my demo probes (20/20); AUD probe C.UTF-8 (84/84); PB-093 probe C.UTF-8 (en 1/1, ar 1/1).
7. 18:12-18:23 the five failing product specs alone, unset: 70/70. 18:23-19:43 full product e2e C.UTF-8: 470/470, EXIT 0 (1.3 h; load max 9.55).
8. 18:27-18:54 unit series: Node 22 and 24, locale unset and C.UTF-8, each EXIT 0 with 2350 / 1746 / 259 + 2 skipped. Load samples max 8.9-9.6 (other reviewers still running; no envelope is claimed).
9. End: identity re-check (00-candidate-end.log), clones removed.

## Every failure, error line or skip in my logs, explained
- **05-e2e-product-unset.log EXIT 1 (5 failed, 10 did not run):**
  - `journeys.spec.ts` "administration screens (access + technical administrator)" [chromium-en]: the dev sign-in form's 'Synthetic user name' field was not visible within 5 s (journeys.spec.ts:131 in signIn, called at :416). The test ran at about 16:16-16:17Z, inside the window in which the shared disk was full (16:15-16:20Z; my own probe hit ENOSPC at 16:16:46Z, 06-probe-exec-pack-attempt1-ENOSPC.log). The API log tail the harness prints is empty, so the cause is not proven; alone it passed in en and ar (8.9 s / 8.5 s).
  - `p3-seams.spec.ts` "P3 pages: bilingual titles, …" [en] (34.0 s), `p4-adoption-bau.spec.ts` "6. BAU handover …" [en] (30.4 s), `p4-traceability.spec.ts` "2. Traceability: …" [en] (30.4 s), `p4-benefits.spec.ts` "8. Auditor read-only; …" [ar] (30.4 s): "Test timeout of 30000ms exceeded" at a 1-minute load of 12-18 on 4 cores (three reviews at once). No assertion failed (p3-seams timed out inside axe's page.evaluate; adoption-bau waited for an h1 after navigation; benefits-8 failed at context.close after the timeout). Alone (05-e2e-product-unset-rerun-failed-specs.log, load max 6.4): 70/70, these tests took 18.7 s, 18.2 s, 13.1 s and 21.3 s (ar). The 10 "did not run" are the serial followers of these specs; they passed in the re-run. Not product defects; recorded as timing observations (no explicit per-test budget; the same class the history branch carried to DG6 as F-DG5-145/146).
- **06-probe-exec-pack-attempt1-ENOSPC.log EXIT 1:** the disposable PostgreSQL could not extend a file (No space left on device) while migrating; the shared volume was full. I deleted my copy's .git and docs/delivery evidence/runs (about 4 GB). Not a product defect.
- **06-probe-exec-pack-attempt2-PROBE-ERROR.log EXIT 1:** my probe chose a period (2041-08) with no demo values (every value headline "0") and matched the label line by line, while the PDF prints the label on its own line. Revised to the demo's own 2026-08 period (the pending SAR 99,000 measurement) and a ±4-piece neighbourhood: 3/3.
- **07-probe-pb093-unset-attempt1-PROBE-TIMING.log:** my 5 s URL wait timed out at load 14 (the draft page arrived later); the ar project then failed on the en project's still-open draft. attempt2-PROBE-ERROR: the review dialog stayed open because my probe did not wait for the preview verdict ("Run a successful preview and test of the current draft first"). attempt3-PROBE-ERROR: my 95 % path skipped the office's review approval, so publish answered "needs an approved review". attempt4-PROBE-ERROR: `count()` does not wait, so the checks were never clicked (same preview message). attempt5-PROBE-ERROR: en passed; ar hard-coded 25 % for the existing transformation, which in the second project was created after en had published 30/20/20/15/15. Final: each project on its own fresh stack, en 1/1 and ar 1/1, in both locale settings.
- **08-probe-aud-p5-unset-attempt1-PROBE-TIMEOUT.log:** my single 15-minute test over 42 screens hit its own budget under load. attempt2-PROBE-FALSE-POSITIVE: 83/84; my write-verb pattern matched "Created sorted descending" (a sort header on /admin/studio) as "Create". Final (word boundary): 84/84 unset and 84/84 C.UTF-8.
- **10-probe-demo-unset-attempt1-PROBE-RACE.log:** D4 counted the banner right after the h1 appeared; the banner waits for the environment read, and the missing screens differed between en and ar. With a 15 s wait for the banner: 8/8 unset, 8/8 C.UTF-8.
- **Unit (all four logs):** 18 stderr blocks per run, all from passing tests: 10 percentKpi.test.tsx and 2 kpiUnit.test.tsx (React "two children with the same key", fixture data), 4 extension-fields.test.tsx (the REQ-PB-011 header test for T12 and T14 renders those pages with generic mocks whose RACI and benefit-totals payloads lack fields, so a page section throws into React Router's error boundary; the test still finds and asserts the template provenance strip, and the real pages pass on the real stack in E2E-P), 1 extension-hosts-twelve.test.tsx, 1 branding.test.ts (Ajv "unknown format date-time ignored"). 0 unhandled errors, 0 ×/FAIL lines. The 2 skips are by design (fuzz.test.ts `it.skipIf(NOCODEGEN)` in unit-formula-nocodegen).
- **Integration (both runs):** 1 skip by design (governance/presentation.test.ts `it.runIf(!hasMeetingPackAssembler)`; its counterpart passes). Lines with error/timeout words are the stdout of passing fault-injection tests (connection-hygiene 408 sweeps; request-io F-DG2-412 BE17 R6a-e and db-econnreset; commit-time-auth BE18 Q7 idp_unavailable).
- **Build:** Vite's advisory "Some chunks are larger than 500 kB" (EXIT 0). Contrast: "3 prohibited pairs fail as documented" (by design, EXIT 0). Install: two "Failed to create bin … mth-db" warnings before the build (the bin's target is built later; a second offline install after the build linked it).
- **e2e logs:** three "npm warn Unknown project config" lines each (npm reading the pnpm .npmrc), no effect.

## Commits that landed during my run
HEAD moved from f816fb2 to e4cbc43 (and later commits) through other reviewers' auto-committed run records under docs/delivery. I did not open their round-1 records. The candidate id was unchanged at the end (00-candidate-end.log).

## Finding id
My range starts at F-DG5-140. The history branch 5a7c189 also used F-DG5-140 (CLOSED_VERIFIED there); this branch's findings.json has no DG5 finding, and the assignment requires 140-159 in order, so F-DG5-140 is used and the collision is flagged for the orchestrator.

## Observations (not findings)
- The rooted traceability view shows the platform's deliverable and capability nodes between the initiative and the outcome KPI. The five B0147 chain-1 labels are shown in chain order (screens/*-qa-r1-d1-traceability-chain1.png).
- The generated rationale of a Studio-default weight set ("Studio default weights (scoring defaults vN): strategic fit 30%, …") is English text in the Arabic prioritization screen (screens/ar-qa-r1-pb093-new-transformation-weights.png). It is a stored record text written by migration 0065, not a catalogue string; cosmetic.
- Timing: four product e2e tests crossed 30 s only at a 1-minute load of 12-18, and passed alone in 13-21 s.

## Clean-up
$TMPDIR/rv, $TMPDIR/rv-e2e, the store copy, the A15 dump, the Playwright output and the screenshot scratch were removed at the end of the run. The 12 screenshots kept are in screens/.
