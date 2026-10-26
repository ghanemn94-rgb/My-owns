# Assignment T-DG6-ARCH-00: P6 architecture plan: decompose the 48 DG6 requirements into architecture slices and implementer waves (solution-architect)

## Stage and base

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING), on branch `claude/mobily-transformation-platform-dg5-regate2`, at the current `HEAD`.
- **Preceding gate:** DG5 is APPROVED (`docs/delivery/gates/DG5.json`, candidate `sha256:55a411ae…`, source `660f40c`; D-193). Before anything else, run `node tools/gates/validate.mjs --historical --stage DG5`, and report the result. It must exit 0.
- **You run first and alone.**
- **Time.** The hard limit is about 2 hours.
  - Run `date -u` at the start and at the end.
  - If you pass about 100 minutes, finish the current section and write the handback, listing what remains.

## Why a planning task first

P6 carries **48** DG6-final requirements. DG5 (78 requirements) took a plan (`docs/architecture/p5-plan.md`) and slice tasks, and the build ran in implementer waves (D-141 to D-169). Follow `p5-plan.md`'s structure.

This task produces the **plan** only: no ADR bodies, no migrations, no contract. The orchestrator then runs one architecture task per slice, and the implementers follow.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **The write guard forbids editing:**
  - `tools/gates/**`, `tools/agents/**` and `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `stages.json` and `findings.json`;
  - `trading_agent/`.

## Inputs (read these first)

- **The register:** `docs/delivery/requirements.csv`, the 48 rows with `final_gate` = DG6. Their `acceptance` texts are binding. Most rows have earlier increments (P1–P5) in their `increments` column; many are cross-cutting hardening of what exists (permissions, concurrency, audit, accessibility, RTL, tables, search). **Read what P1–P5 already deliver for each row before planning the remainder**, and say per row what is done, what is missing and how it will be proven.
- **The master prompt:** `docs/source/master-prompt-v2.0.md`. The P6 row (line 618): "Controlled imports, connector contracts/test adapters, identity/storage integration, optional AI adapter, security/performance/accessibility refinements and operational monitoring"; its acceptance column: "Applicable A01–A22 checks; authorization boundary tests; malformed/duplicate input; concurrency/failure recovery; realistic load; complete lifecycle with external AI disabled; honest live-integration status". Read at least §16 (S16 engineering), §17 (integrations and AI), §15 (UX), §20 (acceptance tests A01, A12, A13, A14, A17, A20, A21, A22 and the load dataset).
- **The playbook:** `docs/source/playbook.md` where a row cites it (`B0xxx`).
- **What exists:** ADR-0001…ADR-0050 (`docs/architecture/adr/`, with dated amendments that win); `docs/architecture/{erd.md,data-dictionary.md,p*-work-split.md,p4-plan.md,p5-plan.md}`; migrations `0001`–`0097` (the eight P5 gap ids are retired, never filled: a new id is above `0097`); `docs/api/openapi.yaml` (846 operations); the API modules, the worker, the scheduled-job kit, advisory locks up to 730299; the web app; `docs/delivery/environment.md` (its documented residuals: Keycloak D-049, live registry D-057, live CI D-058).
- **DG5 carry-forward (D-193), to be planned into P6:** F-DG5-120 and 121 (Studio scoring-weight labels and the version diff view); from earlier DG5 branches F-DG5-125 (`fetchAllPages` stops silently at 2000), 150 (Traceability "Showing the links of" note wraps), 145/146/151 (e2e specs on the default 30 s budget; sweep them). Read them with `git show 5a7c189:docs/delivery/findings.json` and `git show ac68d1b:docs/delivery/findings.json`.
- **Delivery lessons that are requirements from the start** (D-078 §3, D-088 §2, D-141, D-193): the shared free-text rules and strict UTF-8; commit-time re-authorisation with no remote I/O inside a transaction; exactly-once jobs with advisory locks and unique backstops; decimal-only arithmetic, Unknown/Stale/n/a never 0 or green; bilingual text translated at render time and true for the release it ships in; one form-level alert per form; ports below 32768, both locale settings, tests deterministic under load with explicit budgets where needed; every non-zero exit disclosed; ADR claims exactly true and enumerated.
- **Honest live-integration status** is binding: an adapter that cannot be exercised live in this sandbox (enterprise IdP, object store, mail, external AI provider, corporate data sources) is delivered with a contract, a test adapter and documented residual, never claimed live.

## Deliverable: `docs/architecture/p6-plan.md`

In this order:

1. **Inventory.** Map each of the 48 DG6 requirements to exactly one **architecture slice**, with a one-line reason. Group the slices by domain. Choose the slices yourself from the requirements; the master prompt's P6 row suggests at least: controlled imports (staging, validation, duplicates, row errors); the connector framework, contracts and test adapters; identity (OIDC, SAML broker documentation, service identities) and evidence storage adapters; the optional AI assistant and its guardrails (disabled by default, no-AI operation); security hardening (sessions, injection, deep links, search and file authorization); performance (the realistic load dataset, async long exports); UX and accessibility hardening (RTL/LTR, tables, search, saved views, states, keyboard, contrast); operational monitoring; the DG5 carry-forward; and the P6 acceptance tests and evidence. For each requirement state: already met by P1–P5 (with evidence), partly met (what is missing), or new.
2. **Dependencies and order.** Draw the dependency graph between slices. For example, benefits depends on KPI actuals, and dashboards depend on every engine. State the critical path.
3. **The DG1–DG5 seams P6 extends.** Name exactly what P6 must change or extend in approved artifacts, for example: methodology and configuration versioning (how a published configuration change migrates running transformations and triggers re-approval); the form and field definitions; the automation and scheduled-job kit; the dashboards and reports; roles and permissions; the seed data. For each, state whether it is additive or a reopen candidate. A DG1–DG5-approved behaviour may change only with a documented reason.
4. **Architecture tasks.** One task per slice, or per pair of slices, each sized to fit about 2 hours of architect work. For each task give:
   - its ADR numbers, from ADR-0051;
   - a **migration number range**, from `0098`, with no overlaps;
   - its OpenAPI area and an estimated operation count;
   - its advisory-lock classes, from 730300, so the registry stays distinct;
   - the requirements it covers.
5. **Implementer waves.** For each slice, the backend-workflow, kpi-benefits, devops and frontend-ux tasks, each sized at about 60–75 minutes, with **non-overlapping file ownership**, in waves. No more than 4 concurrent workers (D-004). Name the shared files that need orchestrator merges, such as export lines and contract pins.
6. **Risks and open questions.** List anything ambiguous in the sources that the orchestrator or the user must decide, quoting the source text, and any requirement that seems to belong to a later stage.

Also write the handback `docs/delivery/handbacks/DG6/T-DG6-ARCH-00-solution-architect.md`. Include:
- the `validate --historical --stage DG5` result;
- the time used;
- a summary of the plan;
- anything left undone.

## Acceptance

- `p6-plan.md` maps all 48 requirements, each to exactly one slice. Include a check table: per slice, the count of requirement ids, with a total of 48.
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG5` exits 0.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.
