# Assignment T-DG4-ARCH-01: P4 architecture, slice(s) I + C (solution-architect)

## Stage and base

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING), on branch `claude/mobily-transformation-platform-regate`, at the current `HEAD`.
- **Preceding gate:** DG3 is APPROVED. Before anything else, run `node tools/gates/validate.mjs --historical --stage DG3` and report the result. It must exit 0.
- **The plan is binding:**
  - `docs/architecture/p4-plan.md` (T-DG4-ARCH-00), adopted by **D-089**;
  - the orchestrator's decisions on its open questions and reopen candidates, which are in D-089 in `docs/delivery/decisions.md`. Read D-088 and D-089 verbatim.
- **You run alone on the shared contract files** (p4-plan §5.3). Implementer runs may be active in their own git worktrees, but they do not touch your files.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
- **Your harness ports are 23700–23749 only.**

## Your slice (p4-plan §4, row T-DG4-ARCH-01)

- **Slices:** I + C. Read p4-plan §1.1 and §1.2 for their rows, §2 for the dependencies, and §3 for the seams.
- **ADRs:** ADR-0025 business calendar, time semantics (observation period / business date / event timestamp), scheduled-job kit, work items and in-app inbox; ADR-0026 groups and role mapping, delegation management and loop guard, the P4 Approval record (outcomes, SoD, stale 409, timer escalation), T11 decision rights and SLA types, T12 RACI per transformation
- **Migration range:** 0028–0032. Write from the low end. The numbers you leave free are for your slice's implementers, in the order your work-split section names.
- **OpenAPI area:** `calendar`, `tasks` (My Work items, inbox), `groups`, `role-mappings`, `delegations`, `approvals`, `decision-rights`, `raci` (≈ 42)
- **Advisory-lock classes:** 730224 delegation graph (per organization); 730225 RACI deliverable (one accountable); 730226 approval subject (per subject record); 730227 reserved

## Requirements in scope (19 rows, final gate DG4)

Their `acceptance` texts in `docs/delivery/requirements.csv` are binding, and reviewers test them literally. Where a row cites a later-stage A-test, it is judged on its own acceptance text (D-089 R4).

- **REQ-S10-006** (-): Use an Asia/Riyadh default business calendar with configurable workweek, holidays and working-day SLAs, never hardcoding public holidays or using elapsed days where working days are specified
- **REQ-S12-005** (-): Starter automation: when a reporting period opens or an update is due, create owner tasks and in-app reminders with direct links
- **REQ-S15-008** (-): Default the timezone to Asia/Riyadh and the currency to SAR, both configurable; store timestamps consistently and distinguish observation period, business date and event timestamp
- **REQ-S16-005** (-): Provide a durable database-backed worker and scheduler, adding a separate queue service only if justified and included in the self-hosted package
- **REQ-PB-008** (-): Apply 'Operating model before execution': decision rights, ownership and cross-functional ways of working are explicit before execution
- **REQ-PB-065** (T11): Implement Template 11 Decision Rights Matrix with the four seeded source rows
- **REQ-PB-066** (T11): Compute T11 SLAs by type: working days, next forum or release plan
- **REQ-PB-067** (T12): Implement Template 12 RACI with the six seeded deliverables and R/A/C/I values including A/R
- **REQ-S10-003** (-): Never make technical administrators business approvers automatically
- **REQ-S10-007** (-): Preserve the source RACI as a configurable starting point per transformation
- **REQ-S10-008** (-): Map roles to named people or governed groups
- **REQ-S10-009** (-): Require one accountable assignment per deliverable unless a documented governance rule permits otherwise
- **REQ-S10-010** (-): Support authorized delegation with effective dates, absence handling and preserved audit identity, never creating approval loops
- **REQ-S10-014** (-): Record for every approval the assignee, request version, due date, rationale, comments and decision timestamp
- **REQ-S10-016** (-): Enforce separation of duties so a requester cannot approve their own request when policy prohibits it
- **REQ-S10-017** (-): Reject stale approvals when the submitted record version has changed
- **REQ-S10-018** (-): Distinguish approval, rejection, request changes and deferral as separate outcomes
- **REQ-S10-019** (-): Let timers escalate overdue approvals but never approve automatically
- **REQ-S16-011** (-): Implement the identity and access entity group: Organization, BusinessUnit, User, Group, Role, Permission, ScopedAssignment, Delegation

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

Write `docs/delivery/handbacks/DG4/T-DG4-ARCH-01-solution-architect.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-ARCH-01-evidence/`. It contains:
- `date -u` at the start and at the end;
- the `validate --historical --stage DG3` result;
- the migration-apply and guard-probe output;
- the check outputs and counts;
- the deliverables, and anything left for a continuation;
- every DG1–DG3 artifact you changed and why, citing D-089;
- what the implementers of your slice must know.
