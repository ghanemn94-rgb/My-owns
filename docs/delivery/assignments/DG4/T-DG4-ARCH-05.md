# Assignment T-DG4-ARCH-05: P4 architecture, slice(s) D (solution-architect)

## Stage and base

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING), on branch `claude/mobily-transformation-platform-regate`, at the current `HEAD`.
- **Preceding gate:** DG3 is APPROVED. Before anything else, run `node tools/gates/validate.mjs --historical --stage DG3` and report the result. It must exit 0.
- **The plan is binding:**
  - `docs/architecture/p4-plan.md` (T-DG4-ARCH-00), adopted by **D-089**;
  - the orchestrator's decisions on its open questions and reopen candidates, which are in D-089 in `docs/delivery/decisions.md`. Read D-088 and D-089 verbatim.
- **You run alone on the shared contract files** (p4-plan §5.3). T-DG4-BE-B, T-DG4-KBE-B and T-DG4-KBE-D run in their own git worktrees, and none touches your files. Slices I+C, A, B and E are integrated (D-090 to D-093), and so are BE-A and KBE-A. `0028`–`0043` are used, so your range starts at `0044` and must stay contiguous. ADR-0031 §5.4 fixes the escalation and corrective payloads; reuse its conventions.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
- **Your harness ports are 23700–23749 only.**

## Your slice (p4-plan §4, row T-DG4-ARCH-05)

- **Slices:** D. Read p4-plan §1.1 and §1.2 for their rows, §2 for the dependencies, and §3 for the seams.
- **ADRs:** ADR-0032 forums (five layers seeded verbatim), meeting series and recurrence (future-only regeneration), meetings, agenda items with the executive-ask fields, attendance and quorum, minutes (immutable once published), meeting action links, T16 executive decision log, SLA escalation (`S12-011`), blocker-red cycle escalation (`PB-082`)
- **Migration range:** 0044–0046. Write from the low end. The numbers you leave free are for your slice's implementers, in the order your work-split section names.
- **OpenAPI area:** `forums`, `meeting-series`, `meetings`, `agenda-items` (+ publish), `attendance`, `minutes` (+ approve, publish), `executive-decisions` (T16; + record outcome), `escalations` (≈ 36)
- **Advisory-lock classes:** 730238 meeting series generation (per series); 730239 executive ask (per blocker source); 730240 decision escalation (per decision); 730241 reserved

## Requirements in scope (10 rows, final gate DG4)

Their `acceptance` texts in `docs/delivery/requirements.csv` are binding, and reviewers test them literally. Where a row cites a later-stage A-test, it is judged on its own acceptance text (D-089 R4).

- **REQ-PB-060** (-): Seed the five transformation operating system layers with cadence, purpose, participants and outputs
- **REQ-PB-061** (-): Produce each forum's source outputs as native meeting records
- **REQ-PB-068** (T16): Enforce the governance rule: escalate decisions, not status
- **REQ-PB-081** (T16): Implement Template 16 Executive Decision Log as a native register
- **REQ-PB-082** (T16): Apply the escalation principle: a blocker red for multiple cycles requires a named decision, owner and deadline
- **REQ-S10-005** (-): Make forum recurrence, participants, cut-off dates and agenda rules configurable
- **REQ-S10-011** (-): Provide the in-app committee workflow: draft agenda, gather linked decision briefs, review materials, record attendance/quorum where configured, record decisions, approve/publish minutes, assign actions and monitor closure
- **REQ-S10-012** (-): Require executive asks to state decision, why now, options, recommendation, delay impact, decision owner and required date
- **REQ-S12-011** (-): Starter automation: when a decision SLA expires, escalate to the next configured authority and show the delay impact
- **REQ-S16-019** (-): Implement the governance forums and meetings entity group: Forum, Meeting, AgendaItem, Attendance, Minutes, MeetingActionLink

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

Write `docs/delivery/handbacks/DG4/T-DG4-ARCH-05-solution-architect.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-ARCH-05-evidence/`. It contains:
- `date -u` at the start and at the end;
- the `validate --historical --stage DG3` result;
- the migration-apply and guard-probe output;
- the check outputs and counts;
- the deliverables, and anything left for a continuation;
- every DG1–DG3 artifact you changed and why, citing D-089;
- what the implementers of your slice must know.
