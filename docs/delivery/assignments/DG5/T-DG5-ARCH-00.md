# Assignment T-DG5-ARCH-00: P5 architecture plan: decompose the 78 DG5 requirements into architecture slices and implementer waves (solution-architect)

## Stage and base

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING), on branch `claude/mobily-transformation-platform-regate`, at the current `HEAD`.
- **Preceding gate:** DG4 is APPROVED (`docs/delivery/gates/DG4.json`, candidate `sha256:f38274cb…`, source `e70ac02`). Before anything else, run `node tools/gates/validate.mjs --historical --stage DG4`, and report the result. It must exit 0.
- **You run first and alone.**
- **Time.** The hard limit is about 2 hours.
  - Run `date -u` at the start and at the end.
  - If you pass about 100 minutes, finish the current section and write the handback, listing what remains.

## Why a planning task first

P5 carries **78** DG5-final requirements. In DG4 (137 requirements) the architecture took a plan (ARCH-00) and eight slice tasks (ARCH-01 to ARCH-08), and the build ran in waves of implementer tasks (D-088 to D-116). `docs/architecture/p4-plan.md` is the pattern: follow its structure.

This task produces the **plan** only: no ADR bodies, no migrations, no contract. The orchestrator then runs one architecture task per slice, and the implementers follow.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **The write guard forbids editing:**
  - `tools/gates/**`, `tools/agents/**` and `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `stages.json` and `findings.json`;
  - `trading_agent/`.

## Inputs (read these first)

- **The register:** `docs/delivery/requirements.csv`, the 78 rows with `final_gate` = DG5. Their `acceptance` texts are binding. Many rows have earlier increments (P1–P4) in their `increments` column; read what those increments already delivered before planning the remainder.
- **The master prompt:** `docs/source/master-prompt-v2.0.md`.
  - The P5 row, at line 617, is: "Complete Playbook Studio, native procedure/form builders, version migration, full rule builder, report/export formats, 90-day launch plan, 25-question health check and source-grounded demo".
  - Its acceptance column is: "Admin changes without routine code edits; draft/publish/migration/reapproval behavior; durable rule retries; report snapshots and bilingual export inspection; all required starter automations".
  - Read at least: the Playbook Studio text (around line 243), the automation table (around line 367 and §12), §14 "Launch plan and health check" (around line 411), the seed and demo data (around line 540), the reports and exports, the S16 entity groups, and §20's acceptance tests that name DG5 rows.
- **The playbook:** `docs/source/playbook.md`, especially the 90-day launch plan, the 25-question health check, the templates and the worked example. Cite blocks as `B0xxx`.
- **What exists**, because P5 builds on P1–P4:
  - ADR-0001…ADR-0038 (`docs/architecture/adr/`), with their dated amendments, which win where they differ from the original text;
  - `docs/architecture/{erd.md,data-dictionary.md,p1-work-split.md,p2-work-split.md,p3-work-split.md,p4-plan.md,p4-work-split.md}`;
  - migrations `0001`–`0061`;
  - the OpenAPI contract `docs/api/openapi.yaml` (652 operations);
  - the API modules under `apps/api/src/modules/`, the worker, the scheduled-job kit and the advisory-lock registry (730224–730249 used by P4), and the shared calc and formula engine `packages/shared/src/{calc.ts,formula/**}`;
  - the web app's planned areas and routes (`apps/web/src/app/nav.ts`, `router.tsx`), several of which name P5 scope (for example the Playbook Studio under Admin, D-137/D-138);
  - the delivery records `docs/delivery/decisions.md` D-088 to D-140.
- **DG2–DG4 lessons are requirements from the start** (D-078 §3, D-088 §2, D-141):
  - the shared free-text rules and strict UTF-8; `config.consumes` equal to the request media type;
  - commit-time re-authorisation, with no remote I/O inside a transaction; exactly-once jobs with advisory locks and unique backstops;
  - decimal-only arithmetic, with Unknown/Stale/n/a shown honestly and never as 0 or green; value bases never mixed (D-117, D-119, D-122);
  - bilingual text translated at render time, and **user-facing text that is true for the release it ships in** (F-DG4-160);
  - one form-level alert per form, and session-bound web actions;
  - ports below 32768, both locale settings, and tests that stay deterministic under load (F-DG4-143 to F-DG4-148) and do not read growing delivery folders (D-138);
  - every non-zero exit disclosed;
  - **ADR claims that are exactly true and enumerated, never absolute.**

## Deliverable: `docs/architecture/p5-plan.md`

In this order:

1. **Inventory.** Map each of the 78 DG5 requirements to exactly one **architecture slice**, with a one-line reason. Group the slices by domain. Choose the slices yourself from the requirements; the master prompt's P5 row suggests at least: Playbook Studio and native procedure/form builders (with draft/publish, version migration and re-approval); the full rule builder and durable automations (all required starter automations, retries); reports, snapshots and bilingual exports; the 90-day launch plan and the 25-question health check; the source-grounded demo and seed data; and the P5 acceptance tests and evidence.
2. **Dependencies and order.** Draw the dependency graph between slices. For example, benefits depends on KPI actuals, and dashboards depend on every engine. State the critical path.
3. **The DG1–DG4 seams P5 extends.** Name exactly what P5 must change or extend in approved artifacts, for example: methodology and configuration versioning (how a published configuration change migrates running transformations and triggers re-approval); the form and field definitions; the automation and scheduled-job kit; the dashboards and reports; roles and permissions; the seed data. For each, state whether it is additive or a reopen candidate. A DG1–DG4-approved behaviour may change only with a documented reason.
4. **Architecture tasks.** One task per slice, or per pair of slices, each sized to fit about 2 hours of architect work. For each task give:
   - its ADR numbers, from ADR-0039;
   - a **migration number range**, from `0062`, with no overlaps;
   - its OpenAPI area and an estimated operation count;
   - its advisory-lock classes, from 730250, so the registry stays distinct;
   - the requirements it covers.
5. **Implementer waves.** For each slice, the backend-workflow, kpi-benefits and frontend-ux tasks, each sized at about 60–75 minutes, with **non-overlapping file ownership**, in waves. No more than 4 concurrent workers (D-004). Name the shared files that need orchestrator merges, such as export lines and contract pins.
6. **Risks and open questions.** List anything ambiguous in the sources that the orchestrator or the user must decide, quoting the source text, and any requirement that seems to belong to a later stage.

Also write the handback `docs/delivery/handbacks/DG5/T-DG5-ARCH-00-solution-architect.md`. Include:
- the `validate --historical --stage DG4` result;
- the time used;
- a summary of the plan;
- anything left undone.

## Acceptance

- `p5-plan.md` maps all 78 requirements, each to exactly one slice. Include a check table: per slice, the count of requirement ids, with a total of 78.
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.
