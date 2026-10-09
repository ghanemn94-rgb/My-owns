# Assignment T-DG4-ARCH-00: P4 architecture plan: decompose the 137 DG4 requirements into architecture slices and implementer waves (solution-architect)

## Stage and base

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING), on branch `claude/mobily-transformation-platform-regate`, at the current `HEAD`.
- **Preceding gate:** DG3 is APPROVED (`docs/delivery/gates/DG3.json`, candidate `sha256:f55095db…`, source `d3e6fe6`). Before anything else, run `node tools/gates/validate.mjs --historical --stage DG3`, and report the result. It must exit 0.
- **You run first and alone.**
- **Time.** The hard limit is about 2 hours.
  - Run `date -u` at the start and at the end.
  - If you pass about 100 minutes, finish the current section and write the handback, listing what remains.

## Why a planning task first

P4 carries **137** DG4-final requirements, four times DG3's 32. A single architect run cannot design them all. In DG3 the architecture took four runs (ARCH-01 to ARCH-04) and the build took 23 implementer runs (D-079).

This task produces the **plan** only: no ADR bodies, no migrations, no contract. The orchestrator then runs one architecture task per slice, and the implementers follow.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **The write guard forbids editing:**
  - `tools/gates/**`, `tools/agents/**` and `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `stages.json` and `findings.json`;
  - `trading_agent/`.

## Inputs (read these first)

- **The register:** `docs/delivery/requirements.csv`, the 137 rows with `final_gate` = DG4. Their `acceptance` texts are binding.
- **The master prompt:** `docs/source/master-prompt-v2.0.md`.
  - The P4 row, at line 616, is: "Full KPI/benefit engines, T10–T16, forums/decisions/RACI/RAID, adoption, corrective actions, core scheduled jobs, BAU handover, continuous improvement and G5–G6".
  - Its acceptance column is: "KPI-to-benefit-to-dashboard scenario; Finance validation; double-counting prevention; recurrence and escalation; adoption/BAU acceptance and ownership continuity".
  - Read §7 (KPI), §8 (benefits), §10 (governance and approvals), §11 (adoption and sustainment), §12 (automations), §13 (dashboards), the S16 entity groups and §20 (acceptance tests A03, A04, A05 and A08–A11).
- **The playbook:** `docs/source/playbook.md`, the T10–T16 templates and the Transform and Realize phases. Cite blocks as `B0xxx`.
- **What exists**, because P4 builds on P1–P3:
  - ADR-0001…ADR-0024 (`docs/architecture/adr/`);
  - `docs/architecture/{erd.md,data-dictionary.md,p1-work-split.md,p2-work-split.md,p3-work-split.md}`;
  - migrations `0001`–`0027`;
  - the OpenAPI contract `docs/api/openapi.yaml` (270 operations);
  - the API modules under `apps/api/src/modules/`, and the shared calc and formula engine `packages/shared/src/{calc.ts,formula/**}` (ADR-0024 §6, the hardened guard);
  - the delivery records `docs/delivery/decisions.md` D-078 to D-087, including the D-082 rule: no worktree or install activity during reviews.
- **DG2 and DG3 lessons are requirements from the start** (D-078 §3):
  - the shared free-text rules and strict UTF-8;
  - `config.consumes` equal to the request media type;
  - commit-time re-authorisation, with no remote I/O inside a transaction;
  - decimal-only arithmetic, with Unknown/Stale shown honestly;
  - bilingual text translated at render time;
  - one form-level alert per form, and session-bound web actions;
  - ports below 32768, and both locale settings;
  - every non-zero exit disclosed;
  - **ADR claims that are exactly true and enumerated, never absolute.** F-DG3-100 took five repairs because an ADR over-claimed.

## Deliverable: `docs/architecture/p4-plan.md`

In this order:

1. **Inventory.** Map each of the 137 DG4 requirements to exactly one **architecture slice**, with a one-line reason. Group the slices by domain. A suggested starting point, which you may change with reasons:
   - (A) KPI engine (S07, S16-014, S15-008, S16-025, T10 RAG rules);
   - (B) benefits engine and Finance validation (S08, T14, PB-058, PB-074–076, PB-085, S16-017);
   - (C) governance: forums, meetings, decisions, RACI, RAID, approvals and delegation (T11, T12, T15, T16, S10, S16-018/019);
   - (D) adoption, BAU handover and continuous improvement (T13, S11, PB-069–073, PB-083–084, S16-020);
   - (E) phases and gates G5/G6, change control, waivers and impact assessment (S04, PB-014/015/020/021, S09-007/009/010);
   - (F) scheduler and automations (S12, S16-005, S10-006 business calendar);
   - (G) dashboards and workspaces (T10, S13, S03-008/009/011);
   - (H) cross-cutting traceability and modular entry (S03, PB-005/008/009/010/044, S16-011);
   - (I) acceptance tests A03, A04, A05 and A08–A11 (S20), and the P4 evidence (DLV-036).
2. **Dependencies and order.** Draw the dependency graph between slices. For example, benefits depends on KPI actuals, and dashboards depend on every engine. State the critical path.
3. **The DG3 seams P4 extends.** Name exactly what P4 must change or extend in DG1–DG3 artifacts:
   - the gate engine for G5 and G6;
   - the formula engine reused by KPI formulas;
   - roles and permissions;
   - the existing `kpi` module;
   - any other.

   For each, state whether it is additive or a reopen candidate. A DG3-approved behaviour may change only with a documented reason.
4. **Architecture tasks.** One task per slice, or per pair of slices, each sized to fit about 2 hours of architect work. For each task give:
   - its ADR numbers, from ADR-0025;
   - a **migration number range**, from `0028`, with no overlaps;
   - its OpenAPI area and an estimated operation count;
   - its advisory-lock classes, from 730224, so the registry stays distinct;
   - the requirements it covers.
5. **Implementer waves.** For each slice, the backend-workflow, kpi-benefits and frontend-ux tasks, each sized at about 60–75 minutes, with **non-overlapping file ownership**, in waves. No more than 4 concurrent workers (D-004). Name the shared files that need orchestrator merges, such as export lines and contract pins.
6. **Risks and open questions.** List anything ambiguous in the sources that the orchestrator or the user must decide, quoting the source text, and any requirement that seems to belong to a later stage.

Also write the handback `docs/delivery/handbacks/DG4/T-DG4-ARCH-00-solution-architect.md`. Include:
- the `validate --historical --stage DG3` result;
- the time used;
- a summary of the plan;
- anything left undone.

## Acceptance

- `p4-plan.md` maps all 137 requirements, each to exactly one slice. Include a check table: per slice, the count of requirement ids, with a total of 137.
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.
