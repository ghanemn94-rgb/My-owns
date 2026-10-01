# Module implementation guide (read before implementing any module)

This guide is binding for every implementation agent. Reference implementation: `apps/api/src/modules/portfolio/*`
(+ `identity`). Platform code in `apps/api/src/platform/*` is owned by the lead — do not modify it; ask the lead.

## 1. File ownership

| Module | API folder | Contracts | DB schema file | Domain rules | Web routes (under `apps/web/src/app/(app)/projects/[projectId]/`) | i18n namespace |
|---|---|---|---|---|---|---|
| documents | `modules/documents` | `documents.ts` | `documents.ts` | `packages/domain/src/documents.ts` (new) | `documents/` | `documents` |
| governance | `modules/governance` | `governance.ts` | `governance.ts` | `governance.ts` (+ `workflows.ts` DECISION/ACTION machines) | `committee/` | `governance` |
| planning | `modules/planning` | `planning.ts` | `planning.ts` | `schedule.ts`, `measurement.ts`, `workflows.ts` (TASK…) | `plan/`, `raid/`, `workstreams/[id]` tasks tab, `/inbox` | `planning` |
| gates | `modules/gates` | `gates.ts` | `gates.ts` | `gates.ts`, `carveout.ts#computeStatusDimensions` | cockpit gate panels, `gates/` | `gates` |
| carveout | `modules/carveout` | `carveout.ts` | `carveout.ts` (perimeter/transfer/agreement/consent) | `carveout.ts` | `perimeter/` | `carveout` |
| newco | `modules/newco` | `newco.ts` | `carveout.ts#regulatoryRequirement`, `portfolio.ts#legalEntity` (coordinate) | — | `newco/` | `newco` |
| readiness | `modules/readiness` | `readiness.ts` | `carveout.ts` (readiness/cutover/tsa tables) | `carveout.ts` (go/no-go, TSA) | `readiness/` | `readiness` |
| finance | `modules/finance` | `finance.ts` | `finance.ts` | `money.ts` | `finance/` | `finance` |
| jv | `modules/jv` | `jv.ts` | `jv.ts` | `carveout.ts` (closing/partner) | `jv/` | `jv` |
| ai | `modules/ai` | `ai.ts` | `ai.ts` | `ai.ts` | `ai/` | `ai` |
| reporting / imports / integrations / notifications / config | `modules/<m>` | `<m>.ts` | `reporting.ts`, `platform.ts` | — | `reports/`, `/admin` tabs | `<m>` |

Shared files you must NOT edit (lead-owned): `apps/api/src/{app.module,jobs,bootstrap,main,worker}.ts`,
`apps/api/src/platform/**`, `apps/api/src/cli/seed-demo.ts`, `seed-modules.ts`, `packages/contracts/src/{index,route,common}.ts`,
`packages/db/migrations/**`, `packages/db/sql/**`, `packages/domain/src/{index,enums,errors}.ts`, root `package.json`,
`pnpm-lock.yaml`. If you need a change there (new enum value, new shared helper, new permission, new outbox type), put
the exact proposed diff in your final report — the lead applies it. Exception: you MAY add `export * from './<yourfile>';`
lines to `packages/domain/src/index.ts` for new domain files you create (the lead resolves trivial merge conflicts).

Enum values already exist in `packages/domain/src/enums.ts` for all modules — read it first.

## 2. Backend pattern (NestJS)

- **Contract first** (`packages/contracts/src/<module>.ts`): `export const <module>Routes = registerRoutes({ ... defineRoute({...}) })`.
  Every route has `access` = a permission key from `packages/domain/src/policy/policy-matrix.json` (project routes) or
  `{ org: '<perm>' }`. Lists use `PageQuery` + `paged(Item)` and declare their sort keys (`sort: SortParam([...])`, see "List sorting" below). Mutations that change status are **commands**
  (`POST .../:id/<verb>`, `command: true`) with body `{ expectedVersion, note? , ...}`. Generic PATCH routes may only
  change descriptive fields and must never touch `status`/approval fields.
- **Controller**: thin; `@ApiRoute(R.x) handler(@Ctx() ctx, @Input() i: RouteInput<typeof R.x>)` → service.
- **Service methods** (in the request transaction via `DbService.tx()`):
  1. load the target with `loadInProject(db, table, projectId, id)` (404 if not in project),
  2. `policy.assert(ctx, '<perm>', { projectId, classification, roomId, requesterUserId, workstreamId, withinAuthority })`
     — pass every attribute the permission's conditions need (see policy JSON `conditions`). Visibility failures become 404.
  3. validate cross-references are in the same project (composite FKs also enforce this; still check to return 422/404 cleanly),
  4. apply the pure domain rule / state machine from `@hub/domain` (`transition('decision', DECISION_MACHINE, cur, 'submit')`),
  5. write with optimistic concurrency: `updateVersioned(db, table, { id, projectId, expectedVersion }, values)`,
  6. `audit.record({ action: '<perm or verb>', entityType, entityId, projectId, before, after, reason })`,
  7. `outbox.emit({ type, projectId, aggregateType, aggregateId, payload })` when other modules must react,
  8. `recordVersions.snapshot(...)` for versioned business records (perimeter items, agreements, charters, matrices…).
- **Lists**: filter by `projectId` AND visibility (`policy.canSee(ctx, {projectId, classification, roomId})`) *in SQL where
  possible*; totals only over visible rows. Never return titles of invisible rows.
- **Errors**: throw `ruleViolation(code, message, details)` (422), `conflict` (409), `notFound()` (404), `forbidden` (403),
  `invalid` (400) from `@hub/domain`. Never return stack traces.
- Money: decimal strings + currency + unitScale (`MoneySchema`), aggregation only via `sumMoney` (rejects mixed currencies).
- Dates: business dates `YYYY-MM-DD` (project timezone); "today" = `clock.today(project.timezone)` (inject `Clock`).
- Helpers: `apps/api/src/platform/helpers.ts` (`pageOf`, `offsetOf`, `updateVersioned`, `loadInProject`, `nextCode`,
  `activeEvidenceCount`, `RecordVersionService`), `JobQueue`, `OutboxService`, `AuditService`, `PolicyService`, `Clock`.
- Register your controller/providers in your own `<module>.module.ts`; job handlers in `<module>.jobs.ts`; demo scenario
  data in `<module>.seed.ts` (use your services via `args.asUser('<persona>', ctx => svc.method(ctx, ...))`; idempotent;
  every record `isDemo: true` — services should set `isDemo` from `project.isDemo`).

### Outbox events (from `OUTBOX_EVENT_TYPES`)
`task.overdue, source.updated, approval.pending, cp.changed, tsa.expiring, gate.blocked, decision.status_changed,
evidence.changed, perimeter.changed, permission.changed, document.changed, report.generated, baseline.approved,
change_request.decided, readiness.changed, legal_entity.changed, agenda_request.screened` (the last: ids + outcome of a
screening, for the requester's notification in P6). Emit them from your
commands; subscribe in `<module>.jobs.ts` (`registry.subscribe(eventType, jobKind)`; `registry.register(jobKind, handler)`).
Job handlers receive ids only and must open their own context through `JobContextFactory` (never build a principal by
hand): `db.run(jobs.forService(job, 'svc-<module>', ['<permission>', ...]), ...)` — a service principal is **deny-all
except the listed permissions** — or `jobs.forUser(userId, projectId)` for anything user-facing, which re-authorizes the
human principal at execution time and returns `null` when access was revoked (AT-19).

### Cross-module contracts
- Evidence: the documents module owns `evidence_link` writes (`POST /api/v1/projects/:pid/evidence`); other modules read
  counts with `activeEvidenceCount(db, projectId, targetType, targetId)` **for rules** (gates, sign-off, verification: every
  link counts) and with `visibleEvidenceCounts(db, policy, ctx, projectId, targetType, ids)` **for display** (register rows,
  detail views): the same visibility as the evidence list — links to documents above the caller's clearance or in rooms
  they are not granted are not counted (SEC-P1R-05). Reading evidence of a record (list, link commands, document
  counters) requires the target's READ permission (`EVIDENCE_TARGET_READ_PERMISSION` in `@hub/domain`, e.g. `jv.deal.read`
  for a closing condition) plus the target's own visibility (classification, workstream reach); otherwise 404
  (SEC-P1R-04). A new target type needs an entry in both `EVIDENCE_TARGET_PERMISSION` and `EVIDENCE_TARGET_READ_PERMISSION`. Target types used: `gate_criterion`,
  `closing_condition`, `perimeter_item`, `transfer`, `readiness_check`, `tsa_service`, `decision`, `action_item`,
  `task`, `deliverable`, `milestone`, `legal_entity`, `regulatory_requirement`, `agreement`, `benefit`,
  `financial_snapshot`, `post_close_obligation`, `closing_deliverable`.
- Status dimensions: the gates module owns `status_dimension` recomputation (job `gates.recompute_dimensions`, triggered
  by `perimeter.changed`, `evidence.changed`, `cp.changed`, `tsa.expiring`, readiness/closing changes). Other modules just
  emit events.
- Approvals: use the `approval_request` / `approval_record` tables for approvals that are not committee votes (gate decision
  support, waivers, baselines, TSA exit, closing confirmation). Bind to `subjectVersion` + `payloadHash`.
- **Relying on a governance decision** (DOM-P2R-03/-04/-05, QA-P2-01, O-1 — one mechanism for every module). Whenever a
  committee decision backs one of your records (an approval, a closing, a valuation, a budget line…), in the command's
  request transaction:
  1. `loadInProject(db, schema.decision, projectId, decisionId)` + your visibility check (404 outside scope);
  2. `lockDecisionForReliance(db, projectId, decisionId)` (`apps/api/src/modules/governance/decision-reliance.ts`):
     `SELECT … FOR UPDATE` on the decision row, then it re-reads the decision, the CURRENT state of its external-approval
     evidence link and its registered uses — concurrent commands relying on the same decision serialize here;
  3. `assertDecisionReliance` / `decisionRelianceIssue` (`@hub/domain`, `decision-reliance.ts`), in this order: the decision
     is a FINAL approval (within mandate, or a recommendation with the external approval recorded) → the evidence of that
     external approval is still an ACTIVE link VERIFIED by a second person (rejected / superseded / conflicting / unverified →
     `<prefix>.decision_evidence_invalid`) → its type is allowed (`decisionTypeKeys`) → it has not been used for another
     record of the same kind (`<prefix>.decision_already_used`) → it was raised for this record (`subjectRule`: `required`
     — the default for new consumers; `if_set`; `none` when bound otherwise, e.g. by gate key). Codes are
     `<codePrefix>.decision_{not_final,evidence_invalid,type_mismatch,already_used,no_subject,other_subject}`, HTTP 422.
     Your module rules (amount coverage, gate key, authority matrix) come after it;
  4. write your record, then `registerDecisionUse(db, { …, kind, subjectId, codePrefix })`: a `decision_use` row (decision,
     use kind, record), **unique per decision and kind** — one decision backs ONE record of each kind (a G1 decision may back
     the G1 gate cycle and one perimeter version, never two perimeter versions). A unique violation (a caller that skipped the
     lock lost a race) is answered **409** `<prefix>.decision_already_used`. The registry is append-only and its record is
     checked to be of the same project (post-migrate.sql); `onExisting: 'keep'` for a reliance that must not fail when the
     decision is already consumed (a gate REJECTION citing a decision).
  Use kinds registered today (`DECISION_USE_KINDS` → record type): `change_request` → change_request (change-request
  approval), `baseline_version` → baseline_version (baseline approval), `perimeter_version` → perimeter_version (perimeter
  version approval, G1 decision), `gate_cycle` → gate_assessment (gate cycle decision — approve or reject; O-1),
  `closing` → closing (JV closing confirmation, DOM-P4-01), `financial_model_version` → financial_model_version (approved
  valuation / ownership values, DOM-P4-06), `budget_line` → budget_line (approved budget of a line, DOM-P4-07),
  `tsa_service` → tsa_service (TSA terms approval), `tsa_extension` → tsa_service (each recorded TSA extension),
  `cutover_plan` → cutover_plan (the GO of a cutover plan) — the readiness consumers of DOM-P2F-09. A new
  consumer adds its kind and record type to `DECISION_USE_KINDS` / `DECISION_USE_SUBJECT_TYPE` (the record type must be in
  `hub_target_table()`); a paper raised FOR such a record also needs the type in `DECISION_SUBJECT_TYPES` and its open
  states in `DECISION_SUBJECT_OPEN_STATES`. A reliance that does NOT consume the decision (prerequisite satisfaction) calls
  the domain check with `use.kind = null` (final + evidence only). The per-table partial unique indexes
  (`change_request_decision_uq`, `baseline_version_decision_uq`, `perimeter_version_decision_uq`) remain as backstops.

  **P3 / P4 consumers (readiness, JV, finance) use three helpers of the same file**, so every reliance runs the same check:
  `currentDecisionReliance` / `assertCurrentDecisionReliance(db, projectId, decisionRow, rule)` — the check on the
  decision as it is NOW (current external evidence, registered uses), without a lock: the pre-check of a consuming command
  (422 `<prefix>.decision_already_used` for a sequential reuse), a reliance that does not consume the decision, and the
  state shown next to a record; `lockDecisionAndRecheck(db, projectId, decisionId, rule, usesBefore)` — for a consuming
  command, just before its write: the row lock, then the same check again; a use of the same kind for another record that
  was not among the uses read by the pre-check was registered meanwhile by a CONCURRENT command → **409**
  `<prefix>.decision_already_used` (any other issue → 422); then the write and `registerDecisionUse`. `requireFinal: false`
  in the rule links a decision before it is final (a JV confirmation request): evidence, type, uses and subject are checked,
  finality at the confirmation.

  | Reliance | Kind | Subject rule | Code prefix |
  |---|---|---|---|
  | JV closing confirmation (request, confirm) | `closing` | `if_set` | `jv.closing` |
  | JV signing (request, record) — on the decision that approved the current G5 cycle (DOM-P4-02) | none: the signing is part of that G5 approval, whose use is the `gate_cycle` row — no second row | `none` (bound by gate) | `jv.signing` |
  | CP long-stop extension | none (one decision may extend several conditions; never the current extension of the same one again) | `none` | `jv.cp` |
  | Negotiation issue agree / close | none (business-gates.md §8.1, DOM-P4-13) | `none` | `jv.negotiation` |
  | Approved valuation / ownership values of a model version | `financial_model_version` | `if_set` | `finance.model` |
  | Approved budget of a line (+ its stated amount, fail closed: `finance.budget.decision_amount_missing`) | `budget_line` | `none` (a budget decision is raised for the change request / baseline it approves; the line records that approval's amount) | `finance.budget` |
  | Figure / opening-balance approval | none (no kind for figures yet) | `none` | `finance.approval` |
  | TSA terms approval (DOM-P2F-09); a decision already used for another TSA (its terms or its extension) is refused (`tsa.approve.decision_other_tsa`, DOM-P3-13) | `tsa_service` | `if_set` | `tsa.approve` |
  | TSA extension: linked at the request (`requireFinal: false`), consumed when recorded; replaces the former per-TSA check — a decision that authorized an extension of this TSA or another is refused (`tsa.extension.decision_already_used`); a decision used for the terms of ANOTHER TSA is refused (`tsa.extension.decision_other_tsa`, DOM-P3-13, conservative option — governance owner to confirm); once the decision left draft the requested end date / continuity plan are bound to it (`tsa.extension.terms_bound`, DOM-P3-06) | `tsa_extension` (record type `tsa_service`) | `if_set` | `tsa.extension` |
  | GO of a cutover plan: linked (`requireFinal: false`), consumed at the GO; a plan that goes to GO again after a rollback needs a new decision; a NO-GO relies on none | `cutover_plan` | `if_set` | `readiness.go_no_go` |
  | Perimeter version approval (G1 paper) | `perimeter_version` | `required` since DOM-P2F-08 (a G1 paper must name the version it approves) | `perimeter.version` |

  Subject rule `if_set` for closings, model versions, TSAs and cutover plans is the conservative option available today: a
  decision paper cannot yet be raised FOR such a record (`DECISION_SUBJECT_TYPES` has no such type, and the paper form and
  its subject loader belong to governance), so `required` would refuse every existing decision. With `if_set` a decision
  raised for another record never backs them, and the registry binds a decision raised for no record to the first one.
  Moving to `required` = adding the types to `DECISION_SUBJECT_TYPES` / `DECISION_SUBJECT_OPEN_STATES`, the governance
  subject loader and the paper form (open question for the governance owner).

  Records that relied on a decision whose external-approval evidence is later rejected: gate cycles are flagged for
  controlled reassessment by the gates job (DOM-P2R-04); a JV signing / closing (and a negotiation issue) shows the decision
  with `issueCode: evidence_invalid` in its detail (computed on read; the record is never modified). Finance records are not
  flagged yet — the `decision_use` rows (and `approval_decision_id`) identify them for a later generic reassessment job.

### Mandatory patterns added after the P0 architecture review (read carefully)
- **Every submitted id** (path, body, query) is loaded with `loadInProject(db, table, projectId, id)` before use — the DB
  also enforces composite FKs and the polymorphic same-project trigger (allowed polymorphic target types are listed in
  `hub_target_table()` in `packages/db/sql/post-migrate.sql`; ask the lead to add a type).
- **Lists and counts** must use `policy.visibilitySql(ctx, projectId, { classification: table.classification, room: table.roomId })`
  in the WHERE clause (room-only principals — clean team / external partner — see only their rooms).
- **Responses must match the route's `response` schema exactly** — in test mode a mismatch fails with
  `500 contract.response_mismatch` (ResponseContractInterceptor). Return plain JSON (ISO strings for dates).
- **Jobs:** use `JobContextFactory` — `forService(job, 'svc-<module>', [permissions...])` for maintenance (explicit
  permission allowlist), `forUser(userId, projectId)` for anything user-facing (returns null if access was revoked → skip
  and record). Long jobs call `queue.extendLease(job, ms)`. External deliveries go through `DeliveryService`.
- Denied/rejected mutations are audited automatically by the problem filter; do not swallow domain errors.
- **One writer of a project's gate state at a time:** every gate command, the gate evaluation refresh, the gate waiver
  application and the gates worker job take the transaction-scoped advisory lock `hub_gates:<projectId>`
  (`GatesService.lockProjectGates`) BEFORE they read the gate bundle and before their first `gate_assessment` /
  `criterion_assessment` write. A command writes its own cycle row and then refreshes every gate's cached evaluation in
  gate order; without the lock it and the worker's refresh could lock the same rows in opposite orders (PostgreSQL
  "deadlock detected" → 409 `db.serialization_failure`). A new gate write path must take the lock first; reads do not.
  Regression: `apps/api/test/gates/gate-lock-order.spec.ts`.
- **One writer of a project's Day-1 readiness state at a time (DOM-P3-03):** the GO, the execution record and every command
  that changes a gating input of a GO (check creation / instantiation, test run, sign-off, determination, reopen, waiver
  application, re-binding, the plan's site change, the `evidence.changed` reaction) take the transaction-scoped advisory lock
  `hub_readiness:<projectId>` (`ReadinessSupport.lockReadiness`) FIRST, before they read the checks. Lock order:
  `hub_readiness` → decision row (`lockDecisionAndRecheck`). TSA commands do not take it. A new command that changes what a
  GO evaluates must take it. Regression: `apps/api/test/reviews/p3-domain-readiness-race.spec.ts`.
- **One recompute of a project's status dimensions at a time (DOM-P3-14):** `StatusDimensionsService.recomputeDimensions`
  takes the transaction-scoped advisory lock `hub_dimensions:<projectId>` before it reads its inputs, so a recompute with an
  older snapshot never commits last and no `record_version` row is dropped. It is taken last (after any module lock of the
  calling command). Regression: `apps/api/test/gates/p3-dimension-lock.spec.ts`.
- **Evidence a rule relied on (DOM-P3-08, DOM-P3-09, DOM-P34R-06):** a record verified, signed off or accepted on evidence
  reacts to `evidence.changed` (service-principal job with an explicit permission allowlist — access-matrix §9): a readiness
  check passed on evidence that is no longer active returns to `in_progress` and flags the GOs it gated, and a TSA
  replacement acceptance whose evidence is no longer valid is withdrawn (`readiness.check_evidence_changed` job); a
  confirmed incorporation returns to "proposed" verification (`newco.incorporation_evidence_changed`); a verified transfer
  aspect returns to `in_progress` through `reject_evidence` (`carveout.transfer_evidence_changed`, system entry with a null
  `recorded_by`). The rules that read these records fail closed meanwhile (GO evaluation, status dimension). History is
  kept; the change is audited. A new consumer of evidence follows the same pattern.
- **The decision a record relied on carries its terms (DOM-P34R-04):** when a decision authorizes specific values of a
  record (e.g. a TSA extension's end date and continuity plan), bind those values to the DECISION (a per-decision row, here
  `tsa_extension_terms`) — never only to the record's current link, which the requester can switch through another
  decision.
- **Workstream-scoped reach:** when a list or count is structured by workstream, filter it with
  `policy.reachSql(ctx, '<permission>', projectId, table.workstreamId)` — a workstream-only role (e.g. a lead without a
  project role) sees only its workstreams; `policy.permissionReach(...)` tells you whether the grant is project-wide.
- **Raw SQL inside a request** goes through `db.query(text, params)` (runs on the request transaction) or `db.tx()`;
  never `db.pool` (that is autocommit, outside the RLS context and outside the atomic change + audit + outbox unit).
  Do not keep a `tx` handle beyond the request: it throws once the transaction has finished.
- **Response contracts are strict:** fields not declared in the route's `response` schema are stripped in every mode
  and fail tests (`contract.response_mismatch: undeclared field(s) …`). Declare what the screen needs; nothing more.
- **List sorting is an allow-list (QA-P1-13):** every list route declares its sort keys in its contract —
  `PageQuery.extend({ sort: SortParam(['code', 'title', 'dueDate', 'updatedAt']) })` accepts `key` (ascending) and
  `-key` (descending) and rejects anything else with 400 `validation_failed`. A list without a meaningful order
  (relevance ranking, audit feed) declares none (`sort: NoSort`, the `PageQuery` default) and rejects every `sort`.
  The service maps each key to its column(s) with `orderBySort(q.sort, { code: T.code, … }, T.id, defaultOrder)`
  (`apps/api/src/platform/sort.ts`; the compiler requires every declared key): NULLs last, the row id in the same
  direction as tiebreaker, `defaultOrder` when no sort is given. Only the ORDER BY changes — never the WHERE clause,
  so scope, visibility, reach and totals are unaffected. `packages/contracts/src/sort.test.ts` checks every list route.
- **Bilingual server strings (QA-P1-14, REQ-UX-001/002):** the API returns both languages and the web picks by locale;
  the server never selects a language for data and never machine-translates.
  - *Bilingual data* (template-seeded names/titles, bilingual user input): `<field>` = English/primary text,
    `<field>Ar: string | null` = Arabic text (null when there is no Arabic source). Examples: `name`/`nameAr`
    (templates, gates, workstreams, phases, next gate), `title`/`titleAr` (tasks, milestones, deliverables, schedule
    nodes, readiness checks), `description`/`descriptionAr` (criteria), `purpose`/`purposeAr` (gates — from the pinned
    template version while the stored purpose is still the template's). Web: `useLocalized()` / `localized(locale, x, xAr)`
    from `apps/web/src/lib/i18n-data.ts`; with no Arabic text the primary text is shown as-is.
  - *Server-computed explanations*: the rule returns codes + parameters (`ServerMessage { code, params }`, see
    `packages/domain/src/messages.ts`) and renders the English sentence from the same messages with its code → English
    template table (e.g. `DIMENSION_MESSAGES_EN`, `GATE_MESSAGES_EN`). The API returns `<field>` (English — kept for
    audit rows, record history, AI context) plus `<field>I18n: ServerMessage[]` (e.g. `explanation`/`explanationI18n`,
    `message`/`messageI18n`, `blocker`/`blockerI18n`). Parameters are numbers, record keys or enum values (the web
    translates enum values; register them in `ENUM_PARAMS` of `i18n-data.ts`, business dates in `DATE_PARAMS`). Web:
    `useServerMessages()(xI18n, x)` translates `<namespace>.messages.<code>` (en + ar; `serverMessageKey`): `plan.*`
    codes (`PLANNING_MESSAGES_EN`) → `planning.messages`, `authority.*` (`AUTHORITY_MESSAGES_EN`) →
    `governance.messages`, every other code → `gates.messages` (finance uses its own `finance.messages`);
    `node apps/web/scripts/check-i18n.mjs` fails when a domain code has no translation, when placeholders differ, when the
    catalogue keeps a stale code, or when a code uses another catalogue's prefix. Adding a code = domain template +
    en/ar catalogue entry in the same change. The English UI text may be worded for the UI; it need not repeat the
    server's sentence (QA-P2-04).
  - *Lists mixing record kinds* (e.g. My Work): `<field>Ar` is present only for items whose record has a bilingual field
    (null when that record has no Arabic); free text typed by a user carries no `<field>Ar` and is shown as entered.
    Server-composed titles carry `<field>I18n`. On screens, free text typed by a user (e.g. a decision title) may be marked
    `data-user-text`; never template or server text.
  - *Refusals*: every refusal code a module raises should have a translated explanation in `apps/web/src/lib/refusals.ts`
    (the server's English detail is still shown next to it). For the gates module this is checked by `check-i18n.mjs`.

- **Separation of duties and authority fail CLOSED (I-R3).** For a permission with `not_self`, pass the subject's
  requester / submitter / recorder id; a missing (undefined or null) id is **403 `policy.sod_subject_unknown`** — nobody
  may approve a record whose requester is unknown. For a permission with `authority`, pass `withinAuthority` explicitly
  (`true` only when the authority is the role grant itself, with the reason at the call site); `undefined` is 403
  `policy.authority_unknown`. `NO_HUMAN_REQUESTER` (from `@hub/domain`) states that NO human requester exists — only when
  the data proves it (a system-generated escalation; a criterion reviewed with no evidence linked). Approvals check in the
  order **role → state → separation of duties** with `policy.assertApproval(ctx, perm, res, () => transition(...))`, so a
  command in the wrong state is still 422; pre-checks before a per-subject loop use `policy.assertGranted` (never the only
  check of an approval).
- **Activity feed visibility (SEC-P1-03, SEC-P1R-02):** an event is listed only when the caller can see the record itself.
  `apps/api/src/platform/record-visibility.ts` (`RecordVisibility`) holds one rule per entity type — own classification /
  room, visibility INHERITED from the parent (meeting / agenda item / membership / authority matrix → committee; action /
  escalation → decision; source claim → source record; document version → document; evidence link → document + target;
  AI proposal / approval request / waiver / RAG override → target) and, for non-auditors, the workstream reach of the
  type's read permission. **A new audited entity type whose visibility is not just its type permission must get a rule
  there** (and an entry in `ACTIVITY_ENTITY_PERMISSION` to appear for non-auditors).
- **Shared legal entities have ONE owning project (SEC-P1R-03).** `legal_entity` is organization-level and can be linked
  to several projects (`project_entity`). Only the project that created it (`legal_entity.owner_project_id`, set by
  `LegalEntitiesService.create` / project creation, immutable) changes it: descriptive edits (`PATCH …/legal-entities/:id`),
  incorporation record / verify and the setup-wizard NewCo step. Linked projects read it (`ownedByThisProject: false`) and
  get **403 `newco.legal_entity.not_owner`** for those commands (the owning project is not named). The database enforces
  the same rule (restrictive RLS on UPDATE for full members of the owner; owner column immutable). Each change in the owning
  project emits `legal_entity.changed` once per OTHER linked project (ids via the SECURITY DEFINER function
  `hub_legal_entity_linked_projects`, callable by owner members only): the NewCo job records
  `newco.legal_entity.changed_in_owning_project` in that project's activity (ids, change kind, version — no notes or
  people) and the gates job recomputes its status dimensions. Apply the same single-writer model to any future
  organization-level record shared by projects.

### Conventions the DATABASE enforces (post-migrate.sql — your tests will fail if you ignore them)
- `project_id` and `org_id` are **immutable** after insert (`immutable_scope`). Moving a record between projects is a
  re-create command, never an UPDATE.
- A uuid column named `*_user_id` or `*_by` **is a user reference**: it automatically gets a composite FK
  `(org_id, col) → app_user(org_id, id)`. Tests must use real user ids (e.g. `demoUserId('pm')`), not random uuids.
  Name record references `*_id` (e.g. `superseded_by_id` is a record, `superseded_by` would be treated as a user).
- Every `(org_id, project_id)` must match the project's organization (composite FK to `project(org_id, id)`).
- Avoid id lists (jsonb / uuid[]); use a child table with composite FKs. If unavoidable, ask the lead to register the
  column in section 16 of `post-migrate.sql` (every element must be a same-project record).
- `document.current_version_id` must be a version of the same document (deferred check at COMMIT, so insert order
  inside one transaction does not matter).
- `vote.user_id` must be the user of `vote.membership_id`, and the membership must belong to the decision's committee.
- Room-only principals (clean team / external partner) see only their own `project_membership` and `room_grant` rows
  and can never write grants; full membership is required to administer rooms.
- An account holding internal roles or grants cannot be switched to `account_type = 'external'` (I-R1): revoke them first.
- `legal_entity.owner_project_id` is immutable; only full members of the owning project UPDATE a legal entity (SEC-P1R-03).
- Service / non-person accounts (`is_service_account`) never hold an interactive session: `hub_auth_session` reports them
  inactive and OIDC login refuses them (`oidc.service_account`, I-R5).

## 3. Database changes
Edit only your schema file. For local testing run, in your worktree:
`pnpm --filter @hub/db build && (cd packages/db && rm -rf migrations/* && npx drizzle-kit generate --name initial_schema)`
— this regenerates the single pre-release migration (no production database exists yet). The lead regenerates it again on
merge; conflicts in `packages/db/migrations/**` are resolved by regeneration, never by hand-editing.
RLS applies automatically to any new table with `project_id` (see `packages/db/sql/post-migrate.sql`).

## 4. Tests (evidence)
- Integration tests: `apps/api/test/<module>/*.spec.ts`; acceptance tests named `at-XX-<slug>.spec.ts` with the AT id and
  REQ ids in the `describe` title. Use `test/helpers.ts` (`loginAs('<persona>')`, `owner()`, `runtimePool()`,
  `projectIdByCode(DC)`). Personas: see `DEMO_USERS` in `apps/api/src/cli/seed-demo.ts` (`pm`, `sponsor`, `chair`,
  `secretary`, `finance`, `legal`, `approver`, `tech.lead`, `ops.lead`, `contributor`, `auditor`, `portfolio.admin`,
  `platform.admin`, `pm.b`, `contributor.b`, `cleanteam`, `partner.alpha`).
- Use YOUR OWN test database so parallel agents don't collide: `createdb` is done by the lead —
  `TEST_DATABASE_URL=postgres://hub_app:hub_dev_only@127.0.0.1:5432/hub_test_<module>` and
  `TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:hub_dev_only@127.0.0.1:5432/hub_test_<module>`.
  Run: `cd apps/api && TEST_DATABASE_URL=... TEST_DATABASE_MIGRATION_URL=... pnpm test` (builds, resets that DB, seeds, runs).
- Unit tests for pure rules: `packages/domain/src/<file>.test.ts` (`cd packages/domain && npx vitest run`).
- Tests must fail if the rule is removed (assert the server rejects the bypass, check the DB state didn't change, check
  an audit row with outcome `denied`/`rejected` exists for rejected mutations).
- Never weaken an assertion to pass; report defects.

## 5. Web pattern (after the web foundation lands)
See `docs/user-guide/web-foundation-notes.md` and existing pages. Use `api(route, {...})` from `apps/web/src/lib/api.ts`,
shared components from `apps/web/src/components`, i18n namespace `<module>` in both `en` and `ar`, `DemoBadge`,
`StatusBadge`, `VerificationBadge`, `RestrictedState`, `ActivityHistory`, `ConfirmCommandDialog` (sends
`expectedVersion`). Hide actions the user lacks permission for (`useProjectPermissions(projectId)`), but rely on the
server. No fake data: sections without a backend show `NotImplementedYet`.

## 6. Definition of done (per feature)
Contract → service with policy/validation/rules/tx/audit/outbox → controller → unit + integration tests (incl. negative
paths) → demo seed scenario → web screen with loading/empty/error/restricted states and bilingual text → OpenAPI builds
(`cd apps/api && npx tsc -p tsconfig.build.json && node dist/cli/openapi.js /tmp/openapi.json`) → report with real test
output and requirement IDs covered.
