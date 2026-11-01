# qa-verifier DG6 round 1: run notes (T-DG6-REV-QA-R1)

Candidate `sha256:7d6b4a9f202cfa4031c916dca22a410a6e19da5ff0c5f480a822fd0d025608cb` (2708 files), source
`3cce3d4452fcd91e3db2888c60271e5afdc06062`, freeze commit `60a6b3a5c` (HEAD at the start of the run). Every build and
test ran in a disposable COMPLETE clone `$TMPDIR/rv` and its copy `$TMPDIR/rv-e2e` (env.txt); both, the store copy and
all scratch are removed at the end. I read no other reviewer's round-1 record.

## Machine
Three reviews ran at once on 4 cores / 16 GB with no swap. The 1-minute load stayed between 16 and 32 for hours (the
`*-samples.log` files), with free memory down to 0.3-1 GB at times. Two consequences, both disclosed per run below:
Chromium renderer processes crashed ("Target crashed" / "Page crashed") in several e2e tests, and many e2e tests ran
over their 30 s / 90 s / 120 s budgets. The agent shell also kills its processes when a command returns, so long runs use
the tool's background mode, which stops a run after 2 h; a run stopped that way is reported as such, and its remaining
files were run separately.

## Order of work (UTC, 2026-11-01)
- 12:39 identity on the clone (00-candidate.log): HEAD 60a6b3a5c, not shallow, candidate id recomputed equal (2708 files);
  the freeze commit differs from 3cce3d445 only in 5 docs/delivery files; 0 product files differ from 441b6e23b.
- 12:40 offline install (00-install.log), 12:41-12:44 `pnpm -r build` (01-pnpm-r-build.log), both EXIT 0.
- 12:45-12:46 a first launch of integration, root e2e and static checks died with the shell that started them (no
  result; logs deleted and relaunched in background mode at 12:47).
- 12:47-13:16 static checks (01-static.log): typecheck, lint, openapi:lint, check:no-cdn, format:check, contrast, each
  EXIT 0 (typecheck alone took 18 min at load ~20).
- 12:47-13:55 root acceptance e2e, locale unset (05-e2e-root-unset.log): 239 passed, 11 failed, 9 skipped, 47 did not
  run, EXIT 1. Every failure is a Chromium renderer crash ("Page crashed" / "Target crashed": a17-failing-connector en,
  a17-import CSV en, a17-import webhook ar), a test-budget timeout (a17-import XLSX en/ar 120 s, a20-p6-axe /admin/audit
  en 90 s, a04 ar, a14 ar, a16 ar 30 s), a 45 s poll for the connector run watch (a17 failing/stopped connector ar) or a
  reload aborted by a crashed frame; the 47 "did not run" are serial followers of those files (37 of them a20-p6-axe
  en). 13:56-14:09 each affected file re-run alone per project on a fresh stack (05b-e2e-root-unset-rerun-alone.log):
  every invocation exit 0 (en: a17-failing 1, a17-import 5, a20-p6-axe 38 + 9 skipped; ar: a04 1, a14 1, a16 2,
  a17-import 5). So every root test passed in the locale-unset setting, in the full run or alone. The 9 skipped per
  language are a20-p6-axe's NOT SCANNED routes, by its design (QA-D §4; REQ-DLV-038 notes).
- 12:56 probe 10 (REQ-S12-019 stale data with a later period open; 10-probe-freshness-later-period.log): EXIT 1 BY
  DESIGN of the probe: the control passes (stale evaluation in the newest period -> scan stale 1, one data.stale), the
  probe's two soft assertions and its hard assertion fail: kpiFreshness reads "unknown" with lastValue/dataAsOf null and
  the scan reports stale 0, emitted 0, so no data.stale event and no data_stale exception for a KPI whose last data is
  2026-01-15 (window 30 days) once the current month's period is open and empty. -> F-DG6-140.
- 12:59 probe 11 (REQ-S15-007 clause 3 literally; 11-probe-arabic-export-literals.log): 6/6, EXIT 0 (pdf, xlsx, csv,
  docx, pptx in ar: 'KPI-001' and '12.5%' contiguous and unreversed; in xlsx the numeric cell holds 12.5 and the literal
  '12.5%' is read from the text cell).
- 13:01 static REQ-S16-022 entity tables (12-s16-022-static.txt), 13:21 form_draft readers (12b-...), 13:23 contract
  inventory (12c-contract-static.txt: 932 operationIds, all 932 unique; every p6-pending list empty), 13:37 audit trigger
  sweep (12d-...: 268 tables writable by mth_app, 60 without a DB audit-coverage trigger: DG1 core tables audited in
  application code by the approved DG1 convention, insert-only child/history rows, system lineage and infrastructure;
  audit_event is INSERT-only for mth_app). Informational; no finding.
- 13:17 probe 13 (ADR-0052 §4 rate-limit classes; 13-probe-rate-limit-classes.log): EXIT 1 BY DESIGN of the probe: the
  control passes (uploadEvidenceContent at UPLOAD_RATE_LIMIT_PER_MINUTE=1: 404 then 429 rate_limited, so the class
  limiter runs before validation); createExport at EXPORT_RATE_LIMIT_PER_MINUTE=1 answers 400 then 400 and createImport
  at UPLOAD_RATE_LIMIT_PER_MINUTE=1 answers 400 then 400 (never 429): the export class has no operation and the import
  upload is not in the upload class. -> F-DG6-141.
- 13:18 load phase A attempt 1 (14-load-phase-a-attempt1-DRIVER-ERROR-patch-strip.log): my driver used patch -p1 for a
  -p0 patch, exit 3 before any test; fixed. 13:19 phase A (14-load-phase-a-tree-generator.log, EXIT 0): the candidate's
  deploy/load/generate.mjs (sha256 7470ea74...) writes 25 of 30 initiative ids and 3 of 3 transformation ids that are
  not RFC 4122 UUIDs; the API answers 400 validation.invalid_format "Invalid UUID" for those 25 initiatives and all 3
  transformations (5 initiatives 200). -> F-DG6-142.
- 13:16-13:43 demo stack, locale unset (07-e2e-demo-unset.log, EXIT 1): candidate specs 11 passed, 1 failed:
  a02-guided-walkthrough ar, "locator.click: Target crashed" (renderer crash at free memory < 1 GB); my keyboard probe
  attempt 1 failed in en ("Target crashed") and ar (its own 15-min budget: it tabbed through the whole navigation on
  each of the 12 screens). The probe was then changed to enter main through the skip link and to save per-step results.
- 13:23-14:05 unit Node 22 unset attempt 1 (02-unit-node22-unset-attempt1-STOPPED-30min.log): the command was moved to
  the tool's background with a 30-min limit and STOPPED during unit-web (no exit status); unit-node had finished with 3
  load timeouts (architecture.test.ts 30 s, server.test.ts 5 s, n4-value-basis.test.ts 5 s) and 2814 passed. Re-run.
- 13:04-13:34 validators attempt 1 (09-validate-attempt1-STOPPED-at-30min-limit.log): --register DG6 EXIT 0, then
  --pipeline was STOPPED by the same 30-min limit. Re-run in background mode (09-validate.log).
- 14:06-14:21 probe 08 (zz-qa-dg6r1-aud-reflow.spec.ts) on its own production-initialized stack, locale unset:
  attempt 1 (08-probe-aud-reflow-unset-attempt1-PROBE-ERROR.log): my API assertion expected 403/404 but sloppy request
  bodies answered 400 validation first (nothing written); fixed by adding a fully valid connector body that must be 403.
  Attempt 2 (08-probe-aud-reflow-unset.log): A (AUD read-only: 19 screens per language, 0 enabled write controls; every
  P6 mutation refused, the valid connector create 403, lists unchanged), C (a real 400 validation problem shown in the
  selected language: en "This value has the wrong format.", ar "صيغة هذه القيمة غير صحيحة."), D (a succeeded run shows
  rows read 3, staged 3, rejected 3, duplicate 0 and its last success on the connector and run pages), E (clearing local,
  session, IndexedDB and cookies loses nothing: the record reads back 200 by screen and API) passed in en and ar; B
  failed because the product's CSP (style-src 'self') refused my injected <style> for the 200 % mode (correct product
  behaviour); the probe now sets the root font size through the CSSOM. B re-run (08b-probe-reflow-unset.log): ar admin
  and lead 0 problems; en admin: /admin/upload-policy scrolls horizontally at 360 px (385 > 360) and once at 200 %
  (1283 > 1280). The diagnostic (08c-diag-upload-policy-overflow.log, EXIT 0) names the element: the status chip
  "Default policy: no organization setting has been saved" does not wrap (left 29, right 385) at 360 px en; at 200 % it
  did not reproduce (1280 = 1280), so that reading is recorded as transient. en lead (08d-..., EXIT 0): 0 problems.
  -> F-DG6-143 (Low).
- 14:09-15:04 root acceptance e2e, C.UTF-8, under the A21 connection log (05c-e2e-root-cutf8-connection-log.log; the
  log 05c-connection-log.jsonl): 285 passed, 2 failed, 18 skipped, 1 did not run, Playwright EXIT 1. The 2 failures are
  30 s test-budget timeouts (a14-compare-reapply en, a16-health-launch en); the 1 "did not run" is a16's serial follower;
  the 18 skipped are a20-p6-axe's 9 NOT SCANNED routes per language. The connection-log check: 1,654 connections, every
  one to a loopback address (127.0.0.1:28014 PostgreSQL, :28015 the API, localhost:28099 a closed loopback port),
  "PASS: every outbound connection of the logged Node processes went to a loopback address". 15:05-15:06 a14 and a16 en
  re-run alone in C.UTF-8 (05d-e2e-root-cutf8-rerun-alone.log): 1 + 2 passed, EXIT 0. Every root test passed in C.UTF-8.
- 13:49-14:40 validators (09-validate.log): --register DG6, --pipeline, --historical DG5, DG4, DG3, DG2, DG1: 7 x PASS,
  each EXIT 0.
- 12:47-14:52 integration run 1, part 1 (04-integration-run1-part1-STOPPED-2h.log): STOPPED by the 2 h limit after 230
  of 410 files; 2 files with failures (route-inventory: case 3b after 10.9 s and case 4 at its 30 s budget;
  response-validation: U+0000 query and undeclared media type at their 30 s / 90 s budgets); contract.test.ts 105/105;
  response-validation printed "932 of 932 live operations (0 pending excluded)"; automation-backlog-enablement O-1:
  300 of 300 automation.evaluate jobs in 11.1 s = 27.09 jobs/s, one execution and one task per event (load ~25).
  Part 2 (04-integration-run1-part2.log) runs the 180 unfinished files plus the 2 failed ones
  (04-integration-run1-part2-files.txt).
- 14:21-14:52 unit Node 24, locale unset (02-unit-node24-unset.log, EXIT 1): unit-node 2816 passed, 1 failed
  (server.test.ts "declares access on every /api route" timed out at 5 s, plus a vitest-worker "Timeout calling
  onTaskUpdate" unhandled error, both load); unit-web 2017 passed, 1 failed (transformations.test.tsx "Arabic (RTL): ...
  after create" at 7.4 s, a waitFor under load); unit-formula-nocodegen 259 passed, 2 skipped (fuzz it.skipIf(NOCODEGEN),
  by design). The failed files are re-run alone (02-unit-rerun-alone*.log).
- 12:53-14:58 product journeys, locale unset, part 1 (06-e2e-product-unset-part1-STOPPED-2h.log): STOPPED by the 2 h
  limit at test 453 of 544; failures are 30 s budget timeouts and renderer crashes at load 20-28 (plus one
  p4-dashboards assertion, re-run). Part 2 runs every (project, spec) pair with a failure, a not-run test or no test
  started (06-e2e-product-unset-part2-pairs.txt: 27 en, 43 ar) on two fresh stacks, one invocation per spec.
- 14:52-15:36 integration run 1, part 2 (04-integration-run1-part2.log, EXIT 1): 181 of 182 files passed (1154 tests
  passed, 1 todo: audit-events.test.ts's "PENDING T-DG6-BE-B" it.todo), including route-inventory and
  response-validation that had failed under load in part 1. 1 failed: dependency-slip-relay.test.ts "A further relay
  round publishes nothing more": {published: 1} where 0 was expected. The worker started by the test runs its own relay
  loop (apps/worker/src/worker.ts), and the test's extra relayOnce counts ANY unpublished row of the database, so under
  load it can pick up a row the worker wrote after the starter ran; the asserted row itself was published once on its
  first attempt and the execution succeeded once (the assertions before line 168 passed). Re-run alone twice
  (04-integration-run1-rerun-alone.log): 1/1 and 1/1, EXIT 0. A test race under load, no product duplicate.
  Integration run 1 therefore covers all 410 files (migrations 0001-0123 applied by every scratch database; 115
  migration files, the ids renumbered at merge, D-202): every file passed in its part or alone.
- 14:59-16:03 product journeys, locale unset, part 2 (06-e2e-product-unset-part2-en.log / -ar.log, two stacks): of 70
  (project, spec) pairs, 62 passed alone; 8 failed again, every one a 30 s default-budget timeout: p3-seams test 2
  (en, ar), p4-adoption-bau test 6 (en, ar), p4-benefits test 8 (en, ar), p4-gates-closure test 6 (en),
  p4-value-headlines test 2 (en). p6-walkthrough-keyboard is skipped on the production-initialized stack by its own
  design (it needs a demo database) and passed on the demo stack (07-e2e-demo-unset.log).
- 15:05-15:37 unit Node 22, locale unset, attempt 2 (02-unit-node22-unset.log, EXIT 1): unit-node 187 files 2817/2817,
  unit-web 120 files 2018/2018, unit-formula-nocodegen 259 passed + 2 skipped (by design); EXIT 1 only because vitest
  reported one unhandled error "[vitest-worker]: Timeout calling onTaskUpdate" (the worker-to-main RPC timed out at
  load ~16). No test failed. Recorded as load; the unit series is repeated at lower load (02-unit-*-final*.log).
- 15:37-16:57 integration run 2, split into two halves run at once (04-integration-run2-a-files.txt / -b-files.txt,
  205 + 205 = all 410 files): half A (04-integration-run2-a.log) 205/205 files, 1895 passed, 1 skipped, 2 todo, EXIT 0.
  The skip is presentation.test.ts's it.runIf complement ("the live mode answers 404 while no meeting_pack assembler is
  wired" runs only when none is wired; it is wired); the 2 todo are audit-events.test.ts "PENDING T-DG6-BE-B ..." and
  rate-limits.test.ts "export ... pending" (the latter is F-DG6-141's subject). O-1 burst: 300 of 300 jobs in 7.8 s =
  38.33 jobs/s, one execution and one task per event. Half B (04-integration-run2-b.log, EXIT 1) aborted after 149
  files when its vitest fork died: "Unhandled Rejection: Error: Channel closed ... ERR_IPC_CHANNEL_CLOSED" at a moment
  free memory was ~1 GB (no test assertion failed in it besides route-inventory case 4, below). Its 56 unfinished files
  ran as 04-integration-run2-b2.log: 55 passed, 1 failed: route-inventory.test.ts case 4 "tables whose rows changed:
  ['public.session']" (and in half B the same case). Cause, read in the source: touchSession
  (apps/api/src/modules/identity/sessions.ts) slides a session's idle expiry at most once a minute; a sweep that takes
  over 60 s under load legitimately updates the caller's session row, which the test's "nothing persisted" fingerprint
  counts. Re-run alone (04-integration-run2-rerun-alone.log): 9/9, case 4 in 12.4 s, every case "changed 0 (none)",
  EXIT 0. Run 1 part 1's route-inventory failures (case 3b at 10.9 s and case 4) are of the same kind. Integration run
  2 therefore also covers all 410 files, each passed in its part or alone. Test-only defects -> F-DG6-145 (Low).
- The route-inventory sweep pins one DG2 deviation, 4:createTomGap (422 t03.dimension_required instead of the uniform
  400 for a missing required dimensionCode); its author proposed it as F-DG6-BE-C2-1 (Low) in the BE-C2 handback, but it
  was never imported into findings.json or decided. -> F-DG6-146 (Low).
- 16:58-17:20 tests/qa alone in the pristine clone (04b-tests-qa-alone.log, EXIT 0): integration 45/45 files, 437/437;
  tests/qa/unit 6/6 files, 61/61.
- 16:58-17:10 demo stack, C.UTF-8 (07-e2e-demo-cutf8.log, EXIT 2 = only my probe failed): candidate demo specs 12/12
  (a02-demo-labels, a02-demo-users-walkthrough, a02-guided-walkthrough, p6-walkthrough-keyboard; en and ar); my 1440
  probe 4/4 (REQ-S15-001 with the seeded demo data: the three regions inside the first 1440 x 900 screen at scrollY 0
  on /my-work and /executive-overview for the demo Sponsor and Lead, en and ar; Key decisions holds 7 items for the
  Sponsor, Next actions 7 for the Lead and 4 on the executive page; no region shows an empty state). My keyboard probe
  attempt 2 failed by its own conservative rules, not by a product gap: it counted the breadcrumb links ("Transformations",
  "Evidence and Reports"), which sit BEFORE the skip-link target, as unreachable because it only tabbed forward from that
  target, and on step 3 it audited the walkthrough page itself (the URL changed before the DOM). Every other control on
  the twelve step screens was reached by Tab with a visible focus ring, and no click-only element was found. Probe v3
  (Shift+Tab from the skip target; waits until the step list is gone) is re-run in 07b/07c.
- 17:19-17:28 load phase B (14-load-phase-b.log; report 14-load/report.md): the patched generator copy (sha256
  6b2a9007..., the copy every DG6 load figure used) wrote the default dataset in 30 s (50 transformations, 1,000
  initiatives, 10,000 KPI-period actuals, 100,000 audit events, 120 users; 0 non-RFC ids); 100 sessions; reindex; ONE
  repetition, 60 s warm-up + 300 s steady state, 14,803 measured requests, 0 errors, 0 conflicts, 0 error-level log
  lines. p95: ordinary read 38.9 ms, update 59.8 ms, search 36.9 ms, key dashboard 78.1 ms, export start 141.5 ms; no
  class missed its 2 s / 4 s target. PROVISIONAL: one repetition (DO-G ran three), shortened windows, a shared sandbox
  host whose 1-minute load was 4.6-6.4 during the run, PostgreSQL in the same disposable cluster; not Mobily capacity.
  The export proof right after it: part A 16/16 within 2 s; part B (50 simultaneous starts) 20 of 50 over 2 s
  (2.00-2.25 s, p95 2.24 s), 1-minute load 4.6 (mostly my own just-finished workload); LOAD-T20 also has no
  same-scope second user (the disclosed dataset gap). Log scan over the run's API and worker logs (14-load-log-scan.log):
  PASS, 734 lines (the API logged nothing at LOG_LEVEL=warn); its negative control with a planted canary: exit 1, as
  expected.
- 17:28-17:40 the export proof alone on an idle host, DO-H's method (14-load-export-proof-idle.log): fresh database,
  fresh API and worker, a 616 s wait until the 1-minute load was 0.95 (<= 1.0), export-proof.mjs unchanged (sha256
  7865d9d3...): part A 16/16 within 2 s (max 307 ms); part B 38 of 50 starts over 2 s (2.00-2.31 s; p50 2.12 s, p95
  2.31 s). Every other assertion held in both runs (14-load-export-proof-summary.txt): 66/66 202 with a job id,
  progress non-decreasing to 100, succeeded, requester download 200; the same-scope other user (65 of 66 exports) and
  the AUD user (66/66) got 404 on the job and the download. -> F-DG6-147 (Medium; ADR-0058 §1 makes a target miss a
  Medium finding).
- 15:48-17:16 product journeys, C.UTF-8 (06-e2e-product-cutf8-en.log, -ar.log; one project per run, two stacks):
  en 230 passed, 11 failed, 1 skipped, 31 did not run; ar 249 passed, 5 failed, 1 skipped, 18 did not run; both EXIT 1.
  Every failure is a test-budget timeout (30 s; p4-value-rag-lines 120 s; p5-diagnose-reflow 180 s) or one renderer
  crash (p4-benefits ar); the skip is p6-walkthrough-keyboard (needs a demo database; passed on the demo stacks).
- 17:40-18:14 the remaining pairs alone at a 1-minute load of 3-9, sequentially on fresh stacks
  (06-e2e-product-reruns-low-load.log, EXIT 0): locale unset part 3 (06-e2e-product-unset-part3-pairs.txt, 8 pairs)
  and C.UTF-8 part 2 (06-e2e-product-cutf8-part2-pairs.txt, 16 pairs): 24/24 invocations exit 0. So every product
  journey test passed in both locale settings, in a full run or alone; the five tests named in F-DG6-144 need a quiet
  host.
- 17:41-17:45 demo stack, locale unset, re-run (07b-e2e-demo-unset-rerun-and-probes.log, EXIT 2 = only the probe):
  a02-guided-walkthrough ar (crashed in 07) passed alone; 1440 probe 4/4; keyboard probe v3: every control of the 12
  step screens reached by Tab with a visible focus ring, no click-only element; the only items it could not reach are
  the first breadcrumb link of each screen and one scroll region on /prioritization. The diagnostic
  08e-diag-breadcrumb-tab-order.log (EXIT 0; 08-probe-out/breadcrumb/) shows the first breadcrumb IS a Tab stop, both
  from the top of the document and right after the skip link (en and ar): the probe's marker attribute is lost when
  the breadcrumb re-renders, so the count is a probe artifact; the scroll-region case is the same kind (tabIndex >= 0;
  the candidate's p5-table-regions-axe spec proves its regions focusable). Not a product finding.
- 17:46-18:07 unit final series (02-unit-final-node22-C.log ...): see the unit check.
- 18:15-18:19 probe 08 in C.UTF-8 (08f-probe-aud-reflow-cutf8.log, EXIT 1; 08g-...-en-lead.log, EXIT 0): A, C, D, E
  pass in en and ar exactly as in the locale-unset run; B passes in ar (admin and lead) and for the en lead (08g);
  B fails for the en admin only on /admin/upload-policy: 360 px 385 > 360 and 200 % 1283 > 1280. CORRECTION to the
  14:2x note above: the 200 % reading is not transient; it reproduced in 2 of 3 runs (the single-route diagnostic read
  1280). F-DG6-143 records both readings.
- 18:15-18:17 keyboard probe v3 on a C.UTF-8 demo stack (07c-probe-demo-keyboard-cutf8.log, EXIT 1 by the probe's
  conservative rule): the same result as locale unset: on all 12 step screens every control except the first
  breadcrumb (a Tab stop, proven by 08e) and the prioritization chart's "show as table" scroll region was reached by
  Tab with a visible focus ring; that region sits inside a collapsed <details> whose <summary> toggle WAS reached, and
  my probe does not expand disclosures. No click-only element. Not a product finding.
- 17:46-18:30 unit, final series at a 1-minute load of 3-14 (02-unit-final-node22-C.log, -node22-unset.log,
  -node24-C.log, -node24-unset.log): all four EXIT 0 with identical counts: unit-node 187 files 2817/2817, unit-web 120
  files 2018/2018, unit-formula-nocodegen 3 files 259 passed + 2 skipped (fuzz.test.ts it.skipIf(NOCODEGEN), by
  design). 18 stderr blocks per run, all from passing tests, the same as at DG5: 10 percentKpi.test.tsx and 2
  kpiUnit.test.tsx (React duplicate-key warnings from fixture data), 4 extension-fields.test.tsx and 1
  extension-hosts-twelve.test.tsx (generic mocks whose RACI/benefit payloads lack fields, so a page section throws into
  React Router's error boundary, "raci.deliverables is not iterable"; the test asserts the header strip, and the real
  pages pass on the real stack), 1 branding.test.ts (Ajv "unknown format date-time ignored"). The earlier loaded unit
  runs (02-unit-node22-unset-attempt1-STOPPED-30min.log, 02-unit-node22-unset.log, 02-unit-node24-unset.log) are
  explained above: load timeouts at 5 s / 7 s / 30 s and the vitest RPC "Timeout calling onTaskUpdate"; every test
  that failed there passed in the final series.
- 18:30 identity at the end (00-candidate-end.log): the candidate id recomputed in the repository working tree is
  unchanged (2708 files); HEAD had moved to 8e8a5f996 only through the other reviewers' auto-committed run evidence;
  0 files outside docs/delivery differ from 3cce3d445. I saw those commits' subject lines in `git log` at this point,
  after my findings sidecar was written (18:10); I opened no other reviewer's record.
- 18:31 cleanup: both disposable clones, the store copy, the load work directories, Playwright outputs and traces
  removed (disk-notes.txt).

## Load envelope
15-load-envelope.txt lists the 1-minute load range of every run (sampled every 15 s).

## Environmental residuals (not BLOCKED; per the assignment)
Live registry (REQ-DLV-042 AC-1, D-057), live CI (REQ-DLV-025 A24, D-058), Keycloak and a real enterprise IdP (D-049;
e2e/identity/keycloak-login.spec.ts not run: no container runtime; the OIDC clauses ran against the bundled test issuer
in other-realm.test.ts), external systems (connectors, outbound writes, channels and the assistant ran only through
their test adapters and the shipped disabled configuration; no network in the sandbox), production capacity (every
REQ-S20-029/030 figure here is a provisional sandbox measurement on one shared 4-vCPU host).
