# DG1 round 2: qa-verifier narrative

**Verdict: FAIL.** Candidate `sha256:991d32417f16984e47da7bb0767bd2e432e2d88b9fb066513dd7fa1761fea8fc` (source `f32c705`). Run `DG1-T-DG1-REV-QA-R2-qa-verifier-20261001T080945Z-b6fb3406`.

I recomputed the candidate ID, and it matches the manifest (388 files, `--diff` clean). HEAD (`18c1e61`) is the freeze commit on top of `f32c705` and adds only excluded metadata. I ran everything in a disposable clone at `f32c705` and deleted the clone afterwards. Evidence is indexed in `docs/delivery/test-evidence/DG1/qa/round-2/README.md`.

## Green on this candidate
- **Install and static checks.** A frozen offline install is a no-op (371 reused, 0 downloaded). Typecheck, build and lint pass. `openapi:lint` reports 33 operations, and the no-CDN and contrast checks pass.
- **Unit:** 210/210, including the workflows, kpi and reporting scaffolds, auditChanges and transitions.
- **Integration:** 193/193 on two fresh PostgreSQL 16 clusters, with no unhandled errors. Contract coverage is 9/9 tests with all 33 operations, including `getBrandingTokens` (401/200).
- **Schema probe:** 8 migrations. The 0007 and 0008 structures and rule are present, and the audit trigger and privileges reject UPDATE/DELETE.
- **Acceptance suites:**
  - A12, A13 and A14 pass.
  - A18 clean start passes with a real install.
  - A20 shell and tokens pass in EN and AR, and token propagation to #6B1D5C passes.
- **Validators:** `--register`, `--pipeline` and `--reconcile` pass.

## Findings verified
| Finding | Result |
|---|---|
| F-DG1-201 (High) | PASS → CLOSED_VERIFIED |
| F-DG1-101 (High) | PASS → CLOSED_VERIFIED. The stale-register residual is split out as F-DG1-209. |
| F-DG1-110 (Low) | PASS → CLOSED_VERIFIED: scope-local assertion, pg-boss stopped before the DB drop, 2/2 clean runs |
| F-DG1-004 (Low) | PASS → CLOSED_VERIFIED: a BU-scoped lead reaches its new record in EN and AR; dev.nobody gets 404 |
| F-DG1-005 (Low) | **FAIL → OPEN**. Transformation fields are localized now, but the derived `scoped_assignment.create` event added by F-DG1-106 shows a raw action code, raw keys and raw JSON/UUIDs in AR and EN. |
| F-DG1-001 web consistency | The edit form offers only `{draft, active}` and `{active, on_hold}`, and PATCH `closed` returns 422 with the record unchanged. F-DG1-001 belongs to the domain reviewer, so I recorded this as a check, not a verification. |

## New findings
- **F-DG1-208 (High, mandatory; owner frontend-ux-engineer).** `e2e/support/qa-stack.sh npx playwright test e2e --workers=1` exits 1, and the failure is deterministic. At `apps/web/e2e/journeys.spec.ts:138`, the unanchored `/عملي/` also matches the new Arabic BAU label `العمليات الاعتيادية والتحسين`, which came in with the glossary repair `a5ff652`. Six AR journeys never run. In a diagnostic copy, anchoring the regex gives 20/20, so the product is fine but the required suite is red. The FE handback says the real-stack journeys were not run.
- **F-DG1-209 (Low; owner transformation-analyst).** REQ-S19-004 and REQ-DLV-033 still cite the pre-repair 181-test integration log, and the REQ-S19-004 note still says "0001-0006".

## Blocked or not covered
- `deps:verify` is BLOCKED because there is no registry access. It is not an assigned check.
- The live CI run (A24 for REQ-DLV-025) is not observable here.
- The "creator cannot see the record" explanation screen is covered only by unit tests.

## New test assets (outside the candidate, for promotion)
- `docs/delivery/test-evidence/DG1/qa/tests/dg1-r2-web-repairs.spec.ts`
- `docs/delivery/test-evidence/DG1/qa/tests/dg1-r2-schema-probe.sh`
