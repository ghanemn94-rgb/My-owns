# Assignment T-DG7-ARCH-00: P7 architecture plan: decompose the 54 DG7 requirements into architecture slices and implementer waves (solution-architect)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), on branch `claude/mobily-transformation-platform-dg6-regate`, at the current `HEAD`.
- **Preceding gate:** DG6 is APPROVED (`docs/delivery/gates/DG6.json`, candidate `sha256:10f71f24…`, source `d8868b2a5`; D-241). Before anything else, run `node tools/gates/validate.mjs --historical --stage DG6`, and report the result. It must exit 0.
- **You run first and alone.**
- **Time.** The hard limit is about 2 hours.
  - Run `date -u` at the start and at the end.
  - If you pass about 100 minutes, finish the current section and write the handback, listing what remains.

## Why a planning task first

P7 carries **54** DG7-final requirements. DG6 (48 requirements) took a plan (`docs/architecture/p6-plan.md`) and slice tasks, and the build ran in implementer waves (D-194 to D-205). Follow `p6-plan.md`'s structure.

This task produces the **plan** only: no ADR bodies, no migrations, no contract. The orchestrator then runs one architecture task per slice, and the implementers follow.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **The write guard forbids editing:**
  - `tools/gates/**`, `tools/agents/**` and `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `stages.json` and `findings.json`;
  - `trading_agent/`.

## Inputs (read these first)

- **The register:** `docs/delivery/requirements.csv`, the 54 rows with `final_gate` = DG7. Their `acceptance` texts are binding. Most rows have earlier increments (P1–P6) in their `increments` column; many are cross-cutting hardening of what exists (permissions, concurrency, audit, accessibility, RTL, tables, search). **Read what P1–P6 already deliver for each row before planning the remainder**, and say per row what is done, what is missing and how it will be proven.
- **The master prompt:** `docs/source/master-prompt-v2.0.md`. The P7 row (line 619): "Complete source/archive, clean deployment, migrated data/files/configuration, restore drill, guides, traceability and final IT handover"; its acceptance column: "A01–A27 and all product requirements verified; clean-environment/outbound-internet-disabled runtime demonstration; independent final domain/code/QA reviews and release audit, followed by A28 package sealing and integrity verification". **Line 621 is binding:** the DG7 approval covers the frozen application/handover payload (review and gate metadata excluded from its hash); the DG7 gate record is then appended to the release evidence envelope and A28 seals and verifies the package; a sealing failure blocks delivery, a payload change requires new candidate reviews; record the payload hash and the final archive checksum separately. Plan this two-step explicitly. Read at least §20 (A01–A28 and the load dataset), the deployment/handover/IT sections, and the P7 row.
- **The playbook:** `docs/source/playbook.md` where a row cites it (`B0xxx`).
- **What exists:** ADR-0001…ADR-0061 (there is no ADR-0060; `docs/architecture/adr/`, with dated amendments that win); `docs/architecture/{erd.md,data-dictionary.md,p*-work-split.md,p4-plan.md,p5-plan.md,p6-plan.md}`; migrations `0001`–`0130` (`packages/db/migrations/`); `docs/api/openapi.yaml` (932 operations); advisory locks up to 730339; `deploy/` (Compose, images, backup/restore, observability from earlier stages); the web app and worker; `docs/delivery/environment.md` and its documented residuals (Keycloak D-049, live registry D-057, live CI D-058).
- **DG6 carry-forward (D-241):** F-DG6-952 (Low, ACCEPTED_OBSERVATION: out-of-order history timestamps in approved `stages.json` entries) needs no work; list any DG6 register `notes` residual that P7 must close or carry into the handover.
- **Delivery lessons that are requirements from the start** (D-078 §3, D-088 §2, D-141, D-193): the shared free-text rules and strict UTF-8; commit-time re-authorisation with no remote I/O inside a transaction; exactly-once jobs with advisory locks and unique backstops; decimal-only arithmetic, Unknown/Stale/n/a never 0 or green; bilingual text translated at render time and true for the release it ships in; one form-level alert per form; ports below 32768, both locale settings, tests deterministic under load with explicit budgets where needed; every non-zero exit disclosed; ADR claims exactly true and enumerated.
- **Honest live-integration status** is binding: an adapter that cannot be exercised live in this sandbox (enterprise IdP, object store, mail, external AI provider, corporate data sources) is delivered with a contract, a test adapter and documented residual, never claimed live.

## Deliverable: `docs/architecture/p6-plan.md`

In this order:

1. **Inventory.** Map each of the 54 DG7 requirements to exactly one **architecture slice**, with a one-line reason. Group the slices by domain. Choose the slices yourself; the P7 row suggests at least: source archive and reproducible build; clean deployment (outbound internet disabled); data/files/configuration migration; backup and restore drill; operator, admin and user guides (EN/AR); requirement traceability and the A01–A27 verification matrix; IT handover package; A28 sealing and integrity verification. For each requirement state: already met by P1–P6 (with evidence), partly met (what is missing), or new.
2. **Dependencies and order.** Draw the dependency graph between slices. For example, benefits depends on KPI actuals, and dashboards depend on every engine. State the critical path.
3. **The DG1–DG6 seams P7 extends.** Name exactly what P7 must change or extend in approved artifacts, for example: methodology and configuration versioning (how a published configuration change migrates running transformations and triggers re-approval); the form and field definitions; the automation and scheduled-job kit; the dashboards and reports; roles and permissions; the seed data. For each, state whether it is additive or a reopen candidate. A DG1–DG6-approved behaviour may change only with a documented reason.
4. **Architecture tasks.** One task per slice, or per pair of slices, each sized to fit about 2 hours of architect work. For each task give:
   - its ADR numbers, from ADR-0062;
   - a **migration number range**, from `0131`, with no overlaps;
   - its OpenAPI area and an estimated operation count;
   - its advisory-lock classes, from 730400, so the registry stays distinct;
   - the requirements it covers.
5. **Implementer waves.** For each slice, the backend-workflow, kpi-benefits, devops and frontend-ux tasks, each sized at about 60–75 minutes, with **non-overlapping file ownership**, in waves. No more than 4 concurrent workers (D-004). Name the shared files that need orchestrator merges, such as export lines and contract pins.
6. **Risks and open questions.** List anything ambiguous in the sources that the orchestrator or the user must decide, quoting the source text, and any requirement that seems to belong to a later stage.

Also write the handback `docs/delivery/handbacks/DG7/T-DG7-ARCH-00-solution-architect.md`. Include:
- the `validate --historical --stage DG6` result;
- the time used;
- a summary of the plan;
- anything left undone.

## Acceptance

- `p7-plan.md` maps all 54 requirements, each to exactly one slice. Include a check table: per slice, the count of requirement ids, with a total of 54.
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.
