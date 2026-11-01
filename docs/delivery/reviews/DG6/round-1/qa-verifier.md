# DG6 round 1: qa-verifier review (T-DG6-REV-QA-R1)

**Verdict: FAIL.** Candidate `sha256:7d6b4a9f202cfa4031c916dca22a410a6e19da5ff0c5f480a822fd0d025608cb` (2708 files).
Source `3cce3d4452fcd91e3db2888c60271e5afdc06062`, freeze `60a6b3a5c`. The identity was verified at the start and the end
of the run. Four Medium findings are open, and D-192 does not allow a Medium finding to be accepted as an observation.
There are also four Low findings. The record is `qa-verifier.json`, the findings are in `qa-verifier.findings.json`, and
the evidence is in `docs/delivery/test-evidence/DG6/qa/round-1/` (start with `RUN-NOTES.md` and
`16-requirements-matrix.md`). My probes are in `docs/delivery/test-evidence/DG6/qa/tests/round-1/`, outside the candidate.

## What ran

Everything ran in disposable clones under `$TMPDIR`, which were removed at the end.

| Area | Result |
|---|---|
| Static | build, typecheck, lint, openapi:lint, check:no-cdn, format:check: all EXIT 0. contrast: 50 pairs pass; the 3 prohibited pairs fail as documented. |
| Unit | Node 22 (v22.22.0, not 22.22.2) and Node 24, each locale-unset and C.UTF-8: 4 × EXIT 0 (2817 / 2018 / 259 + 2 skipped by design). The earlier loaded attempts are explained. |
| Integration | Twice over all 410 files. Every file passed, in its part or alone. Migrations 0001→0123 (115 files) ran. contract.test.ts passed 105/105. "932 of 932 live operations"; every p6-pending list is empty. |
| tests/qa alone | Integration 45/45 (437 tests); unit 6/6 (61 tests). |
| Root acceptance (22 specs) | en and ar, locale-unset and C.UTF-8. Every test passed in the full run or alone. axe: 0 serious or critical. The 9 skips per language are a20-p6-axe's NOT SCANNED routes. |
| Product journeys (544 tests) | en and ar in both settings. Every test passed in a run or alone. Five tests pass only on a quiet host (F-DG6-144). |
| Demo stack | a02 × 3 and p6-walkthrough-keyboard, en and ar, both settings: all pass (one renderer crash passed alone). |
| Validators | --register DG6, --pipeline, --historical DG5…DG1: 7 × PASS. |
| Reliability | All four A13 kill-and-restart drills pass in both integration runs. Worker burst: 300 jobs at 27.1 and 38.3 jobs/s, one execution and one task per event. |
| Load (provisional) | One repetition with 100 users: every class is within target (p95 read 38.9 ms, update 59.8 ms, dashboard 78.1 ms). The export proof's 2 s start misses (F-DG6-147). |

### How the shared host affected the runs

Three reviews shared 4 cores and 16 GB, and the 1-minute load reached 33.

- Chromium renderer processes crashed.
- Tests ran past their budgets.
- The tool stopped long background runs at 2 h.

Each affected run is labelled in the evidence (`…STOPPED…`, `…attempt1…`). Its failures were re-run alone, and every one is explained in `RUN-NOTES.md`. A timeout was never counted as a pass.

## Beyond the suites (my probes)

These probes closed clauses that the register notes disclosed as only partly covered:

- **REQ-S15-007**: a real 400 field-validation error is shown in Arabic. Arabic pdf, xlsx, csv, docx and pptx exports keep `KPI-001` and `12.5%` readable.
- **REQ-S15-012**: all twelve walkthrough step screens are operable by Tab, with a visible focus ring and no click-only control. A diagnostic shows that the breadcrumb "miss" was an artefact of my probe.
- **REQ-S17-001**: a succeeded run's row counts and last success are shown on screen.
- **REQ-S02-006**: clearing local storage, session storage, IndexedDB and cookies loses no submitted data.
- **REQ-S15-001**: the 1440 px layout holds with populated demo data.
- **AUD read-only pass**: no enabled write control on 19 P6 screens, and every P6 mutation is refused.
- **Reflow**: the P6 screens were checked at 360 px, 390 px and 200 % text.

## Findings

| Id | Severity | Requirement | In one line |
|---|---|---|---|
| F-DG6-140 | Medium | REQ-S12-019 | The freshness scan reads only the newest period, so once a later period is open, stale data never raises a `data_stale` exception. ADR-0053 records this as open and undecided. |
| F-DG6-141 | Medium | REQ-S16-030 | The ADR-0052 §4 export rate-limit class and the import upload's membership in the upload class are not wired. `EXPORT_RATE_LIMIT_PER_MINUTE` is documented but has no effect. |
| F-DG6-142 | Medium | REQ-S20-029 | `deploy/load/generate.mjs` writes non-RFC UUIDs, which the API refuses. The documented dataset cannot reproduce the load report without DO-F's out-of-tree patch. |
| F-DG6-147 | Medium | REQ-S20-030 | With 50 simultaneous export starts, 38 of 50 take longer than 2 s, even on a host that meets DO-H's idle criterion. This contradicts the basis of D-202. The other clauses hold. |
| F-DG6-143 | Low | REQ-S15-009 | Upload policy scrolls horizontally at 360 px in English, because a status chip doesn't wrap. |
| F-DG6-144 | Low | REQ-DLV-038 | The DG5 30 s budget sweep was carried forward but not done. Five journeys fail alone under load. |
| F-DG6-145 | Low | REQ-DLV-038 | Two integration tests (`route-inventory` and `dependency-slip-relay`) assert global database state that load legitimately changes. |
| F-DG6-146 | Low | REQ-S16-027 | `createTomGap` answers 422 instead of the uniform 400. BE-C2 proposed this as a finding, but it was never imported. |

None of these is an authorization hole, a wrong financial result or a business approval that can be fabricated. They are not mandatory violations.

## Independence

I authored no product code in this scope. The candidate's `tests/qa/**` and `e2e/**` suites were written by earlier qa-verifier authoring tasks, and I judged them as a reviewer. I read no other reviewer's round-1 record. At the end-of-run identity check, `git log` showed the subject lines of their auto-committed evidence; that was after my findings were written, and I opened none of their records.

Engineering gates DG0–DG7 are separate from the product's business approvals G1–G6. Nothing in this review grants, or implies, any business approval.
