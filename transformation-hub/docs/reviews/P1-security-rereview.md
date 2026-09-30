# P1 (Secure Foundation): Security & Privacy Re-review

| Item | Value |
|---|---|
| Reviewer | `security-privacy-reviewer`, independent re-review. The reviewer did not write any of the reviewed code or fixes. |
| Revision | **`08981f2`** (`claude/mobily-transformation-hub`). The review started at `38f947c` and the worktree was fast-forwarded to `08981f2` at the coordinator's request. Every result below that names a revision was produced at that revision. The two exceptions are the web proxy probe (C7) and the `safeNext` probe (C8), which ran on a web build from `38f947c`. `git diff 38f947c 08981f2` is empty for `apps/web/src/proxy.ts`, `apps/web/next.config.ts`, `apps/web/src/lib/safe-next.ts` and `apps/web/src/app/login/**`, so the code they test is identical. |
| Input | `docs/reviews/P1-security-review.md` (verdict FAIL, at `5d0dd09`) and the fix commit `ec36f7a`. |
| Scope | **(1)** Each SEC-P1-01…12 finding: the fix, its regression test, and attempts to break it. **(2)** The P1 platform invariants re-checked against the P2/P3 modules. Sampled: carve-out, NewCo, readiness/TSA, documents/evidence, gates/waivers and AI. Governance was checked only where the invariants touch it. **(3)** The S3-compatible storage adapter from `049cf54` (`apps/api/src/modules/documents/storage/*`, `HUB_S3_*` in `config.ts`, Helm wiring). |
| Database | **`hub_test_secrr` only.** It was reset, migrated and seeded by each test run. No other database was used. |
| Processes | A local header-echo stub on `:4197` and a production `next start` of the web app on `:3197`, both started by this reviewer and both stopped by PID afterwards (16721, 16742/16778/16779). A `next-server` with PID 3113 belongs to another agent and was not touched. No external host was contacted. |
| **Verdict** | **PASS with conditions.** No Critical or High finding is open. SEC-P1-01 (High) is **Fixed**. SEC-P1-02 and SEC-P1-04 (Medium) are **Fixed**. SEC-P1-03 (Medium) is **Partially fixed**; its residual is SEC-P1R-02 (Low). The re-review adds **1 Medium** (SEC-P1R-03, NewCo module) and **5 Low**, each with a failing `DEFECT` test, plus 5 Info. See §6. |

## 1. Commands run and real results

**C1. Environment**
- `pg_isready`, then `bash scripts/dev/pg-start.sh` after the container restart.
- `HUB_DATABASES=hub_test_secrr bash scripts/dev/pg-init-roles.sh` → `roles hub_owner/hub_app and databases ready: hub_test_secrr`.
- `pnpm install --frozen-lockfile` and `pnpm build:packages`, both OK.

**C2. Full API suite at `38f947c`** (own database)
```
$ TEST_DATABASE_URL=postgres://hub_app:…@127.0.0.1:5432/hub_test_secrr TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:…@…/hub_test_secrr pnpm --filter @hub/api test
 Test Files  50 passed (50)
      Tests  437 passed (437)
   Duration  361.35s
EXIT=0
```

**C3. Full API suite at `08981f2`** (same command, before the review's defect tests were added)
```
 Test Files  51 passed (51)
      Tests  458 passed (458)
   Duration  323.65s
EXIT=0
```

**C4. Unit suites at `08981f2`**
- `pnpm --filter @hub/domain --filter @hub/contracts run test`
- domain: `Test Files 13 passed (13)`, `Tests 234 passed (234)`
- contracts: `Test Files 1 passed (1)`, `Tests 5 passed (5)`

**C5. The fix regression tests** (`vitest run test/p1/security-p1-fixes.spec.ts test/p1/oidc-sso.spec.ts --reporter=verbose`, at `38f947c`, 25/25 passed)
- `security-p1-fixes.spec.ts` covers SEC-P1-02, -03, -04, -06, -07, -08, -09, -11 and -12.
- `oidc-sso.spec.ts` includes the two SEC-P1-01 takeover tests and the SEC-P1-10 configuration assertions.
- Both files are also part of C3 and passed there.

**C6. Exploratory probes** (temporary vitest files run against `hub_test_secrr` at `08981f2`; not committed)
```
SEC-P1-01 (IdP = repo FakeOidcIdp, HUB_OIDC_LINK_BY_EMAIL=true)
  email_verified: "true" (string)            -> 302 /login?sso_error=oidc.not_provisioned, user stays unbound
  two subjects race to link one unbound user -> A 302 / ; B 302 /login?sso_error=oidc.not_provisioned ; bound = A ; link audit rows = 1
SEC-P1-02 (API app rebuilt with HUB_MODE=standard)
  platform.admin demo session: /me 401, /admin/users 401 ; demo user + 'oidc' session /me 401 ; real user + 'dev' session /me 401
  real user + 'oidc' session /me 200 (positive control) ; POST /auth/demo-login 404
SEC-P1-06 (owner role, rolled back)
  cross-org room_grant       -> 23503 hub_ufk_room_grant_user_id
  cross-org org_role_assignment -> 23503 hub_ufk_org_role_assignment_user_id
  cross-org committee_membership -> 23503 hub_ufk_committee_membership_user_id
  decision.requester_user_id -> 23503 hub_ufk_decision_requester_user_id
SEC-P1-07  text/plain JSON to /auth/demo-login 400 (no session) ; multipart 400 (no session) ; application/json 201 (control)
SEC-P1-08  Cache-Control: no-store on 401, 404, public /auth/config and a document download
           (download also sends Content-Disposition: attachment; filename*=UTF-8''…)
SEC-P1-11  150 POST /me/locale without x-csrf-token (one session) -> {"403":150}, 150 audit rows, no 429      <- SEC-P1R-01
           pm.b POST A/members/<id>/revoke -> 404 ; audit {"project_id":null,"entity_id":null,"after":null,
             "reason":"not_found: Resource not found"}                                                    <- SEC-P1R-06
SEC-P1-12  real grants: cleanteam (clean_team room) and partner.alpha (external_partner_limited room)
           -> isRoomOnlyPrincipal = true for both, projects=1, full=0, rooms=1 ; pm = false
           partner.alpha: /projects total 0, /directory 403, every one of 89 DC GET routes -> 403
           cleanteam: 80×403, 3×404, 2×400 and 4×200 (list/get of its own room document, upload policy, empty source list)
External accounts
  pm adds partner.alpha as contributor -> 422 db.external_account_role
  room_grant 'clean_team' for the external account -> external_account_role
  UPDATE app_user SET account_type='external' on a user with an active contributor membership -> ACCEPTED   <- I-R1
IDOR sweep  every GET route with a resource id, called with ids of the OTHER project under the caller's own path
  pm.b (B -> A ids): 47×404 ; pm and sponsor (A -> B ids): 5×404 each
  4×200 per persona are planning.listRaid on the caller's OWN project (:kind is not an id), so not a finding
S3 adapter  endpoint answering 307 to another server: put/get/exists -> "fetch failed … unexpected redirect";
            redirect target hits 0 ; secret never in the error ; key "documents/../../etc/passwd" -> Invalid storage key
```

**C7. SEC-P1-04: web tier forwarding headers**
- Setup: `next build` with `HUB_API_URL=http://127.0.0.1:4197`, then `next start -p 3197`. The API was replaced by a header-echo stub on `:4197`.
- Results:
```
no client headers                              -> {"xff":null,"xRealIp":null,"forwarded":null,"remote":"127.0.0.1"}
X-Forwarded-For 6.6.6.6 + X-Real-IP + Forwarded + True-Client-IP + CF-Connecting-IP
                                               -> all null at the API
mixed-case / duplicate X-Forwarded-For         -> null
3 requests with rotating XFF                   -> null each time
/%61pi/v1/auth/config (encoded)                -> 404 from the web tier (never reaches the rewrite)
```

**C8. SEC-P1-05: `safeNext`** (`node --experimental-strip-types` against a copy of `apps/web/src/lib/safe-next.ts`, origin `http://127.0.0.1:3000`)
- 27 inputs were tried, including every variant of the original finding.
- Every one resolved to a same-origin URL.
- Normalised to `/`:
  - `/\t/evil…`, `/\n/…`, `/\r\n/…`, `//evil`, `/\evil`
  - `/.//evil`, `/..//evil`, `/a/..//evil`, `/%2e%2e//evil`
  - U+2028, NBSP, BOM, U+3000
  - `https://evil…`, `javascript:…`, `/login`
- Kept as a same-origin path: `/%09/evil…`, `/%2F/evil…`, `/@evil…` and `/javascript:alert(1)`.

**C9. SEC-P1-10: production configuration** (`loadConfig` from `apps/api/dist/platform/config.js` at `08981f2`, starting from a valid production baseline with S3 and OIDC)
```
REJECTED  OIDC client id missing | http redirect URI | cookie secret 'a'×40 | S3 http endpoint | S3 endpoint not on
          HUB_EGRESS_ALLOWLIST | S3 secret missing | SSE aws:kms without key | local storage | demo mode | mock AI | owner role
ACCEPTED  baseline | HUB_OIDC_LINK_BY_EMAIL=true | cookie secret 'abcdefghijkl'×3 | HUB_TRUST_PROXY=0.0.0.0/0 |
          HUB_PRIVATE_MODE=false | HUB_S3_SSE=none | S3 key/secret 'minioadmin'/'minioadmin'                    <- I-R2
```

**C10. Database invariants** (catalog queries as `hub_owner` on the `08981f2` schema)
```
tables 109 ; tables with project_id 96 ; without RLS/policy 4 = delivery_record, job, outbox_event, scheduled_job
  (documented infrastructure exemptions, ADR-0003/0004)
FKs between project-scoped tables that do not include project_id: 0
polymorphic references guarded by hub_same_project_* triggers: 14 (ai_proposal, approval_request, change_request,
  dependency×2, diligence_request, escalation, evidence_link, import_row, notification, raci_assignment, rag_override,
  source_claim, waiver)
hub_scope_immutable triggers: 108 tables ; hub_account_type_guard triggers: 4 tables
uuid user columns (…user_id / …_by) with org_id but no (org_id, col) FK: 0
  (the 4 remaining name matches are date/varchar columns: needed_by ×2, computed_by, locked_by)
```

**C11. The review's defect tests** (`apps/api/test/reviews/sec-p1-rereview.spec.ts`, alone): `Tests 6 failed (6)`. This is intended: each test asserts the secure behaviour.

**C12. Full API suite at `08981f2` including the defect tests**
```
 Test Files  1 failed | 51 passed (52)
      Tests  6 failed | 458 passed (464)
   Duration  380.30s
```
The only failures are the six `DEFECT SEC-P1R-0n` tests. Their fixtures are cleaned up, and every other test still passes.

## 2. Status of the P1 security findings

| ID | Sev | Status at `08981f2` | Evidence |
|---|---|---|---|
| **SEC-P1-01** | **High** | **Fixed** | `oidc.service.ts:128-131,145-163`. Link-by-email now requires `email_verified === true` and binds only with `where oidc_subject is null and oidc_issuer is null and is_active and not is_demo`. It requires `rowCount === 1` and writes the audit row only after a real bind. Both regression tests pass (bound victim with the same and upper-case email → `oidc.not_provisioned`, no audit row; unverified email → no bind). Break attempts (C6): a string `"true"` → refused. A race of two subjects → exactly one bind and one audit row. |
| SEC-P1-02 | Medium | **Fixed** | `session.service.ts:43` rejects `auth_method='dev'` and `user_is_demo` sessions unless demo mode is on. C6 shows 401 for four variants (demo admin session, demo user with an `oidc` session, a real user with a `dev` session, plus the regression test) and 200 for a real OIDC session. |
| SEC-P1-03 | Medium | **Partially fixed** | `portfolio.service.ts:83-106,632-643` filters events about 22 classified or room-bound entity types, plus `document_version`, through `visibilitySql` for everyone, auditors included, in both the list and the count. The regression test passes, and a restricted committee's events are hidden (auditor total 0). **Residual:** entities that inherit their visibility from a parent are not covered: meeting, agenda item and committee membership (committee), action and escalation (decision), source claim (source record). A meeting of a restricted committee is 404, but its 14 events, actors and actions are listed. See **SEC-P1R-02**. |
| SEC-P1-04 | Medium | **Fixed** (supported topology) | `apps/web/src/proxy.ts` strips `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, `True-Client-IP` and `CF-Connecting-IP` (C7: all null at the API, including mixed-case and duplicate XFF). `HUB_TRUST_PROXY` now accepts a hop count or an address list (`true` maps to 1 hop). The Helm ingress sends `/api` straight to the API. Documented residual (ADR-0017): behind the dev/eval rewrite every client shares the web server's public bucket. `HUB_TRUST_PROXY=0.0.0.0/0` is still accepted (I-R2). |
| SEC-P1-05 | Low | **Fixed** | `apps/web/src/lib/safe-next.ts` rejects control characters, whitespace and backslashes. It resolves the value against the origin and requires the same origin, with no `//` path and no `/login`. C8: 27 variants, none leaves the origin. Gap: the repository has **no automated test** of `safeNext`. |
| SEC-P1-06 | Low | **Fixed** | `post-migrate.sql` now adds `(org_id, col)` FKs even where a single-column FK existed, and `hub_auth_user_scope` joins on `u.org_id`. C10 finds 0 uuid user columns without an org-scoped FK. C6 shows cross-org room grant, org role, committee membership and decision requester all rejected. |
| SEC-P1-07 | Low | **Fixed** | `bootstrap.ts` sets `bodyParser: false` and registers only JSON (1 MB) and raw `application/octet-stream`. Regression test: urlencoded demo login → 400, no cookie. C6: text/plain and multipart → 400, no session. |
| SEC-P1-08 | Low | **Fixed (API)**; CSP nonce still open | `Cache-Control: no-store` and `Pragma: no-cache` are set on every API response, including 401, 404, public routes and downloads (C6). The web CSP still has `script-src 'unsafe-inline'`, and the threat model marks C-26 as partial, as recommended. |
| SEC-P1-09 | Low | **Fixed** | `db.service.ts:70` makes `query()` throw when the ALS store is closed; the regression test passes. The pool fallback remains only when no request context exists at all (platform code), by design. |
| SEC-P1-10 | Low | **Fixed**, with Info residuals | These are rejected now: missing client id or redirect, an http redirect, a trivially repeated secret, and incomplete, http or non-allow-listed S3 settings (C9). Still accepted: `LINK_BY_EMAIL=true` (now safe after SEC-P1-01), a secret with 12 distinct characters repeated, `TRUST_PROXY=0.0.0.0/0`, and default MinIO credentials. See I-R2. |
| SEC-P1-11 | Low | **Partially fixed** | CSRF denials are audited as `auth.csrf` with a correlation id (regression test). Rate-limit denials are logged, deliberately not audited. **Still open:** (a) a denied out-of-scope mutation records neither the attempted project nor the target id (SEC-P1R-06). (b) The new CSRF audit runs **before** the rate limiter, so one session can write unbounded audit rows (SEC-P1R-01). |
| SEC-P1-12 | Low | **Fixed** | The `app.room_only` GUC is set by `DbService.applyContext`. RLS hides org-level audit rows and org tables from room-only principals, and `app_user` shows them only their own row (regression test). C6 with real room grants: `isRoomOnlyPrincipal = true` for both principals. Partner and clean team reach only their room's documents and the directory is 403. |
| I-1 | Info | **Fixed** | `document_version` now has `room_id` (C10 column list) and is room-filtered in RLS and in the activity feed. |
| I-2 | Info | **Fixed** | `likeContains` escapes `%`, `_` and `\` everywhere. `grep` finds no remaining `` `%${q}%` `` patterns (the only literal is a seed filter). |
| I-3…I-6 | Info | Not re-verified | — |

## 3. P1 invariants re-checked against the P2/P3 modules

| Invariant | Result | Evidence |
|---|---|---|
| Every route has a contract and a permission | **Holds** | 347 routes, 330 of them project routes. The boot-time contract check (`contract-check.ts`) passes in every test app, and the guard returns 500 for an unbound handler. Only 7 non-public routes are `authenticated`: `me`, `setLocale`, `logout`, `listProjects`, `listTemplates`, `directory` (permission checked in the service) and `myWork` (filtered with `policy.can` per item). |
| 404, not 403, out of scope | **Holds** | Guard: a project outside the principal's scope → 404. IDOR sweep (C6): every foreign id under the caller's own project path → 404. Where route-level RBAC answers 403, it does so before any id lookup, so the answer does not depend on the id. |
| RLS and GUCs on every project table | **Holds** | C10: 96/96 project tables have RLS, except the 4 documented infrastructure tables. All seven GUCs are set per transaction: `app.org_id`, `app.user_id`, `app.project_ids`, `app.full_project_ids`, `app.room_ids`, `app.room_only` and `app.correlation_id`. `app.room_only` is computed correctly for real room-only principals (C6). |
| Composite FKs and same-project guards | **Holds** | C10: no FK between project tables lacks `project_id`. 14 polymorphic references have triggers, and `document.current_version_id` has a deferred check. **Exception by design:** `legal_entity` is organisation-level and shared, which enables SEC-P1R-03. |
| Separation of duties (`not_self`) | **Holds in every sampled path** | All 54 `not_self` permissions in the matrix were traced with `grep`. Permissions with no call site at `08981f2` belong to features that are not implemented yet: `admin.access.suspend`, `admin.clearance.grant`, `config.template.publish`, `config.template_migration.approve`, `gates.definition.approve`, and the JV, finance, imports and integrations permissions. Every implemented approve, verify or decide call passes `requesterUserId`: governance, planning, gates and waivers, carve-out perimeter and transfer, NewCo incorporation and regulatory, readiness sign-off, go/no-go and TSA exit, documents evidence, claim and dispose, and AI proposal, autopilot and kill switch. The only calls without a requester are non-approval checks: readiness `reopen` (`checks.service.ts:485`) and the TSA-exit pre-checks (`tsa.service.ts:497,517`), each followed by the requester-bound check. **Latent risk (I-R3):** `not_self` and `authority` pass when the attribute is omitted (`engine.ts:74-78`), although the header comment says conditions fail closed. |
| External accounts | **Holds at the API and grant level** | API → 422 `db.external_account_role`. The DB trigger rejects internal roles and non-`external_partner_limited` room grants for external accounts. Accountable owners in carve-out, NewCo and readiness must be internal full members (`carveout.support.ts:81-93`, `newco.support.ts:76`, `readiness.support.ts:68-77`). Residual I-R1: the type can be flipped after the grant. |
| Classification inside SQL (lists, counts, search) | **Holds for lists and totals; not for evidence counters** | `visibilitySql` and `reachSql` appear in both the list and the count for perimeter, transfers, agreements, consents, regulatory, readiness checks, cutover and TSA, and in the AI chunk retrieval (`ai-knowledge.service.ts:62-110`, ACL before rank and LIMIT). Evidence counters on register rows count links to documents the caller cannot read (SEC-P1R-05). |
| Audit on denials | **Holds, with gaps** | Detached audit for mutation 403, 404, 409 and 422 (`errors.ts:113-123`) and for CSRF. Gaps: SEC-P1R-01 and SEC-P1R-06. |
| S3 storage adapter (`049cf54`) | **Holds** | Keys are UUID-path only (`STORAGE_KEY_PATTERN`), checked before any I/O. SigV4 signs the payload hash. `redirect: 'error'` (C6: 0 hits on the redirect target). A timeout is set. Errors carry only the HTTP status and S3 code. Production requires https and an allow-listed endpoint. Helm passes the credentials via `secretKeyRef`. There are no presigned or public links. Residual: I-R4. |

## 4. New findings

The failing tests for SEC-P1R-01…06 are in `apps/api/test/reviews/sec-p1-rereview.spec.ts` (C11, C12).

| ID | Sev | Location (`08981f2`) | Finding | Reproduction | Recommendation |
|---|---|---|---|---|---|
| **SEC-P1R-01** | Low | `apps/api/src/platform/hub.guard.ts:100-114` | **CSRF-denial audit runs before the rate limiter.** Each request with a valid session cookie and a missing or wrong `x-csrf-token` writes a hash-chained `audit_event` row in its own detached transaction and pool connection. The per-session mutation limiter (120/min) is only consulted afterwards. Any session holder (or a compromised browser extension) can therefore grow the audit chain and use connections without bound, which is the flooding the adjacent comment says the limiter path avoids. | `DEFECT SEC-P1R-01`: 150 POSTs without the header → `{"403":150}`, 150 audit rows, no 429. | Apply the limiter (or a dedicated per-session security-event bucket) before auditing. Aggregate repeated CSRF failures (for example, one audit row per session per minute with a count). |
| **SEC-P1R-02** | Low | `apps/api/src/modules/portfolio/portfolio.service.ts:83-106,632-643` | **Activity feed: events of records with inherited visibility stay visible** (residual of SEC-P1-03). `CLASSIFIED_ENTITIES` covers only tables with their own `classification` or `room_id` column. Meetings, agenda items, committee memberships and authority-matrix versions inherit the committee classification. Actions and escalations inherit the decision classification, and source claims inherit the source record's. Their events stay listed, with entity id, action, actor and time, and with the free-text reason for auditors. The `entityType/entityId` filter is again an existence oracle. | `DEFECT SEC-P1R-02`: the demo steering committee is reclassified `restricted`. Auditor (confidential) `GET meetings/<id>` → 404, but `activity?entityType=meeting&entityId=<id>` → total 14, first item `governance.minutes.approve` by "Demo Committee Chair". | Map each child entity type to its parent's visibility: meeting, agenda item and membership → committee; action and escalation → decision; claim → source record. Better, reuse each module's own visibility predicate. Add tests per inherited type. |
| **SEC-P1R-03** | **Medium** | `apps/api/src/modules/newco/legal-entities.service.ts:53-65,110,183-235` (`loadLinked`, `update`, `recordIncorporation`, `verifyIncorporation`; history filter at `:110`) | **A shared legal entity can be changed from another project, with no trace in the owning project.** `legal_entity` is organisation-level and may be linked to several projects (spec §5). Any `newco.legal_entity.manage` or `newco.incorporation.manage` holder in any linked project can rename it, change its registration reference or jurisdiction, or record an incorporation status. That includes recording `unconfirmed`, which needs no evidence and resets the Legal verification. The owning project's history is filtered to its own snapshots, the audit rows carry the acting project's id, and the owning project's status dimensions are not recomputed. Members and project auditors of project A therefore see a changed NewCo fact with no history, no audit trail and stale dimensions, and the change was made by people with no access to A. This breaks the "two isolated projects" property for a record that gates rely on. | `DEFECT SEC-P1R-03`: the DC NewCo is linked to project B (as `…/legal-entities/link` would do). `pm.b` (member of B only) `PATCH`es it → 200. The DC view shows the new name, with DC history `[]` and DC activity total 0. | Choose one: (a) require the manage or verify permission in **every** project linked to the entity; (b) let only the creating ("owning") project edit it and give the others read-only access; or (c) fan the change out: record-version and audit rows in every linked project, and recompute dimensions for each. Whatever the choice, show cross-project changes in each linked project's history. |
| **SEC-P1R-04** | Low | `apps/api/src/modules/documents/evidence.service.ts:66-81,106-146`; contract `documents.listEvidence` (access `documents.document.read`) | **Listing evidence ignores the target module's read permission and workstream reach.** `loadTarget` checks only that the target exists and, where there is one, its classification. A contributor, who has `documents.document.read` but not `jv.deal.read`, can read the evidence links of a JV closing condition: note text, purpose, reviewer, and the titles of visible documents. A workstream-scoped principal can likewise read evidence on other workstreams' tasks (static reading, not executed). 200 versus 404 is also an existence oracle for target ids. It is exploitable only with a known target UUID (UUIDv7, not enumerable). | `DEFECT SEC-P1R-04`: a closing condition plus a note-only link (owner fixtures). Contributor `GET …/evidence?targetType=closing_condition&targetId=<id>` → 200 with the note. An unknown id → 404. | In `loadTarget`, require the target type's **read** permission (for example a `EVIDENCE_TARGET_READ_PERMISSION` map: `jv.deal.read`, `finance.record.read`, `planning.plan.read` with `reachSql`/workstream, …) and return 404 when it is missing. |
| **SEC-P1R-05** | Low | `apps/api/src/modules/readiness/checks.service.ts:188-196`, `carveout/carveout.support.ts:106-118`, `newco/newco.support.ts:102-113`, `planning/planning-support.ts:144-160`, `platform/helpers.ts:115-120` | **Register evidence counters count links the caller cannot read.** The evidence list omits links to documents above the caller's clearance or in rooms they are not granted, and its contract says "including from the total". The `evidence: {active, conflicting}` counters on readiness checks, perimeter items, agreements, legal entities, tasks, milestones and deliverables count them anyway. The caller learns that restricted or clean-team evidence exists on a record. | `DEFECT SEC-P1R-05`: restricted evidence is linked to a DC readiness check. For the contributor, the evidence list total is 0 while the register counter is `{"active":1}`. | Keep the unfiltered count for rule evaluation (gates and sign-off must count all evidence). For **display**, join `document` and apply `visibilitySql`, or return "n visible of m (some not shown)" without the hidden number. |
| **SEC-P1R-06** | Low | `apps/api/src/platform/errors.ts:113-123`, `platform/audit.service.ts:57-70` | **Denied cross-project mutations are audited without the attempted project or target** (residual of SEC-P1-11, whose recommendation this was). `recordDetached` drops an out-of-scope `projectId` (RLS `WITH CHECK`) and replaces the reason with the error code. The route params, including the target id, are not kept. An investigator cannot tell which project or record was probed. | `DEFECT SEC-P1R-06`: `pm.b` `POST A/members/<id>/revoke` → 404, and the audit row is `{"project_id":null,"entity_id":null,"after":null,"reason":"not_found: Resource not found"}`. | Store the attempted `projectId` and the route's id params as plain values in `after` (not FKs). They are only visible to org-level security-event readers. |
| I-R1 | Info | `packages/db/sql/post-migrate.sql:804-829`; `hub_app` has UPDATE on `app_user.account_type` | The account-type guard fires on role and grant rows, not on `app_user`. Flipping an internal user who holds project roles to `external` is accepted and leaves internal roles on an external account. No API path changes `account_type` today. | C6: `UPDATE app_user SET account_type='external'` on the demo contributor → accepted. | Add an `app_user` trigger that refuses the flip while internal roles or grants are active. Alternatively, revoke UPDATE on the column from `hub_app`. |
| I-R2 | Info | `apps/api/src/platform/config.ts:84-110` | Production validation still accepts: `HUB_TRUST_PROXY=0.0.0.0/0` or `::/0` (trust everyone); a cookie secret made of 12 repeated characters; `HUB_OIDC_LINK_BY_EMAIL=true` (safe now, but it is a standing takeover-by-IdP-email trust decision); `HUB_PRIVATE_MODE=false`; and the MinIO default credentials `minioadmin/minioadmin`. | C9 | Reject catch-all trust-proxy CIDRs and known default S3 credentials. Use an entropy estimate for secrets. Log a startup warning for link-by-email. |
| I-R3 | Info | `packages/domain/src/policy/engine.ts:57-80` | `not_self` passes when `subjectRequesterId` is missing, and `authority` passes when `withinAuthority` is `undefined`. The header comment says conditions that cannot be evaluated fail closed. All call sites sampled in §3 supply the attribute. A future call site that forgets it silently loses separation of duties. | Code reading. | Make `not_self` and `authority` fail closed when the attribute is `undefined`, with an explicit `null` meaning "no requester", and add a unit test. |
| I-R4 | Info | `deploy/helm/transformation-hub/templates/_helpers.tpl:190-214`, `config.ts` (`HUB_S3_SSE` default `none`) | S3 server-side encryption is never required, and the chart cannot set `HUB_S3_SSE` or `HUB_S3_KMS_KEY_ID`, so production relies on the bucket's default encryption. The chart also sets `HUB_S3_FORCE_PATH_STYLE`, which the API does not read. | C9: `HUB_S3_SSE=none` accepted in production. | Wire `storage.s3.sse` and `kmsKeyId` in Helm. Require SSE in production unless an explicit "bucket default encryption verified" flag is set. |
| I-R5 | Info | `packages/db/sql/post-migrate.sql:439-444`, `oidc.service.ts:124-135` | The OIDC subject and email lookups do not exclude `is_service_account` users. A service account that had an email or subject could receive an interactive session. | Code reading. | Filter `NOT is_service_account` in both functions, or refuse such users in `complete()`. |

## 5. NOT EXECUTED

- A real enterprise IdP, MFA, https issuer, real ingress or TLS, and a multi-replica rate limiter. None exists in this environment.
- A connection to a real S3-compatible store. The adapter was exercised against local redirecting servers (C6) and the repository's `FakeS3` contract suite (part of C3). Connecting to Mobily storage is **Not configured**.
- The Playwright E2E suite, and the XSS browser probe of the first review. The web client's XSS sinks were not re-audited beyond `safeNext`.
- The workstream-reach variant of SEC-P1R-04 (static reading only).
- JV and finance controllers. `apps/api/src/modules/jv` and `finance` have only seeds and jobs at `08981f2`, so no route could be probed.
- AI prompt-injection, egress and kill-switch behaviour beyond reading the code. The repository's AT-17…AT-22 and AT-28 suites passed as part of C3, but the reviewer did not probe them independently.
- I-3…I-6 of the first review were not re-verified.

## 6. Verdict

**PASS with conditions** for the P1 security gate at `08981f2`.

- The only High of the first review, SEC-P1-01 (OIDC account takeover), is fixed. The fix withstood variants of the original reproduction plus a string `email_verified` and a concurrent-link race.
- SEC-P1-02 and SEC-P1-04 are fixed. SEC-P1-03 is fixed for every entity that carries its own classification or room; its residual is SEC-P1R-02 (Low).
- There is no open Critical or High.
- The core P1 invariants hold across the P2/P3 modules:
  - RLS and all seven GUCs on every project table;
  - composite and same-project FKs;
  - org-scoped user FKs;
  - 404 on foreign ids;
  - room-only principals confined to their rooms;
  - external-account guards;
  - `not_self` in every sampled approve and verify path;
  - classification inside SQL for lists and totals.

The items under §5 NOT EXECUTED are blocked by the environment. No enterprise IdP, ingress or object store is configured, and the JV and finance controllers do not exist. The first review could not execute them either. The verification the P1 exit criterion needs was executed: isolation of two projects, denied unauthorised access, authentication, sessions, CSRF and configuration (C2–C12). Persistence across a restart was **not** re-tested in this re-review. The first review observed it (§4 of that report).

Conditions, which must be carried with owners:
1. **SEC-P1R-03 (Medium, NewCo)**: fix before the **P3** gate. Cross-project writes to a shared legal entity are invisible to the owning project.
2. **SEC-P1R-01, -02 and -06 (Low, platform)**: fix in the next platform hardening pass. They are CSRF audit flooding, the inherited-visibility gap in the activity feed, and denial audit without the attempted ids.
3. **SEC-P1R-04 and -05 (Low, documents/evidence)**: fix before the **P2/P3** gate re-check.
4. Add an automated test for `safeNext` (SEC-P1-05). Track I-R1…I-R5.

The six `DEFECT SEC-P1R-0n` tests fail on purpose (C11, C12: 6 failed, 458 passed). They must turn green with the fixes. They must not be skipped or weakened.

## Fix status (implementation, 2026-09-30)

Appended by the implementing `backend-data-engineer` (not the reviewer). The reviewer's text above is unchanged.
Implementation commits on branch `worktree-agent-a56863fb27b864dea`: `0d1542e` and `8c685f6` (work in progress, merged with `claude/mobily-transformation-hub` @ `223e967` in `7d5e823`) and **`d87a6d3`** (final: docs, ADR-0017, threat model, module guide, web i18n entry for the new outbox event type).
The six reviewer tests keep their assertions and were renamed from `DEFECT SEC-P1R-0n …` to `SEC-P1R-0n …`
(`apps/api/test/reviews/sec-p1-rereview.spec.ts`). Additional regression tests: `apps/api/test/p1/sec-p1r-fixes.spec.ts`,
`apps/api/test/p1/oidc-sso.spec.ts` (I-R5), `apps/api/test/documents/storage-contract.spec.ts` (I-R2/I-R4),
`packages/domain/src/policy/policy.test.ts` (I-R3), `packages/domain/src/documents.test.ts` (SEC-P1R-04).
Verification (own database `hub_test_secfix`, source identical to `d87a6d3` for API and packages):
full API suite `Test Files 59 passed (59)`, `Tests 527 passed (527)` (315.69 s); the five security spec files verbose
`Tests 78 passed (78)`; domain `Tests 248 passed (248)`; contracts `Tests 69 passed (69)`; `pnpm lint` exit 0;
`apply_status.py --check` OK. Baseline before the fixes (`581493a`, i.e. before merging `223e967`): `Test Files 1 failed | 53 passed (54)`, `Tests 6 failed | 473 passed (479)` — the six DEFECT tests.

### SEC-P1R-01 (Low) — Fixed
- `hub.guard.ts`: the per-session rate limiter now runs **before** the CSRF check, so a CSRF-failing request consumes the
  mutation budget (120/min default) and the rest get 429 (logged, not audited).
- CSRF denials are **coalesced** per session and minute (`RateLimiter.tally`): the first denial of each window is audited
  with its correlation id, then one row when the window's count reaches 10, 100, 1000 …, each with
  `after.deniedInCurrentMinute`; every denial is still logged with session and correlation id. ADR-0017 amended.
- Tests: `SEC-P1R-01: CSRF denials are audited BEFORE the rate limiter, …` (reviewer; now 403×120 then 429, ≤ 120 rows);
  `SEC-P1R-01: one audit row for the first denial of the minute (with its correlation id), then at 10 and 100; 429 after the budget`
  (rows `[1, 10, 100]`); `SEC-P1-11: CSRF denials are audited …` still passes.

### SEC-P1R-02 (Low) — Fixed
- New `apps/api/src/platform/record-visibility.ts` (`RecordVisibility`): one SQL rule per entity type — own
  classification / room; visibility inherited from the parent (meeting, agenda item, committee membership, authority
  matrix version → committee; action item → decision when linked; escalation → decision when raised about one; source
  claim → source record; document version → document; evidence link → document **and** target); polymorphic records
  (AI proposal, approval request, waiver, RAG override) → their target; and, for non-auditors, the workstream reach of the
  type's read permission. The activity feed applies it inside SQL for the list and the total, as one
  `CASE entity_type WHEN … END` (only the matching branch runs per row).
- Performance note found while fixing: the per-type predicate triggered PostgreSQL JIT (42 s of compilation for a query
  that runs in 74 ms). `DbService.applyContext` now sets `jit = off` per request/job transaction (OLTP workload).
- Tests: `SEC-P1R-02: the activity feed still shows events of records whose visibility is inherited …` (reviewer; total 0);
  per inherited type `SEC-P1R-02: events of a <type> disappear when its <parent> becomes restricted (auditor, list and total)`
  for agenda_item, committee_membership, authority_matrix_version, action_item, escalation, source_claim,
  document_version and evidence_link (each with a positive control); `SEC-P1R-02: a workstream-only reader sees task events
  of its own workstream only (reach of planning.plan.read)`; `SEC-P1-03 …` still passes.

### SEC-P1R-03 (Medium) — Fixed (single-writer model)
- Model: a legal entity has ONE owning project, the one that created it (`legal_entity.owner_project_id`, NOT NULL, set by
  `LegalEntitiesService.create` and by project creation, immutable). Only the owning project changes it: descriptive
  edits, incorporation record / verify, setup-wizard NewCo step. Linked projects read it (`ownedByThisProject: false` in
  the DTO) and get **403 `newco.legal_entity.not_owner`** (the owning project is not named).
- Database: restrictive RLS policies on `legal_entity` (INSERT only for an in-scope owner; UPDATE only for full members of
  the owner), composite `(org_id, owner_project_id)` FK, immutability trigger (`immutable_owner`).
- Changes made in the owning project are fanned out: one `legal_entity.changed` outbox event per other linked project
  (ids from the SECURITY DEFINER function `hub_legal_entity_linked_projects`, callable only by owner members); the NewCo job
  records `newco.legal_entity.changed_in_owning_project` in that project's activity (ids, change kind, version only) and the
  gates job recomputes its status dimensions. Documented in `docs/architecture/module-guide.md` §2; threat model T-63a.
- Schema change → the single migration `0000_initial_schema.sql` was regenerated (one added column + FK).
- Tests: `SEC-P1R-03: a shared legal entity can be changed from another project …` (reviewer; now 403);
  `SEC-P1R-03: the linked project gets 403 newco.legal_entity.not_owner on every change; the owner changes it and the linked project is told`;
  `SEC-P1R-03: database — only full members of the owner update it, the owner is immutable, and the link fan-out needs the owner`.

### SEC-P1R-04 (Low) — Fixed
- `EVIDENCE_TARGET_READ_PERMISSION` (domain) maps every evidence target type to its READ permission. `EvidenceService.loadTarget`
  requires it, full (non room-only) membership, and the target's own visibility through `RecordVisibility` (classification —
  own or inherited —, workstream reach); NewCo targets follow the NewCo read rule. It guards the list and the link commands
  (verify, flag-conflict, supersede, link); anything else is 404. Document detail counters count only links whose target
  the caller can read.
- Tests: `SEC-P1R-04: listing evidence does not check the target module read permission …` (reviewer; now 404);
  `SEC-P1R-04: evidence of a restricted decision and link commands on an unreadable target are 404`;
  `SEC-P1R-04: a workstream-only reader cannot list evidence of another workstream's task (404), but can for its own`
  (the reach variant the review could not execute); domain `Evidence target read permissions (SEC-P1R-04)`.

### SEC-P1R-05 (Low) — Fixed
- `visibleEvidenceCounts` / `evidenceLinkVisibleSql` (platform helpers) count display counters with the evidence list's
  predicate (link room + document classification / room). Used for readiness checks, TSA services, cutover plans,
  perimeter items and transfers, agreements, legal entities, regulatory requirements, tasks, milestones, deliverables,
  gate criteria and the AI closing-condition context. Rules (gates evaluation, sign-off, transfer / incorporation /
  regulatory verification, TSA exit, perimeter reconciliation) keep the unfiltered `activeEvidenceCount`.
- Tests: `SEC-P1R-05: register evidence counts include links to documents the caller cannot read` (reviewer; counts agree);
  `SEC-P1R-05: task counters and document counters count only evidence the caller could list`.

### SEC-P1R-06 (Low) — Fixed
- `ProblemFilter` stores the attempted ids of a denied / rejected mutation as plain values in
  `after.attempted = { projectId, <idParam>: … }` — UUID-shaped route params only, never body content. The row's
  `project_id` stays null for an out-of-scope project (RLS).
- Tests: `SEC-P1R-06: a denied cross-project mutation is audited without the attempted project or target` (reviewer);
  `SEC-P1R-06: an out-of-scope PATCH records the attempted project and target ids as plain values, no body content`.

### I-R1 (Info) — Fixed
- Trigger `hub_account_type_flip_guard` on `app_user.account_type`: switching to `external` is refused while internal
  project / workstream memberships, org roles, committee memberships or non-`external_partner_limited` room grants are active
  or future-dated. Test: `I-R1: flipping account_type to external is refused while an internal grant is active, allowed after revocation`.

### I-R2 (Info) — Fixed
- Production refuses trust-everyone `HUB_TRUST_PROXY` ranges (`0.0.0.0/0`, `0/0`, `::/0`, IPv4 wider than /8, IPv6 wider
  than /16, `::ffff:0:0/96`); default / example S3 credentials (`minioadmin`, `minio123`, AWS documentation keys …) and S3
  secrets shorter than 16 characters; and `HUB_OIDC_LINK_BY_EMAIL=true` unless
  `HUB_OIDC_LINK_BY_EMAIL_ACK=accept-idp-verified-email-first-login-binding`. Choice: link-by-email stays available
  (first-login binding of pre-provisioned accounts, hardened by SEC-P1-01) but is an explicit, acknowledged trust decision
  in production and is logged as a startup warning. `weakSecret` adds an entropy estimate (Shannon × repetition
  (deflate) × sequence discount, floor 64 bits; distinct-character floor lowered from 12 to 8 because random 32-hex secrets
  often show 11): `'abcdefghijkl'×3`, `'Password123!'×3` and sequences are refused; 2 000 random base64 / hex secrets pass.
  `HUB_PRIVATE_MODE=false` remains accepted (a deployment choice, not a weakness).
- Tests: `I-R2: trust-everyone proxy ranges are refused; …`, `I-R2: link-by-email must be explicitly acknowledged …`,
  `I-R2: weak-but-varied cookie secrets are refused …`, `I-R2: default MinIO / documentation S3 credentials are refused`,
  and the S3 block of `storage-contract.spec.ts`.

### I-R3 (Info) — Fixed
- `evaluateConditions`: `not_self` without the subject's requester (undefined, null or empty) or without the actor, and
  `authority` without an explicit result, now **fail closed** and are reported in `AbacResult.missing`;
  `PolicyService` answers 403 `policy.sod_subject_unknown` / `policy.authority_unknown`. `NO_HUMAN_REQUESTER` states
  explicitly that no human requester exists (system-generated escalation; criterion reviewed with no evidence linked) — it
  is never inferred from null. `PolicyService.assertApproval` checks role → state → separation of duties so that a command
  in the wrong state stays 422; `assertGranted` is a role-level pre-check. Every `not_self` / `authority` call site was
  reviewed: authority is now passed explicitly everywhere (role authority where the delegation matrix has no decision type,
  commented at the call site — planning baseline / change requests, charter / matrix approval, outcome recording, TSA exit,
  perimeter rejection).
- Tests: domain `I-R3: separation of duties and authority fail CLOSED when their inputs are missing` (8 cases, incl. every
  matrix permission with `not_self`/`authority`); API `I-R3: approving a deliverable weight whose setter is unknown is refused with 403 policy.sod_subject_unknown (and audited)`.

### I-R4 (Info) — Fixed
- Production with `HUB_STORAGE_DRIVER=s3` requires `HUB_S3_SSE=AES256|aws:kms` unless
  `HUB_S3_BUCKET_DEFAULT_ENCRYPTION=assured` (logged as a startup warning). Helm: `storage.s3.sse` (default `AES256`),
  `kmsKeyId`, `bucketDefaultEncryptionAssured` wired to the env; the unused `HUB_S3_FORCE_PATH_STYLE` was removed.
- Tests: `I-R4: S3 objects must be encrypted server-side in production unless the bucket default encryption is assured`;
  `storage-contract.spec.ts` configuration test. Helm rendering was NOT EXECUTED (no `helm` binary here; CI lints the chart).

### I-R5 (Info) — Fixed
- `OidcService.complete` refuses service / non-person accounts (`oidc.service_account`), link-by-email never binds one,
  and `hub_auth_session` reports a service account's session as inactive (defence in depth).
- Tests: `I-R5: a service / non-person account never signs in interactively, …`, `I-R5: link-by-email never binds a service account, and a service account session is never valid`.

### Residuals / follow-ups
- Web (not in this change): the NewCo entity screens should hide edit / incorporation actions when
  `ownedByThisProject` is false (the server already answers 403).
- The planning baseline / change-request approvals have no delegation-matrix decision type: their `authority` is the role
  grant, now stated explicitly at the call sites (I-R3) rather than implied.
