# ADR-0051: The P6 authorization boundary: one `ReadScope` derived from the ADR-0006 policy, sensitive records and explicit grants, notification deep links with re-authorization and title redaction, evidence authorization after ownership transfer, and the S02-006 route-inventory sweep

- **Status:** Proposed for P6 (DG6). Author: solution-architect (T-DG6-ARCH-01), 2026-10-26.
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
- **Totals and rollups (D-195 Q3, decided by the user):** an aggregate that includes a sensitive record's value is computed exactly as in DG4 (identical for every user; decimal arithmetic unchanged; **no DG4 reopen**). When a reader is not admitted to at least one sensitive record whose value the aggregate includes, the response carries `includesRestrictedRecords: true` and the screen shows the label **"Includes restricted records"** / **"يشمل سجلات مقيدة"** (Arabic provisional, i18n key `access.includesRestrictedRecords`). The record and its individual value are never shown. When the reader is admitted to all of them, or none is sensitive, the field is `false` and no label is shown. Which DG4/DG5 aggregate responses gain the optional field is BE-B2's inventory (p6-work-split §E/F.3) (the benefit totals of `benefits/**` and the dashboard totals of `reporting/dashboards/**` at minimum); each is an additive optional property, recorded by the orchestrator in the contract (an implementer's contract need goes in its handback, p6-plan §5.3). Unknown and n/a stay Unknown and n/a; the label never turns an Unknown into a number.

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

**Inbox redaction** (`listMyInbox`, `GET /api/v1/me/inbox`; DG4 response **content** change accepted by D-195, shape unchanged): for each item, the server re-checks the recipient's read access to the item's target. The target is `target_record_*` when set, else `deepLinkTarget(link_path)` computed at read time (nothing is written by the GET), else the item's `transformation_id` with `transformation.read`; an item with none of these is organization-level and is never redacted. The in-app inbox keeps navigating by `linkPath`; every page it opens re-checks access through its own API calls. When the recipient cannot read it now, the item is returned with `messageKey` = `inbox.restricted` and `messageParams` = `{}`; `id`, `linkPath`, `readAt`, `createdAt`, `version`, `transformationId` and `workItemId` are unchanged (they are ids, not content). Text: **"You no longer have access to this item."** / ar provisional **"لم تعد لديك صلاحية الوصول إلى هذا العنصر."** The stored row is never modified by redaction (it is a read-time rule; access restored = text restored). Fields redacted: exactly `messageKey` and `messageParams`. The channel adapters of ADR-0054 send only the token link and a neutral subject, never `messageParams` content, for the same reason.

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
