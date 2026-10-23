# qa-verifier DG5 clean re-gate round 1: run notes (T-DG5-RG-QA-R1; assignment task id T-DG5-REV-QA-R5)

Candidate `sha256:8df7f922775ffe8134d0f1c9848d94aa7d16a315997211bcb162ad727d88b74c` (2194 files), source `270ebbf`, freeze `53bd2d1`.
Every command ran in a disposable clone `$TMPDIR/review-dg5` (see env.txt for why it is a `--shared` sparse clone); it, the store copy and all scratch are removed.

## Order of work (UTC)
1. 05:19 full clone: ENOSPC (4.0 GB free on the shared scratch volume). Log kept as 00-candidate-attempt1-ENOSPC-INVALID.log: after the failed clone its later lines ran against the working tree (the cd failed), so they are invalid; nothing was written.
2. 05:25 shared sparse clone; identity at 53bd2d1, --ref 270ebbf and the working tree: same id, 2194 files, every manifest hash equal (00-candidate-start.log). 05:26 offline install; 05:28 build; 05:31-05:33 the other 6 static checks: all EXIT 0.
3. 05:33-06:41 unit series r1 (4 runs) at load 8.5-21.8 (the three reviews in parallel): OUTSIDE the envelope, not the gate check. All tests passed in all 4 runs; node22-C exited 1 on a Vitest worker RPC timeout ("Timeout calling onTaskUpdate", 1 unhandled error, 144/144 files passed).
4. 05:33-05:52 validators in the working tree: 6/6 PASS. Clone-side runs fail only on the paths the sparse checkout omits (08-validate-clone-classified.log: 12,689 error lines, every one naming docs/delivery/{runs,test-evidence,handbacks}/).
5. 05:53-07:00 integration run1, 07:00-08:00 run2: 319 files, 3076 + 1 skipped (by design) each, EXIT 0.
6. 06:26-07:58 product e2e (locale unset): 459 passed, 1 failed (p4-dashboards :295 chromium-ar timeout, F-DG5-141). Re-run of that spec alone x3: 42/42.
7. 07:05 root acceptance specs unset 30/30; demo specs unset 12/12. Probes (unset): demo 4/4; PB-093 (attempt 1 probe error, fixed: 2/2); AUD sweep (3 hits: 2 false positives of my rule + the Launch form, F-DG5-140); AUD launch 2/2.
8. 07:25 tests/qa alone (verbose, QA_A15_DUMP): 31 files, 336/336; 64 export files dumped. Exec-pack probe (attempt 1 probe error in Arabic matching, fixed: 3/3); 18 demo samples.
9. 08:00-08:26 unit series r2, nothing else of mine running: INSIDE the envelope (86 samples, max 6.59): 4/4 EXIT 0. This is the gate check.
10. 08:27-10:00 C.UTF-8: root 29/30 (A22 race, F-DG5-142; alone 6/6), demo 12/12, probes all as expected (refined AUD sweep: only the Launch hit), product e2e 459 passed, 1 failed (the same p4-dashboards timeout, F-DG5-141).
11. 09:55 end-of-review identity: unchanged; clone removed.

## Disclosed non-zero exits, invalid attempts, warnings
- 00-candidate-attempt1-ENOSPC-INVALID.log: see 1.
- 02-unit-node22-C-r1.log EXIT 1: Vitest RPC timeout at load ~19-21 (series r1 outside the envelope); all tests passed. Series r2 inside the envelope: 0 unhandled errors.
- Every unit log carries the 18 stderr blocks D-169 disclosed (10 percentKpi.test.tsx, 2 kpiUnit.test.tsx, 4 extension-fields.test.tsx: its T12 header test renders /raci against a mock without deliverables, hence 'raci.deliverables is not iterable' in the error boundary; 1 extension-hosts-twelve.test.tsx key warning; 1 branding.test.ts). All from passing tests.
- unit-formula-nocodegen: 2 skipped by design (it.skipIf(NOCODEGEN) ESLint assertions in fuzz.test.ts; they run in unit-node).
- integration: 1 skipped by design (presentation.test.ts it.runIf(!hasMeetingPackAssembler); the assembler is wired, its runIf(has...) counterpart passes). 'BE17 db-econnreset ... ECONNRESET' is request-io.test.ts's own log of a deliberate connection reset through a proxy.
- 05-e2e-probe-pb093-{en,ar}-unset-attempt1-PROBE-ERROR.log: the clause under test passed (95 % refused at publish, version stays a draft); my cleanup poll expected status != draft, but a discarded draft keeps status draft with draftStage discarded. Fixed; re-runs pass.
- 04-integration-probe-execpack-attempt1-PROBE-ERROR.log: P1 passed; P2 flagged 8 Arabic files because my plain substring test cannot read Arabic PDF runs or a DOCX statement split across runs; with the QA support matcher `contains` 18/18 pass.
- 05-e2e-probe-aud-unset.log EXIT 1 by design of the rule: 3 hits: "Search" (submit of a role=search form) and "Bulk edit not sorted" (a column sort header) are false positives of my rule, refined for the C.UTF-8 run; the third, the auditor's enabled Launch form, is real (F-DG5-140). 05-e2e-probe-aud-cutf8.log EXIT 1: exactly that one hit per language; 64/64 screen results with 0 overflow, 0 serious/critical axe, 0 mutations in each setting.
- 05-e2e-product-{unset,cutf8}.log EXIT 1: the p4-dashboards :295 chromium-ar timeouts (30.1 s, 30.5 s), F-DG5-141; no assertion failed (05-e2e-product-cutf8-p4dash-trace-timing.txt).
- 05-e2e-root-cutf8.log EXIT 1: A22 chromium-en, F-DG5-142 (two reads across the 08:30Z boundary of a */15 job).
- LibreOffice rendering of the samples: BLOCKED by the sandbox (07-render-samples-BLOCKED.log); the samples were inspected at the content level instead (07-inspect-samples.txt, decoder limits stated in scripts/inspect-samples.py).
- A first attempt to start the C.UTF-8 product run as a detached subshell never ran (no log); it was started properly at 08:37.
