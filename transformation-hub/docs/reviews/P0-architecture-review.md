# P0/P1-foundation architecture review (independent)

| Item | Value |
|---|---|
| Reviewer | `solution-architect`, REVIEW mode. Ran as a general-purpose subagent with its own context, following `.claude/agents/solution-architect.md` and `.claude/AGENT_RULES.md` (see ADR-0015). The reviewer did not author the reviewed artifacts. |
| Revision reviewed | **`e2daae7`** on branch `claude/mobily-transformation-hub` ("P0 docs and P1 foundation: API platform, identity, portfolio, demo seed") |
| Note on HEAD | HEAD moved to `9901330` while this review was running. All findings and line numbers refer to `e2daae7`. Where `9901330` changes an in-scope file, the finding says so (`errors.ts`, `portfolio.service.ts` duplicate check, new `platform/helpers.ts`). `packages/db/**`, `post-migrate.sql`, `db.service.ts`, `hub.guard.ts`, `policy.service.ts`, `auth/*`, `jobs/*`, `identity/*` and the ADRs are **byte-identical** between the two commits (`git diff e2daae7 HEAD` on those paths is empty). |
| Database probed | local `hub_dev`, PostgreSQL 16.13, schema from the same migrations and `post-migrate.sql` |
| Scope | Master prompt §13–§16, `CLAUDE.md`, ADR-0001…0015, `packages/db/sql/post-migrate.sql`, `packages/db/src/schema/*.ts`, `apps/api/src/platform/**`, `apps/api/src/modules/{portfolio,identity}/*.ts`, `packages/contracts/src/*.ts`, `apps/api/src/cli/openapi.ts` |
| **Verdict** | **FAIL**: 0 Critical, **2 High**, 11 Medium, 7 Low |

---

## 1. Commands run and real output

All commands were read-only. Probes 5, 8 and 9 ran inside `BEGIN … ROLLBACK`, and a follow-up query (8b) confirmed that nothing persisted.

**1. Revision**
```
$ git -C /home/user/My-owns log --oneline -1      (at start of review)
e2daae7 P0 docs and P1 foundation: API platform, identity, portfolio, demo seed
$ git -C /home/user/My-owns branch --show-current
claude/mobily-transformation-hub
```

**2. Role attributes** (owner connection)
```
  rolname  | rolsuper | rolbypassrls | rolcreaterole | rolcreatedb
 hub_owner | f        | f            | f             | f
 hub_app   | f        | f            | f             | f
```

**3. RLS coverage and policies**
```
 rls_on | rls_off | forced
     95 |       5 |      0          -- rls_off = delivery_record, job, outbox_event, scheduled_job, session
       policyname        |  cmd   | tables | has_with_check
 hub_membership_access   | ALL    |      1 | t
 hub_notification_read   | SELECT |      1 | t
 hub_notification_update | UPDATE |      1 | t
 hub_notification_write  | INSERT |      1 | t
 hub_org_isolation       | ALL    |      9 | t
 hub_org_self            | ALL    |      1 | f   (USING doubles as WITH CHECK)
 hub_project_isolation   | ALL    |     82 | t
 hub_project_self        | ALL    |      1 | t
```

**4. Runtime role with no context** (`psql -U hub_app`)
```
 task_no_ctx 0 | project_no_ctx 0 | app_user_no_ctx 0 | audit_no_ctx 0 | jobs_visible 0
 sessions_visible 7 (orgs 1) | outbox_visible 16          -- exempt tables are readable by the API role
(owner view: tasks 116, projects 2, audits 23, sessions 7)
```

**5. Scope, WITH CHECK, and caller-settable GUC** (hub_app, rolled back)
```
 scope=B only            | tasks_visible 14 | projects_visible 1
 UPDATE task … WHERE project_id = A                      -> UPDATE 0
 UPDATE task SET project_id = A …                        -> ERROR: new row violates row-level security policy for table "task"
 select set_config('app.project_ids', A, true); count(*) -> tasks_visible 102   (any SQL running as hub_app can widen its own scope)
```

**6. Transaction-local context does not leak across pooled use**
```
 inside tx                      | project_ids 01a0ecc6-e691-… | tasks 102
 COMMIT
 after COMMIT (same connection) | <empty>                     | tasks 0
```

**7. Composite-FK coverage**
```
-- FKs between two project-scoped tables that do NOT include project_id:
(0 rows)
-- project-table *_id columns with NO FK at all (excerpt of 66 rows):
action_item.issue_id, agreement.executed_document_id, baseline_version.change_request_id, change_request.decision_id,
closing.confirmation_decision_id, closing_condition.waiver_id, closing_deliverable.document_id, committee.charter_document_id,
committee_membership.delegate_of_membership_id, criterion_assessment.waiver_id, cutover_plan.runbook_document_id,
dependency.predecessor_id, dependency.successor_id, diligence_finding.risk_id, diligence_request.evidence_document_ids (jsonb),
document.current_version_id, document_chunk.room_id, escalation.raised_to_committee_id, escalation.resolution_decision_id,
evidence_link.conflict_with_link_id, evidence_link.target_id, financial_model_version.source_document_id,
financial_snapshot.source_document_id, gate_assessment.decision_id, gate_assessment.supersedes_assessment_id,
import_batch.document_version_id, meeting.authority_matrix_version_id, meeting.pack_snapshot_id,
report_snapshot.baseline_version_id, report_snapshot.previous_snapshot_id, source_claim.conflict_with_claim_id,
source_record.supersedes_source_id, tsa_service.escalation_id, vote.authority_matrix_version_id, vote.meeting_id,
vote.user_id, recusal.user_id, attendance.user_id, notification.user_id, approval_record.approver_user_id, …
(polymorphic: approval_request.subject_id, change_request.subject_id, waiver.target_id, source_claim.target_id,
 raci_assignment.entity_id, rag_override.entity_id, ai_proposal.target_id, import_row.target_id, escalation.source_id)
$ grep -rn assertSameProject  (e2daae7, code)   -> no matches (only in CLAUDE.md:58, threat-model.md:203, requirements.yaml:4261, an agent file)
```

**8. REQ-DAT-002 acceptance probe.** REQ-DAT-002's acceptance test is "linking Project A evidence to Project B task rejected by DB". Run as hub_app with both projects in scope, rolled back:
```
INSERT INTO evidence_link (…, project_id=B, target_type='task', target_id=<task of A>, …)  -> INSERT 0 1   (accepted)
INSERT INTO milestone (…, project_id=B, workstream_id=<workstream of A>)                  -> ERROR: … violates foreign key constraint "milestone_ws_fk"
ROLLBACK
(8b) evidence_link rows persisted: 0
```

**9. SECURITY DEFINER functions and `search_path`**
```
 hub_audit_chain / hub_audit_verify / hub_auth_org_by_slug / hub_auth_session / hub_auth_user_by_email /
 hub_auth_user_by_subject / hub_auth_user_scope  | prosecdef t | owner hub_owner | proconfig {search_path=public} | exec hub_app
 has_schema_privilege(hub_app, public, CREATE) = f ; has_database_privilege(hub_app, hub_dev, TEMP) = t
-- temp-table shadowing (hub_app, rolled back):
 select hub_auth_org_by_slug('mobily')                     -> bc8fc679-970c-45e7-b446-c9e69fff7c9f
 CREATE TEMP TABLE organization …; INSERT fake row; GRANT SELECT … TO hub_owner;
 select hub_auth_org_by_slug('mobily')                     -> 00000000-0000-0000-0000-00000000beef
```

**10. Grants, timeouts, triggers**
```
 hub_app on audit_event: INSERT, SELECT | vote: INSERT, SELECT
 hub_app on organization / project / org_role_assignment / session / job: SELECT, INSERT, UPDATE, DELETE
 rolconfig hub_app: (null); statement_timeout 0; idle_in_transaction_session_timeout 0; lock_timeout 0
 triggers: hub_append_only on audit_event, vote, record_version, approval_record, transfer_record, readiness_test_run,
           report_snapshot; hub_audit_chain (BEFORE INSERT) on audit_event; hub_document_guard on document.
           No statement-level TRUNCATE trigger. None on attendance, recusal, document_version.
 indexes: audit_event_chain_uq UNIQUE (org_id, chain_pos); project_org_code_uq UNIQUE (org_id, code); job_idempotency_uq
```

**11. Audit chain**
```
 select * from hub_audit_verify('bc8fc679-…')  -> (0 rows)  -- intact; 23 events, chain_pos 1..23
```

**12. PolicyService probe** (compiled `apps/api/dist/platform/policy.service.js`; source unchanged since e2daae7)
```
guard canInProject(documents.document.read) = true     <- clean_team-only principal, via room role
canSee(non-room internal document)       = true        <- list-filter primitive
can(documents.document.read, non-room doc)= false
RLS app.project_ids for this principal    = p1         <- whole project in RLS scope
PM grant sponsor (withinAuthority=false)  = false
PM revoke sponsor (as revokeMembership)   = true
```

**13. Drizzle error wrapping** (relevant to ARCH-11)
```
drizzle-orm@0.45.3 pg-core/session.cjs:66,73,84,91,106  throw new DrizzleQueryError(queryString, params, e)
errors.cjs: class DrizzleQueryError … this.cause = cause   (no `code` property)
```

---

## 2. What is sound

- **RLS core.** RLS is on for every table except the five documented infrastructure tables. Every project policy has `WITH CHECK`. `hub_app` is not the owner, has no BYPASSRLS and is not a superuser. With no context it sees 0 rows (probe 4), and re-homing a row into another project is refused (probe 5). Context set with `set_config(..., true)` is transaction-local and reset after COMMIT (probe 6). There is no pool leakage through GUCs.
- **Composite FKs.** Every real FK between two project-scoped tables includes `project_id` (probe 7, 0 rows). `project_membership.workstream_id` is protected (`project_membership_ws_fk`).
- **Audit.** The runtime role has INSERT/SELECT only. Append-only triggers are in place. The hash chain is serialized per org by a transaction-scoped advisory lock and is correct under READ COMMITTED; `UNIQUE (org_id, chain_pos)` makes a fork fail loudly. The chain verifies intact (probe 11). ADR-0014 correctly says "tamper-evident, not tamper-proof".
- **Data conventions.** No float or money types. All instants are `timestamptz`. Every mutable business table has `version`. `updateProject` and `assignWorkstreamLead` use atomic conditional updates that return 409.
- **Outbox and scheduler.** The outbox row is written in the business transaction. Outbox→job fan-out and job-key idempotency (`outbox:<id>:<kind>`, `schedule:<id>:<slot>`) are done in one transaction with `FOR UPDATE SKIP LOCKED`. Schedule double-enqueue is prevented.
- **Guard.** Scope is computed fresh on every request (revocation applies immediately). Project ids outside scope or malformed return 404. Denied or rejected mutations are audited in a detached transaction after the main transaction rolls back, so the advisory lock cannot self-deadlock.
- **ADR honesty.** The ADRs state that the ORM does not enforce isolation (ADR-0003). They impose no external SaaS: PostgreSQL queue instead of Redis, OIDC against Mobily's IdP, S3-compatible or on-prem storage, AI off by default. They do not claim Compose gives high availability, and they avoid "tamper-proof".

---

## 3. Findings

| ID | Sev | Location (e2daae7) | Description | Spec / ADR | Recommendation |
|---|---|---|---|---|---|
| ARCH-01 | **High** | `packages/db/src/schema/governance.ts:143,285,292,312`; `gates.ts:92,120`; `planning.ts:161,163,218,252`; `jv.ts:211,285,311`; `documents.ts:205`; `carveout.ts:59,263`; `finance.ts:45,119`; (probe 7, 8) | **Cross-project link prevention is incomplete.** Dozens of concrete intra-project references have **no FK at all**. Examples: `vote.meeting_id`, `vote.authority_matrix_version_id`, `meeting.authority_matrix_version_id`, `gate_assessment.decision_id`, `criterion_assessment.waiver_id`, `closing_condition.waiver_id`, `change_request.decision_id`, `baseline_version.change_request_id`, `dependency.predecessor_id/successor_id`, `diligence_finding.risk_id`, and the ACL-critical denormalized `document_chunk.room_id` (ADR-0008). Polymorphic targets (`evidence_link.target_id`, `waiver.target_id`, `approval_request.subject_id`, …) have no guard at all. `assertSameProject`, the documented second control (CLAUDE.md:58, threat-model C-07 "P1", REQ-DAT-002 security rule), **does not exist** in code. Probe 8 shows the DB accepts a Project-B evidence link to a Project-A task, which is exactly what REQ-DAT-002's acceptance test says must be rejected. ADR-0003 §Decision 2 says the schema makes cross-project links "impossible". | §14 "constraints preventing cross-project linking merely by submitting another resource ID"; REQ-DAT-002; ADR-0003; ADR-0008 | Add `projectFk()` for every concrete reference (and `(project_id, user_id)`/`org` FKs for user refs). For polymorphic targets, either use typed nullable FK columns with an exactly-one CHECK, or a `BEFORE INSERT/UPDATE` trigger `hub_assert_same_project(target_type, target_id, project_id)` driven by an allowlisted type→table map. Enforce denormalized ACL columns with a composite FK `(project_id, document_id, room_id) → document(project_id, id, room_id)` using `ON UPDATE CASCADE`, or derive them by join. Make the platform helper (at HEAD: `loadInProject`) mandatory for every submitted id. Add the REQ-DAT-002 integration test. Correct ADR-0003 and the ERD note. |
| ARCH-02 | **High** | `apps/api/src/platform/auth/scope.service.ts:61-66`; `policy.service.ts:104-116` (`canSee`), `:73` (`canInProject`); `post-migrate.sql:52-54`; probe 12 | **Room-scoped principals (clean_team, external_partner_limited): both isolation layers fail open for non-room data.** (1) A room grant with a role puts the **whole project** into `app.project_ids`, so RLS exposes every row of that project to an external partner or clean-team member. RLS gives no partner/clean-team isolation. (2) The guard passes project routes for any permission held through a room role (`canInProject`=true). The platform's list-visibility primitive `canSee` (documented as "used to filter lists") returns **true for every resource with `roomId=null`** for a room-only principal. Only `check()` hides these, and list code (the `listProjects` pattern: RBAC + `canSee`/clearance) does not call it. A P2+ list endpoint such as documents, built on the provided primitives, would show all non-room project documents to a clean-team user. Latent in P1 (no endpoint yet serves room data), but it is a flaw in the foundation. | §15 "Enforce isolation in APIs, appropriate database/row policies…"; §8 clean team; AT-03, AT-17; ADR-0003, ADR-0006, ADR-0008 | Make `canSee` deny resources outside the principal's rooms when the principal is room-only (same `roomOnly` rule as `check()`). Better: provide `PolicyService.visibilityPredicate(ctx, projectId)` that emits SQL, so lists and counts filter in SQL. In RLS, carry room-only scope in a separate GUC (`app.room_ids`, `app.full_project_ids`): tables with `room_id` allow `room_id = ANY(app.room_ids)`, and tables without it deny room-only principals. Record the room model in an ADR amending 0003/0006. Add clean-team/external-partner isolation tests. |
| ARCH-03 | Medium | `post-migrate.sql:154,179,224,234,260,309,315` (`SET search_path = public`); probe 9 | SECURITY DEFINER functions do not put `pg_temp` last, so `pg_temp` is searched first for relations. `hub_app` has TEMP and can shadow `organization`, `session`, `app_user`, `project_membership` or `audit_event` inside owner-privileged functions (demonstrated: `hub_auth_org_by_slug` returned an attacker-chosen id). The audit-chain trigger can be fed a forged `prev_hash`/`chain_pos` from a hub_app session. | PostgreSQL SECURITY DEFINER guidance; ADR-0014 | `SET search_path = pg_catalog, public, pg_temp` (pg_temp explicitly last) or `search_path = ''` with schema-qualified names (`public.digest`, `public.audit_event`). `REVOKE TEMP ON DATABASE … FROM hub_app` (and from PUBLIC). `REVOKE EXECUTE ON FUNCTION hub_audit_chain() FROM PUBLIC`. |
| ARCH-04 | Medium | `docs/architecture/adr/0003-postgres-drizzle-rls.md:11,17`; `post-migrate.sql:7-9,32`; `config.ts:50`; probes 4, 5, 9 | **ADR-0003 overstates the guarantees and leaves limits undocumented.** (a) It says "the only RLS bypasses are two" functions; there are **seven** SECURITY DEFINER functions, including `hub_auth_user_scope` (returns any user's grants) and `hub_audit_verify` (any org). (b) The RLS context is caller-settable (probe 5), so RLS protects against missing filters but **not** against SQL injection or compromised app code. (c) FK checks bypass RLS. (d) The owner bypasses RLS (no FORCE). (e) The exempt tables (`session`, `outbox_event`, `job`, …) are fully readable and writable by the HTTP API role across all orgs (probe 4). (f) The production "not owner" check is a username regex. | §14 "Document protection limits"; §15 least privilege; ADR-0003 | Add a "Limits" section to ADR-0003 listing (a)–(f). Use a separate `hub_worker` role for the queue tables and remove the API role's access where it isn't needed. At startup, assert `NOT rolbypassrls AND NOT rolsuper` and that `current_user` owns no tables. |
| ARCH-05 | Medium | `post-migrate.sql:141-175`; `adr/0014-audit-tamper-evidence.md:10-16`; probe 10 | **ADR-0014 limits are incomplete.** `TRUNCATE` (owner) bypasses the row-level append-only trigger (there is no statement-level TRUNCATE trigger). The owner can `ALTER TABLE … DISABLE TRIGGER` without superuser rights. Deleting the chain tail, or the whole table, is **not detectable** by `hub_audit_verify` (an empty or truncated chain verifies as intact). The trusted fields `created_at` and `actor_user_id` are caller-supplied, so a backdated or misattributed row is hashed as valid. | §14 "Append-only audit … Do not call tamper-proof; document limits"; AT-05, AT-27 | Add a `BEFORE TRUNCATE` statement trigger that raises. In the chain trigger, stamp `created_at := clock_timestamp()` and set actor from `app.user_id` (or require equality). Anchor `(org, chain_pos, hash)` periodically to the SIEM/WORM export and verify against the anchor. Update the ADR-0014 wording ("unless the trigger is dropped" → include DISABLE TRIGGER and TRUNCATE). |
| ARCH-06 | Medium | `post-migrate.sql:122,124,144`; `schema/governance.ts:242,262`; `schema/documents.ts:61` | **Append-only coverage does not match the governance docs.** `attendance` and `recusal` are UPDATE/DELETE-able by `hub_app`, although `decision-workflow.md:124` and `committee-charter-draft.md:131` say "votes, attendance and recusals are append-only/immutable". Deleting a recusal re-enables a conflicted member's vote. `document_version` rows (storage key, hash) are mutable, even under legal hold. | AT-05, AT-27; REQ-GOV-024 | Add `attendance`, `recusal` and `document_version` to the append-only set. Model recusal withdrawal and attendance correction as new rows. Allow only scan-status transitions on `document_version`, through a guarded trigger. |
| ARCH-07 | Medium | `apps/api/src/platform/db.service.ts:61-63,86-88,29`; `portfolio.service.ts:259`; `identity.service.ts:66`; probe 10 | **Transaction and ALS hazards in DbService.** (a) Nested `run(ctx2, fn)` silently runs under the **outer** context (`if (existing) return fn()`), so a caller asking for a different principal or scope gets the wrong one. (b) The ALS store is not invalidated on release. Any continuation after COMMIT/ROLLBACK (for example a `Promise.all` sibling after the first rejection) would query a pooled client that may by then carry another request's transaction and RLS context. (c) No `connectionTimeoutMillis`, `statement_timeout`, `idle_in_transaction_session_timeout` or `lock_timeout` (all 0), while the per-org audit advisory lock is held until commit, so one stuck request blocks every audited write in the org. Acquiring a second pool connection inside a transaction (portfolio duplicate check at e2daae7; removed in 9901330) risks pool deadlock. | ADR-0003 "every request runs inside one transaction"; ADR-0014 lock | Throw on a nested `run` whose ctx differs. Mark the store `closed` in `finally` and make `tx()` throw after close (wrap the client). Use `client.release(err)` when ROLLBACK fails. `ALTER ROLE hub_app SET statement_timeout/idle_in_transaction_session_timeout/lock_timeout`. Set Pool `connectionTimeoutMillis`. Forbid `db.pool` use inside request code (lint rule). |
| ARCH-08 | Medium | `apps/api/src/platform/jobs/job-queue.service.ts:67-101`; `worker.service.ts:115` | **Job lease has no fencing and no heartbeat.** `complete()`/`fail()` update by `id` only. The lease is a fixed 120 s with no renewal, so a long job (report render, AI run) is re-claimed and runs **concurrently**, and the stale worker's completion overwrites the new state. Reclaiming an expired lease increments `attempts` but never checks `max_attempts`, so a poison job that crashes the worker is retried forever and never dead-lettered. Backoff has no jitter. | AT-20; ADR-0004 | `WHERE id=$1 AND locked_by=$2 AND attempts=$3` on complete/fail. Add a lease heartbeat. In `claim`, require `attempts < max_attempts`, otherwise mark the job `dead`. Add jitter. |
| ARCH-09 | Medium | `worker.service.ts:120-128`; `scope.service.ts:86-101`; `policy.service.ts:73,132`; `schema/platform.ts:152-171`; ADR-0004 | **The platform does not provide job authorization or AT-19/AT-20 mechanics.** Handlers receive a raw `ClaimedJob` with no context. ADR-0004 promises re-entry "with fresh authorization of the human principal", but the only helper is `servicePrincipal`, which PolicyService allows for **every** permission with `strictly_confidential` clearance. `delivery_record` reconciliation (`sending`→`uncertain`) and restore-time reconciliation (AT-23) exist as schema only. | AT-19, AT-20, AT-23; ADR-0004 | Add a platform `runJob(job, fn)` that resolves `requested_by` fresh through `ScopeService`, fails closed if the principal is inactive or out of scope, and executes inside `db.run`. Limit service principals to an explicit permission list. Implement a `DeliveryLedger` helper before any notification or integration handler. Mark the unimplemented parts of ADR-0004 as "decided, not implemented". |
| ARCH-10 | Medium | `portfolio.service.ts:396-400`; `identity.service.ts:97-160`; `portfolio.service.ts:196-230,342,406`; `session.service.ts:72,99,103`; probe 12 | **The reference mutation flow deviates from the mandate.** (a) `revokeMembership` never computes `withinAuthority`, so a PM can **revoke** sponsor or chair memberships it cannot grant (probe: grant=false, revoke=true). This affects quorum. (b) Identity commands and queries, `listPrograms`, `listTemplates`, `listMembers` and `listWorkstreams` rely only on the guard's RBAC, with no `PolicyService` call in the service, contrary to ADR-0006 ("called in every command/query service method"). (c) Session create and revoke run through `db.pool` outside the business transaction, so a login or deactivation can take effect even if the audit write fails. (d) `deactivateUser` emits no `permission.changed` (§14 cache invalidation) and takes no `expectedVersion`. | §13 mutation flow; §14; §15 SoD; ADR-0006 | Pass `withinAuthority` on revoke (same assignability table as grant). Call `policy.assert*` in every service method. Write the session rows through `db.tx()`. Emit `permission.changed` on deactivation. |
| ARCH-11 | Medium | `apps/api/src/platform/errors.ts:88,91,99`; probe 13 | At e2daae7 `fromPg()` receives Drizzle's `DrizzleQueryError` (no `code`). DB-enforced rejections therefore return **500 and are not audited** as denied or rejected (audit list is 403/404/409/422): RLS WITH CHECK 42501, composite-FK 23503, append-only and legal-hold P0001, unique, serialization. The 500 log line includes the SQL and bound params. **Resolved in `9901330`** (cause-chain walk), which this reviewer did not re-verify by test. Logging of query params on unknown errors remains. | §14 "error logs without secrets"; AT-05, AT-13, AT-27 | Keep the 9901330 fix and add a regression test per error class. Redact `params` from logged `DrizzleQueryError` messages. |
| ARCH-12 | Medium | `portfolio.service.ts:28,457-493`; `contracts/src/portfolio.ts:235-239` | The project activity feed hides sensitive entity types with a **denylist**, on a route guarded only by `portfolio.project.read`. Every new module's entity types (decision, vote, waiver, finance, NewCo…) are exposed by default, including `reason` text, to all project readers, with no classification check. | §15 deny-by-default; AT-03 | Use an allowlist mapping entity type → required read permission, check it per row (ABAC), and push the filter into SQL. |
| ARCH-13 | Medium | `apps/api/src/platform/hub.guard.ts:80` | `void this.sessions.touch(...)` has no `.catch`. Any DB error in the idle-expiry update produces an `unhandledRejection`, which **terminates the process** under Node 22 defaults. No process-level handler exists. | §16 availability | `.catch((e) => log.warn(...))`, plus a process-level handler that logs and exits in a controlled way. |
| ARCH-14 | Low | `portfolio.service.ts:81-97,156-163,414-419` | Counts (open risks, overdue actions, task, workstream and risk counts) are gated by the RBAC-only `canInProject`. Workstream-scoped users therefore receive project-wide counts. Totals are not derived from row visibility. | CLAUDE.md "Counts … inside SQL"; AT-03 | Compute counts through the same visibility predicate as the list (ARCH-02 fix). |
| ARCH-15 | Low | `post-migrate.sql:52-54,106-112,119-124`; `hub.guard.ts:50-72` | RLS and grant details: (a) the notification UPDATE policy lets any in-scope user modify other users' notifications, and org-level INSERT (`project_id NULL`) works for any user; (b) project policies do not tie `org_id` to the project's org (no `(org_id, project_id)` FK); (c) `hub_app` holds DELETE on `organization`, `project`, `org_role_assignment`, `project_membership` and `room_grant`, so grant history can be hard-deleted; (d) the anonymous public-route context gets org-level RLS visibility. | §15 least privilege; §14 soft deletion | Tighten the notification policies. Add an `(org_id, project_id)` composite FK. Revoke DELETE on grant, role and project tables (use soft revoke or archive). Give public routes an empty `app.org_id`. |
| ARCH-16 | Low | `post-migrate.sql:258-296,178-200` | `hub_auth_user_scope`'s portfolio path does not check `p.org_id = ora.org_id`, and `scope_id` has no FK. `hub_auth_user_scope(any user)` and `hub_audit_verify(any org)` are callable by the runtime role for any subject. | §15 least privilege | Add org equality checks. Restrict the verifier to `app_org_id()`, or require the `audit.chain.verify` permission through a wrapper. |
| ARCH-17 | Low | `worker.service.ts:42-45,55-82,100`; `worker.ts:14-19` | Events with zero subscribers are marked dispatched and lost for subscribers added later. `stop()` does not await the in-flight tick before `app.close()`. Missed schedule slots are skipped because the next run is computed from now (reasonable, but undocumented). | ADR-0004; AT-20 | Record `dispatched_to` or keep undispatched events until a subscriber exists. Drain on shutdown. Document the catch-up policy in ADR-0004. |
| ARCH-18 | Low | `hub.guard.ts:121-126`; `bootstrap.ts:21`; `cli/openapi.ts:8,17,28-31` | Only inputs are validated. Responses are neither validated nor stripped against `route.response`, so drift and over-exposure are possible. OpenAPI renders responses with `io:'input'`, path params are untyped strings, and 400/401/403/404/409/422 are not listed separately. The contract check is skipped in production (the guard still fails closed with 500). | §13 "input/output schemas"; ADR-0007 | Parse or strip responses in an interceptor (at least in dev/test). Use `io:'output'` for responses and `format: uuid` for params. List problem responses per status. |
| ARCH-19 | Low | `portfolio.service.ts:184-187,389,440-455,298-316` | Reference-implementation details: `updateProject` spreads the validated body into `.set()`. This is safe today because Zod strips unknown keys, but it is the generic-update template other modules will copy (prefer explicit field mapping plus `.strict()`). `validTo` is stored as `23:59:59Z` instead of project-timezone end of day. A workstream lead need not be a project member. `newco.legalEntityId` is not validated, and FK checks bypass RLS. | §14 domain commands; CLAUDE.md dates | Map fields explicitly. Compute end of day in `project.timezone`. Validate the lead's membership and the legal entity's org. |
| ARCH-20 | Low | `docs/architecture/adr/*`; `errors.ts:98` | There is no ADR for observability (OpenTelemetry to an internal collector, §13) or for API rate limiting (REQ-DAT-016, "must"). Denied **read** attempts (GET 403/404) are not audited. | §13, §14, §15 sensitive-access logs | Add both ADRs. Audit denied reads, sampled or rate-limited, as security events. |

Counts: **High 2** (ARCH-01, ARCH-02), **Medium 11** (ARCH-03…ARCH-13), **Low 7** (ARCH-14…ARCH-20), **Critical 0**.

---

## 4. ADR-by-ADR consistency with the specification

| ADR | Assessment |
|---|---|
| 0001 Modular monolith + worker | Consistent with §13. OK. |
| 0002 Versions | Consistent in approach (pinned in the lockfile, framed as proposals). Release dates and licences were **not verified** by this reviewer. |
| 0003 Postgres/Drizzle/RLS | Correctly says the ORM does not enforce isolation. Overstates the schema guarantee ("impossible", ARCH-01) and the bypass inventory (ARCH-04). Room-scoped principals are not modelled (ARCH-02). |
| 0004 Durable jobs/outbox | Acceptable internal alternative to Redis, as §13 allows. Outbox and schedule idempotency are implemented. Lease fencing, poison-job handling, job authorization and delivery reconciliation are not (ARCH-08, ARCH-09). The unmeasured throughput statement should be labelled an assumption. |
| 0005 Auth/sessions/OIDC | Consistent (no passwords, IdP MFA, demo mode refused in production). Note: demo login is a public POST without CSRF (login CSRF), acceptable only because it is demo-only. |
| 0006 RBAC+ABAC | The model is sound. The implementation deviates from "assert in every service method" (ARCH-10) and from list-visibility correctness for room roles (ARCH-02). |
| 0007 Contracts/OpenAPI | Input validation, registry and boot check implemented. Output side weak (ARCH-18). |
| 0008 Retrieval ACL | The design (ACL in SQL before ranking) is right, but it relies on denormalized `document_chunk.room_id`/`classification` with no consistency constraint (ARCH-01). P5 scope. |
| 0009 AI gateway | Consistent with §12 and §16 (AI off by default, mock labelled Simulated, no claim of hostable Claude weights). |
| 0010 Storage | Consistent (adapter, no public links, quarantine, `not_scanned` blocks indexing). P-later. |
| 0011 Reporting | Consistent (snapshot then render; immutability by trigger, which is present on `report_snapshot`). |
| 0012 Money/time | Consistent; verified in the DB (no floats, only `timestamptz`). |
| 0013 i18n/RTL | Consistent (local fonts, logical properties). |
| 0014 Audit | Correct "tamper-evident" framing. Limits section incomplete (ARCH-05); search_path hardening missing (ARCH-03). |
| 0015 Agent execution | Consistent with how this review was run. |

No ADR contradicts the spec's explicit prohibitions: no external SaaS is imposed, no table is called tamper-proof, and the ADRs do not claim the ORM enforces isolation. The two High findings are gaps between what the ADRs and CLAUDE.md claim and what the schema and platform enforce.

---

## 5. Mandatory mutation flow in the reference modules

| Step | portfolio / identity at e2daae7 |
|---|---|
| AuthN | Global guard, server-side session, CSRF on non-GET: **OK** |
| AuthZ | Route RBAC in the guard, 404 outside scope: **OK**. Service-level ABAC present for project/membership/workstream commands, **missing** in identity and list methods (ARCH-10). Revoke authority asymmetry (ARCH-10). Room-scoped visibility flaw (ARCH-02). |
| Validation | Zod on params, query and body; unknown keys stripped: **OK** |
| Business rules | Template must be published, PM active, role scope type, not-self: OK. Cross-project/org validation of submitted ids: **partial** (ARCH-01, ARCH-19) |
| One tx with audit + outbox | `createProject`, `grantMembership` and `revokeMembership` write audit and outbox in the request transaction: **OK**. Session side effects run outside it (ARCH-10c). DB rejections were not audited at e2daae7 (ARCH-11). |
| Status changes | Only through commands; `updateProject` cannot reach `status` (Zod strips it): **OK**, but see ARCH-19 on the spread pattern. |
| Optimistic concurrency | `updateProject` and `assignWorkstreamLead`: **OK**. `deactivateUser` bumps `version` without checking it (ARCH-10d). |

---

## 6. Not executed

- `pnpm test`, the integration suites and `pnpm openapi`: **NOT EXECUTED**. Not required for an architecture review, and the suites write to `hub_test`. At `e2daae7`, `apps/api/test/` contained **no** test files; API isolation tests first appear in `9901330` and were not run by this reviewer. The isolation behaviour at the reviewed revision is evidenced only by the DB probes above.
- Worker crash and lease-expiry simulations (AT-20): **NOT EXECUTED**. ARCH-08 and ARCH-09 come from code reading.
- The `unhandledRejection` crash (ARCH-13): **NOT EXECUTED**. It follows from Node 22's documented default `--unhandled-rejections=throw` and the absence of a handler.
- ADR-0002 version and licence facts: **not verified**.

## 7. Conditions for PASS

1. ARCH-01: composite FKs for all concrete intra-project references, a same-project trigger or helper for polymorphic targets, a constraint on the `document_chunk` ACL columns, and an integration test for REQ-DAT-002 showing the DB rejects the probe-8 insert.
2. ARCH-02: fix `canSee` and add a SQL visibility predicate for room-only principals; add room-aware RLS or a documented, tested equivalent; add clean-team and external-partner isolation tests.
3. Medium findings: fix them, or accept each in an ADR with an owner and a target phase before P2 modules copy these patterns. ARCH-03, ARCH-07, ARCH-08 and ARCH-10a should be fixed, not only accepted.
