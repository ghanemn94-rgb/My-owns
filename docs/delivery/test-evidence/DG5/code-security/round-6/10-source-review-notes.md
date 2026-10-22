# DG5 round 6: code-security source review notes (code-security-reviewer, T-DG5-REV-SEC-R6)

Candidate sha256:3294f8fc030f48dc5c3c65caff150479ab4b4cdcb72daf02217e411c9cc8ba6d (2191 files), source ad52a56, freeze 3985d19.
Diffs read: `git diff 0c88d5e..ad52a56` (the wave-AA repair delta) in full for product files (01-repair-diff.patch), and the
P5 diff `git diff e70ac02..ad52a56` (873 product files, migrations 0062-0097) for the targeted areas below. Line numbers
are at ad52a56.

## Wave AA (0c88d5e..ad52a56)

Product files: apps/api/src/modules/forms/export.ts, packages/shared/src/schemas/forms-records.ts, docs/api/openapi.yaml,
apps/web/src/styles/app.css. Tests: form-export-illustrative.test.ts (new, 19), form-records.test.ts, p5-title-reflow.spec.ts.

### `illustrativeLabel` contract change (judged as assigned)
- zod `formRecordExport` (forms-records.ts:34) `illustrativeLabel: z.string().min(1).nullable()`, required;
  OpenAPI `FormRecordExport` lists it in `required`, `type: [string, "null"]`, `minLength: 1`, with
  `additionalProperties: false` kept. The two agree (string >= 1 or null; required).
- "Additive" holds for the wire: no field removed or retyped; old readers that ignore unknown members keep working.
  It is required in the RESPONSE schema, which is correct for a server that always sends it (export.ts:271-275 always
  sets string or null). The only in-repo consumer (apps/web form-framework api.ts:96 `api.get<FormRecordExport>`, no zod
  parse; ExportDialog.tsx downloads the body as is) is unaffected; `pnpm -r typecheck` passes with the new required member.
  The contract test validates every exercised exportFormRecords JSON response against the updated schema (83/83 in both
  integration runs).
- Not user-controlled: the value is one of two constants (export.ts:95 `FORM_EXPORT_ILLUSTRATIVE_LABELS`), held equal to
  the reporting pipeline's `export.illustrative` strings by form-export-illustrative.test.ts.

### Demo detection
- export.ts:235 `readDeploymentEnvironment(db)` (packages/db/src/demo/guard.ts:39): the singleton marker row; `synthetic`
  exactly when `environment_kind = 'demo'`; no row -> production (fail-safe: no label on possibly real data). Same source
  as GET /environment (admin/environment.ts:112) and the report snapshots (reporting/reports/snapshots.ts:76).
- The marker cannot be steered from the API: 0090:35 grants mth_app SELECT only; the table is append-only
  (`p2_attach_append_only`) and a singleton. My probe SEC-R6 2 proves INSERT/UPDATE/DELETE by mth_app are refused with
  42501 on a demo and a production database, and the owner cannot flip a production marker to demo.
- The marker is read outside a transaction, on the pool, after `requireTransformationRead` (export.ts:318). It is
  immutable, so reading it in a different statement from the rows cannot mislabel an export. No remote I/O, no write.

### CSV label row
- export.ts:297: `lines = illustrativeLabel === null ? [] : [csvCell(label, false)]`, then the header. The label goes
  through the same `csvCell` (formula-trigger rule, RFC 4180 quoting); both constants start with a letter, so they are
  never prefixed or quoted. Non-demo CSV is byte-identical to before (header first). The BOM stays first.
- The label row has one field while the header has 2 + 2n. RFC 4180 says each line "should" have the same field count;
  a strict parser reading the first line as the header would mis-parse a DEMO export. This is the D-178 decision, and it
  matches the report pipeline's CSV, which also opens with a one-field label row (packages/reporting/src/csv.ts:64).
  Demo-only; no security or integrity effect. Observation, not a finding.
- Formula injection after the change: my probe SEC-R6 4 builds a labelled export whose header and values start with =,
  + and @ and a number field holding "-1+1"; every one is apostrophe-prefixed, and the canonical decimal -12.50 is not.
  Mutant M2 (neutralization removed) is killed by it (08-probe-mutants.log).

### Authorization of the labelled export
- Unchanged: route config `transformation.read` plus `requireTransformationRead` (404 outside scope). Probe SEC-R6 1: the
  demo access administrator (ADM_ACCESS only) gets 404 on T01/T14 x csv/json, and the body never carries the label;
  TL, CM and KDS in the transformation get 200 with the Arabic label; an unknown transformation id is 404.

### Read consistency (observation, pre-existing, not new in wave AA)
- buildFormExport reads count, rows and custom values in separate statements on the pool (export.ts:192-231), not in one
  snapshot transaction (the report pipeline uses `snapshotRead`). A write committed between the row read and the
  custom-value read could pair a row's `version` with a newer extension-value set. Read-only, a millisecond window, no
  import path consumes the export, and ADR-0041 §5 does not require a snapshot. Not a finding.

### F-DG5-147 CSS (app.css)
- `overflow-wrap: anywhere` on title containers, `min-inline-size: 0` on `.page-header__row > *`, and the same wrap on
  `.entry-list > li`. Pure presentation: no selector reaches a form control, no content/url()/@import, no external
  resource. `pnpm check:no-cdn` passes.

## Targeted P5 source checks, re-verified on this candidate (no defect found)
- Exports: jobs.ts:177 `ownJob` filters `requested_by = caller` and re-checks transformation.read (404 otherwise);
  download :463 goes through it; cancel :486 refreshes grants, takes the exportJob advisory lock, If-Match, one audit
  event. Store keys are server-built (packages/reporting/src/storage.ts:55), `..` and non-matching keys refused, the
  resolved path must stay under the root (:85-88); download names sanitized to [A-Za-z0-9_-].
- Formula injection: packages/reporting/src/injection.ts (= + - @ TAB CR) for XLSX and CSV; the forms CSV applies the same
  rule (forms/export.ts:109-113).
- Automation: the dry run evaluates in a `read only` transaction that always throws RolledBack (automation/dry-run.ts:270-
  278); worker `decideActionAuthorization` (apps/worker/src/automation/identity.ts:60): scope first, service identity
  limited to its permissions, otherwise the initiating user's re-checked permission.
- Relay (apps/worker/src/relay.ts:53-75, :110-125): an unregistered event type throws inside the publish transaction, the
  row's publish_attempts is incremented, the round ends, and after maxPublishAttempts the row is skipped by the
  `publish_attempts < max` filter, so later events are delayed by a bounded number of polls, never stalled.
- Procedures: 0096 Rule A permits exactly one transition (NULL -> the intake's own output transformation, pending step,
  nothing else changed); every other change raises `_identity_immutable`.
- 0094: the two row guards are disabled only around the one backfill UPDATE inside the migration's own transaction and
  re-enabled at once (0094:26-40); only the new column changes, derived from existing `gate_instance.configure` audit
  events; no version step and no audit event for the backfill, which is the ADR-0039 C2 one-off migration exception.
- Demo: seed-demo refused with MTH_ENV=production or a production marker (demo/guard.ts:96-103); the dev-issuer binding
  only with AUTH_MODE=dev and NODE_ENV != production (:125-130); production config refuses AUTH_MODE=dev
  (server.test.ts:52).
- evidence/register.ts:164/171 `sql.raw(s.active)`: the predicates are fixed literals of a module constant (:110-132),
  never input.
- Module graph: reporting imports neither workflows nor admin (the one grep hit is a string inside reporting.test.ts that
  tests the guard); the worker imports nothing from apps/api.
- Contract: 846 operationIds; all 46 exported p5-pending arrays are empty (04-p5-pending-lists.log; the same set as round 5).
- Migrations: 28 added files 0062-0097, all additions (no edit of an earlier file). Numbers 0066-0067, 0073, 0077-0079 and
  0083-0084 are unused: reserved ranges that p5-work-split.md (§B.5, §D, §F) and D-145 left free on purpose ("a task that
  needs none leaves its number unused; numbers are never reordered"). The runner applies pending files in lexical order
  and refuses unknown or changed applied files (packages/db/src/migrate.ts). Observation: a file added later inside a gap
  would be applied after 0097 on an existing database; that is a process rule for later stages, not a defect here.
