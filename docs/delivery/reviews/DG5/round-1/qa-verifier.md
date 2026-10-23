# DG5 clean re-gate, round 1: qa-verifier narrative

**Verdict: PASS.** Three new findings, all Low and non-mandatory; none blocks the gate.

**Candidate.** `sha256:8df7f922775ffe8134d0f1c9848d94aa7d16a315997211bcb162ad727d88b74c`
- 2194 files; source `270ebbf7477664cb17202ee2c32ac49c6f36c5ce`; freeze `53bd2d1`.
- Verified at the start and at the end of the review, on a complete (non-shallow) clone and on the working tree.

**Run.** `DG5-T-DG5-RG-QA-R1-qa-verifier-20261023T051206Z-29a41226`. The assignment file names the task `T-DG5-REV-QA-R5`, and the invocation reference names it `T-DG5-RG-QA-R1`. I used the invocation reference verbatim.

All commands, outputs and disclosures are in `docs/delivery/test-evidence/DG5/qa/round-1/` (start with `RUN-NOTES.md` and `env.txt`). The probes are in `docs/delivery/test-evidence/DG5/qa/tests/round-1/`.

## What ran

| Check | Result |
|---|---|
| Static checks: build, typecheck, lint, openapi:lint (846 ops), no-cdn, format, contrast | 7/7 exit 0 |
| Unit tests: Node 22 and 24, locale unset and C.UTF-8 | Series r2 inside the D-134 envelope (max load 6.59): 4/4 exit 0, 2341 / 1722 / 259 + 2 by-design skips. Series r1 at load 16–21 is disclosed; it had one Vitest RPC-timeout exit, and all tests passed. |
| Integration x2 (disposable PostgreSQL) | 319 files; 3076 passed + 1 by-design skip in each run; migrations 0001–0097; contract test passes; p5-pending lists empty |
| `tests/qa` alone | 31 files, 336/336 |
| REQ-DLV-037 suites on this candidate | A06 27, A07 12, A15 34, A16 30, in all three runs |
| Product e2e (en and ar, both locale settings) | 459/460 in each setting. The one failure is the p4-dashboards test 6 timeout (F-DG5-141); no assertion failed, and the spec passes 42/42 alone. |
| AUD read-only and 390 px / 200 % text | Product: 48 AUD tests and `p5-reflow-axe` pass. My probe over 32 P5 screens: 0 mutations, 0 overflow, 0 serious or critical axe issues. |
| Root acceptance specs | 30/30 (locale unset). 29/30 (C.UTF-8): an A22 test race (F-DG5-142); A22 passes 6/6 alone. |
| Demo-stack specs (`a02-*`, `a21`) | 12/12 in both settings |
| Validators (working tree) | register, pipeline, and historical DG4, DG3, DG2 and DG1: all PASS |

## Independent probes of the disclosed partial clauses

- **REQ-PB-093, through the Studio UI**, in en and ar and in both locale settings:
  - Publishing 95 % is refused in the UI, and the version stays a draft.
  - 30/20/20/15/15 plus a new Feasibility rubric, published in the UI, reaches only a transformation created afterwards.
  - The existing transformation keeps v1 (25/25/20/15/15) and its rubric.
- **REQ-PB-090, on the rendered traceability screen.** All three B0147 chains are shown label by label, in chain order.
  - Observation: the screen also shows the deliverable and capability columns between initiative and KPI.
  - Observation: record codes prefix the names, including the English key `customer_value_proposition`, which also appears in the Arabic UI.
- **REQ-S21-001, on an approval opened from the inbox.** The pending approval opens from the BO's My Work and shows the synthetic approval label in both languages.
- **REQ-S13-008, on the executive-pack PDF.** A pending (submitted) benefit value is labelled Provisional / مؤقت in en and ar.
- **REQ-DLV-037, export samples.**
  - 18 demo samples (executive pack, gate pack and benefits register, every offered format, en and ar) and the 64 files of the A15 matrix.
  - Each carries the demo label and the B0004 provenance in its language, and declares the right direction.
  - My own inspector confirms RTL markup and Arabic fonts in the Arabic files, and readable identifiers and amounts.
  - **Raster rendering was BLOCKED by the sandbox:** LibreOffice needs a writable `/tmp`, and no other renderer exists. The inspection is therefore at content level, not visual.

## Findings (Low, non-mandatory, not blocking)

| ID | Requirement | Owner | Summary |
|---|---|---|---|
| F-DG5-140 | REQ-S06-002 | frontend-ux-engineer | My procedures offers the read-only auditor an enabled "Launch a procedure" form. The server correctly refuses with 403 and nothing is created, but the action is offered where every other screen offers AUD none. |
| F-DG5-141 | REQ-S15-009 | frontend-ux-engineer | `p4-dashboards.spec.ts:295` runs on the default 30 s budget. In the full suite, in chromium-ar, it timed out in both of my full runs (30.1 s and 30.5 s). The trace shows 18 s spent in full-page screenshots and no slow request. |
| F-DG5-142 | REQ-S12-022 | backend-workflow-engineer (the job-operations module owner; the file is a qa acceptance spec) | `e2e/a22-operations-jobs.spec.ts` compares an API read of `nextRunAt` with a later screen read. It fails whenever a `*/15` schedule boundary falls between the two reads. The product is correct. |

## Disclosed and explained

Every non-zero exit and probe error is listed in `RUN-NOTES.md`:
- the failed first clone (ENOSPC);
- the unit r1 RPC timeout;
- two attempt-1 probe errors of my own;
- the false positives of my AUD rule;
- the clone-side validator failures caused by the sparse checkout (every error line classified);
- the 18 known stderr blocks;
- the by-design skips.

Disk on the shared 4 GB scratch volume was guarded by deleting stale Playwright raw trace recordings (`06-prune-traces.log`).

## Boundaries

No product file was changed. Probes ran only in a disposable clone, which has been removed.

Product gates G1–G6 are business approvals inside the product. Nothing here approves anything real, and product gate G6 never implies DG7. All data is synthetic.
