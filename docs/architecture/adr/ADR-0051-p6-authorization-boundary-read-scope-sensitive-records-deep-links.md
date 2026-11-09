# ADR-0051: The P6 authorization boundary: one `ReadScope` derived from the ADR-0006 policy, sensitive records and explicit grants, notification deep links with re-authorization and title redaction, evidence authorization after ownership transfer, and the S02-006 route-inventory sweep

- **Status:** Proposed for P6 (DG6). Author: solution-architect (T-DG6-ARCH-01), 2026-10-26. Amended 2026-11-04 (T-DG6-ARCH-14), 2026-11-06 (T-DG6-ARCH-15), 2026-11-08 (T-DG6-ARCH-16) and 2026-11-09 (T-DG6-ARCH-17); see the amendments at the end.
- **Requirements (slice E of `docs/architecture/p6-plan.md`):** REQ-S02-006, REQ-S10-002, REQ-S10-004, REQ-S12-024, REQ-S13-013.
- **Sources (quoted where a design point has one):**
  - M0090 (§2) "All required controls must work against persisted server-side data. … A navigation shell, static dashboard, clickable mockup or browser-local data store does not meet completion criteria."
  - M0188 (§10) "Access is scoped by organization, business unit, transformation and sensitive record where needed. Job title alone must not grant access across all transformations. Technical administrators do not automatically become business approvers. Enforce permissions on the server for records, files, APIs, exports, search and AI retrieval."
  - M0241 (§12) "… Deep links must enforce access."
  - M0255 (§13) "… Preserve evidence access after ownership transfer and apply the same authorization to downloads and previews as to the parent record."
  - M0330 (§16) "Generated exports and search indexes must enforce the same scopes as record views."
  - Playbook: B0124 (benefits are sustained "after transition to the business", the reason ownership transfers at BAU handover). The playbook names no access model; every rule below is an engineering default, configurable as data where stated, and not a Mobily-approved access policy.
- **Decisions applied:** D-195 (Q3 sensitive records; Q2 short-lived evidence links belong to ADR-0053/0054; Q13 enforcement in the application, no PostgreSQL RLS; reopen candidates: inbox title redaction accepted as stated in p6-plan §3 row 6), D-193, D-088 §2, D-141, F-DG3-100, F-DG4-160.
- **Builds on:** ADR-0002 (modules), ADR-0004 (audit), ADR-0006 (the single policy function, `scopeFilter`, 404/403 rule), ADR-0007 (problem bodies, If-Match), ADR-0010 (evidence through the API only), ADR-0016 (guards, lock registry), ADR-0020 (record-level rules), ADR-0025 (inbox), ADR-0034 (BAU handover).
- **Physical model:** `0098_p6_sensitive_records_deep_links.sql`, `0100_p6_access_hardening_permissions.sql`. The guard probe (`docs/delivery/handbacks/DG6/T-DG6-ARCH-01-evidence/probe-output.txt`) tests this ADR's database claims in groups G (apply), RS (sensitivity), GR (grants), DL (deep links), PM (seeds) and LK (locks).
- **Two gate systems.** Nothing here reads or writes DG0–DG7. A sensitive-record grant is an access decision, never a business approval (G1–G6), and no technical-admin role gains a business-approval permission.

## Context

1. `access/policy.ts` is the single decision point (`authorize`, `requireRead`, `requireAction`) and already compiles the same grant rules into SQL (`scopeFilter`, ADR-0006). Lists in P1–P5 call `scopeFilter`; record views call `requireRead`/`requireTransformationRead`. There is no type that bundles "the rows this principal may read" for the paths P6 adds (search, assistant retrieval, job reads), and nothing proves the SQL and per-record forms agree.
2. No sensitivity flag or grant exists in `0001`–`0097` (p6-plan §1.2, REQ-S10-002).
3. `inbox_notification` (`0028`) stores `link_path`, `message_key` and `message_params`; `/api/v1/me/inbox` returns them unchanged whether or not the recipient can still read the target. No resolver re-authorizes a link (REQ-S12-024).
4. Evidence download (`GET …/evidence/{evidenceId}/content`) requires `transformation.read` and answers 404 otherwise (ADR-0006 response rule). No test reads evidence after a BAU handover (REQ-S13-013).
5. Every stage's A08/A12 suites call the API directly, but no sweep proves that **every** mutating operation of the contract rejects an unauthenticated, an unauthorized and an invalid call (REQ-S02-006).

## Decision

### 1. `ReadScope`: one read boundary derived from the policy (REQ-S10-004)

**Module and file:** `apps/api/src/modules/access/read-scope.ts` (owner BE-B), exported through `access/index.ts`. `access` imports none of its consumers (p6-plan §2).

```ts
export interface ReadScopeColumns {
  readonly recordType: SensitiveRecordType | null; // null: a type that cannot be sensitive
  readonly recordId: Expression<string>;
  readonly organizationId: Expression<string>;
  readonly businessUnitId?: Expression<string | null>;
  readonly transformationId: Expression<string | null>;
  readonly partyUserIds?: readonly Expression<string | null>[]; // §2 "named parties" of the row
}
export interface ReadScope {
  /** SQL predicate for list, search, export and retrieval queries. */
  predicate(cols: ReadScopeColumns): Expression<SqlBool>;
  /** The same decision for a row already in memory (non-SQL paths: search hits, retrieval chunks, job outputs). */
  admits(row: { recordType: SensitiveRecordType | null; recordId: string; target: ResolvedTarget; partyUserIds: readonly (string | null)[] }): boolean;
}
export async function readScopeFor(db: DbOrTx, principal: Principal, permission: Permission): Promise<ReadScope>;
```

- `predicate` = `scopeFilter(principal, permission, cols)` (unchanged ADR-0006 function) **AND** the sensitivity clause of §2. `admits` = `decide(principal, permission, target).allowed` (unchanged `rules.ts`) **AND** the same sensitivity clause evaluated in memory.
- `readScopeFor` loads, once per request (never cached across requests, as ADR-0006 requires of grants), the principal's ACTIVE `sensitive_record_grant` rows. A revocation applies to the next request.
- Record views keep calling `requireRead` unchanged. A record view of a sensitive record type additionally calls `requireSensitiveRead(db, principal, recordType, recordId, target, parties)` (§2), which answers 404 like any unreadable record.
- **Callers (by construction, the same scopes as record views):** search (ADR-0057, `search/query.ts`), assistant retrieval (ADR-0059, through search), report and export selection (`reporting/exports/jobs.ts`: BE-B2 adds the `ReadScope` line, as `p6-work-split.md` §E/F.3 assigns it; corrected 2026-10-30, T-DG6-ARCH-07), job and connector reads under a service identity (ADR-0053, BE-J). A path that reads business records for a principal and uses neither `requireRead` nor `ReadScope` is a defect that the BE-B parity test and the route-inventory sweep (§5) are designed to find.
- **Parity test (BE-B, `access/read-scope.test.ts` unit plus `apps/api/test/integration/access/read-scope-parity.test.ts`):** for a fixture of at least 2 organizations, 3 business units (one nested), 3 transformations, the 14 seeded roles at organization, business-unit and transformation scope, and benefits, business cases and evidence items each in a sensitive and a non-sensitive state, with grants active and revoked: for every (reader, record) pair, `predicate` selects the row **iff** `admits` returns true **iff** the record's GET returns 200. The test prints the pair count; a mismatch lists the pair.

### 2. Sensitive records and explicit grants (REQ-S10-002)

**Which types (D-195 Q3):** `benefit`, `business_case`, `evidence`. The closed set is a CHECK on both tables and in `p6_sensitive_record_ref_guard()` (probe RS09, GR14). Another type needs a migration and an ADR amendment.

**Entity `record_sensitivity`** (`0098`; mutable, P2 guards, audited; probe RS01–RS18). Fields: `id`, `organization_id`, `transformation_id`, `record_type`, `record_id` (the marked record; must exist in that transformation: `record_sensitivity_record_ref`; immutable: `record_sensitivity_record_immutable`), `is_sensitive` boolean, `reason` (3–1000 characters, free-text rules), `version`, created/updated stamps. One row per record (`record_sensitivity_record_key`). No row means **not sensitive**, so every DG1–DG5 record and response is unchanged until someone marks a record (probe G04). Unmarking is an UPDATE to `is_sensitive = false`, never a DELETE (mth_app has no DELETE: RS14).

**History `record_sensitivity_change`** (append-only; written only by the `SECURITY DEFINER` trigger `record_sensitivity_history` on every insert and update; mth_app has SELECT only; UPDATE/DELETE/TRUNCATE raise even for the owner: RS02, RS08, RS15–RS18). Fields: the head row's id, organization, transformation, record type and id, `record_version`, `is_sensitive`, `reason`, `changed_by`, `changed_at`.

**Entity `sensitive_record_grant`** (`0098`; mutable, P2 guards, audited; probe GR01–GR14). Fields: `id`, `organization_id`, `transformation_id`, `record_type`, `record_id` (must exist), `grantee_user_id`, `reason` (3–1000), `status`, `revoked_at`, `revoked_by`, `revoke_reason` (3–1000; all three set exactly when revoked: `sensitive_record_grant_revoke_complete`), `version`, stamps.

**State machine** (trigger `sensitive_record_grant_guard`): a grant is inserted `active` (`sensitive_record_grant_transition`, GR03); `active → revoked` is the only transition; `revoked` is terminal (GR11). The record, grantee and reason never change (`sensitive_record_grant_immutable`, GR08). At most one active grant per record and grantee (`sensitive_record_grant_one_active_key`, GR02); after a revocation a new grant is a new row (GR12). Nobody grants to themselves (`sensitive_record_grant_not_self`, GR04). A grant may exist for a record that is not (yet) sensitive; it then changes nothing.

**Who reads a sensitive record (the sensitivity clause).** A principal who passes the ADR-0006 read check for the record's transformation is admitted to a record whose `record_sensitivity.is_sensitive` is true **iff** at least one of:
1. the principal holds an ACTIVE `sensitive_record_grant` for that record;
2. the principal is a **named party** of the record. The parties are exactly: for `benefit`, `owner_user_id`, `finance_validator_user_id`, `created_by`; for `business_case`, `benefit_owner_user_id`, `initiative_owner_user_id`, `finance_validator_user_id`, `created_by`; for `evidence`, `owner_user_id`, `created_by`;
3. the principal holds `sensitive_record.grant` at the record's transformation scope (§7; the people who decide grants can see what they grant).

Service principals are admitted only through their declared scope (ADR-0053); a service identity holds no `sensitive_record.grant` and is no named party, so a job never reads a sensitive record unless ADR-0053 declares an explicit exception for that job code. Holding AUD does **not** admit by itself (AUD is read-only but not a named party); a TO can grant an auditor (configurable default, stated so the business can change it).

**Effect on reads.**
- Record GET of a sensitive record the principal is not admitted to: **404** `not_found` (existence not disclosed; ADR-0006).
- Lists, search, exports, assistant retrieval: the row is absent (`ReadScope.predicate`).
- Evidence of a sensitive parent: §4.
- **An open record that references a restricted record** never names its id (D-218), and a write that names one answers as an unknown id. The read, re-save and write rules, D-219's three exclusions and the reference inventory are in the amendment of 2026-11-08 (added by T-DG6-ARCH-16).
- **Totals and rollups (D-195 Q3, decided by the user):** an aggregate that includes a sensitive record's value is computed exactly as in DG4 (identical for every user; decimal arithmetic unchanged; **no DG4 reopen**). When a reader is not admitted to at least one sensitive record whose value the aggregate includes, the response carries `includesRestrictedRecords: true` and the screen shows the label **"Includes restricted records"** / **"يشمل سجلات مقيدة"** (Arabic provisional, i18n key `access.includesRestrictedRecords`). The record and its individual value are never shown. When the reader is admitted to all of them, the field is `false` and no label is shown. When none of them is sensitive, the field is **absent** and the response is unchanged byte for byte (corrected 2026-11-06, T-DG6-ARCH-15: the text said `false`; the shipped code and the contract omit the field, so every DG4/DG5 response stays identical until a record is marked). Which DG4/DG5 aggregate responses gain the optional field is BE-B2's inventory (p6-work-split §E/F.3) (the benefit totals of `benefits/**` and the dashboard totals of `reporting/dashboards/**` at minimum); each is an additive optional property, recorded by the orchestrator in the contract (an implementer's contract need goes in its handback, p6-plan §5.3). The shipped list is in "Which responses carry `includesRestrictedRecords`" below. Unknown and n/a stay Unknown and n/a; the label never turns an Unknown into a number.

**Which responses carry `includesRestrictedRecords` (as shipped; T-DG6-BE-B2, T-DG6-BE-Z7, T-DG6-BE-Z7B; F-DG6-340, F-DG6-360, F-DG6-361; recorded 2026-11-06, T-DG6-ARCH-15).** Each is an optional boolean, additive to the contract:

| Response (OpenAPI schema; operation) | When it is present | Owning ADR of the response |
|---|---|---|
| `BenefitTotals` (`getBenefitTotals`) | an included benefit or business case is sensitive | ADR-0030 (benefit totals) |
| `TransformationDashboard`, `WorkstreamDashboard` | a benefit or business case of the dashboard's facts is sensitive, or an entry was removed (below) | ADR-0037 §2 |
| `FinanceDashboard` | a benefit or business case of the dashboard's facts is sensitive (it lists no items, so nothing is removed) | ADR-0037 §2, N2 |
| `ExecutiveOverview` (`getExecutiveOverview`; T-DG6-BE-Z7B) | the same | ADR-0037 §8 (amendment of 2026-11-06) |
| `DashboardDrilldown` (`getDashboardDrilldown`) | the same | ADR-0037 §5 |
| every section of `ReportDocument`: live report, snapshot GET and the generate, issue, discard and reissue bodies (T-DG6-BE-Z7B, T-DG6-BE-Z9) | the section references a marked-sensitive record through a row, an item or a source, **or its aggregate figures include one** (the executive pack's `metrics_<subject>`, the executive dashboard's `area_value` and `items_portfolio`, the gate pack's `criteria`; corrected 2026-11-08, T-DG6-ARCH-16: see the amendment of that date) | ADR-0045 §3 (amendments of 2026-11-06 and 2026-11-08) |

`AdoptionDashboard` filters its items through the same rule but has no such member. Its items are adoption KPIs, which are never a sensitive record type or a child of one, so no item can be removed today (T-DG6-BE-Z7B §7 item 3). A change that lets an adoption item be restricted must add the member in the same change.

**Totals that are the same for every reader (as shipped).** These are computed from the same facts for every reader, exactly as in DG4/DG5:
- the headlines and area statuses of every dashboard and of the Executive Overview;
- the overview's `transformations[]` rows;
- the drill-down's `value` and `calculation.expression`, `ruleKey` and `rounding`;
- `BenefitTotals`;
- the table totals and metrics of every report section.

Only the listed entries differ between readers. The flag is decided from the assembled content, before anything is omitted. It is `true` whenever the reader is not admitted to at least one included sensitive record, **and** whenever the shared rule removed an entry (`restrictedFieldAfter`, `apps/api/src/modules/reporting/dashboards/restricted.ts`). A reader who lost an entry is therefore never told that nothing was restricted (absent or `false`). That covers, for example, a sensitive evidence item of an open benefit. A report section is read-time only: the assemblers never set the member, so stored content and `contentSha256` are unchanged (`apps/api/src/modules/reporting/reports/restricted.ts` `documentForReader`). For a report section, "included" also covers the records its aggregate figures include without naming them (T-DG6-BE-Z9; the aggregate flag rule in the amendment of 2026-11-08).

**The drill-down rule (as shipped; T-DG6-BE-Z7, T-DG6-BE-Z7B; F-DG6-361).** `getDashboardDrilldown` treats every metric and value class the same way:
- **What is filtered.** Its `items`, `calculation.inputs` and `evidence` go through `withoutRestrictedRefs`.
- **The order of the checks.** The first check uses the dashboard facts' own records: a benefit, a business case, a business-case line, and every value line keyed by its table and id (`benefit_measurement` and `benefit_plan_value`). Every remaining reference then goes through the shared `SENSITIVE_CHILD_SOURCES` rule (amendment of 2026-11-04). An unknown item type is never passed by default.
- **Evidence entries.** An evidence entry is checked both as its line and as its evidence item. It is removed when **any** of its references is restricted.
- **Pagination.** Items are filtered **before** the offset pagination. A page therefore never counts a hidden item, unlike the list filter of the amendment of 2026-11-04.
- **A restricted benefit as `subjectId`** is refused with 422 `dashboard.metric_subject_mismatch` at `/subjectId`, the same answer as a subject outside the scope (ADR-0037 §13). Its existence is not disclosed.
- **Response field.** `includesRestrictedRecords` follows the flag rule above.

The Executive Overview, the transformation, workstream and adoption dashboards filter their area items through the same function (`withoutRestrictedItems`).

**Refusals (exact codes and English texts; i18n en/ar keys under `problems.`):**

| Status | Code | English text |
|---|---|---|
| 422 | `sensitive_grant.not_self` | "You cannot grant access to yourself." |
| 422 | `sensitive_grant.grantee_not_in_organization` | "The person you grant access to must be a user of the record's organization." |
| 409 | `sensitive_grant.duplicate` | "This person already has an active grant for this record." |
| 422 | `invalid_transition` | "Only an active grant can be revoked." |
| 422 | `sensitivity.reason_required` | "Give a reason of 3 to 1000 characters." |
| 404 | `not_found` | (standard) a record, grant or transformation the caller cannot read |
| 403 | `forbidden` | (standard) the caller can read the record but lacks `sensitive_record.grant` |

**Codes added after this table was pinned (T-DG6-ARCH-07, 2026-10-30).** The web catalogue tests read the rows above verbatim and pin their number, so later codes are listed here instead of as rows. Folding them into the table is for the owner of those tests. Each code below is emitted by the shipped API, and its en/ar texts are in the web catalogue (Arabic provisional):
- `export.includes_restricted_records` (403): "This report includes records you cannot see, so it cannot be exported for you." Answered when an export selection would include a record the caller is not admitted to (D-199; T-DG6-BE-B2; `reporting/exports/jobs.ts`).


**Operations** (contract, `docs/api/openapi.yaml` tag `access`; owner BE-B):
- `getRecordSensitivity` `GET /api/v1/transformations/{transformationId}/records/{recordType}/{recordId}/sensitivity`: the record must be readable (else 404); returns `isSensitive`, `reason`, `version` (`ETag "0"` when no row), `updatedAt`, and `canManage`.
- `putRecordSensitivity` `PUT` same path, `IfMatchOrZero` (`"0"` creates the row), body `{isSensitive, reason}`; `sensitive_record.grant` on the transformation; one audit event `record_sensitivity.marked` / `record_sensitivity.unmarked` with prior and new version.
- `listSensitiveGrants` `GET /api/v1/admin/sensitive-grants?transformationId=&recordType=&recordId=&granteeUserId=&status=&cursor=&limit=` (`sensitive_record.read` on the transformation; `transformationId` required).
- `createSensitiveGrant` `POST /api/v1/admin/sensitive-grants` body `{transformationId, recordType, recordId, granteeUserId, reason}`; `sensitive_record.grant`; 201 with `ETag "1"`; audit `sensitive_record_grant.granted`.
- `getSensitiveGrant` `GET /api/v1/admin/sensitive-grants/{grantId}`.
- `revokeSensitiveGrant` `POST /api/v1/admin/sensitive-grants/{grantId}/revoke`, `IfMatch`, body `{reason}`; audit `sensitive_record_grant.revoked`.

A grant response shows the record's title only when the caller can read the record (§1); otherwise `recordTitle` is `null` and `recordTitleRedacted` is `true`.

### 3. Deep links: re-authorization and title redaction (REQ-S12-024)

**Token** (`0098`, columns on `inbox_notification`): `link_token` (43 base64url characters = 32 random bytes from `crypto.randomBytes`; unique: `inbox_notification_link_token_key`; format CHECK), `target_record_type`, `target_record_id` (both or neither: `inbox_notification_target_pair`). Each is set once and never changed (`inbox_notification_deep_link_guard`; probe DL01–DL07). The P4/P5 writers keep working unchanged (the columns are nullable). At `HEAD` seven code sites insert notifications (`apps/api/src/modules/tasks/service.ts`, and in `apps/worker/src/`: `kit.ts`, `automation/actions/notify.ts`, `handlers/{digests,escalations,gates,meetings}.ts`); **none of them is edited for deep links.** Instead a token is issued **lazily**, only when a link must leave the in-app inbox (a channel send of ADR-0054 calls BE-C's `issueDeepLink`; a GET never writes), under advisory lock 730301: one UPDATE that sets `link_token` and, when `deepLinkTarget(link_path)` (BE-C, `tasks/deep-links.ts`, a pure function over the known record route patterns) recognizes a benefit, business case or evidence route, `target_record_type`/`target_record_id`; version step and audit event `inbox_notification.link_issued`. A concurrent second issuer waits on the lock and then reads the token already set.

**The token is an opaque identifier, never a credential.** Holding it grants nothing: every resolution re-authorizes the signed-in caller against the target. This is why a forwarded link is safe.

**Resolver** `resolveDeepLink` `GET /api/v1/links/{token}` (session required; tag `tasks`; owner BE-C):
- unknown token: **404** `not_found`;
- the caller cannot read the target now (no transformation read, or a sensitive record without admission, or the target no longer exists): **403** with code `deep_link.forbidden` and English text **"You do not have access to this item."** (ar provisional "ليست لديك صلاحية الوصول إلى هذا العنصر."). The body never contains the record title, type, id, transformation name or the notification's `messageParams`; it is byte-identical for every forbidden token (the test compares bodies minus `requestId`);
- otherwise **200** `{ linkPath, recordType, recordId }`; the web route `/l/{token}` navigates to `linkPath`, whose own API calls re-check access again.
- Being the recipient is neither required nor sufficient: a colleague with read access resolves a forwarded link; the original recipient who lost access gets 403.

**Inbox redaction** (`listMyInbox`, `GET /api/v1/me/inbox`, and `markInboxNotificationRead`; DG4 response **content** change accepted by D-195; the shape gains one optional member, below): for each item, the server re-checks the recipient's read access to the item's target. The target is `target_record_*` when set, else `deepLinkTarget(link_path)` computed at read time (nothing is written by the GET), else the item's `transformation_id` with `transformation.read`; an item with none of these is organization-level and is never redacted. The in-app inbox keeps navigating by `linkPath`; every page it opens re-checks access through its own API calls. **As shipped (corrected 2026-11-09, T-DG6-ARCH-17; D-226, D-227 (3); the earlier text said "shape unchanged", "`linkPath` … unchanged" and "exactly `messageKey` and `messageParams`"):** an item is restricted when the recipient cannot read the target now, **or** when any id in its link, its `messageParams` or its stored target names a sensitive record or a `SENSITIVE_CHILD_SOURCES` child (a Finance validation, a benefit overlap, a measurement, a corrective case, …) the recipient is not admitted to, **or** an action whose corrective case is such a record, **or** the work item it announces is restricted (`restrictedNotifications`, `tasks/deep-links.ts`; one decision). A restricted item is returned with `messageKey` = `inbox.restricted`, `messageParams` = `{}`, `linkPath` = the transformation home `/transformations/<transformationId>` (else `/my-work`) and `includesRestrictedRecords: true`; `id`, `readAt`, `createdAt`, `version`, `transformationId` and `workItemId` are unchanged (they are ids, not content). Fields redacted: `messageKey`, `messageParams` and `linkPath`. `markInboxNotificationRead` returns the same redaction. Text: **"You no longer have access to this item."** / ar provisional **"لم تعد لديك صلاحية الوصول إلى هذا العنصر."** The stored row is never modified by redaction (it is a read-time rule; access restored = text and link restored). **Channels (corrected 2026-11-09; D-227 (2)):** a channel message of ADR-0054 never carries `messageParams` content. For a recipient who may read the target it carries the token link `/links/<token>` (re-authorized on open). For a restricted recipient it carries the `inbox.restricted` text, no parameter and the transformation home link (else `/my-work`), and **no token is issued**. The earlier text said the adapters "send only the token link and a neutral subject". See the amendment of 2026-11-09.

### 4. Evidence authorization, including after ownership transfer (REQ-S13-013)

**Rule (one function, `evidence/access.ts` `requireEvidenceRead`, owner BE-C):** a caller may read an evidence item's metadata, download its content and preview it **iff**:
1. ADR-0006 read on the evidence's transformation (`transformation.read`), **and**
2. the evidence item itself passes the §2 sensitivity clause, **and**
3. every **sensitive** parent record the item is linked to passes the §2 sensitivity clause. "Linked" means every row in the evidence-link tables of `0001`–`0103` that names this evidence item and a `benefit` or `business_case` (BE-C enumerates the tables with `grep -l evidence_id packages/db/migrations/*.sql` and records the list in its handback; as of `0097` the polymorphic `evidence_link` (`0012`) cannot name a benefit or business case, so the tables are the type-specific link tables).

Download, preview and metadata use this single function, so they can never disagree (M0255 "the same authorization to downloads and previews as to the parent record").

**Ownership transfer.** No rule above reads `evidence.owner_user_id`, `created_by` or the uploader except as a §2 named party of a **sensitive** item, and no rule requires the previous owner to keep access. A BAU handover (ADR-0034) changes who owns the performance area and its records; the new owner reads the evidence through their own assignment at the transformation (and, for a sensitive item, through a grant or named-party role on the record now naming them). BE-C's integration test proves it: (a) seed a transformation with file evidence linked to a benefit; (b) complete and accept a BAU handover to a new owner holding a BO assignment on the transformation; (c) the new owner downloads and previews: 200; (d) a user with no assignment on the transformation: refused; (e) mark the evidence sensitive and repeat (c) with and without a grant. If (c) fails on the DG2–DG5 code, BE-C fixes it in `evidence/routes.ts` (read lines) and reports it as a P6 finding.

**403 or 404 for an outsider (decided: D-196 item 1, Option A; the text below records the question as raised).** A caller without `transformation.read` keeps the DG2-approved 404 (non-disclosure). An in-scope caller without admission to the parent record, or to a sensitive item, gets 403 `evidence.parent_forbidden`. The contract declares that 403 on `downloadEvidenceContent` and `getEvidence` (T-DG6-BE-X1). For a sensitive evidence item itself (rule 2), the metadata GET keeps the 404 of §2, while the download answers 403; the allow-or-deny decision is the same function (T-DG6-BE-C §5 item 4). REQ-S13-013's acceptance says "a user without access to the parent gets **403** on the evidence download URL". The DG2-approved route answers **404** to a caller without `transformation.read` (ADR-0006 "no read permission on a specific record gives 404"), which the A12 suites assert. This ADR therefore states:
- a caller who **can** read the transformation but is not admitted to a sensitive item or sensitive parent gets **403** `evidence.parent_forbidden` "You do not have access to the record this evidence belongs to." (new behaviour, additive: sensitivity is new);
- a caller who **cannot** read the transformation keeps the DG2 **404** until the orchestrator decides. Option A (recommended): keep 404 and record that the acceptance's "403" is met for the in-scope reader without the parent's grant, with 404 for the out-of-scope reader as ADR-0006's non-disclosure form of the same refusal. Option B: answer 403 for every unreadable content/preview call, including for evidence ids that do not exist (so existence is still not disclosed); this changes a DG2-approved response (404 → 403) and is a DG2 reopen. **This is raised to the orchestrator in the handback; BE-C does not change the outsider status before the decision.**

### 5. The S02-006 route-inventory sweep (REQ-S02-006)

**Test** `apps/api/test/integration/hardening/route-inventory.test.ts` (owner BE-C). For **every** operation in `docs/api/openapi.yaml` whose method is POST, PUT, PATCH or DELETE, excluding exactly the operations in the `p2-pending.ts` aggregate (not yet routed), the one public unsafe operation `devLogin` (session bootstrap, ADR-0005; it checks `Origin` itself and exists only with `AUTH_MODE=dev`), and, from ADR-0056, the signature-authenticated webhook receivers (their own signature sweep). `logout` is not public and is swept like every other mutation. At `HEAD` the routes declared `{ public: true }` are exactly `startOidcLogin`, `completeOidcLogin` (both GET), `devLogin`, `getHealth` and `getReadiness`:
1. **unauthenticated** (no session cookie): 401 `unauthenticated`;
2. **CSRF** (session, no `X-CSRF-Token`): 403 `csrf`;
3. **unauthorized** (a session of a synthetic user with no assignment in the target organization, valid CSRF): 403 `forbidden` or 404 `not_found`, never 2xx;
4. **invalid input** (an authorized session, a body or parameter that violates the contract schema, generated from the operation's request schema: a missing required property, or for a body-less operation a malformed path id): 400 with the uniform problem body (`ValidationError`), never 2xx and never 500.

Each case asserts that **no row changed**: the count of `audit_event` rows other than `authorization.denied` failure records is identical before and after (ADR-0004 failed-mutation audit is allowed), so a rejected call provably persisted nothing. The test prints the operation count per case and fails if any eligible operation is skipped. The second half of the acceptance ("clearing browser storage loses no submitted business data") is proven by ADR-0057's server-side drafts (H) and by QA-D's e2e; this sweep does not claim it.

### 6. Concurrency and locks

- 730300 `sensitiveRecordGrant`, key `"<recordType>:<recordId>"`: taken by the API around mark/unmark, grant and revoke, and by the triggers `record_sensitivity_guard` and `sensitive_record_grant_guard` (probe LK01). The unique keys `record_sensitivity_record_key` and `sensitive_record_grant_one_active_key` are the backstops: a concurrent duplicate is 409, never a second row.
- 730301 `deepLinkIssue`, key `"<notificationId>"`: the lazy token issue (§3); taken by `inbox_notification_deep_link_guard` when a token is set; `inbox_notification_link_token_key` is the backstop.
- 730302–730304: reserved for this block, never allocated elsewhere.
- Every mutation: commit-time re-authorization (the permission is re-checked inside the transaction after the row lock), If-Match (409/428), one audit event with prior and new version, no remote I/O inside the transaction.

### 7. Authorization summary (permissions matrix rows; `0100`)

| Action | Permission | Seeded roles | AUD |
|---|---|---|---|
| Read a record's sensitivity flag | the record's read | anyone who reads the record | read (if the record is readable) |
| Mark or unmark; grant; revoke | `sensitive_record.grant` (configure) | TO, ADM_ACCESS | none |
| List grants and flags (metadata) | `sensitive_record.read` (read) | TO, AUD, ADM_ACCESS | read |
| Resolve a deep link | session + the target's read | everyone signed in | same rule |

`sensitive_record.grant` and `sensitive_record.read` join `STRUCTURAL_PERMISSIONS` (`access/rules.ts`, BE-B's line), like `access.assign`: an ADM_ACCESS organization-level assignment applies to the organization's transformations for these two codes only. This does **not** give ADM_ACCESS `transformation.read`, so an access administrator manages grants by record id and sees titles only where §2 shows them. No code is `business_approval` or `finance_validation`; the 0001 trigger still refuses any approval code for a technical-admin role (probe PM04). Job title never grants anything: every admission above is an assignment, a grant or a named field on the record (REQ-S10-002).

### 8. Decimal and Unknown semantics

None of these entities holds money, a rate or a KPI value. The rollup rule of §2 changes no number: totals stay the DG4 decimal sums, and an Unknown/Stale/n/a value stays labelled as such (never 0, never green), with or without the restricted-records label.

## Alternatives

- **PostgreSQL row-level security** for sensitivity. Rejected for P6 (D-195 Q13): it would touch every DG1–DG5 table and the pooled connection model (ADR-0006 Alternatives).
- **A sensitivity column on each of the three tables.** Rejected: every flag change would step the business record's version and audit it as a record edit, changing DG4/DG5 version histories; a separate table keeps the records untouched (probe G04: the benefit stays at version 1).
- **Hiding sensitive values from totals per user.** Rejected by the user (D-195 Q3): totals would differ per user and reopen DG4.
- **A signed or expiring token as the access credential.** Rejected: a token that grants access is dangerous when forwarded; an opaque id plus re-authorization meets "deep links must enforce access" with no secret to leak.

## Consequences

- Three engines (search, assistant, jobs) depend on `access/read-scope.ts`; BE-B lands first (W3) and the parity test is the gate for BE-J and BE-P.
- Inbox items of users who lost access change their text (accepted, D-195). The stored rows are unchanged.
- The open 403/404 question of §4 must be decided before BE-C (W4).
- `includesRestrictedRecords` adds an optional property to some DG4/DG5 aggregate schemas: the orchestrator merges each from BE-B's handback.

## Verification

- **Database (this task):** probe groups G00–G04, RS01–RS18, GR01–GR14, DL01–DL07, PM01–PM04, LK01: 70/70 PASS together with ADR-0052's groups (`probe-output.txt`).
- **Catalogue and seeds:** `packages/db/test/integration/catalogue.test.ts` (trigger list, mutable-table list, privileges), `packages/db/src/seed.test.ts` (0100 equals `P6_ACCESS_HARDENING_*`).
- **Implementers:** BE-B parity test (§1) and rollup label tests; BE-C deep-link tests (forwarded link 403 without title; redacted inbox item; restored access), post-handover evidence test (§4), route-inventory sweep (§5); QA-B A12 extension (search, export, evidence URL, deep link, sensitive benefit hidden from a workstream member without the grant).
- No third-party dependency is added by this ADR.

## Amendment (2026-11-04, T-DG6-ARCH-14): §2, the records that carry a sensitive record's values (sweep after T-DG6-BE-Z1)

**Why.** §2 says that a sensitive record a principal is not admitted to is absent from lists, search, exports and assistant retrieval. It does not say how that extends to the rows that **carry** such a record's values (its children). This ADR does not enumerate them. The shipped rule is recorded here so that the ADR states it, and the enumeration stays in one place in the code.

**The rule as shipped:**

- **Where it lives.** `apps/api/src/modules/access/sensitive-reach.ts` (T-DG6-BE-Y1: F-DG6-121/122/123; T-DG6-BE-Z1: F-DG6-180), constant `SENSITIVE_CHILD_SOURCES`, which is authoritative.
- **What it lists.** Each record type (the audit `record_type`, which is the table name) whose rows hold a sensitive record's values, and how its sensitive owner(s) are found. There are three kinds of source:
  - `column`: the row names its owner(s) in a column. Examples are `benefit_overlap` (two benefits) and `benefit_evidence` (a benefit and an evidence item).
  - `pair`: the row names a `(record type or form code, record id)` pair. Examples are the form sub-resources and the sensitivity and grant rows. The form attachment also names its evidence.
  - `via`: the row names no owner, but rows of another table name it. Its owners are the owners of those referencing rows. T-DG6-BE-Z1 adds the first such source: `benefit_calculation`, referenced by `benefit_measurement.benefit_calculation_id`, owned by that measurement's `benefit_id`. A stand-alone T09 calculation that no measurement references has no owner and stays listed.
- **When a row is restricted.** It is restricted when **any** of its owners is sensitive and the principal is not admitted by the §2 clause.
- **Effects on reads:**
  - A route whose path names a restricted child answers 404 (`registerSensitiveReachGuard`, `requireRecordReach`).
  - Lists leave the row out (`restrictedRecordRefs`, `withoutRestricted`). This includes `listBenefitCalculations` since T-DG6-BE-Z1.
  - Both audit routes redact the row's events.
- **Pagination.** As in the overlap list (T-DG6-BE-Y1), the list filter runs after pagination. A page can hold fewer than `limit` items while `nextCursor` is set. No count or total of hidden rows is returned.
- **Unresolved owners fail closed.** An unresolved owner (a deleted child, an unknown form code) is resolved from the audit `changes`. If it cannot be resolved, the row is treated as restricted whenever its transformation holds a sensitive record of the owner type that the principal is not admitted to.
- **Adding a table.** A new table that carries a sensitive record's value must be added to `SENSITIVE_CHILD_SOURCES` in the same change. Reviewers check this against the migrations' foreign keys, as in the BE-Z1 sweep.

**Checked against the code.** The integrated `HEAD` `561565123` agrees with this rule. No contradiction with §2 was found.

Nothing else in this ADR changes. This is an engineering design record: it grants no business, Finance or IT approval (G1–G6), and it implies no DG0–DG7 result.

## Amendment (2026-11-06, T-DG6-ARCH-15): §2, restricted records in the Executive Overview, the drill-down and report sections (sweep after T-DG6-BE-Z7B)

**Why.** T-DG6-BE-Z7B (F-DG6-360, F-DG6-361 High; F-DG6-340, F-DG6-362 Medium) shipped three things that §2 did not enumerate:
- the restricted-records flag on the Executive Overview and on every report section;
- totals that are the same for every reader on those surfaces;
- a drill-down filter that covers every metric.

The round-5 ADR sweep records them here so the ADR states the shipped rule.

**What changed in §2 ("Effect on reads", "Totals and rollups"):**
- **A correction.** When none of the included records is sensitive, the field is **absent**, not `false`. The earlier text said `false`. The shipped code (`benefits/restricted.ts` `restrictedField`, `reporting/dashboards/restricted.ts`, `reporting/reports/restricted.ts`) and the contract descriptions ("Present when …") omit it. This keeps every DG4/DG5 response byte-identical until a record is marked (probe G04). The text now matches the code. No code changes.
- **New paragraph "Which responses carry `includesRestrictedRecords`":** the six response schemas plus every `ReportDocument` section, each with its owning ADR. It also records that `AdoptionDashboard` filters but has no member, and why.
- **New paragraph "Totals that are the same for every reader".** It lists the figures that never differ between readers, and the flag rule: `true` also whenever the shared rule removed an entry (`restrictedFieldAfter`).
- **New paragraph "The drill-down rule".** It covers:
  - every metric and value class, and the three lists that are filtered;
  - the facts' own lines first, then `SENSITIVE_CHILD_SOURCES`;
  - the evidence entry checked twice;
  - filtering before pagination;
  - a restricted `subjectId` refused like an out-of-scope subject.

**Contract.** Two additive optional members, both already in `docs/api/openapi.yaml` (1.5.0-p6) and the zod mirrors by T-DG6-BE-Z7B:
- `ExecutiveOverview.includesRestrictedRecords` (`packages/shared/src/schemas/dashboards.ts` `executiveOverview`);
- the read-time section member `includesRestrictedRecords` on every `ReportDocument` section (`packages/shared/src/schemas/report.ts` `sectionBase`). In OpenAPI it is documented in the `ReportDocument.sections` description, because the section items are open `type: object`.

They are recorded in the ADRs that own those responses: ADR-0037 (amendment of 2026-11-06) and ADR-0045 (amendment of 2026-11-06). Neither is a breaking change, and no gate needs reopening.

**Checked against the code** at the integrated `HEAD` `a600bf63b` by the solution-architect. The code agrees with the text above, with no contradiction found. The code checked:
- `apps/api/src/modules/reporting/executive-overview.ts`;
- `reporting/dashboards/restricted.ts`, `drilldown.ts`, `transformation.ts`, `workstream.ts`, `adoption.ts` and `finance.ts`;
- `reporting/reports/restricted.ts`;
- `access/sensitive-reach.ts` (`recordRefSensitivity`).

The latent adoption limit is stated in §2 and is not a defect today.

Nothing else in this ADR changes. This is an engineering design record. It grants no business, Finance or IT approval (G1–G6), and it implies no DG0–DG7 result.

## Amendment (2026-11-08, T-DG6-ARCH-16): §2, the report aggregate flag, references to restricted records (D-218, D-222), the re-save and write rules, D-219's exclusions and the reference inventory (sweep after T-DG6-BE-Z9 to T-DG6-BE-Z12B)

**Why.** F-DG6-460 (Low; REQ-S10-002) found that this ADR, the OpenAPI descriptions and the data dictionary still described the narrower report-section rule from before T-DG6-BE-Z9. They also did not record what T-DG6-BE-Z10, BE-Z10B, BE-Z11, BE-Z12 and BE-Z12B shipped under D-218, D-219, D-222 and D-223. This amendment records the shipped rules. No code changes. The §2 table row for `ReportDocument` and the sentence after "Totals that are the same for every reader" are corrected in place, with a pointer to this amendment.

### A. The report aggregate flag (T-DG6-BE-Z9; F-DG6-400; D-195 Q3)

- **The rule.** A report section's `includesRestrictedRecords` is decided from the records the section references (rows, items, sources) **plus the records its aggregate figures include without naming them**:
  - true when the reader is not admitted to at least one sensitive record among them;
  - false when the reader is admitted to all of them;
  - absent when none of them is sensitive. The document is then the same object, byte for byte.
- **Which sections aggregate over records they do not name.** These come from the T-DG6-BE-Z9 sweep of all 12 definitions:

  | Definition | Section | The records the aggregate includes |
  |---|---|---|
  | `executive_pack` | `metrics_<subject>` | the dashboard facts' benefits and business cases (value headlines, value lines, investment) |
  | `executive_dashboard` | `area_value` | the same |
  | `executive_dashboard` | `items_portfolio` | the benefits allocated to each listed initiative (planned value = Σ allocated benefit amount × share) |
  | `gate_pack` | `criteria` | the evidence items counted by `unverified_evidence_count` |

  Every other section either references its records itself (BE-Z7B) or aggregates over no sensitive type. The facts come from the same functions the dashboards use (`factsValueRecords`, `allocatedBenefitRecords` in `reporting/dashboards/restricted.ts`). So a report section is labelled for exactly the readers the transformation dashboard labels.
- **Where the records come from.**
  - Assemblers return them as `aggregates: AggregateRef[]` (`reporting/reports/assembler.ts`).
  - A live report passes them to `documentForReader` (`reporting/reports/restricted.ts`).
  - A stored snapshot keeps them in `report_snapshot_aggregate` (migration `0126`; ADR-0045 §3, amendment of 2026-11-08).
- **Legacy snapshots.** A snapshot stored before `0126` has `report_snapshot.aggregates_recorded = false`. Its aggregate sections are judged conservatively against **every** record of the section's types marked sensitive in its transformation (`legacyAggregates`). This is a deliberate superset: it may over-label, and it never under-labels. The column is immutable after insert.
- **What the aggregate records are not.** They are never shown and never omit anything. They are not sources: `listReportSnapshotSources` does not list them, and the D-199 export refusal does not read them. An aggregate shows a value to every reader (D-195 Q3). Totals and metrics are unchanged, and `content` and `contentSha256` are unchanged.
- **Exports (unchanged; T-DG6-BE-Z9 §9 item 1).** The member is read-time only. So the rendered export files carry no "Includes restricted records" label for any section. Whether an export should carry it is an open design question and is not decided here. It is not a defect against D-195 Q3, and refusing such an export would contradict the D-199 rule, which is decided on the selection's records.

### B. An open record never names a restricted record's id (D-218)

- **The rule** (D-218, quoted): "a response never names the id of a sensitive record the reader is not admitted to. The reference is omitted; where the open record depends on it, a neutral restricted marker without an id is returned, `includesRestrictedRecords: true` is set, and the screen shows the restricted label instead of a link."
- **Restricted** means a record of the §2 sensitive set, or a `SENSITIVE_CHILD_SOURCES` child carrying its values (amendment of 2026-11-04), that the reader is not admitted to by the §2 clause. Admitted readers get every id and no marker.
- **The shapes.** Every response that serializes such a reference takes one of these shapes. The OpenAPI description of each listed field and member states its own case.

  | Shape | Where (as shipped) | Helper |
  |---|---|---|
  | **Null + marker.** A nullable reference becomes `null`, and the object carries `includesRestrictedRecords: true`. | Benefit `parentBenefitId` and `businessCaseLineId`; Day-90 response, health answer, gate-condition closure, workstream output, inherited record, dispensation and deliverable-confirmation `evidenceId`; RAID action `correctiveCaseId`; sustainment review `transitionDecisionId`; procedure instance `subjectRecordId`. | `hideRestrictedRefs` (`access/sensitive-reach.ts`) |
  | **Null with the type kept.** For a typed reference, the type stays and the id becomes null, plus the marker. | Launch task `outputRecordType`/`outputRecordId`; meeting output `recordType`/`recordId`; approval and approval decision record `subjectId`; workstream output `recordId`. | `hideRestrictedTypedRefs` |
  | **Null + a named restricted flag.** Used where null alone would read as "none". | `countedBenefitRestricted` (benefit group), `businessCaseRestricted` (funding decision), `parentCaseRestricted` (business case), `blockerRecordRestricted` (executive decision), `evidenceRestricted` (RAG override and the override in force). | as above |
  | **Omitted from a list of ids, plus the marker.** Counts of hidden ids are not returned. | Benefit group members; measurement, KPI-actual, BAU-handover and T14 register evidence ids (`evidenceCount` counts only what the reader may see); `includedCaseIds` (totals unchanged); agenda `materialsEvidenceIds`. | `hideRestrictedRefLists`, `restrictedIdsOf` |
  | **A row whose only purpose is to name the record is not listed.** | Evidence links, phase-step evidence, TOM canvas evidence, procedure instance links, report snapshot sources and evidence, the orphan report, the evidence register's own sensitive items. | `withoutRestricted`; `visibleRefs` for the snapshot lists |
  | **Redacted body.** In a free-form or frozen body, a hidden id that is an array element is dropped. An array element that is an object naming it is dropped. Any other property naming it becomes null. The stored body and its hash are unchanged, so a redacted gate snapshot does not verify against `snapshotSha256`. | Gate submission `snapshot` and criterion `detail`, the live gate view, finance-validation `content.evidence`, closure `snapshot.benefits[]`, form custom values, procedure `inputValues`, revision proposal `impact` and `validationReport` (counts unchanged), audit `changes` of an open record. | `redactRestrictedIds` |
  | **Work items and My Work (D-222 (1)).** The rule covers the assignee too. A restricted item has `subjectId: null` (the type is kept), and its link goes to the transformation home (`/my-work` for an item outside any transformation). Its text is `inbox.restricted`, and it carries the marker. In My Work it has `recordId: null`, `href` the transformation home and `code: null`. This also applies to the completion response and to the workspace header's next actions. For a restricted item, the My Work cursor carries the work-item id, never the record id. BE-Z4's kept ids are superseded. | `listMyWorkItems`, `getWorkItem`, `completeWorkItem`, `getMyWork`, `getWorkspaceHeader` | `restrictedWorkItems` (`tasks/deep-links.ts`), `presentWorkItems` (`reporting/my-work.ts`) |
  | **Automation condition literals (D-222 (2); the marker superseded by D-226 and D-228 (1), see the amendment of 2026-11-09).** A literal (or `in`-list element) naming a restricted record is shown **in place** as the opaque token `[restricted:k]` (`automationRestrictedToken(k)`; k = the literal's 1-based position among **all** literals of the stored version). The bare marker `"[restricted]"` (`AUTOMATION_RESTRICTED_LITERAL`) is never shown and is refused on write. The condition, operator and positions stay, so the rule is still seen to test something. The readable summary says "a restricted record" / "سجل مقيد", and the version carries the marker. The rule's own `summary` is redacted the same way. The stored conditions, `contentSha256` and the audit trail are unchanged. Refusing the whole version was rejected, because it would hide that a rule exists. | every response that serializes a rule version or a rule | `redactConditionLiterals` (`automation/versions.ts`) |

- **On screen (en/ar).** The restricted label is `access.includesRestrictedRecords` ("Includes restricted records" / "يشمل سجلات مقيدة", Arabic provisional), shown through `RestrictedRecordsLabel` in place of a link and never as "none". No new catalogue key was added.
- **Contract shape changes (additive or widening, as merged).** Each changed schema gained an optional `includesRestrictedRecords` (`const: true`). Six fields widened from `Uuid` to `NullableUuid` and are still required:
  - `RagOverride.evidenceId` and `RagOverrideInForce.evidenceId` (BE-Z10B, merged per D-220);
  - `Approval.subjectId` and `ApprovalDecisionRecord.subjectId` (BE-Z12);
  - `WorkItem.subjectId` and `MyWorkItem.recordId` (BE-Z12B). These two are confirmed by D-223 (1). No decision row names the first four; they are recorded here as merged. An approval, an override or a work item is a governance record. Omitting it would hide that it exists, so the record stays and only the id is withheld. The version string stays `1.5.0-p6`.

### C. The re-save rule (D-218 continuation; `keptRestrictedRef`)

A writer not admitted to a stored reference was shown it as null or omitted. When that writer saves the record back, the save must not remove a reference they never saw:
- **A single reference.** Sending `null`, or omitting the field on a replacing write, **keeps** the stored hidden reference. Another id replaces it and is checked as before. A writer admitted to the stored record, or a stored reference to an open record, clears it with `null` exactly as before. The audit event records no change for such a re-save. Applied to:
  - the Day-90 response PUT and the health answer PUT;
  - the benefit PATCH `parentBenefitId` and `businessCaseLineId`, including the forms bulk edit, which uses the same core;
  - the launch-task PATCH `outputRecordId`, when `outputRecordType` is unchanged.
- **A list of ids.** On the agenda item PATCH, hidden `materialsEvidenceIds` are appended back. On the custom-field values PUT, a hidden attachment id stays in its list, and a hidden single reference stays when the writer sends null or omits it.
- **Automation conditions (superseded 2026-11-09: D-226 and D-228 (1) replace the D-222 (2) pairing; `resolveRestrictedTokens` replaces `keepRestrictedLiterals`).** Each token `[restricted:k]` sent back is replaced by the stored string literal at position k of the version being edited, wherever the condition now sits (any condition, order or list position). A token left out removes its literal. An unknown token (a position with no string literal), the bare marker `[restricted]` or any other marker-like text is refused with 422 `automation_rule.restricted_marker_unknown`, so marker text is never stored as a literal. A writer can only bring back literals of the version being edited, never an id from elsewhere. The full rule is in the amendment of 2026-11-09, part A. _(The earlier text described a four-way pairing of the k-th marker with the k-th stored condition, and said that a marker with no hidden literal behind it was stored as an ordinary literal. Both are no longer true.)_

### D. The write rule for hidden references (T-DG6-BE-Z12; `refIsRestricted`)

A write that names a reference to a restricted record answers **exactly as it answers an unknown id**: the same status, code, pointer and problem keys, and nothing is stored. The write is then neither an existence oracle nor a way to attach a record the writer gets 404 on. `refIsRestricted` makes one policy decision. The register kit's `unknownReference` (`transformations/register-kit.ts`) is the shared 422.

| Write | Answer for a hidden id (= unknown id) |
|---|---|
| `createBenefit`, `updateBenefit` `parentBenefitId` | 422 `validation.reference` at `/parentBenefitId` |
| `createBenefit`, `updateBenefit` `businessCaseLineId` | 422 `benefit.case_line_invalid`, checked **before** the 409 `benefit.case_line_taken`, which would otherwise disclose the line |
| `updateLaunchTask` `outputRecordId` | 422 `launch_task.output_record_invalid` |
| `createMeetingOutput` `recordId` | 422 `meeting_output.record_not_found` |
| `linkProcedureStepEvidence` `evidenceId`; `completeProcedureStep` `outputRecordId` (link outputs, `requireNamedRecordRead`) | 422 `procedure_step.output_record_invalid` |
| `launchProcedureInstance` `subjectRecordId`; automation condition literals | accepted. Neither is existence-checked for **any** id, so a hidden id and an unknown id behave identically. The reader is then shown null or the marker. A writer who already holds a hidden id learns that it names a restricted record. This was accepted by BE-Z12 §3 and by D-223 (2): UUIDv7 ids are not guessable, and no new 422 is added on a free-text field. |

Writes that earlier tasks already refused, and references set only by the system (blockers, closures, snapshots), are unchanged.

### E. D-219's exclusions (what D-218 does not override)

D-218 governs business responses to readers not admitted to the record. It does **not** override these three cases. Each is excused in the sweep's `ID_REF_ALLOWED` (`access/sensitive-reach-sweep.test.ts`) and in the inventory (status `D-219`):
1. **Audit events of a restricted record** (§2): actor, action, time, record id and versions are kept, and `changes`/`reason` are redacted (`redacted: true` on the global audit API). The audit trail must stay complete and tamper-evident for its readers. An event of an *open* record whose `changes` name a restricted id is redacted the same way (T-DG6-BE-Z10).
2. **The grant register `recordId`** (§7). It is shown only to `sensitive_record.read` holders, who administer grants by record id. `recordTitle` stays null unless the caller can read the record.
3. **The phase-step evidence remove response.** It echoes the id of the link the writer named in the request, so it adds no new disclosure. The list no longer gives a not-admitted reader that link id.

D-219's falsifier stands: a reviewer showing a reader learning a restricted id it could not otherwise obtain through one of these paths reopens it.

### F. The reference inventory is the reference list of this class (T-DG6-BE-Z12, BE-Z12B)

- **The inventory.** `apps/api/test/support/sensitive-reference-inventory.ts` has one row per column that can hold the id of a sensitive record or of a `SENSITIVE_CHILD_SOURCES` child. Each row gives the column, its kind, what it can name, the operations that serialize it, its status, the fix or citation, and the test that seeds it. Its statuses are `redacted`, `holder-restricted`, `D-219`, `cannot-name`, `not-served`, `own-input` and `open`.
- **The test.** `apps/api/test/integration/access/sensitive-reference-inventory.test.ts` derives the column set from the **PostgreSQL catalogue** of a database migrated to HEAD, not from the demo seed. The set is:
  - every FK column referencing a sensitive or child table's `id`;
  - every uuid column with no FK;
  - every `uuid[]` column;
  - every `json`/`jsonb` column.

  The test fails on a missing, stale or mis-kinded row, an unknown operationId, or a `redacted` row without an existing exercise. It also pins the `open` and `PENDING` lists, both empty since BE-Z12B.
- **The sweep.** `sensitive-reach-sweep.test.ts` checks in the database that every row it claims to exercise really holds a hidden id.
- **Counts at T-DG6-BE-Z12B** (its handback §4): 199 rows from the catalogue (fk 54, uuid 59, json 84, array 2):

  | Status | Rows |
  |---|---|
  | `redacted` | 48 |
  | `holder-restricted` | 49 |
  | `cannot-name` | 91 |
  | `D-219` | 2 |
  | `not-served` | 6 |
  | `own-input` | 3 |
  | `open` | 0 |
- **Adding a column.** A new reference column of any of these kinds fails the inventory test until it is classified, in the same change. This extends the "Adding a table" rule of the amendment of 2026-11-04 from tables to columns.

### G. Saved-view registry (T-DG6-BE-Z11)

`includesRestrictedRecords` on a list item is a list **column**, not response metadata (ADR-0057 §4: the registry's columns are exactly the item schema's properties). It is listed for `workstream_outputs`. It has no filter and no sort: a "restricted only" filter would let a reader probe for restricted links, and the value is computed at read time.

**Contract.** Only description texts changed in `docs/api/openapi.yaml`, with no schema change: `ReportDocument.sections`, the condition `value` of `AutomationRuleContent`, and the per-field descriptions of the fields in B to E. `pnpm openapi:lint` passes with 932 operations. No gate needs reopening.

**Checked against the code** by the solution-architect at the integrated `HEAD` `95936867c`. The code agrees with the text above, and no contradiction was found. The code checked:
- `reporting/reports/restricted.ts` (`documentForReader`, the aggregate section map, `legacyAggregates`) and migration `0126`;
- `access/sensitive-reach.ts` (`keptRestrictedRef`, `refIsRestricted`, `redactRestrictedIds`);
- `benefits/register.ts` (the re-save loop) and `launch/tasks.ts` (the re-save and the write);
- `automation/versions.ts` (`redactConditionLiterals`, `keepRestrictedLiterals`);
- `tasks/deep-links.ts` (`restrictedWorkItems`) and `reporting/my-work.ts` (`presentWorkItems` and the cursor);
- the inventory and its test (`KNOWN_OPEN` and `KNOWN_PENDING` empty).

Nothing else in this ADR changes. This is an engineering design record. It grants no business, Finance or IT approval (G1–G6), and it implies no DG0–DG7 result.

## Amendment (2026-11-09, T-DG6-ARCH-17): §2 and §3, automation marker tokens (D-226, D-228 (1)), inbox and channel redaction (D-226, D-227 (2)), served keys and the action→case rule (D-227 (1), (3)), served error texts and the item label (D-228 (2), (3)), and connector configuration names (D-229) (sweep after T-DG6-BE-Z13 to T-DG6-BE-Z13C)

**Why.** T-DG6-BE-Z13, BE-Z13B and BE-Z13C repaired the round-8 findings F-DG6-520, 540, 541, 560 and 561 and the residuals that D-227 and D-228 named. This ADR still described the D-222 (2) marker and pairing, an inbox redaction with an unchanged `linkPath`, and channel messages that always carry the token link. D-228 (5) assigns this sweep. This amendment records the shipped rules. No code changes. Four places above are corrected in place, each with a pointer here: §3 "Inbox redaction"; the amendment of 2026-11-08, part B (the automation row of the shapes table) and part C (the automation re-save bullet). The "Checked against the code" list of 2026-11-08 names `keepRestrictedLiterals`. It is kept as the record of that check; the function is now `resolveRestrictedTokens`.

### A. Automation condition literals: opaque per-version tokens (D-226, D-228 (1); supersedes the marker and pairing of D-222 (2))

- **Read.** A condition literal, or an `in`-list element, that contains the id of a restricted record (§2 sensitive set or a `SENSITIVE_CHILD_SOURCES` child, as in part B of 2026-11-08) is shown **in place** as the opaque token `[restricted:k]`. The version, and the rule whose effective version it is, carry `includesRestrictedRecords: true`. The readable summary renders a token as "a restricted record" / "سجل مقيد". The stored conditions, `contentSha256` and the audit trail are unchanged. Helper: `redactConditionLiterals` (`automation/versions.ts`), one policy decision per batch.
- **k (D-228 (1)).** k is the literal's 1-based position among **all** literals of the **stored** version, in reading order: conditions in order; a string or boolean scalar counts as one; each `in` element counts as one; a condition without a value (`present`, `absent`) counts none. So k depends only on the version that the author read, which `If-Match` pins. A grant or sensitivity change between the read and the save cannot shift a token. It discloses only the number of literals before the hidden one, which the reader already sees. (D-226 first defined k among the reader's hidden literals. BE-Z13's handback §5 showed that this set can change between read and save, and D-228 (1) replaced it.)
- **Write.** `resolveRestrictedTokens` (synchronous; it needs no policy decision) runs on `updateAutomationRuleVersion` against the stored version, and on `createAutomationRule` with no stored version:
  - a token `[restricted:k]` is replaced by the stored **string** literal at position k, wherever the condition now sits (any condition, order or list position);
  - a token left out removes its literal;
  - an unknown token (no stored version, or no string literal at position k), the bare marker text `[restricted]`, or any other marker-like text (`looksLikeRestrictedMarker`: optional leading space, `[`, optional space, `restricted`, any case) is refused **422** `automation_rule.restricted_marker_unknown` with a JSON pointer to the value. English text: "A condition value is restricted-record marker text that does not stand for a value of this version. Reload the version and keep each restricted value as shown, or remove it." (en/ar in `problems.json`, Arabic provisional);
  - so marker text is **never stored** as a literal.
- **The two races D-228 (1) closes.** (a) A record becomes hidden between the read and the save: the author sends back the plain id they hold (allowed, D-223), and every other token keeps its position. (b) A record becomes visible between the read and the save: the token the author holds still resolves to the literal at its position. Resolving a position the writer can now read discloses nothing, because the stored literal is never returned to a reader who is not admitted.
- **An admitted writer** is never shown a token, so for them any token is unknown (422), and they edit the literal freely.
- **Shared constants** (`packages/shared/src/schemas/automation.ts`): `automationRestrictedToken(k)`, `AUTOMATION_RESTRICTED_TOKEN_PATTERN` (`^\[restricted:([1-9][0-9]{0,3})\]$`), `looksLikeRestrictedMarker`, and `AUTOMATION_RESTRICTED_LITERAL` (`"[restricted]"`), which is now the bare text that is refused, never shown.
- **On screen.** The rule editor shows the item-scoped restricted label on a condition whose value matches the token pattern, never on a value equal to the bare text. The label moves with the token when a condition is removed.
- **Write rule for a plain hidden id** (part D of 2026-11-08) is unchanged: a literal is free text and is not existence-checked for any id (D-223).

### B. Inbox, work items and channel messages (D-226, D-227 (2), (3))

- **One decision for a notification.** `restrictedNotifications` (`tasks/deep-links.ts`) marks a notification restricted when (1) its target is unreadable (`readableTargets`); or (2) any id in its link, its `messageParams` or its stored target names a sensitive record or any `SENSITIVE_CHILD_SOURCES` child the reader is not admitted to (`restrictedIdsAmong`); or (3) that id is an action whose corrective case is such a record (`correctiveCasesOfActions`, D-227 (3)); or (4) the work item it announces is restricted.
- **The inbox response** (`listMyInbox` and `markInboxNotificationRead`, `notificationFor` in `tasks/routes.ts`): `messageKey` `inbox.restricted`, `messageParams` `{}`, `linkPath` the transformation home `/transformations/<transformationId>` (else `/my-work`), and `includesRestrictedRecords: true`. `id`, `workItemId`, `transformationId`, `readAt`, `createdAt` and `version` are unchanged. The stored row is never changed. §3 is corrected in place.
- **The resolver.** `resolveDeepLink` uses the same decision: a restricted notification's token answers the §3 **403** `deep_link.forbidden`, including for a child route of a restricted record.
- **Work items (D-227 (3)).** `restrictedWorkItems` checks the subject and every id in the item's link, and treats an action id as naming its corrective case. So the owner's task for an action on a restricted corrective case (`raid.task.action_due`, `{sourceCode}`, link `/action-register/<actionId>`) and its notification are restricted, in `listMyWorkItems`, `getWorkItem`, `completeWorkItem`, `getMyWork`, `getWorkspaceHeader`, the inbox and the resolver. The work-item shape is the one of part B of 2026-11-08 (`subjectId: null`, home link, `inbox.restricted`, marker). Register rows of such an action were already redacted (`correctiveCaseId: null` and the marker, BE-Z12).
- **Channel messages (D-227 (2); ADR-0054 §3).** The worker decides restriction with `recipientCanRead` (`apps/worker/src/handlers/notifications.ts`). It collects every uuid in the link, the params, the stored target and the announced work item (subject and link), and resolves it with `restrictedForRecipient` (`apps/worker/src/sensitive-children.ts`) through `SENSITIVE_CHILD_SOURCES_TWIN`, which a test pins deep-equal to the API's `SENSITIVE_CHILD_SOURCES`. It also covers an action on a corrective case and the parents of an evidence item. The worker imports no API code.
  - **A restricted message** carries the `inbox.restricted` text in the recipient's locale, no parameter, and the transformation home link (else `/my-work`), and **no link token is issued**.
  - **Fail-closed.** In the worker, only an active explicit `sensitive_record_grant` admits. The §2 named-party and `sensitive_record.grant` clauses are not restated, so a party without an explicit grant receives the restricted text by e-mail while the inbox shows them the full text. The worker can hide more than the API, never less.
  - **Not skipped.** A restricted recipient is sent the restricted message. The delivery is not `skipped`, and the `recipient_restricted` skip reason, which stays in the `notification_delivery` CHECK and in the contract enum, is not set by the shipped worker.

### C. Served keys: hidden ids masked inside the text (D-227 (1))

- **The rule.** A served text column that embeds a record id is not excluded by D-219. A hidden id inside it (a §2 sensitive record or a `SENSITIVE_CHILD_SOURCES` child the reader is not admitted to; for example `benefit.variance_evaluated:<measurementId>`) is replaced by the marker `[restricted]` (`RESTRICTED_ID_MARKER`, `packages/shared/src/schemas/sensitivity.ts`), and the item carries `includesRestrictedRecords: true`. The stored row is unchanged. An admitted reader sees the real key and no member.
- **Helpers** (`access/sensitive-reach.ts`): `hiddenIdsInTexts` (one `restrictedIdsAmong` decision for every uuid in the texts), `maskHiddenIds` and `maskRestrictedIdsInFields`.
- **Where it applies (as shipped):**

  | Response member | Operations |
  |---|---|
  | `OperationalFailure.idempotencyKey` | `listAutomationFailures`, `getAutomationFailure`, `retryAutomationFailure`, `dismissAutomationFailure` |
  | `AutomationExecution.triggerKey`, `actionResults[].idempotencyKey` | `listAutomationExecutions`, `getAutomationExecution` |
  | `IntegrationRun.idempotencyKey` (also as a connector's `lastRun`) | `listIntegrationRuns`, `runConnector`, `getIntegrationRun`, `retryIntegrationRun`, `testConnector`; `listConnectors`, `createConnector`, `getConnector`, `putConnector`, `enableConnector`, `disableConnector` |
  | `OutboundWrite.idempotencyKey` | `listOutboundWrites`, `executeOutboundWrite` (also on replay), `getOutboundWrite`, `confirmOutboundWrite` |
  | `CorrectiveCase.sourceScopeKey` | `listCorrectiveCases`, `createCorrectiveCase`, `getCorrectiveCase`, `updateCorrectiveCase`, `closeCorrectiveCase` |

  D-227 named the first three columns and "any other served text column the inventory finds". The inventory found the integration and corrective keys: the system builds them from non-sensitive ids, but they embed caller text (`manual:<userId>:<Idempotency-Key>`, an outbound caller's key, a Value Review finding reference), which can hold any id.
- **Same rule for an action on a restricted corrective case.** See part B (D-227 (3)).

### D. Served error texts and the item label (D-228 (2), (3))

- **Error texts.** Every served column matching `(^|_)error_(message|detail)$` is classified in the inventory and masked exactly as in part C:

  | Response member | Operations |
  |---|---|
  | `OperationalFailure.errorMessage` | as its key (part C) |
  | `AutomationExecution.errorDetail` | as its key |
  | `OperationalException.lastErrorMessage` (and `OperationalExceptionDetail`) | `listOperationalExceptions`, `getOperationalException`, `acknowledgeOperationalException`, `resolveOperationalException` |
  | `IntegrationRun.errorMessage`, and `ConnectorActionableError.params` values parsed from it (`{name=…}`, `{column=…}`) | as `IntegrationRun.idempotencyKey`; the actionable error on `getIntegrationRun` and every connector response |

  `ConnectorActionableError` carries its own `includesRestrictedRecords` when a params value was masked. The Operations screen never shows `lastErrorMessage` (it shows the catalogue text of `lastErrorCode`, F-DG6-221), so the marker is not visible there.
- **The item label (D-226, F-DG6-561; D-228 (3)).** `RestrictedRecordsLabel` has a `scope` prop, exposed as `data-restricted-scope`. Its visible text is always `access.includesRestrictedRecords`. Its description depends on the scope:
  - `"total"` (default; totals): `adminP6.restricted.hint`, "This total includes records you are not admitted to. The total is the same for every user; the individual records and values stay hidden.";
  - `"item"` (a row, link, count of links or condition): `adminP6.restricted.hintItem`, "This item refers to a record you are not admitted to. The record and its values stay hidden." / "يشير هذا العنصر إلى سجل غير مسموح لك به، ويبقى السجل وقيمه مخفيين." (Arabic provisional).
  
  The item label is shown when `includesRestrictedRecords` is set: on an inbox row (My Work), on a rule condition, on a failure-queue row and in its dismiss form, on the execution detail next to the trigger key, on the run detail next to the idempotency key, and in the actionable-error panel.

### E. What stays out of scope

- **Cross-organization ids (D-228 (4)).** Every D-218 helper checks the records marked sensitive in the **reader's** organizations, and a reader never reaches another organization's records. A hidden id of another organization inside a key or an error text is not masked. This is reachable only on a fault path (an envelope naming another organization's benefit).
- **Connector configuration names (D-229).** `connector_config_version.credential_refs` (secret references) and `field_mappings` (column mappings) stay **cannot-name**. They are set only through IT's secret manifest (ADR-0052 §5, amendment of 2026-11-04) or by connector administrators, who already see that configuration. A name that textually holds an id therefore discloses nothing to anyone who could not already read it, although the run's error text that repeats it is masked (part D). D-229's falsifier stands: a reviewer showing a reader learning a hidden id they could not already see reopens it.

### F. The reference inventory at T-DG6-BE-Z13C

- **Catalogue widened (part F of 2026-11-08).** The column set now also contains every **text** column whose name matches `(^|_)(link_path|href|key|error_message|error_detail)$`: links (BE-Z13), keys (BE-Z13B, D-227) and error texts (BE-Z13C, D-228 (2)). The new kind is `"text"`.
- **Counts** (BE-Z13C handback §2.2; `T-DG6-BE-Z13C-evidence/13-after-fix-error-texts.log`): catalogue fk 54, uuid 59, json 84, array 2, text 77 (276 rows).

  | Status | Rows |
  |---|---|
  | `redacted` | 60 |
  | `holder-restricted` | 54 |
  | `cannot-name` | 135 |
  | `D-219` | 2 |
  | `not-served` | 22 |
  | `own-input` | 3 |
  | `open` | 0 |

  `KNOWN_OPEN` and `KNOWN_PENDING` stay pinned empty. The per-column classification of this sweep is in the data dictionary, "P6 read-time classifications after round 8".

**Contract.** The members below were added by the implementers and merged. Each is an optional `includesRestrictedRecords` (`type: boolean`, `const: true`), additive:
- `InboxNotification` (BE-Z13);
- `AutomationExecution`, `OperationalFailure`, `IntegrationRun`, `OutboundWrite` and `CorrectiveCase` (BE-Z13B);
- `OperationalException`, `OperationalExceptionDetail` and `ConnectorActionableError` (BE-Z13C).

One problem code is new: 422 `automation_rule.restricted_marker_unknown` on `createAutomationRule` and `updateAutomationRuleVersion`. This task changed only description texts in `docs/api/openapi.yaml`: every key, error text, link and configuration member listed in parts B to E now states its own rule. No schema changed, the version string stays `1.5.0-p6`, and no gate needs reopening.

**Checked against the code** by the solution-architect at the integrated `HEAD` `553f278b0`. The code agrees with the text above, with no contradiction found. The code checked:
- `automation/versions.ts` (`literalPositions`, `mapLiteralsAt`, `redactConditionLiterals`, `resolveRestrictedTokens`, `automationRefusals.restrictedMarkerUnknown`) and `packages/shared/src/schemas/automation.ts`;
- `tasks/deep-links.ts` (`restrictedNotifications`, `restrictedWorkItems`, `correctiveCasesOfActions`, `restrictedWorkItemLink`) and `tasks/routes.ts` (`notificationFor`);
- `apps/worker/src/handlers/notifications.ts` (`recipientCanRead`, `restrictedChannelLink`, the send path) and `apps/worker/src/sensitive-children.ts` (`restrictedForRecipient`: active explicit grants only);
- `access/sensitive-reach.ts` (`maskHiddenIds`, `hiddenIdsInTexts`, `maskRestrictedIdsInFields`) and `packages/shared/src/schemas/sensitivity.ts` (`RESTRICTED_ID_MARKER`);
- `apps/api/test/support/sensitive-reference-inventory.ts` (the text rows, `credential_refs` and `field_mappings` as cannot-name);
- `apps/web/src/i18n/{en,ar}/adminP6.json` (`restricted.hint`, `restricted.hintItem`) and `problems.json` (`automation_rule__restricted_marker_unknown`).

Nothing else in this ADR changes. This is an engineering design record. It grants no business, Finance or IT approval (G1–G6), and it implies no DG0–DG7 result.
