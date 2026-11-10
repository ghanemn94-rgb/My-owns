# Assignment T-DG6-AN-P6B: DG6 register update, half B: 23 DG6-final requirements IMPLEMENTED with evidence (transformation-analyst)

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory, on branch `dg6/an-p6b`, at the integrated `HEAD`. Every P6 implementation, repair and acceptance-suite task except QA-E is merged there (D-193 to D-202); the evidence is in the QA handbacks under `docs/delivery/test-evidence/DG6/qa/` and the implementer handbacks under `docs/delivery/handbacks/DG6/`.
- **Concurrency (D-004):** T-DG6-AN-P6A updates the other DG6 rows in its own worktree. T-DG6-QA-E runs the final acceptance re-runs (the REQ-DLV-038 evidence run) at the same time; `REQ-DLV-038` is updated by a short follow-up analyst task after QA-E merges, so neither half touches it.
- **Your write scope:** your rows of `docs/delivery/requirements.csv`, `docs/analysis/**` and your handback. Nothing else.
- **Do not touch:**
  - application code (`apps/**`, `packages/**`, `tests/**`, `e2e/**`);
  - `docs/api/**`, `docs/architecture/**`, migrations;
  - reviews, runs, gate records, `stages.json`, `findings.json`;
  - `tools/**`, `docs/source/**`;
  - the other half's rows.
- **Why now:** in DG2, this update was missed until review round 1 raised F-DG2-202 (High). Since DG3 it lands before the candidate freezes (D-079 §4).
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG5` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current row, and list the rows you did not reach in the handback.

## Task

For **each of your 36 rows** (listed below), all with `final_gate` = DG6:

- set `status = IMPLEMENTED`;
- fill `evidence` with accurate, specific, `;`-separated repository paths, **every one of which exists in your tree**;
- append one sentence to `notes`: "DG6 analyst check (T-DG6-AN-P6B, base <sha>): …". Keep the existing notes.

Draw the evidence from the real P6 deliverables:

- **Implementing code:** the requirement → owner tables of `docs/architecture/p6-work-split.md` (the requirement → owner table of each slice) name the owner task and where each row is proven. The repair waves moved some of it (BE-X1 to BE-X3B, FE-X1B, QA-A2); follow the handbacks in `docs/delivery/handbacks/DG6/`.
- **Verifying tests:**
  - the API, worker and package integration tests named there;
  - the unit tests;
  - the web tests of each page;
  - the e2e specs `apps/web/e2e/p6-*.spec.ts` and the other web journeys;
  - **the acceptance suites:** `tests/qa/integration/**` (the P6 suites a12-p6, a13/a14-p6, a17, a20/a21-p6, a22) and the root `e2e/a0*-*.spec.ts`, `e2e/a1*-*.spec.ts`, `e2e/a2*-*.spec.ts`. Their requirement → test tables are in `docs/delivery/test-evidence/DG6/qa/T-DG6-QA-*-authoring/handback.md` (and the DG4/DG5 ones for older suites).
- **Design records:** ADR-0051 to ADR-0061 with their dated amendments, `docs/api/openapi.yaml`, `docs/architecture/erd.md`.
- **The orchestrator's verifications:** the QA handbacks under `docs/delivery/test-evidence/DG6/qa/` and the implementer handbacks under `docs/delivery/handbacks/DG6/` (the merged-tree runs) and the decisions D-193 to D-202 in `docs/delivery/decisions.md`.

**Before you cite a test as evidence for a requirement, open it and check that it asserts that requirement's acceptance clause.** The acceptance clauses are binding, and reviewers test them literally.
- Where a handback or acceptance suite says a clause is only partly covered, say so in `notes`. Examples from the QA handbacks: REQ-S06-003 (each seeded procedure launched and completed is A02's), REQ-S01-002 (the report-header clause), REQ-S13-008 (the executive pack holding a pending value), REQ-S09-011 (metric values compared with the dashboard).
- A clause a later gate completes (the row's `increments`) is not a gap for DG6 if the row's DG6 acceptance is met; say which part is left and to which gate.
- If the integration tests do cover the clause, the row may still be IMPLEMENTED.

Keep `req_id`, `class`, `title`, `source_ref`, `acceptance`, `increments` and `final_gate` unchanged.

If a row's behaviour cannot be pointed to, **leave it SPECIFIED and flag it in the handback as a real gap.** A real gap is a finding the orchestrator must repair, not something the register should paper over.

**Your 23 rows:** REQ-S16-029, REQ-S16-030, REQ-S16-032, REQ-S17-001, REQ-S17-002, REQ-S17-003, REQ-S17-005, REQ-S17-006, REQ-S17-007, REQ-S17-008, REQ-S17-009, REQ-S17-010, REQ-S17-011, REQ-S20-001, REQ-S20-012, REQ-S20-013, REQ-S20-014, REQ-S20-017, REQ-S20-020, REQ-S20-021, REQ-S20-022, REQ-S20-029, REQ-S20-030.

**Later-gate rows with a P6 increment** (`increments` contains P6 and `final_gate` is DG7): do not change their status. Half A only: you may add a short "P6 increment delivered: …" pointer to `notes`, but only where a P6 handback or QA handback names that increment. Half B does not touch them.

## Self-verification (real output in the handback)

- `node tools/gates/validate.mjs --register DG6`: show its output. It can PASS only once both halves and the held rows are done. Confirm that every failure it lists is a row of the other half or REQ-DLV-038, never one of yours.
- `node tools/gates/validate.mjs --register DG4`, `--register DG3` and `--register DG2` → still PASS.
- **CSV integrity:** the CSV still parses, with the same column count on every row and valid quoting. Check it with a small script and show its output.
- **Your rows only:** a script must show that only your rows (and, for half A, the later-gate notes) differ from the base.
- **Every evidence path exists:** a script must check every path in your rows' `evidence` and show the output.
- **`git diff --stat`** shows only `requirements.csv`, plus your handback and any `docs/analysis/**` note.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-AN-P6B-transformation-analyst.md`. Include:
- the rows changed;
- per row, the acceptance clause and the test that asserts it;
- the validator output;
- every row you could NOT evidence, flagged as a real gap.

Leave your changes **uncommitted** for the orchestrator to integrate.
