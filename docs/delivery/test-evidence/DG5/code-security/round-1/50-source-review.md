# DG5 round 1: code-security-reviewer source review notes (T-DG5-RG-SEC-R1)

Candidate `sha256:8df7f922…88b74c`, source `270ebbf7477664cb17202ee2c32ac49c6f36c5ce`, read in the disposable clone
`$TMPDIR/rv` at freeze commit `53bd2d1` (product tree byte-identical to `270ebbf`; see 01-candidate-identity.log).
Diff read: `git diff e70ac02..270ebbf -- apps packages` (881 files, +175 735 / −3 787), the touched files in full where
cited. Line numbers below are of the candidate.

## Authorization and separation of duties

| Area | Where | What I verified |
|---|---|---|
| Export create | `apps/api/src/modules/reporting/exports/jobs.ts:298`, `:346` | 403 before the body for a caller holding `export.create` nowhere (AUD, ADM); grants reloaded inside the write transaction (`refreshPrincipal`) and `export.create` / `report.generate` re-checked (commit-time). Idempotency key UNIQUE (`requested_by`, key) with `ON CONFLICT DO NOTHING` and a replay that re-checks readability and request equality. |
| Export read / download / cancel | `jobs.ts:177` (`ownJob`) | Requester only (`requested_by = userId`) AND `transformation.read` re-checked on every call; anyone else 404. Cancel: lock class `exportJob`, If-Match, one audit event. |
| Export store | `packages/reporting/src/storage.ts:90` | Keys are `exports/<org uuid>/<job uuid>-a<n>.<ext>` (opaque, regex + `..` check), resolved path must stay under the root; atomic temp + fsync + rename; 200 MiB ceiling. No user file name reaches the path. Download headers: `attachment` with an ASCII-sanitised name, `nosniff`, `private, no-store`. |
| Studio review SoD | `apps/api/src/modules/methodology/reviews.ts:339`; `packages/db/migrations/0097_p5_config_review_contributors.sql:222` | The decider is never the requester nor any recorded contributor (creator + every content writer, captured by AFTER-ROW triggers and a deferred trigger on the write's audit event), refused at the API (403 `config_review.self_review`) and by the named DB constraint. Reviewer role is never AUD (CHECK) nor technical_admin (0062 trigger). |
| Procedures Rule A | `packages/db/migrations/0096_p5_intake_adopts_transformation.sql:57` | Exactly one `transformation_id` change: NULL → T, pending before and after, nothing else of the row changes (jsonb diff minus version/updated_*), active org-scope `new_transformation_intake` instance, T = the completed `capture_intake` step's output link, same organization. Every other change raises `procedure_step_instance_identity_immutable`. |
| Adopted steps (D-167) | `apps/api/src/modules/procedures/steps.ts:502` | `authorizeStepWrite` tries the instance scope then T, each with read gate + permission + step-actor rule on grants reloaded in the transaction. |
| Attachments IDOR | `apps/api/src/modules/forms/attachments.ts:207` | The record must exist in the URL's transformation (`recordExists`) and the evidence must be of the same transformation; evidence_link store additionally requires `evidence.create`. |
| Bulk edit | `apps/api/src/modules/forms/bulk.ts:234` | Every item locked `FOR UPDATE` scoped to the URL transformation, in record-id order (no deadlock), all-or-nothing, each through the register's own updater. |
| Automation identity | `apps/worker/src/automation/identity.ts:60`; `0074_p5_automation_engine.sql:233`, `:492` | Scope first, then the acting identity (initiating user's reloaded grants, or the service identity's declared codes); a service identity can never hold a `business_approval` / `finance_validation` code (DB); a `human_only` action can never be saved on a version nor recorded as a result (DB); starters keep `starter_handler` only. |
| Dry run | `apps/api/src/modules/automation/dry-run.ts:276` | Evaluation inside a READ ONLY transaction always rolled back (`RolledBack`); the second transaction re-authorizes and writes only the append-only dry-run row and its audit event. Observation: the planned action returns `recipientUserIds` of the sample's target transformation to an `automation.configure` holder (ADM_METHOD) without a `transformation.read` check (`apps/api/src/modules/tasks/automation-actions.ts:129`); ADR-0043 §1/§4/§8 make the organization's methodology administrator the configurer of transformation-scope rules and say the dry run returns target and assignee, so this is designed, not raised. |
| Self-grant | `apps/api/src/modules/access/assignments.ts:108` | An access administrator cannot grant themselves a role (so the demo access administrator cannot make themselves SP/BO/FIN). |
| Demo isolation | `packages/db/src/cli.ts:53`; `packages/config/src/load.ts:196` | Dev-issuer binding only when `demoDevIssuerBindingAllowed(NODE_ENV, AUTH_MODE)`; `AUTH_MODE=dev` with `NODE_ENV=production` refused at config load. |
| ADM_METHOD transformation reads | `docs/architecture/adr/ADR-0040-p5-methodology-migration-reapproval-scoring-defaults.md:84` | The three 200s of the role sweep (config pins, pin history, methodology migrations) are the ADR-0040 §9 row granting `methodology.read` to ADM_METHOD, which plans and executes migrations; designed, not raised. |

## Integrity, migrations, injection

| Area | Where | What I verified |
|---|---|---|
| 0094 trigger disable | `0094_p5_gate_approver_configured.sql:27`, `:40` | Disabled and re-enabled inside the migration's own transaction under ALTER TABLE's ACCESS EXCLUSIVE lock; the backfill touches only the new column; no concurrent writer can pass the guards. Acceptable under ADR-0039 C2. |
| Snapshots | `0080_p5_reports_snapshots_updates.sql:177` | Content, hash and context immutable on UPDATE (named constraint); children append-only; no P5 table grants DELETE to `mth_app`. |
| Dynamic SQL | `0068_p5_form_schemas_framework.sql:45` | `sql.table`/`sql.ref` names come from `form_record_type`, which `mth_app` may only SELECT; evidence register predicates are module constants. |
| Branding logo | `apps/api/src/modules/admin/branding.ts:245` | PNG only (signature, size bounds, alt texts in en and ar); no SVG. |
| Formula injection | `packages/reporting/src/injection.ts:13`; `csv.ts:48`; `model.ts:191`, `:206` | Text starting with `= + - @ TAB CR` is quote-prefixed in CSV and written as a string with quotePrefix in XLSX. Defect found: a decimal over 15 significant digits becomes a text cell and the CSV writer re-neutralizes it, so a negative one is written `'-…` (F-DG5-101). |
| Migration order | `packages/db/src/migrate.ts:95`, `:159`; `packages/db/src/seed.test.ts:767` | The runner applies every pending file in lexical order and refuses only changed checksums and unknown applied files; nothing refuses a pending id below the highest applied id, and the seed test admits any id ≤ 0099. With P5's eight unused ids (0066, 0067, 0073, 0077–0079, 0083, 0084) a later file there runs in a different order on an upgraded database than on a fresh one (F-DG5-100). |
| Relay | `apps/worker/src/relay.ts:70` | An event without a queue or schema fails its row (attempts + 1, last_error) and ends the round; after `maxPublishAttempts` it is skipped, so it delays but never stalls later events. 40-outbox-registry.log: 26 schema types = 26 queue-mapped types, every write-site literal registered. |

## Observations (not raised)

- `apps/web/src/api/queries.ts:108` `fetchAllPages` stops silently after 20 pages of 100 (old F-DG5-125, a pre-P5 helper; lists above 2000 items are not a DG5 acceptance). Carried to DG6 as before.
- `apps/web/src/pages/raci/RaciPage.tsx:124` throws on a response without `deliverables` (only an incomplete unit-test fixture produces one; the contract requires the array) — the stderr lines in 20/21-unit logs.
- The web entry chunk is 1.58 MB minified (Vite warning in 10-build.log); every page is still lazy (`lazyPage`); performance, not a DG5 acceptance.
