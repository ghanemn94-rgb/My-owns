# Assignment T-DG3-AN-P3: DG3 register update: the 32 DG3-final requirements IMPLEMENTED with evidence (transformation-analyst)

## Stage and working tree

- **Stage:** P3 "Mobilization and portfolio", gate DG3 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory, on branch `dg3/an-p3`, at the integrated `HEAD`: every P3 implementation task through FE-E and ARCH-04 is merged and verified, and all 270 contract operations are routed.
- **Concurrency (D-004):** two tasks run alongside you in their own worktrees, and you never touch their files:
  - FE-D owns `apps/web/e2e/p3-journeys.spec.ts`;
  - BE-F owns the `g4.schedule_unknown` item.
- **Your write scope:** `docs/delivery/requirements.csv`, `docs/analysis/**` and your handback, nothing else. Do NOT touch:
  - application code (`apps/**`, `packages/**`);
  - `docs/api/**`, `docs/architecture/**`, migrations;
  - reviews, runs, gate records, `stages.json`, `findings.json`;
  - `tools/**`, `docs/source/**`.
- **Why now:** in DG2 this update was missed until review round 1 raised F-DG2-202 (High). In DG3 it lands before the candidate freezes.
- **Time:** about 30–45 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end.

## Task

For **each of the 32 rows whose `final_gate` = DG3** in `docs/delivery/requirements.csv`:

- set `status = IMPLEMENTED`;
- fill `evidence` with accurate, specific, `;`-separated repository paths, **every one of which exists in your tree**;
- append one sentence to `notes`: "DG3 analyst check (T-DG3-AN-P3, base <sha>): …". Keep the existing notes.

Draw the evidence from the real P3 deliverables:

- **Implementing code:** use `docs/architecture/p3-work-split.md` §7 (requirement → owner) and §9. This covers:
  - `apps/api/src/modules/{portfolio,workflows,kpi,platform}/**`;
  - `packages/shared/src/{calc.ts,scoring.ts,formula/**,schemas/**}`;
  - `packages/db/migrations/0020`–`0027`;
  - `apps/web/src/pages/{portfolio,readiness,dispensations,prioritization,roadmap,dependencies,capacity,business-cases,benefit-formulas,gates}/**`.
- **Verifying tests:**
  - integration: `apps/api/test/integration/{portfolio,dependencies,kpi,gates}/**`, `contract/p3-exercises-*.ts`;
  - unit: `scoring.test.ts`, `formula/*.test.ts`, `schedule.test.ts`, `g4.test.ts`, `capacity.test.ts`, `sequencing.test.ts`, `totals.test.ts`, `db-errors.test.ts`;
  - web: the web tests of each page;
  - e2e: the specs `apps/web/e2e/p3-*.spec.ts` that exist in your tree (`p3-portfolio`, `p3-prioritization-roadmap`, `p3-business-cases`, `p3-ui-completion`, `p3-seams`).
- **Design records:** ADR-0021…0024, `docs/api/openapi.yaml`, `docs/architecture/erd.md` §1c.
- **The P3 implementer handbacks:** `docs/delivery/handbacks/DG3/*.md`, for the checks they ran.

**Before citing a test as evidence for a requirement, open it and check that it asserts that requirement's acceptance clause.** The acceptance clauses are binding, and reviewers test them literally.

Keep `req_id`, `class`, `title`, `source_ref`, `acceptance`, `increments` and `final_gate` unchanged.

If a row's behaviour cannot be pointed to, **leave it SPECIFIED and flag it in the handback as a real gap.** A real gap is a finding the orchestrator must repair, not something the register should paper over.

**The 32 rows:**
- REQ-PB-004, REQ-PB-006, REQ-PB-007, REQ-PB-019, REQ-PB-022;
- REQ-PB-032, REQ-PB-040, REQ-PB-045, REQ-PB-046, REQ-PB-047;
- REQ-PB-048, REQ-PB-049, REQ-PB-050, REQ-PB-051, REQ-PB-052;
- REQ-PB-053, REQ-PB-054, REQ-PB-055, REQ-PB-056, REQ-PB-057, REQ-PB-059;
- REQ-DLV-035, REQ-S04-006, REQ-S05-005, REQ-S08-007;
- REQ-S09-001, REQ-S09-003, REQ-S09-004, REQ-S09-005, REQ-S09-006, REQ-S09-008;
- REQ-S16-016.

**P3 increments of later-gate rows** (`increments` contains P3; work split §8): do not change their status. If a row's `notes` would benefit from a short "P3 increment delivered: …" pointer, add it, but only for rows the work split §8 names.

## Self-verification (real output in the handback)

- `node tools/gates/validate.mjs --register DG3` → **PASS**, exit 0.
- `node tools/gates/validate.mjs --register DG2` → still PASS.
- `node tools/gates/validate.mjs --historical --stage DG2` → exit 0.
- The CSV still parses: same column count on every row, valid quoting. Check it with a small script and show its output.
- `git diff --stat` shows only `requirements.csv`, plus your handback.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-AN-P3-transformation-analyst.md`. Include:

- the rows changed;
- per row, the acceptance clause and the test that asserts it;
- the validator output;
- any requirement you could NOT evidence, flagged as a real gap.
