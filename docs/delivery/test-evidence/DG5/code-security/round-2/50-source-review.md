# DG5 round 2: code-security-reviewer source review notes (T-DG5-RG-SEC-R2)

Candidate `sha256:5df44203b73c7c9e4a7a34d65abde4f7060bcd5b1ef66ee84e7d47ba7699186b`, source
`edbf5ce2be5212f9de2e7d5f1af5ce57ca2eb9e7`, read in the disposable clone `$TMPDIR/rv` at freeze commit `7144a19`
(identical to `edbf5ce` outside `docs/delivery`; 01-candidate-identity.log). The product equals the old branch head
`ac68d1b` plus exactly the RG1 repair diff (`git diff --stat ac68d1b edbf5ce` = `git diff --stat 270ebbf edbf5ce`,
45 files). Read this round: the RG1 diff in full (`git diff 270ebbf..edbf5ce`), and the P5 diff areas below
(`git diff e70ac02..edbf5ce -- apps packages`), at the candidate's line numbers. Evidence is produced in this round only.

## RG1 repair diff (security-relevant parts)

| Change | Where | Verdict |
|---|---|---|
| CSV trusts the cell's `quotePrefix` instead of re-neutralizing every text cell (F-DG5-101) | `packages/reporting/src/csv.ts:45-56`, `:59`; `packages/reporting/src/model.ts:196-209`, `:217` | Sound. Every text cell carrying user text is built by `textCell()` (model.ts:196), which sets `quotePrefix` from `neutralizeSpreadsheetText` (injection.ts:30). The only `quotePrefix: false` literals are (a) a decimal too long for a double (model.ts:208), whose value passed `DECIMAL_PATTERN` `^-?[0-9]{1,18}(\.[0-9]{1,6})?$` in `reportDocument` (shared/schemas/report.ts:150; renderCsv safeParses its input), so it can only start with a digit or `-` followed by a digit; and (b) a fixed validation label (model.ts:217). Frame rows, titles and legend go through `textRow` -> `textCell` (csv.ts:59). Real-stack check (41-f101-csv-stack.log): long negative decimals unprefixed in en and ar; `=HYPERLINK(...)` and `-2+3` user texts prefixed in CSV and quotePrefix in XLSX; no unprefixed formula-like field in the whole file. |
| Runner refuses a pending id not above the highest applied id (F-DG5-100) | `packages/db/src/migrate.ts:99-111`, `:168-175`; `cli.ts:90-97`; `apps/api/src/modules/platform/health.ts:50-52`; `seed.test.ts:755-805` | Sound. `outOfOrderPending` is computed from the applied rows' ids; migrate() throws before the first file (nothing applied, not even a valid later file in the same build); `status` prints ORDER and exits 4 (drift); `/readyz` reports `fail`, not `pending`. A database applied only to 0065 still accepts 0066 in place (no false refusal, same order as fresh). The eight P5 gaps are also pinned as retired in the numbering test. Duplicate ids are refused by `listMigrationFiles`. 39-, 40b-, 46- logs. |
| Demo Day-90 test seeded with the plan (F-DG5-121) | `packages/db/src/demo/data/roaming-states.ts:80-114` | Inserted through `ctx.insert` (audited seed path), open with no answers, demo database only. No authorization surface. |
| Launch section hidden without `procedure.launch` (F-DG5-140) | `apps/web/src/pages/procedures/MyProceduresPage.tsx:202-224` | UI-only, documented as such; the server still checks `procedure.launch` and launch roles (instances.ts). Hooks are unconditional (form split into `LaunchForm`). |
| Playbook reader tables (F-DG5-122) | `apps/web/src/pages/playbook/ui.tsx:33-80`, `:135-165`, `:204-209` | `<br>` turned into React `<br />` elements by splitting text; no `dangerouslySetInnerHTML` anywhere in `apps/web/src` (grep: none). Not an XSS vector. |
| Dependency slips (F-DG5-120) | `apps/web/src/pages/dependencies/slips.tsx:28-33`, `:45-50` | Read-only list via `fetchAllPages` of a `transformation.read` route; calendar-day difference computed from UTC midnights of two business dates (exact); null -> Unknown. |

## P5 areas re-verified this round (candidate line numbers)

| Area | Where | What I verified |
|---|---|---|
| Export create / read / download | `apps/api/src/modules/reporting/exports/jobs.ts:177-185` (`ownJob`), `:281`, `:297-298`, `:330-348` | 403 before the body for a caller holding `export.create` nowhere; `export.create` (+ `report.generate` for live) re-checked on grants reloaded inside the write transaction; read/download/cancel only for `requested_by = me` AND still `transformation.read`, else 404. |
| Export store | `packages/reporting/src/storage.ts:15`, `:57`, `:88-95` | Opaque keys (regex + `..` refusal), 200 MiB ceiling enforced before writing. |
| Approval routes | `apps/api/src/modules/workflows/approval-routes.ts:486-501`, `:515-614`; `0075_p5_starters_routes_policies.sql:131-134` | Approval row locked FOR UPDATE + subject advisory lock + route lock; commit-time `approval.decide` on refreshed grants; step-role holder or DG4 delegate; requester excluded; one step per person (incl. on-behalf); If-Match on the approval; stale subject refused; parallel steps serialized by the approval lock and re-read after it. A technical-admin-kind role (ADM_METHOD is `technical_admin`, 0005:39) or AUD can never be a step approver (DB trigger). |
| Gate routing | `apps/api/src/modules/workflows/gates.ts:276-291`, `:308-326`, `:385-399`, `:455-462` | Every read naming an approver and `isGateApprover`/`gateView` use `routedApproverOf`; `canDecide` excludes the submitter. |
| KPI restatement SoD | `apps/api/src/modules/kpi/restatement-decisions.ts:99` | Requester cannot decide (API) with the DB CHECK as backstop. |
| Studio review SoD | `apps/api/src/modules/methodology/reviews.ts:15-23`; `0097_p5_config_review_contributors.sql:218` | Decider is neither requester nor any contributor (API 403 + named DB constraint). |
| Rule A | `0096_p5_intake_adopts_transformation.sql:49-95` | Exactly one transition (NULL -> T, pending/pending, nothing else changes, active org-scope intake instance, T = completed capture_intake output, same org); everything else raises `_identity_immutable`; version step kept. |
| Adopted steps / attachments / bulk | `procedures/steps.ts:502`, `forms/attachments.ts:202`, `forms/bulk.ts:295` | As in round 1, unchanged by RG1. |
| Automation | `apps/api/src/modules/automation/dry-run.ts:223`, `:271-280`; `apps/worker/src/automation/identity.ts` | Dry run in a READ ONLY transaction always rolled back (`RolledBack`); identity rules unchanged. |
| Defaulted records (`ETagOrZero`) | `apps/api/src/modules/tasks/notification-policy.ts:292-305` (same pattern in `benefits/financial-metrics.ts:302`, `:444`, `dashboards/rag-policy.ts:179`, `admin/branding.ts:388`) | `IfMatchOrZero` compared to the row read FOR UPDATE; two concurrent first saves both pass the check but the second INSERT hits the UNIQUE key (e.g. `notification_preference_user_key`) and maps to 409 `duplicate` (`platform/hooks.ts:123`). |
| Relay | `apps/worker/src/relay.ts:53-126` | Unregistered type / no schema / bad payload -> the row's attempts + 1 and `last_error`, round ends; after `maxPublishAttempts` it is skipped, so later events are delayed, never stalled. 40-outbox-registry.log: 26 schema types = 26 queue types; 22 write-site literals all registered. |
| Demo isolation | `packages/db/src/demo/guard.ts:125`; `cli.ts:53`; `packages/config/src/load.ts:195-198` | Dev-issuer binding only with `AUTH_MODE=dev` outside production; `AUTH_MODE=dev` + `NODE_ENV=production` refused at config load. |
| 0094 trigger disable | `0094_p5_gate_approver_configured.sql:27-40` | Disabled and re-enabled inside the migration transaction under ALTER TABLE's ACCESS EXCLUSIVE lock; acceptable under ADR-0039 C2. |
| Decimals | grep of the P5 diff for `parseFloat`/`Number(` on values | Only `Number()` on rubric level scores (small integers, scoring-defaults.ts:149) and on an all-digit dashboard count (executive-pack.ts:148-149, count headlines); money/rates/scores/totals use decimal.js; `formatNumber` passes a decimal string to `Intl.NumberFormat` (values.ts:56-62), no float. |
| Module graph | 43-module-graph.log, 47-web-graph.log | reporting imports neither workflows nor admin (ports wired in server.ts:384-415); worker imports no API code; the web has one static import cycle (`admin/AssignmentsPage.tsx` <-> `admin/UsersPage.tsx`), present unchanged at the P5 base e70ac02 and introduced in DG1 (4cd9224): P5 added 84 web modules and no cycle; every page but LoginPage is lazy. |

## Observations (not raised as findings)

- Pre-P5 web import cycle `AssignmentsPage.tsx` <-> `UsersPage.tsx` (DG1 4cd9224): function-level use only (components used inside render), no module-evaluation dependency; not in the P5 diff.
- `apps/web/src/api/queries.ts` `fetchAllPages` stops at 20 pages of 100 (old F-DG5-125, carried to DG6); the RG1 slips list uses it.
- Unit stderr lines come from incomplete web test fixtures (no `deliverables` / `currencies`, both required by the contract), duplicate fixture ids and dev warnings (22-unit-stderr-analysis.log).
- The web entry chunk is 1.59 MB minified (Vite warning in 10-build.log); performance, not a DG5 acceptance.
- Relay: a poison event delays later events by up to `maxPublishAttempts` poll rounds before being skipped (designed; recorded for operators via `last_error`).
