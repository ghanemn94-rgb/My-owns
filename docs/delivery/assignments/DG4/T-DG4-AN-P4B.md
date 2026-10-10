# Assignment T-DG4-AN-P4B: DG4 register update, half B: 66 DG4-final requirements IMPLEMENTED with evidence (transformation-analyst)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory, on branch `dg4/an-p4b`, at the integrated `HEAD`. Every P4 implementation and acceptance-suite task is merged and verified there (D-088 to D-115). All 652 contract operations are routed, and every `p4-pending-*.ts` list is empty.
- **Concurrency (D-004):** T-DG4-AN-P4A updates the other 71 DG4 rows in its own worktree, and T-DG4-FE-R3 works on `apps/web/**`. You never touch their rows or files. The orchestrator merges the two register halves row by row.
- **Your write scope:** your rows of `docs/delivery/requirements.csv`, `docs/analysis/**` and your handback. Nothing else.
- **Do not touch:**
  - application code (`apps/**`, `packages/**`, `tests/**`, `e2e/**`);
  - `docs/api/**`, `docs/architecture/**`, migrations;
  - reviews, runs, gate records, `stages.json`, `findings.json`;
  - `tools/**`, `docs/source/**`;
  - the other half's rows.
- **Why now:** in DG2, this update was missed until review round 1 raised F-DG2-202 (High). In DG3 and DG4 it lands before the candidate freezes (D-079 §4).
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current row, and list the rows you did not reach in the handback.

## Task

For **each of your 66 rows** (listed below), all with `final_gate` = DG4:

- set `status = IMPLEMENTED`;
- fill `evidence` with accurate, specific, `;`-separated repository paths, **every one of which exists in your tree**;
- append one sentence to `notes`: "DG4 analyst check (T-DG4-AN-P4B, base <sha>): …". Keep the existing notes.

Draw the evidence from the real P4 deliverables:

- **Implementing code:** the requirement → owner tables of `docs/architecture/p4-work-split.md` (§I+C.7, A.7, B.7, E.7, D.7, FG.10, H.8, JK.9) name the owner task and where each row is proven. The repair rounds (D-109 to D-115) moved some of it; follow the handbacks.
- **Verifying tests:**
  - the API and worker integration tests named there;
  - the unit tests;
  - the web tests of each page;
  - the e2e specs `apps/web/e2e/p4-*.spec.ts`;
  - **the acceptance suites:** `tests/qa/integration/a03-*.test.ts`, `a04-*`, `a05-*`, `a08-*`, `a09-*`, `a10-*` and `a11-*`, `tests/qa/unit/a05-*`, `e2e/a0*-*.spec.ts`.
  - The acceptance suites' requirement → test tables are in `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-{A,B,C}-authoring/HANDBACK-*.md`.
- **Design records:** ADR-0025 to ADR-0038 with their dated amendments, `docs/api/openapi.yaml`, `docs/architecture/erd.md`.
- **The handbacks:** `docs/delivery/handbacks/DG4/*.md`, for the checks they ran and the gaps they disclosed.

**Before you cite a test as evidence for a requirement, open it and check that it asserts that requirement's acceptance clause.** The acceptance clauses are binding, and reviewers test them literally.
- Where a handback or acceptance suite says a clause is only partly covered, say so in `notes`. Examples: REQ-PB-066 and REQ-S15-008 (the server clock cannot be set); REQ-S04-014, REQ-S07-015 and REQ-PB-065 (proven by stubs and integration tests only).
- If the integration tests do cover the clause, the row may still be IMPLEMENTED.

Keep `req_id`, `class`, `title`, `source_ref`, `acceptance`, `increments` and `final_gate` unchanged.

If a row's behaviour cannot be pointed to, **leave it SPECIFIED and flag it in the handback as a real gap.** A real gap is a finding the orchestrator must repair, not something the register should paper over.

**Your 66 rows:**
- REQ-S08-001, REQ-S08-002, REQ-S08-003, REQ-S08-004, REQ-S08-006, REQ-S08-008;
- REQ-S08-009, REQ-S08-010, REQ-S08-011, REQ-S08-013, REQ-S08-014, REQ-S08-015;
- REQ-S08-016, REQ-S08-017, REQ-S08-018, REQ-S09-007, REQ-S09-009, REQ-S09-010;
- REQ-S10-003, REQ-S10-005, REQ-S10-006, REQ-S10-007, REQ-S10-008, REQ-S10-009;
- REQ-S10-010, REQ-S10-011, REQ-S10-012, REQ-S10-014, REQ-S10-016, REQ-S10-017;
- REQ-S10-018, REQ-S10-019, REQ-S11-001, REQ-S11-002, REQ-S11-004, REQ-S11-005;
- REQ-S11-006, REQ-S11-007, REQ-S11-008, REQ-S11-009, REQ-S12-005, REQ-S12-006;
- REQ-S12-009, REQ-S12-010, REQ-S12-011, REQ-S12-014, REQ-S12-016, REQ-S13-001;
- REQ-S13-002, REQ-S13-003, REQ-S15-008, REQ-S16-005, REQ-S16-011, REQ-S16-014;
- REQ-S16-017, REQ-S16-018, REQ-S16-019, REQ-S16-020, REQ-S16-025, REQ-S20-003;
- REQ-S20-004, REQ-S20-005, REQ-S20-008, REQ-S20-009, REQ-S20-010, REQ-S20-011.

**Later-gate rows with a P4 increment** (`increments` contains P4): do not change their status. You may add a short "P4 increment delivered: …" pointer to `notes`, but only where a P4 handback names that increment.

## Self-verification (real output in the handback)

- `node tools/gates/validate.mjs --register DG4`: show its output. It can PASS only once both halves are merged. Confirm that every failure it lists is a row of the other half, never one of yours.
- `node tools/gates/validate.mjs --register DG3` and `--register DG2` → still PASS.
- `node tools/gates/validate.mjs --historical --stage DG3` → exit 0.
- **CSV integrity:** the CSV still parses, with the same column count on every row and valid quoting. Check it with a small script and show its output.
- **Your rows only:** a script must show that only your rows differ from the base.
- **`git diff --stat`** shows only `requirements.csv`, plus your handback and any `docs/analysis/**` note.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-AN-P4B-transformation-analyst.md`. Include:
- the rows changed;
- per row, the acceptance clause and the test that asserts it;
- the validator output;
- every row you could NOT evidence, flagged as a real gap.

Leave your changes **uncommitted** for the orchestrator to integrate.
