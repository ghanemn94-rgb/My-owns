# DG5 round 1: code-security-reviewer source-review notes (T-DG5-REV-SEC-R1B, session bb0be01a)

Frozen candidate sha256:8e7d23a3…f8af67b. Source 601d7d2, read at 89d30a4, where only docs/delivery differs (02-diff-and-identity.log).
Diff reviewed: `git diff e70ac02..601d7d2 -- apps packages` (835 files, +168707/-3671), focused on the security-relevant modules listed here.
Each line gives the file:line inspected and what was verified. "OK" means no defect found.

## Exports (ADR-0046; REQ-S13-005)
- apps/api/src/modules/reporting/exports/jobs.ts:165-184 `requesterOf`/`ownJob`: requested_by = caller AND transformation.read re-checked on every get/download/cancel; anything else is 404. OK.
- jobs.ts:296-415 createExport: `holdsAnywhere(export.create)` (AUD/ADM 403), with export.create and report.generate re-checked at commit on reloaded grants (refreshPrincipal), and the idempotency key unique per requester (ON CONFLICT on export_job_idempotency_key, then replay with the read re-check). Audit `export_job.create` and the outbox `export_job.requested` (registered) are written in the same transaction. OK.
- jobs.ts:463-475 + routes.ts:73-92 download: Content-Disposition from EXPORT_FILE_NAME (ASCII), nosniff, `private, no-store`. OK.
- packages/reporting/src/storage.ts: opaque keys `exports/<org>/<job>-a<n>.<ext>`, regex plus a `..` check, 200 MiB cap (ExportTooLarge); export-runner.ts:334-367,455 removes only this job's earlier attempt keys. OK.

## Formula injection (REQ-S13-006)
- packages/reporting/src/injection.ts: the triggers are = + - @ TAB CR. csv.ts:41-51 prefixes `'` on every text cell (labels included). xlsx/sheet.ts writes text as inlineStr with quotePrefix, never `<f>`; the only formula is SUM from the fixed template (integers only). The number cells come from the decimal regex of the report schema (packages/shared/src/schemas/report.ts:148-150). OK.

## Automation (ADR-0043; REQ-S12-001/002/003/020/021/026)
- apps/worker/src/automation/identity.ts: there is one identity per execution; a service identity holds exactly service_permission_codes, inside the rule scope only. API validation (versions.ts:278) and DB 0074:231-236 refuse business_approval/finance_validation codes; human-only action types are refused at the API and by DB AV01/AX05. OK.
- dry-run.ts:262-279: the evaluation runs in a READ ONLY transaction that is always rolled back (the RolledBack throw), then a separate write transaction re-authorizes and inserts only automation_dry_run plus its audit event. OK.
- **Defect F-DG5-102:** dry-run.ts:162-166 takes the sample's transformationId, and tasks/automation-actions.ts:106-131 returns the recipients (role holders) without checking that the caller can read the target. The reason codes at :108 and :114 form an existence oracle. Probe: 09-probes.log.
- **Defect F-DG5-101:** lifecycle.ts:317 checks only authored_by; versions.ts updateVersion leaves authored_by as the creator; 0074:146 does the same. Probe: 10-probe-automation-coeditor.log.
- worker relay (apps/worker/src/relay.ts:55-110): one row per transaction, FOR UPDATE SKIP LOCKED, and a failure is recorded on the row (attempts, last_error) and skipped after maxPublishAttempts, so an unregistered type never stalls later events indefinitely. Every event_type the P5 code enqueues is in OUTBOX_EVENT_SCHEMAS (packages/shared/src/schemas/events.ts:176-219). `report_snapshot.issued` is guarded (snapshots.ts:580: it is written only once registered). OK.

## Studio (ADR-0039; REQ-S06-004/006/007/010, REQ-PB-093)
- **Defect F-DG5-100:** methodology/reviews.ts:333 and 0062:441-443 compare the decider only with the requester and with methodology_version.created_by. Probe: 09-probes.log.
- Reviewer policy: never AUD (CHECK 0062:194) and never an admin role (trigger 0062:222). methodology.publish is held by ADM_METHOD only. OK.

## Procedures (ADR-0042; D-166/D-167; REQ-S06-001/002, REQ-S16-015)
- 0096_p5_intake_adopts_transformation.sql: the replaced row guard permits exactly one transformation_id change. The change must be NULL→T, on a step that is pending before and after, with no other column changed (a to_jsonb diff), on an ACTIVE org-scope new_transformation_intake instance, and only to the T linked as the output of its COMPLETED capture_intake step, in the same organization. Every other change raises procedure_step_instance_identity_immutable. OK.
- procedures/steps.ts:402-529 (D-167): the adopted step tries the instance scope first, then T. The read gate, the permission and the step-actor rule are re-checked at commit on reloaded grants, and the instance list keeps the instance's scope. OK.

## Approvals (ADR-0044; REQ-S10-015, REQ-S04-011)
- workflows/approval-routes.ts header and approvals.ts:750: a routed approval is decided only through its steps (the DG4 decision path writes nothing for it); sequential activates step 1 only, parallel activates all. OK (behaviour is asserted by the integration suite).
- 0094_p5_gate_approver_configured.sql: the two gate_instance row triggers are disabled for ONE backfill UPDATE of only the new column, inside the migration's own transaction, and re-enabled before commit. version/updated_* and the ETags stay unchanged and no business value changes. Judged acceptable under ADR-0039 C2 (the flag mirrors a fact already in the audit trail).

## Demo isolation (ADR-0050; D-165; REQ-S18-001/003)
- packages/db/src/demo/guard.ts:96-104 refuses seeding when MTH_ENV=production, or the database is production-marked, already a demo, or not empty. packages/config/src/load.ts:179 makes MTH_ENV default to production under NODE_ENV=production. guard.ts:125-130 binds the dev issuer only when NODE_ENV≠production and AUTH_MODE=dev. reset.ts:65-87 refuses to drop a database whose marker is not demo. admin/environment.ts:242-260 accepts the in-app reset only in a demo database, with demo.reset re-checked at commit. OK.

## Branding (ADR-0049; REQ-S15-004, REQ-S01-002)
- admin/branding.ts:226-254: colours must match ^#[0-9A-F]{6}$, only the bundled fonts are allowed, and the logo must be PNG (signature check; SVG refused) at 67 B–256 KiB; it is served image/png with nosniff. The web code has no dangerouslySetInnerHTML or innerHTML (grep). OK.

## Forms (ADR-0041; REQ-S05-001/002, REQ-S06-005, REQ-S16-010)
- forms/attachments.ts: the composite FK (transformation_id, evidence_id) (0068:611) prevents attaching another transformation's evidence (no IDOR). Calculated fields use the existing safe formula engine (packages/shared/src/forms/calculated.ts); there is no eval/new Function in product code (grep: only tests). OK.

## Registry, migrations and module graph
- The advisory-lock registry (platform/advisory-locks.ts:80-122) has unique P5 classes 730250-730271 with reserved gaps. OK.
- P5 migrations 0062-0096 are all added (git name-status A), none edited. The numbering gaps are by design (p5-work-split.md:30; seed.test.ts enforces contiguity below 0058 and strict increase up to 0099). OK.
- Reporting imports neither workflows nor admin (the WorkflowsReadPort is wired in server.ts); the worker imports no API code (grep shows comments only). OK.

## Heuristic write-route scan (informational)
A grep over the P5 route files for re-authorization, audit and If-Match markers was run. Files showing 0 markers delegate to shared helpers (openWrite/openLaunchWrite with `atCommit: true`, register-kit) and were spot-checked (launch/plan.ts:285-330). Creates are version 1 without If-Match, per ADR-0048 §136 and ADR-0007. Coverage of every write is asserted by the integration suite (AUD 403, 428/409, one audit event, commit-time re-auth tests per module).
