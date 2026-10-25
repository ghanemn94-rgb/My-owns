# DG5 corrected clean re-gate, round 1: code-security source review

Reviewer: code-security-reviewer, session `3a37f8d1-f94f-4a01-a212-2a87d876b1fa` (invocation task `T-DG5-RG2-SEC-R1`; the assignment file names the task `T-DG5-REV-SEC-R5`; it is the same assignment, whose sha256 `3f908ae3…a41e` I verified).
Candidate: `sha256:ff3bc2c42889d232a84658da7ff850117a8c0c1ba1de6b4c8e32bcc30dae1008` (2203 files), source commit `2fe8f853e54ef7ab7b88527f11633c0c3542edd6`. The repository HEAD is the freeze commit `f816fb2`, which adds only `docs/delivery` records (`01-candidate-identity.log`).
Scope: `git diff e70ac02..2fe8f85` over `apps/**`, `packages/**` and migrations `0062`–`0097` (899 product files, +177,740/−3,815), plus the full files it touches where a path needed tracing.

I authored no implementation in the DG5 scope. I formed this verdict before reading any other reviewer's record for this round. I read the earlier branch's (`5a7c189`) code-security harness only for the mechanics of the disposable install and cluster. I did not read or rely on its conclusions.

## Result

**One new finding, F-DG5-100 (Medium, not a mandatory violation, not blocking):**

- **What happens.** A DOCX or PPTX export is not well-formed XML 1.0 when accepted user text contains a C0 control character.
- **Why.** The API refuses only U+0000 and lone surrogates (`packages/shared/src/schemas/common.ts:94`). The XLSX writer replaces XML-invalid characters (`packages/reporting/src/xlsx/sheet.ts:13-26`). The DOCX (`docx` 9.8.1) and PPTX (`pptxgenjs` 4.0.1) writers pass them through raw.
- **Reproduction, end to end.** A real demo stack, the real worker export runner, and a transformation renamed through the API to a name that contains U+000B.
- **Result.** The charter DOCX and the roadmap PPTX jobs report `succeeded`, but `word/document.xml`, `ppt/slides/slide1.xml` and `docProps/core.xml` each hold a raw U+000B. The roadmap XLSX is clean (`46-ooxml-control-char.log`, `46b-ooxml-control-chars-renderer.log`).

Nothing else I inspected is a defect. Every other probe and suite matched its expectation (the individual checks are in the review record).

## What I inspected, with the outcome

### Authorization and separation of duties

- **AUD / ADM-only sweep** (`45-p5-role-sweep.log`, 9/9). This is my own generated sweep over all 194 P5 operations on the real demo dataset.
  - **Writes, AUD and ADM-only.** For both roles, 0 of the 90 P5 writes succeeded and the row counts of every public table were unchanged.
  - **AUD with valid bodies.** The 400/404 answers to `{}` come from body validation and path lookup, which run before the permission check. With valid bodies and a real T02 record, AUD gets 403 on 13 of 16. The other three: `decideKpiRestatement` is 404 (no restatement exists), `putHealthCheckAnswer` is 400 (my placeholder question code), and `previewFormula` is 200 (a stateless preview; nothing written).
  - **Reads, ADM-only.** No ADM-only read of the 104 P5 GETs disclosed the demo transformation. ADM_TECH's operational reads of executions, failures and jobs are documented in ADR-0043 §8.
  - **Navigation.** ADM-only navigation lists no transformation item.
- **Studio separation of duties.**
  - `reviews.ts:337-345`: the requester or any recorded author (0097 contributors) gets 403 `config_review.self_review`, and the reviewer must hold the policy's role.
  - The policy cannot name AUD or a `technical_admin` role, at the API (`review-policies.ts:59-67`) and at the database (0062 CHECK and the `config_review_policy_guard` trigger).
- **Approval routes** (`approval-routes.ts:515-600`). The step decision checks, in order: commit-time `approval.decide`, step capacity (the role, or a DG4 delegate of a holder), requester exclusion, one step per person, If-Match, and subject staleness under the subject lock.
- **Routed approver.** `approver_configured` is set only by the configure operation (`gates.ts:714`). The API (`gates.ts:270-283`) and the worker (`handlers/gates.ts:519`) apply the same rule.
- **Automation identity.**
  - **The decision.** `decideActionAuthorization` checks scope first, then the identity. A service identity holds only its version's codes, never an approval right (0074 AV04). An initiating user is checked as a reader of the target transformation.
  - **Human-only actions.** They are refused at the API (`human-only.ts`) and twice at the database (0074 `automation_rule_version_human_only`, `automation_action_result_human_only`).
  - **Dry run.** It evaluates in a READ ONLY transaction that always rolls back (`dry-run.ts:269-282`). The commit transaction then re-authorizes and writes only the dry-run row.
- **Procedures, Rule A (0096).** The guard allows only NULL to T for a pending step of an active organization-scope intake, and only to the transformation linked by its completed `capture_intake` output.
  - **Database probe** (`45-p5-role-sweep.log`, PROBE 0096). Changing a step from T to another T, from T to NULL, and from NULL to T without the link are all refused with `procedure_step_instance_identity_immutable`.
  - **API.** Adopted steps are authorized in T (`steps.ts:497-536`).
- **Demo isolation.**
  - Seeding is refused when MTH_ENV is production, on a production marker, on a non-empty database, or on an existing demo database (`demo/guard.ts`).
  - MTH_ENV defaults to production under NODE_ENV=production (`config/load.ts:179`).
  - The dev-issuer binding requires `AUTH_MODE=dev` and NODE_ENV not production (`guard.ts:125-130`).
  - The demo access administrator holds only ADM_ACCESS (`roaming.ts:105-135`).
- **Exports.**
  - **Access.** The list, read, download and cancel return only the requester's own jobs, with `transformation.read` re-checked; anyone else gets 404. Probe: AUD, which can read the transformation, gets 404 on read and download and does not list the job; ADM gets 404 too.
  - **Store keys.** Keys are opaque, checked against a regex, path-contained, and per attempt (`storage.ts`, `export-runner.ts:334-367`).
  - **Writes and cleanup.** Files are written atomically with fsync, and earlier attempts are discarded.
  - **Download headers.** The 200 MiB cap applies, with `nosniff` and `private, no-store`.
- **Forms IDOR.** Every record path is scoped by `transformation_id` (`record-types.ts:124-140`). Attachments accept only evidence of the same transformation (`attachments.ts:202-207`). Bulk edits re-check on the reloaded principal and lock all items first.
- **Commit-time authorization** (`47-commit-time-scan.log`). Every P5 write path reloads the principal inside its transaction. The DG2–DG4 register cores that P5 reuses for bulk editing are called only after `bulk.ts` has re-checked at commit.

### Data integrity, jobs and concurrency

- **Outbox** (`40-outbox-registry.log`). The 26 registered types and the 26 queue-map types are the same set, and every enqueued type is registered. The exception is `report_snapshot.issued`, which `snapshots.ts:580` never writes while it is unregistered. An unregistered type is retried up to `maxPublishAttempts` and then excluded, so it never stalls later events (`relay.ts:61-72`).
- **Exactly once** (`44-exactly-once-backstops.log`). Unique backstops exist for executions, effects, open failures, digests, cut-off packs, slips, the export idempotency key and storage key, reissue offers, launch plans and Day-90 tests. Lock classes 730250–730272 are unique, and `advisory-locks.test.ts` passes in 20/21.
- **Formula injection.**
  - The triggers are `= + - @ TAB CR`. XLSX text is always `inlineStr` with `quotePrefix`. CSV gets a leading `'`.
  - Decimals come from a regex-validated schema and are never prefixed. The only `<f>` written is the fixed-template SUM.
  - The forms CSV export (`forms/export.ts:101-113`) carries its own copy of the same six triggers, not the shared function. The behaviour is identical, so I record this as an observation only.
- **Decimals.** A float scan of the P5 diff found only counts, byte sizes, integer rubric levels and layout widths. Money, weights and totals use decimal.js.
- **Migrations.**
  - **Ids.** The applied ids are 0001–0097 minus exactly the eight retired P5 ids (D-185, `seed.test.ts` pins them), and the runner refuses a pending id below the highest applied id (PROBE schema_migration).
  - **0094.** It disables two `gate_instance` guards for the backfill statement only, inside the migration transaction, and re-enables them. PostgreSQL DDL is transactional, so a failed backfill rolls the disable back with it. Probe: every public trigger is enabled after 0001→0097. I judge it acceptable as the one-off ADR-0039 C2 exception (D-166, D-167).
- **Snapshots.** Content and `content_sha256` are immutable at the database (0080 `report_snapshot_content_immutable`). `synthetic: true` is set only when `readDeploymentEnvironment` reports demo (`snapshots.ts:296-326`).

### Contract and seams

- **OpenAPI.** It has 846 operations, and all 43 `p5-pending-*.ts` lists are empty, including `P5_PENDING_TESTS_BE_O` (`42-contract-pending.log`, `14-openapi-lint.log`).
- **Module graph** (`43-module-graph.log`). Reporting imports neither workflows nor admin, the worker imports no API code, and the gate data flows through `WorkflowsReadPort`, wired at `server.ts:384`.
- **Web.**
  - No `dangerouslySetInnerHTML`, `innerHTML` or `eval`. Routes are lazy (`router.tsx`, `lazyPage`). `pnpm check:no-cdn` passes.
  - The branding logo is PNG-only (signature checked), served as `image/png` with `nosniff`.
  - The entry chunk is 1.59 MB minified. That is a performance observation for DG6, not a security defect.
- **Secrets** (`49-secrets-scan.log`). None in the P5 diff.

## Evidence-honesty notes

Every non-zero exit, failed attempt and stderr line in the cited logs is explained in the review record's checks. In summary:

- **Integration attempt 1, LANG unset** (`30-integration-lang-unset.attempt1-enospc.log`). initdb failed with ENOSPC on the shared scratch disk; no test ran.
- **Sweep attempts 1 and 2** (`45-p5-role-sweep.attempt1-import-error.log`, `.attempt2-setup-incomplete.log`). Both were defects in my probe, not in the product: a `yaml` import that tests/qa cannot resolve, then wrong setup bodies and no procedure step to probe. The final run is 9/9.
- **The Node 24 unit wrapper's exit 2.** It was caused by my editing `checks.sh` while bash was still reading it. The run itself logged `exit=0`.
- **Unit stderr, the same five sources on both Node versions.**
  - ajv "unknown format" notices.
  - `extension-fields.test.tsx`: its T12/T14 mocks omit the contract-required `deliverables`, so the page falls to its error boundary after the asserted header strip has rendered. This is a test-fixture weakness, not a product defect.
  - A React key warning on a `<select>` in `extension-hosts-twelve.test.tsx`.
  - Duplicate React keys from dashboard fixtures that reuse one KPI id (`kpiUnit`, `percentKpi`).
- **The two skipped tests** are `it.skipIf(NOCODEGEN)` by design (`fuzz.test.ts:600`, `:833`).
- **The `pnpm install` bin warnings** come from the first install, run before `@mth/db/dist` existed. The tests call `packages/db/dist/cli.js` directly.
- **Vite's chunk-size notice** concerns the entry chunk (see the web item above).

## Suites run on the candidate (disposable working copy `$TMPDIR/rv` at `f816fb2`)

| Check | Result |
|---|---|
| `pnpm -r build`, `pnpm -r typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm openapi:lint` (846 ops), `pnpm check:no-cdn` | all exit 0 (`10`–`15`) |
| `pnpm test`, Node 22.22.2, LANG/LC_ALL unset | 145 files / 2350 tests, 94 / 1746, 3 / 259 + 2 skipped by design; exit 0 (`20`) |
| `pnpm test`, Node 24.21.0, LANG/LC_ALL unset | the same counts; exit 0 (`21`) |
| Integration, disposable PostgreSQL 16.13, LANG/LC_ALL unset | 320 / 320 files, 3084 passed, 1 skipped by design; 89 migrations 0001→0097; `contract.test.ts` 83 tests; exit 0 (`30`; attempt 1 ENOSPC before any test) |
| Integration, LANG=C.UTF-8 | 320 / 320, 3084 passed, 1 skipped by design; exit 0 (`31`) |
| `validate.mjs --historical --stage DG4`, `DG3`, `DG2`, `DG1`, `--register DG5`, `--pipeline` | all exit 0 (`16`) |
| Role sweep and database probes | 9 / 9 (`45`) |
| Outbox registry | PASS (`40`) |
| DOCX/PPTX control character | defect reproduced (`46`, `46b`), F-DG5-100 |

I used my own writable `node_modules` in the disposable working copy (offline `--frozen-lockfile` install from a private copy of the local pnpm store), so Vitest's `--configLoader runner` workaround for a read-only `node_modules` was not needed. I ran no e2e spec in this review, so the A06/A07 `E2E_SCREENSHOT_DIR` note does not apply. The browser journeys are the QA reviewer's scope.
