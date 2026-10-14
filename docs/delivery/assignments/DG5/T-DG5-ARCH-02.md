# Assignment T-DG5-ARCH-02: P5 architecture, slice(s) B + C (solution-architect)

## Stage and base

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING), on branch `claude/mobily-transformation-platform-regate`, at the current `HEAD`.
- **Preceding gate:** DG4 is APPROVED. Before anything else, run `node tools/gates/validate.mjs --historical --stage DG4` and report the result. It must exit 0.
- **The plan is binding:**
  - `docs/architecture/p5-plan.md` (T-DG5-ARCH-00), adopted by **D-142**;
  - the orchestrator's decisions on its open questions Q1–Q12 and reopen candidates, which are in D-142 in `docs/delivery/decisions.md`. Read D-141 and D-142 verbatim.
- **You run alone on the shared contract files** (p5-plan §5.3). T-DG5-BE-A (slice A: the module registry, `ConfigResolver` and every P5 route and worker stub, p5-work-split §A.1) runs at the same time in its own worktree and does not touch your files. Name in your work-split section the stubs and registrations your slices need from it.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
- **Your harness ports are 23700–23749 only.**

## Your slice (p5-plan §4, row T-DG5-ARCH-02)

- **Slices:** B + C. Read p5-plan §1.1 and §1.2 for their rows, §2 for the dependencies, §3 for the seams and §6 for the risks.
- **ADRs:** ADR-0041 form schema versions: the eleven field types and their server-side validation (percentage as fraction, currency as decimal + code, calculated via the DG3 engine unchanged), extension fields, protected source columns, custom-field validation on every register write, the common form framework (drafts, version history, comments, attachments, export, bulk edit, recoverable conflict), the twelve extension record types and badges; ADR-0042 procedures: definition (all M0152 parts, ordered/conditional/parallel steps, validation of trigger and completion), instance (pinned version, current step, assignee, due date, missing inputs, evidence, next action), outputs as linked records, the ten seeded procedures, the S01-003 coverage view, the S16-015 entity group
- **Migration range:** 0068–0073. Write from the low end. The numbers you leave free are for your slice's implementers, in the order your work-split section names.
- **OpenAPI area:** `admin/form-schemas` (+ fields, publish via ARCH-01), `{register}/versions`, `/comments`, `/attachments`, `/export`, `/bulk`; `procedure-definitions` (+ validate, publish), `procedure-instances` (+ launch, steps complete/skip, cancel), `admin/coverage` (≈ 40)
- **Advisory-lock classes:** 730254 procedure instance step (per instance); 730255 form record comment thread (per record) only if the ADR shows a need; 730256–730257 reserved

## Requirements in scope (10 rows, final gate DG5)

Their `acceptance` texts in `docs/delivery/requirements.csv` are binding, and reviewers test them literally. Where a row cites a later-stage A-test, it is judged on its own acceptance text (p5-plan R1, D-142). Read each row's `increments` and `notes`: earlier increments (P1–P4) may already deliver part of it.

- **REQ-S05-001** (-): Give every native template form inline help, validation, draft saving, version history, comments, attachments, permissions, bulk editing where suitable and export
- **REQ-S05-002** (-): Allow extension fields on templates without deleting or changing the meaning of any source column
- **REQ-S05-006** (-): Provide the native operating records added for execution, labelled as extensions where the source gives no full template
- **REQ-S06-005** (-): Support Studio field types text, rich text, number, currency, percentage, date, reference, attachment, lookup, choice and calculated value
- **REQ-S16-010** (-): Use typed relational tables for core entities and validated metadata/JSON structures for extensible custom fields and versioned forms, never one unvalidated JSON blob
- **REQ-S01-003** (-): Convert the playbook operating system into connected executable workflows from input through procedure, validation, approval, output, monitoring and correction to sustainment
- **REQ-S06-001** (-): Define procedures with purpose, trigger, scope, prerequisites, inputs and input schema, ordered/conditional/parallel steps, responsible roles, SLA, validation rules, approval path, escalation path, expected outputs, completion conditions, exceptions and version/effective date
- **REQ-S06-002** (-): Create a persistent procedure instance on launch showing current step, assignee, due date, missing inputs, completed evidence and next action, whose outputs are real linked records
- **REQ-S06-003** (-): Seed configurable procedures for new transformation intake, baseline validation, KPI submission, TOM approval, initiative prioritization, gate review, scope/target change, benefit validation, executive escalation and BAU handover
- **REQ-S16-015** (-): Implement the target operating model and procedures entity group: TOMDimension, TOMCanvas, Capability, Gap, Journey, Process, ProcedureDefinition, ProcedureInstance

## Inputs

- **The master prompt** (`docs/source/master-prompt-v2.0.md`, with the anchors in `master-prompt.anchored.md`): the sections p5-plan cites for your slices.
- **The playbook** (`docs/source/playbook.md`): the template blocks for your slices. Cite `B0xxx`.
- **What exists:**
  - ADR-0001 to ADR-0038 with their dated amendments, plus the P5 ADRs already written;
  - migrations `0001`→ latest;
  - the erd and the data dictionary;
  - `openapi.yaml`;
  - `apps/api/src/modules/**`;
  - `packages/shared/src/{calc.ts,formula/**}`;
  - p4-plan, p4-work-split, p5-plan, and p5-work-split if it exists.

## Deliverables, in this order

The critical path is deliverables 1–3. If you pass about 100 minutes, finish the current file, make the tree typecheck, and write the handback, listing exactly what remains for a continuation task. Never leave a half-written file.

1. **ADRs.** Write them in the existing Context / Decision / Alternatives / Consequences / Verification format. Every claim must be **enumerated and exactly true, never absolute** (D-088 §2, D-141; F-DG3-100). Where a design point has a source text, quote it, and cite the master-prompt anchors `M0xxx` and the playbook blocks `B0xxx`. For each requirement in scope, the ADR must name:
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
   - Update `packages/db/src/schema.ts` (Kysely), the catalogue and seed test pins, and `packages/shared/src/permissions.ts` (`P5_PERMISSIONS`; technical-admin roles never get business-approval rights, S10-003).
   - Register your advisory-lock classes in `apps/api/src/modules/platform/advisory-locks.ts` and the ADR-0016 §6 registry, and keep the distinct-classes test green.
3. **Probe (real output, in the handback).** On a disposable PostgreSQL (`tests/qa/support/with-pg.sh`, your port range):
   - apply `0001`→ your last migration to an empty DB, and also over a DB populated by `0001`–`0061`;
   - prove that each new guard fires: missing audit fails at COMMIT, a non-stepping version fails, UPDATE/DELETE on history fails, and every database invariant your ADR claims holds.
4. **ERD and data dictionary.** Extend `docs/architecture/erd.md` and `data-dictionary.md` with every new table, matching the migrations exactly.
5. **Contract.** Extend `docs/api/openapi.yaml` (OpenAPI 3.1) with your slice's operations.
   - Set `info.version` to `1.4.0-p5`.
   - Keep every P1–P4 path byte-stable except the extensions D-142 accepts.
   - Every operation declares the ADR-0007 §5b statuses, its request media type (= the route's future `config.consumes`), problem+json, `If-Match`/ETag and cursor pagination.
   - Add your operations to a new `apps/api/test/support/p5-pending-<your task>.ts` list, so `contract.test.ts` stays green until the implementers route them (the P3/P4 `p*-pending-*` precedent). Update `contract.test.ts`'s pins only as that pattern requires, and report the new counts.
   - `pnpm openapi:lint` must pass.
6. **Permissions matrix and work split.**
   - Add your entities' rights to `docs/analysis/permissions-matrix.md`, with AUD read-only everywhere.
   - Write your slice's section of `docs/architecture/p5-work-split.md`, following `p4-work-split.md` and p5-plan §5. Include:
     - the implementer tasks for your slice, each sized at about 60–75 minutes;
     - exact, non-overlapping file ownership;
     - the contracts each task consumes;
     - the integration order;
     - a requirement → owner table for your rows.
   - If the file does not exist yet, create it with the shared rules section (§2, the numbered DG2–DG4 lessons below) and your slice's section.

## Lessons from DG2–DG4 that P5 builds in (state them as implementer rules)

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
9. **The formula engine** (`packages/shared/src/formula/**`) is reused unchanged. Any change to it is a reopen candidate.
10. **Exactly once.** Jobs and automations use the advisory-lock registry, unique backstops and idempotency keys; a replay creates nothing (DG4 S12-021 pattern).
11. **Value bases are never mixed** (D-117, D-119, D-122), and every number states its unit kind (ADR-0037 N5).
12. **User-facing text is true for the release it ships in** (F-DG4-160): when a P5 feature ships, the texts that called it planned are updated; texts for P6/P7 features stay.
13. **Tests are deterministic under load** (F-DG4-143 to F-DG4-148) and never read growing delivery folders (D-138).

## Environment and constraints

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`. Run offline. Never run `playwright install`.
- **The write guard forbids editing:**
  - `tools/gates/**`, `tools/agents/**` and `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `stages.json` and `findings.json`;
  - `trading_agent/`.
- **No dependencies, secrets or CDNs.** Add no dependency without an orchestrator decision; a dependency you need goes in your handback with its official documentation, support window and licence (D-142 Q8). No secrets and no public CDNs.
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
2. `node tools/gates/validate.mjs --historical --stage DG4` exits 0.
3. Your migrations apply on a fresh DB and over a P4-populated DB, and the guard probe fires as specified.
4. `pnpm test` passes with the locale unset and with `C.UTF-8`. The integration suite passes on a disposable PostgreSQL: `QA_PG_PORT=<your range> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration`. Report the counts and any pinned-count change.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed suite or timeout in the logs you cite. Never report a check as passed that did not run. A missing tool makes the check BLOCKED.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-ARCH-02-solution-architect.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-ARCH-02-evidence/`. It contains:
- `date -u` at the start and at the end;
- the `validate --historical --stage DG4` result;
- the migration-apply and guard-probe output;
- the check outputs and counts;
- the deliverables, and anything left for a continuation;
- every DG1–DG4 artifact you changed and why, citing D-142;
- what the implementers of your slice must know.
