# Assignment T-DG5-AN-P5A: DG5 register update, half A: 36 DG5-final requirements IMPLEMENTED with evidence (transformation-analyst)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory, on branch `dg5/an-p5a`, at the integrated `HEAD`. Every P5 implementation, repair and acceptance-suite task through W21 is merged there (D-143 to D-167), all 846 contract operations are routed, and the orchestrator's merged-tree verifications are under `docs/delivery/test-evidence/DG5/orchestrator-D-*/`.
- **Concurrency (D-004):** T-DG5-AN-P5B updates the other 36 DG5 rows in its own worktree. T-DG5-BE-T5, T-DG5-FE-D5 and T-DG5-ARCH-R2 make the last follow-up repairs (D-167) in `apps/**`, `packages/**` and `docs/architecture/**`. You never touch their rows or files. The orchestrator merges the two register halves row by row.
- **Held rows (D-167):** `REQ-PB-089`, `REQ-S06-003`, `REQ-S12-012`, `REQ-S18-001`, `REQ-S18-002`, `REQ-S21-001` are repaired in this wave. They are updated by a short follow-up analyst task after the repairs merge, so neither half touches them.
- **Your write scope:** your rows of `docs/delivery/requirements.csv`, `docs/analysis/**` and your handback. Nothing else.
- **Do not touch:**
  - application code (`apps/**`, `packages/**`, `tests/**`, `e2e/**`);
  - `docs/api/**`, `docs/architecture/**`, migrations;
  - reviews, runs, gate records, `stages.json`, `findings.json`;
  - `tools/**`, `docs/source/**`;
  - the other half's rows.
- **Why now:** in DG2, this update was missed until review round 1 raised F-DG2-202 (High). Since DG3 it lands before the candidate freezes (D-079 §4).
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current row, and list the rows you did not reach in the handback.

## Task

For **each of your 36 rows** (listed below), all with `final_gate` = DG5:

- set `status = IMPLEMENTED`;
- fill `evidence` with accurate, specific, `;`-separated repository paths, **every one of which exists in your tree**;
- append one sentence to `notes`: "DG5 analyst check (T-DG5-AN-P5A, base <sha>): …". Keep the existing notes.

Draw the evidence from the real P5 deliverables:

- **Implementing code:** the requirement → owner tables of `docs/architecture/p5-work-split.md` (§A.9, B.7, C.5, E.7, F.10, G.6, H.7, I.6, J.7) name the owner task and where each row is proven. The repair waves moved some of it (D-155 to D-167); follow the handbacks in `docs/delivery/handbacks/DG5/`.
- **Verifying tests:**
  - the API, worker and package integration tests named there;
  - the unit tests;
  - the web tests of each page;
  - the e2e specs `apps/web/e2e/p5-*.spec.ts` (and `journeys.spec.ts` for REQ-S03-007);
  - **the acceptance suites:** `tests/qa/integration/a02-*`, `a06-*`, `a07-*`, `a13-*`, `a15-*`, `a16-*`, `a21-*`, `a22-*` and the root `e2e/a0*-*.spec.ts`, `e2e/a1*-*.spec.ts`, `e2e/a2*-*.spec.ts`. Their requirement → test tables are in `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-*-authoring/handback.md`.
- **Design records:** ADR-0039 to ADR-0050 with their dated amendments, `docs/api/openapi.yaml`, `docs/architecture/erd.md`.
- **The orchestrator's verifications:** `docs/delivery/test-evidence/DG5/orchestrator-D-*/` (the merged-tree runs) and the decisions D-141 to D-167 in `docs/delivery/decisions.md`.

**Before you cite a test as evidence for a requirement, open it and check that it asserts that requirement's acceptance clause.** The acceptance clauses are binding, and reviewers test them literally.
- Where a handback or acceptance suite says a clause is only partly covered, say so in `notes`. Examples from the QA handbacks: REQ-S06-003 (each seeded procedure launched and completed is A02's), REQ-S01-002 (the report-header clause), REQ-S13-008 (the executive pack holding a pending value), REQ-S09-011 (metric values compared with the dashboard).
- A clause a later gate completes (the row's `increments`) is not a gap for DG5 if the row's DG5 acceptance is met; say which part is left and to which gate.
- If the integration tests do cover the clause, the row may still be IMPLEMENTED.

Keep `req_id`, `class`, `title`, `source_ref`, `acceptance`, `increments` and `final_gate` unchanged.

If a row's behaviour cannot be pointed to, **leave it SPECIFIED and flag it in the handback as a real gap.** A real gap is a finding the orchestrator must repair, not something the register should paper over.

**Your 36 rows:**
- REQ-PB-001, REQ-PB-002, REQ-PB-011, REQ-PB-077, REQ-PB-086, REQ-PB-087;
- REQ-PB-088, REQ-PB-090, REQ-PB-091, REQ-PB-092, REQ-PB-093, REQ-DLV-037;
- REQ-S01-002, REQ-S01-003, REQ-S01-004, REQ-S02-001, REQ-S02-004, REQ-S03-007;
- REQ-S03-010, REQ-S04-011, REQ-S05-001, REQ-S05-002, REQ-S05-006, REQ-S06-001;
- REQ-S06-002, REQ-S06-004, REQ-S06-005, REQ-S06-006, REQ-S06-007, REQ-S06-008;
- REQ-S06-009, REQ-S06-010, REQ-S07-016, REQ-S08-005, REQ-S08-019, REQ-S09-011.

**Later-gate rows with a P5 increment** (`increments` contains P5 and `final_gate` is DG6 or DG7): do not change their status. Half A only: you may add a short "P5 increment delivered: …" pointer to `notes`, but only where a P5 handback or QA handback names that increment. Half B does not touch them.

## Self-verification (real output in the handback)

- `node tools/gates/validate.mjs --register DG5`: show its output. It can PASS only once both halves and the held rows are done. Confirm that every failure it lists is a row of the other half or a held row, never one of yours.
- `node tools/gates/validate.mjs --register DG4`, `--register DG3` and `--register DG2` → still PASS.
- **CSV integrity:** the CSV still parses, with the same column count on every row and valid quoting. Check it with a small script and show its output.
- **Your rows only:** a script must show that only your rows (and, for half A, the later-gate notes) differ from the base.
- **Every evidence path exists:** a script must check every path in your rows' `evidence` and show the output.
- **`git diff --stat`** shows only `requirements.csv`, plus your handback and any `docs/analysis/**` note.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-AN-P5A-transformation-analyst.md`. Include:
- the rows changed;
- per row, the acceptance clause and the test that asserts it;
- the validator output;
- every row you could NOT evidence, flagged as a real gap.

Leave your changes **uncommitted** for the orchestrator to integrate.
