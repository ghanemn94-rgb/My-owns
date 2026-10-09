# Assignment T-DG4-ARCH-02: P4 architecture, slice(s) A (solution-architect)

## Stage and base

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING), on branch `claude/mobily-transformation-platform-regate`, at the current `HEAD`.
- **Preceding gate:** DG3 is APPROVED. Before anything else, run `node tools/gates/validate.mjs --historical --stage DG3` and report the result. It must exit 0.
- **The plan is binding:**
  - `docs/architecture/p4-plan.md` (T-DG4-ARCH-00), adopted by **D-089**;
  - the orchestrator's decisions on its open questions and reopen candidates, which are in D-089 in `docs/delivery/decisions.md`. Read D-088 and D-089 verbatim.
- **You run alone on the shared contract files** (p4-plan §5.3). T-DG4-BE-A runs at the same time in its own git worktree; it does not touch your files. Migration `0032` already exists (an orchestrator no-op, D-090), so your range starts at `0033`.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
- **Your harness ports are 23700–23749 only.**

## Your slice (p4-plan §4, row T-DG4-ARCH-02)

- **Slices:** A. Read p4-plan §1.1 and §1.2 for their rows, §2 for the dependencies, and §3 for the seams.
- **ADRs:** ADR-0027 KPI data model and pipeline (dictionary v2, versions, target trajectories, actual versions, submission routes, accept pipeline, calculation runs, data-quality findings, overrides, `kpi.deviation_evaluated` event); ADR-0028 KPI calculation semantics (measure types, period/cumulative, % vs pp, aggregation, RAG with versioned thresholds, Unknown/Stale/Not computable, KPI formulas on the DG3 engine)
- **Migration range:** 0033–0036. Write from the low end. The numbers you leave free are for your slice's implementers, in the order your work-split section names.
- **OpenAPI area:** `kpi-definitions` (extended), `kpi-versions`, `target-trajectories`, `reporting-periods`, `kpi-actuals` (+ submit, accept, reject), `calculation-runs`, `kpi-status` (RAG panel), `rag-overrides`, `data-quality-findings` (≈ 35)
- **Advisory-lock classes:** 730228 KPI formula graph (per transformation); 730229 KPI actual slot (KPI, scope, period); 730230 reporting period (per organization, frequency, period); 730231 reserved

## Requirements in scope (16 rows, final gate DG4)

Their `acceptance` texts in `docs/delivery/requirements.csv` are binding, and reviewers test them literally. Where a row cites a later-stage A-test, it is judged on its own acceptance text (D-089 R4).

- **REQ-S07-001** (-): Provide a KPI dictionary with name, description, business purpose, owner, steward, unit, frequency, polarity, numerator/denominator, calculation, baseline and baseline date, target and target date, phased trajectory, source, aggregation rule, data-quality rule, reporting period, approval policy and leading/lagging classification
- **REQ-S07-002** (-): Support higher-is-better, lower-is-better, acceptable-band and binary milestone measures
- **REQ-S07-003** (-): Store actuals by KPI, scope and reporting period
- **REQ-S07-004** (-): Distinguish period from cumulative values and percentage changes from percentage-point changes
- **REQ-S07-005** (-): Handle missing values, zero denominators, negative baselines and incomparable periods explicitly
- **REQ-S07-006** (-): Show Unknown or Stale for missing or stale data, never green or zero
- **REQ-S07-007** (-): Compute RAG from the approved expected trajectory with configurable thresholds and never from project task completion
- **REQ-S07-008** (-): Always show actual, expected-to-date, final target, variance, trend, data freshness and the rule explanation alongside RAG
- **REQ-S07-009** (-): Allow manual RAG override only by an authorized user with reason, evidence, expiry and audit, preserving the calculated status
- **REQ-S07-010** (-): Define aggregations explicitly: sum eligible flows, last value for stocks, weighted ratios where appropriate or an approved custom formula; never average percentages or mix units by default; preserve currency and period
- **REQ-S07-011** (-): Reject circular references and invalid units in formula dependencies
- **REQ-S07-012** (-): Route KPI submissions through configurable draft/review/accept or direct-accept routes
- **REQ-S07-013** (-): On an accepted actual run server-side validation, recalculation of dependent metrics and benefits, dashboard refresh, deviation evaluation and an audit event
- **REQ-S07-017** (-): Make the routine KPI update quick: open KPI, select period, enter or import actual and evidence, submit; then show which downstream views changed and whether review is pending
- **REQ-S12-006** (-): Starter automation: when an accepted KPI actual changes, recalculate dependent values and RAG, refresh live views and flag benefit validation where needed
- **REQ-S16-014** (-): Implement the KPI and calculation entity group: KPIDefinition, KPIVersion, KPIActual, TargetTrajectory, CalculationRun, DataQualityFinding

## Inputs

- **The master prompt** (`docs/source/master-prompt-v2.0.md`, with the anchors in `master-prompt.anchored.md`): the sections p4-plan cites for your slices.
- **The playbook** (`docs/source/playbook.md`): the template blocks for your slices. Cite `B0xxx`.
- **What exists:**
  - ADR-0001 to ADR-0024, plus the P4 ADRs already written;
  - migrations `0001`→ latest;
  - the erd and the data dictionary;
  - `openapi.yaml`;
  - `apps/api/src/modules/**`;
  - `packages/shared/src/{calc.ts,formula/**}`;
  - p3-work-split, and p4-work-split if it exists.

## Deliverables, in this order

The critical path is deliverables 1–3. If you pass about 100 minutes, finish the current file, make the tree typecheck, and write the handback, listing exactly what remains for a continuation task. Never leave a half-written file.

1. **ADRs.** Write them in the existing Context / Decision / Alternatives / Consequences / Verification format. Every claim must be **enumerated and exactly true, never absolute** (D-088 §2; F-DG3-100). Where a design point has a source text, quote it, and cite the master-prompt anchors `M0xxx` and the playbook blocks `B0xxx`. For each requirement in scope, the ADR must name:
   - the entity and the fields;
   - the state machine, if any;
   - the exact refusal codes and their English texts, taken from the acceptance texts;
   - the authorization: permission, role defaults, AUD read-only, and SoD where it applies;
   - the decimal and Unknown semantics.
2. **Migrations and schema types.**
   - Write your range's migrations, forward-only, with the P2 guard pattern on every new mutable table:
     - `p2_attach_guards`;
     - version stepping by 1;
     - the deferred audit-coverage constraint;
     - append-only history;
     - `timestamptz`;
     - `numeric` for money, rates and FTE;
     - CHECK constraints for the closed sets.
   - Include any seeds the acceptance texts require. Mark source seeds verbatim and bilingual, with the provisional-Arabic label where needed.
   - Update `packages/db/src/schema.ts` (Kysely), the catalogue and seed test pins, and `packages/shared/src/permissions.ts` (`P4_PERMISSIONS`; technical-admin roles never get business-approval rights, S10-003).
   - Register your advisory-lock classes in `apps/api/src/modules/platform/advisory-locks.ts` and the ADR-0016 §6 registry, and keep the distinct-classes test green.
3. **Probe (real output, in the handback).** On a disposable PostgreSQL (`tests/qa/support/with-pg.sh`, your port range):
   - apply `0001`→ your last migration to an empty DB, and also over a DB populated by `0001`–`0027`;
   - prove that each new guard fires: missing audit fails at COMMIT, a non-stepping version fails, UPDATE/DELETE on history fails, and every database invariant your ADR claims holds.
4. **ERD and data dictionary.** Extend `docs/architecture/erd.md` and `data-dictionary.md` with every new table, matching the migrations exactly.
5. **Contract.** Extend `docs/api/openapi.yaml` (OpenAPI 3.1) with your slice's operations.
   - Set `info.version` to `1.3.0-p4`.
   - Keep every P1–P3 path byte-stable except the extensions D-089 accepted.
   - Every operation declares the ADR-0007 §5b statuses, its request media type (= the route's future `config.consumes`), problem+json, `If-Match`/ETag and cursor pagination.
   - Add your operations to a new `apps/api/test/support/p4-pending-<your task>.ts` list, so `contract.test.ts` stays green until the implementers route them (the P3 `p3-pending-*` precedent). Update `contract.test.ts`'s pins only as that pattern requires, and report the new counts.
   - `pnpm openapi:lint` must pass.
6. **Permissions matrix and work split.**
   - Add your entities' rights to `docs/analysis/permissions-matrix.md`, with AUD read-only everywhere.
   - Write your slice's section of `docs/architecture/p4-work-split.md`, following `p3-work-split.md` and p4-plan §5. Include:
     - the implementer tasks for your slice, each sized at about 60–75 minutes;
     - exact, non-overlapping file ownership;
     - the contracts each task consumes;
     - the integration order;
     - a requirement → owner table for your rows.
   - If the file does not exist yet, create it with the shared rules section (§2, the numbered DG2/DG3 lessons below) and your slice's section.

## Lessons from DG2 and DG3 that P4 builds in (state them as implementer rules)

1. **Free text** uses the shared `freeText`/`hasText`/`hasInvalidCharacter`/`truncateText` rules.
2. **Strict UTF-8** JSON and query parsing applies to every route.
3. **`config.consumes`** equals the operation's request media type.
4. **Every mutation needs:**
   - authorization re-checked at commit time;
   - validation;
   - `If-Match` (409/428);
   - an audit event;
   - no remote I/O inside a transaction;
   - a test for each.
5. **Decimal only** for money, rates, FTE and KPI values. Unknown, Stale or Not computable is never shown as 0 or green.
6. **Bilingual text,** Arabic RTL and English LTR, translated at render time. Problem codes are translated too.
7. **Web forms** have one form-level alert; actions are session-bound (`auth/sessionBound.ts`); the AUD user sees read-only views; the label is "business approval", never DG0–DG7.
8. **Ports** stay below 32768, and verification runs with the locale unset and with `C.UTF-8`.
9. **The formula engine** (`packages/shared/src/formula/**`) is reused unchanged. Any change to it is a reopen candidate (seam 5).

## Environment and constraints

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`. Run offline. Never run `playwright install`.
- **The write guard forbids editing:**
  - `tools/gates/**`, `tools/agents/**` and `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `stages.json` and `findings.json`;
  - `trading_agent/`.
- **No dependencies, secrets or CDNs.** Add no dependency without an orchestrator decision. No secrets and no public CDNs.
- **Brand and naming.** `#0078FF` is provisional. Never call the product an official PMI standard or a certified product.
- **Gates.** Product gates G1–G6 are business approvals, separate from the engineering gates DG0–DG7. No agent grants a real business, Finance or IT approval.
- **Clones.** Never run `git worktree add`; use a `git clone` under `$TMPDIR` if you need a clean copy (D-082).

## Acceptance (your self-check; reviewers verify independently)

1. These commands pass:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm openapi:lint`
2. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.
3. Your migrations apply on a fresh DB and over a P3-populated DB, and the guard probe fires as specified.
4. `pnpm test` passes with the locale unset and with `C.UTF-8`. The integration suite passes on a disposable PostgreSQL: `QA_PG_PORT=<your range> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration`. Report the counts and any pinned-count change.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed suite or timeout in the logs you cite. Never report a check as passed that did not run. A missing tool makes the check BLOCKED.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-ARCH-02-solution-architect.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-ARCH-02-evidence/`. It contains:
- `date -u` at the start and at the end;
- the `validate --historical --stage DG3` result;
- the migration-apply and guard-probe output;
- the check outputs and counts;
- the deliverables, and anything left for a continuation;
- every DG1–DG3 artifact you changed and why, citing D-089;
- what the implementers of your slice must know.
