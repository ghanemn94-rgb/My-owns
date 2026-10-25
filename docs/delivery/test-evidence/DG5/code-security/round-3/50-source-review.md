# DG5 round 3 (clean re-gate): code-security source review notes

Reviewer: code-security-reviewer, session 7a111d89 (run `DG5-T-DG5-RG-SEC-R3-code-security-reviewer-20261024T225643Z-7a111d89`).
Candidate `sha256:d8d831814a6065af8b417c862486dc2132ee6cca40bae0573f4918ff52e782c9` (2203 files), source `54e02b61961550386d5ab24a74e8ae8bb612218f`, freeze commit `bd2e7f9` (adds only delivery records).
Scope: `git diff e70ac02..54e02b6` (product: `apps/**`, `packages/**`, migrations `0062`–`0097`) and the round-2 delta `git diff edbf5ce..54e02b6` (two e2e spec files).
Every claim below cites `file:line` in the candidate tree. Where I ran something, the log is named.

## Round-2 delta (`edbf5ce..54e02b6`)

The delta is test-only: `apps/web/e2e/p3-prioritization-roadmap.spec.ts` and `apps/web/e2e/p4-raid-governance.spec.ts`.
- **p3 (F-DG5-143).** The matcher `APPROVE_OR_MOVE` uses Unicode word boundaries. The test now pins it against the real catalogue in both directions:
  - every approve/move write label must match;
  - five read-only labels, including «الاعتمادية», must not.
  The generic `enabledWrites` count-0 assertion is unchanged and remains the primary check, so nothing is weakened.
- **p4 test 5 (F-DG5-144).** The change is a budget of 90 s plus phase timing annotations. Steps and assertions are unchanged.

## Authorization and separation of duties

- **Exports** (`apps/api/src/modules/reporting/exports/jobs.ts`):
  - **Ownership.** `ownJob` (l.177–185) selects only the requester's job and then re-checks `transformation.read`; any other caller gets 404.
  - **Create.** Checks `export.create`/`report.generate` in the snapshot's transformation (l.318–330). It re-checks at commit on reloaded grants (l.346–353).
  - **Cancel.** Advisory lock, row lock, If-Match and one audit event (l.486–531).
  - **Download.** `routes.ts:73-90` streams only `storage_key` of a succeeded own job. The Content-Disposition name is ASCII-sanitised.
- **Export store** (`packages/reporting/src/storage.ts`):
  - **Keys.** Opaque `exports/<org>/<job>-a<n>.<ext>` keys, with a regex, a `..` refusal and a root-escape check (l.84–89).
  - **Writes and limits.** Atomic writes with temp-file, fsync and rename. The cap is 200 MiB (l.15).
  - **Cleanup.** Removes only the same job's `-a<n>` keys (`apps/worker/src/reports/export-runner.ts:336-350`).
- **Worker re-check of the requester.** `requesterHolds` (export-runner.ts:91-113) is the SQL twin of `access/rules.ts:66-82` `grantApplies` for non-structural permissions, and the two match.
- **Automation identity** (REQ-S12-003):
  - `apps/worker/src/automation/identity.ts:55-63` checks scope first, then the identity. A service holds exactly the version's `service_permission_codes`.
  - 0074 (l.230–236) refuses unknown permissions and approval rights (`business_approval`, `finance_validation`).
  - `initiating_user` re-reads the user's live grants in the action's transaction (`actions/common.ts:130-133`).
- **Human-only actions** (REQ-S12-026):
  - The API refuses them (`automation/human-only.ts:24-27`). 0074 refuses them on the version (l.199, "unknown OR human_only") and on every result (l.490).
  - The registry has no descriptor for them.
- **Dry run** (REQ-S12-002), `automation/dry-run.ts:265-283`:
  - Evaluation runs in a READ ONLY transaction that is always rolled back.
  - A second transaction re-authorizes, checks the version is still the draft with the same content hash, and inserts only `automation_dry_run` plus its audit event.
- **Studio review** (REQ-S06-007, S06-010), `methodology/reviews.ts:323-345` (author/requester check at l.339):
  - Refuses the requester and every author (creator plus 0097 contributors).
  - The decider must hold the request's reviewer role.
  - 0062 l.193–220 forbids AUD and `technical_admin` reviewer roles. `methodology/invariants.ts:126` forbids an ADM/AUD approver.
- **Routed approvals** (REQ-S10-015), `workflows/approval-routes.ts:486-612`:
  - The step role grant must itself carry `approval.decide` in scope.
  - The requester is refused, and one person decides one step.
  - The approval row lock, the subject lock and the route lock serialise parallel deciders.
  - Completion goes through `decideApprovalInTx`, which applies SoD again (`approvals.ts:799-…`).
- **`routedApproverOf`.** API `workflows/gates.ts:276-288` and worker `handlers/gates.ts:491-522` are equivalent, including `approver_configured` (0094). Only `gate_instance.configure` sets the flag (`gates.ts:714`).
- **0096 Rule A.** `procedure_step_instance_row_guard` allows exactly one change of `transformation_id`: NULL→T, of a pending step, with all other columns unchanged (jsonb diff). The instance must be an active org-scope `new_transformation_intake`, and T must be the output link of its completed `capture_intake`. Every other change raises `_identity_immutable`.
  - The link itself requires the actor to read T (`procedures/outputs/kit.ts:117-131`).
  - T must have been created after launch and must not be any other instance's output (kit.ts:163-180).
- **Demo isolation:**
  - `seedDemoRefusal` (`packages/db/src/demo/guard.ts:97-105`) refuses `MTH_ENV=production`, a production marker, an existing demo database and a non-empty database.
  - The dev-issuer binding needs `AUTH_MODE=dev` and NODE_ENV≠production (guard.ts:125-130).
  - The dev-login route refuses to register in production (`identity/routes.ts:247-249`), and the configuration loader refuses the combination (`packages/config/src/load.ts:196-197`).
  - The demo access administrator holds ADM_ACCESS only (`demo/data/roaming.ts:105-135`).
- **Role sweep (my own probe, `45-p5-role-sweep.log`).**
  - **Coverage.** Contract-generated, over 194 P5 operations: 90 mutations and 40 transformation-scoped reads.
  - **Mutations.** AUD, ADM (ADM_ACCESS+ADM_TECH) and ADM_METHOD wrote no row in any table. The only new audit rows were `authorization.denied`, and no request got 2xx.
  - **Reads.** ADM gets zero 200s on T-scoped reads. ADM_METHOD reads three methodology-configuration lists of T (`listTransformationConfigPins`, `listConfigPinHistory`, `listMethodologyMigrations`). That is the documented design (ADR-0040 l.84; `methodology/pins.ts:5-6`; D-143 point 6): methodology admins plan and execute a transformation's methodology migration. It exposes configuration metadata only, no business record.
  - **Navigation.** The server hides every transformation-scoped area from ADM and ADM_METHOD.

## Integrity, jobs and concurrency

- **Outbox registry** (`40-outbox-registry.log`):
  - All 26 written event types are registered in `OUTBOX_EVENT_SCHEMAS` and routed in `QUEUES_FOR_EVENT`.
  - `report_snapshot.issued` is written only once it is registered (`reports/snapshots.ts:580`).
  - Every writer validates against the registry before INSERT.
  - The relay (`apps/worker/src/relay.ts:53-124`) records a failure and moves on after `maxPublishAttempts`. A bad row never blocks later rows permanently.
- **Advisory locks.** The worker constants equal the named API classes:
  - 730233 / 730236 / 730238 / 730239 / 730240 / 730242 / 730258 / 730259 / 730261 / 730264 / 730266 / 730267.
  - The registry runs 730250–730272 in P5 blocks with documented reservations.
- **Unique backstops.**
  - 0074: `automation_execution_once_key` and the `action_result_effect_once_key` partial index.
  - 0075: `meeting_cutoff_pack_once_key`, `notification_digest_window_key`, `dependency_slip_once_key` and `gate_condition_*_once_key`.
  - 0081: `export_job_idempotency_key` and the unique `storage_key`.
  - 0086: `launch_plan_transformation_key`, `launch_plan_idempotency_key`, `day_ninety_test_plan_key` and `health_assessment_one_draft_key`.
  - 0080: `report_snapshot_one_issued_key` and `report_snapshot_series_issue_key`.
- **ETagOrZero.** `forms/custom-values.ts:81-83` accepts `"0"` as create.
  - A concurrent double create hits `form_custom_value_record_key` (0068 l.445).
  - This constraint is unmapped, so it falls to `platform/hooks.ts` `case "23505"` → 409 `duplicate`. The write rolls back.
- **Bulk edit.** `forms/bulk.ts` carries one version per item and is all-or-nothing (header l.4–20).
- **Formula injection** (REQ-S13-006; `41-injection-probe.log`):
  - The trigger set is `= + - @ TAB CR` (`packages/reporting/src/injection.ts:13`). XLSX text is always `inlineStr`, with quotePrefix style ids 1/3/5/7. CSV fields get a leading `'`.
  - The only `<f>` is `SUM(<col><r1>:<col><r2>)`, built from integers (`xlsx/sheet.ts:46-56`).
  - XML text is escaped and control characters are replaced (sheet.ts:14-26).
  - Decimal cells come only from `DECIMAL_PATTERN`-validated strings (`shared/schemas/report.ts:148-151`).
  - My probe: eleven adversarial texts, including DDE `=cmd|' /C calc'!A0`, full-width `＝` and leading space. Result: 0 failures, and `formulas=["SUM(D3:D13)"]`.
- **OOXML metadata.** pptxgenjs 4.0.1 entity-encodes the title and subject (`dist/pptxgen.cjs.js:6456-6457`).
- **Branding.** The logo must be a PNG: signature-checked, 67 B to 256 KiB (`admin/branding.ts:233-246`). Colours match `^#[0-9A-F]{6}$`, and the fonts are fixed to the bundled pair (l.226, 249–254).
- **Snapshots.** Content and context are immutable (0080 l.166–177). `synthetic` is set exactly when `readDeploymentEnvironment` says demo (`reports/snapshots.ts:63-76, 326`). Every subject type is transformation-scoped (0080 l.100, 145–149).
- **Migrations.**
  - The 89 files `0001`–`0097` are forward-only. They apply to a fresh database in both integration runs.
  - The gaps (0066–0067, 0073, 0077–0079, 0083–0084) are unused numbers of the reserved per-task blocks (p5-plan §4 table; D-145 "gaps between ranges are already accepted"). The migrator applies files in lexical order (`packages/db/src/migrate.ts:3`).
  - **0094.** The DISABLE/ENABLE of `gate_instance_row_guard` and `_audit_required` is transactional, and runs under the ACCESS EXCLUSIVE lock already taken by `ALTER TABLE … ADD COLUMN` in the same migration transaction. It changes only the new column, deliberately leaving version and ETag alone, and it derives the column from existing audit facts. Acceptable under ADR-0039 C2.
- **Dynamic SQL identifiers.** Every `sql.table`/`sql.ref` of a non-constant comes from a closed set:
  - `procedures/outputs/kit.ts:153,224-227` (CHECK-closed output types);
  - `methodology/providers/methodology-kind.ts:141-144` (constants);
  - `governance/meeting-outputs.ts:157-159` (zod enum);
  - `launch/tasks.ts:287-290` (`OUTPUT_TABLES` allowlist).

## Contract, seams, web

- **Contract.** 846 operations with unique ids. All 46 arrays in the 44 `p5-pending-*.ts` files are empty, `P5_PENDING_TESTS_BE_O` included (`42-contract-pending.log`). `contract.test.ts` (83) and `media-types.test.ts` (21) pass in both integration runs.
- **Module graph** (`43-module-graph.log`):
  - Reporting imports neither workflows nor admin.
  - The worker imports no API code.
  - Procedures do not import workflows.
- **Web** (`47-web-graph.log`):
  - There are 171 `import()` sites (lazy routes), no external URL in the source, and 12 bundled font files in `dist/assets`.
  - The browser stores no tokens; `localStorage` holds only the locale and column visibility. There is no `innerHTML`/`dangerouslySetInnerHTML`.
  - `rich_text` is a plain length-bounded string, rendered as a text node.
  - **Import cycle.** One cycle exists, `UsersPage.tsx` ↔ `AssignmentsPage.tsx`, from DG1 (`4cd9224`), unchanged in kind through DG1–DG4. Both modules export function components used only at render time, so ESM resolves them without a TDZ error.
    - I judge it an observation, not a defect: no behavioural effect, and not introduced by P5. It is the only cycle, and P5 added none.
- **Rate limit.** `@fastify/rate-limit` is `global: true` (`apps/api/src/server.ts:313-326`), so it covers every P5 route.
- **Secrets** (`49-secrets-scan.log`): none. The matches are synthetic test fixtures and a model signature inside a run transcript.

## Observations (not findings)

1. **ADM_METHOD reads T's config pins and methodology migrations.** By design (ADR-0040 l.84, D-143 point 6). This is configuration metadata only.
2. **Web import cycle `UsersPage` ↔ `AssignmentsPage`.** Pre-existing from DG1, with no runtime effect.
3. **Production web build: one 1.59 MB `index` chunk** (Vite's >500 kB warning, `10-build.log:192-195,234`). A bundle-size and performance matter for DG6 hardening, not a security or correctness defect.
4. **Old accepted Low items** (old F-DG5-125 `fetchAllPages` 2000 cap, F-150, F-151). Read as context only; I did not judge any of them a defect needing a new finding in this round.
5. **My sweep's 400/404 statuses for AUD.** They come from my probe's empty bodies and random nested ids: body validation or record resolution answers before the permission decision. Each slice's integration tests assert AUD 403 against real records. My probe proves the invariant that matters for security: nothing written, never 2xx.
