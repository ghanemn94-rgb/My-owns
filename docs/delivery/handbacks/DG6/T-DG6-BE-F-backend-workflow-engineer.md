# Handback T-DG6-BE-F: response validation of every operation and the S16-023 integrity sweep (backend-workflow-engineer)

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING). Section `docs/architecture/p6-work-split.md` §E/F.10; design ADR-0052 §7, §9 (and §8 "one audit event per mutation").
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-F.md` (sha256 `4c8fa7fe9d773df74e44378fc0f76b7fd2e55da0aadcbdce162e7a8364924edf`, verified).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-F-backend-workflow-engineer-20261027T010242Z-205d45ef","session_id":"205d45ef-4e43-456a-8ea7-6260fc7c694b"}`.
- **Working tree:** worktree `/home/user/wt/dg6-be-f`, branch `dg6/be-f`, base `HEAD` `5e4cbad20917cb4f50517981d15fb87441fedfc5`. Changes are **uncommitted** for the orchestrator.
- **Time:** started `Tue Oct 27 01:02:58 UTC 2026`; ended `Tue Oct 27 02:59 UTC 2026` (about the 2-hour limit; row 3 was completed from the log at 02:59:51).
- **Requirements:** REQ-S16-027 (owner BE-F), REQ-S16-023 (owner BE-F), REQ-S16-032 (BE-F part: the cross-entity "one audit event per mutation" assertion of ADR-0052 §8 for the routed P6 entities).
- **Two gate systems.** Nothing here reads or writes DG0–DG7. The only product-gate action is a synthetic G1 approval by a synthetic Sponsor on test data inside a disposable database. It approves nothing real. Product G6 never implies DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/test/support/contract.ts` (named lines only, +55) | The `validatedResponses` ledger: one `(operationId, status, mediaType, problemType, problemCode, errorPointers, hasNextCursor)` entry per response `assertContract` validated. A new check that every problem body (`application/problem+json`) is a `Problem` whose `status` equals the response status, whatever the operation declares. `acceptedRequestBodies`: the first contract-valid request body the server accepted per operation (filled in `assertAcceptedRequest`). |
| `apps/api/test/integration/contract/response-validation.test.ts` (new) | ADR-0052 §7. It runs the whole contract suite inside its own file (see §2.1 for why), then asserts coverage of every operation and the three acceptance clauses literally. |
| `apps/api/test/integration/hardening/integrity-sweep.test.ts` (new) | ADR-0052 §9 parts 1–4, with the acceptance trio stated literally, plus the P6 audit assertion. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-F-backend-workflow-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-F-evidence/*.log` | Logs of every check, each with its command, its UTC times and `exit=`. |

No source file under `apps/api/src/**`, no migration, no contract (`docs/api/openapi.yaml`), no zod mirror, no web file and no dependency was changed. `contract.test.ts` and every `p*-exercises-*.ts` and `p*-pending-*.ts` file are unchanged.

## 2. Behaviour delivered, per requirement

### 2.1 REQ-S16-027

Acceptance (quoted): **"A12;A08: contract tests validate responses against the OpenAPI document; invalid input returns the uniform 400 body; an unauthorized call returns 403"**.

**Why the contract suite runs inside `response-validation.test.ts`.** Vitest isolates module state per test file (`isolate` is on; one fork; the file order is not fixed). So a ledger filled by `contract.test.ts` cannot be read deterministically from another file. `response-validation.test.ts` therefore starts with `import "./contract.test.ts"`. That registers every `describe`/`it` of the contract suite in this file, in order, against this file's own API and seeded world. Its own checks run after the suite and read the ledger the suite filled.

Cost: the contract suite runs twice per integration run, about +85–95 s. That was measured: the contract suite alone took 83.5 s; this file took 93–116 s across my runs. `contract.test.ts` itself is untouched and still runs on its own.

The one deliberate call outside the contract is the bucket-spending first call per operation of the rate-limit sweep (`platform-statuses.ts`, `contract: false`). The second call, the 429, is validated.

What the file asserts, with the measured numbers from my last run of the file:

1. **Every operation outside the pending aggregate has at least one validated response.** 9,837 validated responses cover 855 of 855 live operations (55 pending excluded) as 3,764 distinct `(operationId, status)` pairs. Operations without one: 0. The test lists any such operation by id. A pending operation with a validated response also fails the test.
2. **Every validated error response is `application/problem+json` and a `Problem`, and every validated 400 is the uniform validation body.** 7,322 validated error responses; 5,049 of them are 400s, every one with `type urn:mth:problem:validation`, a `code`, and a non-empty `errors[]` whose pointers are RFC 6901 JSON pointers.
3. **Invalid input returns the uniform 400 body in every module.**
   - From the suite: a validated uniform 400 exists in 113 of 113 OpenAPI tags.
   - Explicit samples: for every module with a JSON-body operation addressed only by `{transformationId}` (or nothing), the test sends a JSON array (never a valid object). The caller is a synthetic user holding every catalogue role, so authorization order cannot mask validation. Result: 400 `urn:mth:problem:validation` with JSON-pointer `errors[]` in 44 of 44 such modules; modules without a 400: none.
4. **An unauthorized call returns 403 (or the ADR-0006 404 for an unreadable record).**
   - (a) Every GET of a transformation's parts addressed by `{transformationId}` alone, except the 2 GETs that require a query parameter (they validate it first), called by an authenticated user of the same organization with no assignment: 122 operations, 121 × 404 `not-found` and 1 × 403 `forbidden`, never a success.
   - (b) The organization's auditor (AUD, read-only) calls every body-carrying operation whose route needs a business permission (442 writes). Each call replays the first body the server accepted for that operation in the suite, so validation passes and authorization answers. Statuses: 300 × 403, 114 × 404, 28 × 400. **No write succeeded.**
   - (c) Per module: every module with a business-permission route (105) refused an unauthorized call, as a 403 forbidden in (b) or in the suite, or an ADR-0006 404 in (a). Not reached: none. The pin `MODULES_WITHOUT_A_REACHED_REFUSAL` is empty.
5. **Pagination (ADR-0052 §7 "nextCursor on every list operation").**
   - Static over the whole contract (215 `list*` operations): 177 declare a required `nextCursor`.
   - The 218 validated 200s of those operations all carry it, and none of the 177 lacks a validated 200.
   - **38 list operations declare no `nextCursor`** (bounded `{ items }` collections of DG1–DG5 owners). They are pinned in `UNPAGINATED_LISTS_AT_HEAD` so the set only shrinks, and reported as proposed finding F-DG6-BE-F-3 below. A new unpaginated list fails the test.

The ledger also made the existing harness stricter: every `application/problem+json` body produced through `call` in **every** integration file is now checked against `Problem` with a matching `status`.

My first version applied this check to every JSON error body. The full integration run showed that this broke 3 tests in `platform.test.ts`, because `getReadiness` 503 answers its declared `Readiness` JSON body, not a Problem. I narrowed the check to `application/problem+json` (02:58), and the ledger test now names that one exemption. `platform.test.ts` then passed 13/13 (`platform-after-fix.log`, exit 0). The full run was not repeated after the fix (§3, row 3).

### 2.2 REQ-S16-023

Acceptance (quoted): **"A08;A07: deleting an approved gate decision or its evidence returns 409; an illegal status transition returns 422 invalid-transition (ADR-0007); a duplicate unique key returns 409"**.

**Part 1: finalized records.** The world is built natively with the QA fixtures (`tests/qa/support/gates-native.ts`, imported, not edited): a note evidence item linked to a seeded diagnostic item, then G1 passed natively and approved by the synthetic Sponsor. The submission snapshot holds the evidence id (asserted).

- **Approved gate decision.**
  - The contract has no DELETE, archive, remove, discard, void or purge operation under `/gates`.
  - `mth_app` holds no DELETE on `gate_decision`, `gate_submission`, `gate_submission_criterion` or `gate_instance` (`has_table_privilege`).
  - A `DELETE` on the approved `gate_decision` row as `mth_app` fails with `42501`, and the row still reads `approved`.
- **Its evidence.**
  - The contract has no DELETE on any evidence path, and `mth_app` holds no DELETE on `evidence`, `evidence_link` or `evidence_content`. A `DELETE` of either row as `mth_app` fails with `42501`.
  - **The two removal operations the contract does offer accept the call.** `archiveEvidence` answers **200** and archives the item. `removeEvidenceLink` answers **200** and removes the link. ADR-0052 §9.1 expects 409 with the row unchanged for "each finalized type that has a DELETE or archive operation … the approved gate decision and its evidence first".
  - These are defects in another owner's route (`evidence/routes.ts`). Per p6-plan §5.1 they are **reported, not fixed** (proposed F-DG6-BE-F-1 and -2 below).
  - The two cases are written as the expected behaviour (409) and marked `it.fails`. They make the real call on every run and pass only while the defect persists, so they turn red the day the route refuses with 409, and the pin is then removed. **They are not passing acceptance tests. Count them as 2 open defects, not 2 passes.** The immutable submission snapshot (`gate_submission_freeze`) is unaffected.
- **Other finalized types.**
  - The contract's only DELETE operation is `retireDependencyType`, a catalogue retirement, not a finalized record (pinned).
  - `mth_app` holds DELETE only on `idempotency_record`, `oidc_login_state`, `session` and `user_identity`. None of the finalized tables checked (`audit_event`, `decision`, `gate_decision`, `gate_submission`, `evidence`, `evidence_link`, `report_snapshot`, `finance_validation`, `record_sensitivity`, `sensitive_record_grant`) is among them.

**Part 2: illegal status transitions.** Each is 422 `urn:mth:problem:invalid-transition` `invalid_transition`, with no audit row written by the refused request:

- **P6:** the sensitive grant, revoked → revoke again. The grant keeps its two audit events, `granted` (null → 1) and `revoked` (1 → 2).
- **DG1:** the transformation, active → closed by a status edit.
- **DG2:** the diagnostic finding, confirmed → archived.
- **DG3:** the T08 dependency, resolved → at_risk.
- **DG4:** the stakeholder champion, removed → remove again.

**Part 3: duplicate unique keys.** Each is a 409, with no audit row written by the refused request:

- **P6:** `sensitive_record_grant_one_active_key` → 409 `duplicate` `sensitive_grant.duplicate`.
- **P6:** `record_sensitivity_record_key`, reached only through PUT with `If-Match "0"` on an existing flag → 409 `version_conflict`.
- **DG1:** `organization` code → 409.
- **DG4:** the stakeholder champion's active key → 409 `stakeholder_champion.exists`.
- **DG5:** the automation rule code → 409 `automation_rule.code_taken`.

**Part 4: required ownership and canonical references.**

- All 32 P6 tables (`0098`–`0107`) exist. Every `uuid` `*_id` column of those tables (84) is covered by one of:
  - a foreign key;
  - a `*_record_ref` trigger (`record_sensitivity`, `sensitive_record_grant`);
  - one of 4 pinned, explained exceptions: three append-only history copies of an FK- or record_ref-guarded source column, and `import_row_commit.target_record_id`, which is guarded by `import_row_commit_guard` (`import_row_commit_target_exists`, `23503`).
- Text `*_id` columns (`source_system_id`, `source_record_id`, `delivery_id`) are external identifiers, not record references.
- Live checks:
  - a grant on a missing record → 404 `not_found`, nothing written;
  - an insert of a grant without its grantee as `mth_app` → `23502` (NOT NULL).
- Informational: `operational_exception` and `service_identity` have a nullable `organization_id`. The test prints this but does not assert it, and I did not check it against ADR-0053. Their owners (BE-J, BE-K) should confirm the design when the P6 rows are added.

**One audit event per P6 mutation (ADR-0052 §8, REQ-S16-032 part).** Every successful P6 mutation in the sweep asserts exactly one `audit_event` for its request, with prior and new version: `record_sensitivity.marked` (null → 1), `sensitive_record_grant.granted` (null → 1) and `sensitive_record_grant.revoked` (1 → 2). Every refused mutation asserts none. These are all the P6 mutations routed at `HEAD`. The other P6 mutations are still pending (see §6).

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline; PostgreSQL 16.13 disposable clusters through `tests/qa/support/with-pg.sh`; harness ports 23850–23899 only. The empty `.claude/.cc-writes` directories that the write guard leaves in visited source folders were removed before the runs.

**Host load during the acceptance runs.** The sandbox host has 4 CPUs and 16 GB of memory, and the other W4 agents ran on it at the same time. `/proc/loadavg` read 14–22 from 02:19 onward, and memory was nearly full. That load caused the Vitest RPC timeouts, the unit-web timeouts and the OOM kills reported below. None of them is a failed assertion in code this task touched; each is disclosed with its log.

| # | Command | Log | Exit | Result |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start of task, and again at the end) | `validate-dg5.log` | **0**, 0 | `PASS gate DG5 (historical)` both times. |
| 1a | `pnpm -r typecheck` (01:31–01:37; before the DG3/DG5 sweep rows were added) | `typecheck.log` | **0** | All packages done. |
| 1a' | `pnpm -r typecheck` (final tree, 02:2x) | `typecheck-final.log` | **137** | `apps/worker typecheck: Killed` (OOM; my change does not touch `apps/worker`). |
| 1a'' | `pnpm --filter @mth/api typecheck` (final tree) | `typecheck-api-final.log` | **137** | Killed (OOM). |
| 1a''' | `pnpm -r typecheck` (final tree, retry) | `typecheck-final2.log` | **137** | `apps/api typecheck: Killed` (OOM). **So there is no clean typecheck of the final tree.** The final tree differs from run 1a only in `integrity-sweep.test.ts` (the DG3 and DG5 rows), which `eslint` (typed rules) and Vitest's transform both processed without error (rows 1c', 3). |
| 1b | `pnpm -r build` | `build.log` | **0** | The builds compile `src` only (`tsconfig.build.json` includes `src`, excludes tests), and this task changed no `src` file, so the build inputs equal the final tree's. |
| 1c | `pnpm lint` (before the DG3/DG5 rows) | `lint.log` | **0** | |
| 1c' | `pnpm lint` (final tree) | `lint-final.log` | **0** | |
| 1d | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (final tree) | `prettier.log` | **0** | "All matched files use Prettier code style!" The sandbox's `/dev/null` bind mounts at the top level (`.bashrc`, `CLAUDE.local.md`, `.mcp.json` …, character devices, not repository files) are listed as untracked and passed. |
| 1e | `pnpm openapi:lint` | `openapi-lint.log` | **0** | The contract is unchanged. |
| 2a | `pnpm test`, locale unset, attempt 1 (01:44, concurrent with the integration run) | `test-locale-unset-attempt1-concurrent.log` | **1** | unit-node 154/155 files, 2,424/2,425 tests: `architecture.test.ts` found a `.claude` directory in `apps/api/src/modules`, the write guard's artifact from my shell's working directory (removed afterwards). Plus 1 Vitest `Timeout calling "onTaskUpdate"` error. unit-web 96/96 files, 1,768/1,768 tests. unit-formula-nocodegen 3/3 files, 259 passed and 2 skipped. |
| 2b | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test`, attempt 1 (concurrent) | `test-c-utf8-attempt1-concurrent.log` | **1** | unit-node 155/155, 2,425/2,425, but 1 Vitest `onTaskUpdate` RPC timeout error. unit-web 96/96, 1,768/1,768. nocodegen 3/3, 259 passed and 2 skipped. |
| 2c | `pnpm test`, locale unset, rerun (02:20) | `test-locale-unset.log` | **1** | unit-node 155/155, 2,425/2,425, with 1 `onTaskUpdate` RPC timeout. **unit-web 90/96 files, 1,760/1,768 tests: 8 failures**, all timeouts under load: 4 × "Test timed out in 20000ms" and 4 `findBy*` waits that did not find their element (in `p2-blank-forms`, `p2`, `render-time-language` ×3, `ExecutionPanel`, `roadmap` and `team` tests). These are web tests this task cannot affect (no `apps/web` or shared change), and the same files passed 96/96 in runs 2a and 2b. nocodegen 3/3, 259 passed and 2 skipped. |
| 2d | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test`, rerun | `test-c-utf8.log` | **1** | unit-node 155/155, 2,425/2,425, with 1 `onTaskUpdate` RPC timeout. **unit-web 94/96 files, 1,765/1,768 tests: 3 failures**, all load timeouts: 1 × "Test timed out in 20000ms" and 2 `findBy*` misses (`/View/`, `/عرض/`), in `extension-hosts-twelve` (ar) and `g5-g6` (G5 view ar; modular G3 waiver en). The same files passed in runs 2a and 2b. nocodegen 3/3, 259 passed and 2 skipped. |
| 3 | `QA_PG_PORT=23860 MTH_PORT_POOL=23861-23899 tests/qa/support/with-pg.sh pnpm test:integration` (started 01:32) | `integration.log` | **1** (finished 02:59:51) | **Final: 326/328 files passed; 3,283 passed, 5 failed, 1 skipped, 1 todo (3,290 tests); 5,290 s; `exit=1`.** The 5 failures are in 2 files:
- **`platform.test.ts`, 3 tests.** My over-broad Problem check (see §2.1). Fixed at 02:58 and verified (`platform-after-fix.log`: 13/13, exit 0).
- **`response-validation.test.ts`, 2 of 109 tests.** Both are in the *second* run of the contract suite inside this file: the "P5 BE-J operations" seam, and "every operation: an undeclared request media type …", which hit the 30 s test timeout under load. All 7 of this file's own checks passed in the full run: 855/855 operations validated, 113/113 tags with a uniform 400, 68 explicit-sample modules, 0 auditor write successes, 105/105 modules refused, the pagination pin holding. The BE-J failure is `p5-exercises-be-j.ts:61`, `expected [] to have a length of 1` on a list read. The likely cause is shared per-run database state: in the full run, `contract.test.ts` has already exercised the same seams in the same database, and the BE-J seam is evidently not repeatable there. In my targeted runs (fresh cluster, `contract.test.ts` not run first), the file passed 108/108 three times. 
- **Passed:** `contract.test.ts` (101 tests) and `integrity-sweep.test.ts` (19 tests). The pinned counts in `contract.test.ts` are unchanged (§4). | |
| 3' | Targeted runs of the two new files (same harness, port 23852) | (scratch) | 0 | Final versions: `integrity-sweep.test.ts` 19/19 (2 of them `it.fails` defect pins); `response-validation.test.ts` 108/108 (93–116 s). |

**Acceptance status.** 1b, 1c, 1d, 1e and 4 (row 0) are met. **1a is not met on the final tree**: three OOM kills. **2 is not met as "exit 0"**: in every invocation every unit-node and nocodegen test passed, but each invocation exited 1, on a load-induced Vitest RPC timeout, on the 8 unit-web timeouts of run 2c, or on the guard artifact in run 2a. **3 is not met**: the full run exited 1 with 5 failed tests (3 fixed and verified, 2 open in the duplicated contract suite). The orchestrator should rerun 1a, 2 and 3 on an unloaded host after the §6 repair.

## 4. Operations routed, contract pins, migrations

- **Operations routed: none.** BE-F owns no operation, so there is no `p6-pending-be-f.ts` and no `p6-exercises-be-f.ts` (§E/F.10 names neither). Pending-list delta: none.
- **`contract.test.ts` pins:** unchanged. Operation count 910; JSON-body pin `[394, 393, 1]`; the rate-limit floor; the public/CSRF-exempt ids.
- **Integration project counts (for the orchestrator's reconciliation):** +2 files.
  - `response-validation.test.ts` adds 108 tests: the 101 contract-suite tests run again, plus its 7 own.
  - `integrity-sweep.test.ts` adds 19 tests, 2 of them `it.fails` defect pins.
- **Migrations:** none.

## 5. Proposed findings (for the orchestrator; ids to be allocated)

| Proposed id | Requirement | Severity (proposed) | Mandatory violation | Summary |
|---|---|---|---|---|
| F-DG6-BE-F-1 | REQ-S16-023 | High | true (literal acceptance; data integrity) | `archiveEvidence` on evidence of an approved gate decision answers 200 and archives it; expected 409, row unchanged (ADR-0052 §9.1). |
| F-DG6-BE-F-2 | REQ-S16-023 | High | true | `removeEvidenceLink` on the link that made the item evidence of an approved gate decision answers 200 and removes it; expected 409. |
| F-DG6-BE-F-3 | REQ-S16-027 | Medium | false (bounded collections; the acceptance text itself names no pagination) | 38 `list*` operations declare no `nextCursor` (ADR-0007 §4 "Responses are `{ items, nextCursor }`"; ADR-0052 §7). The list is in `UNPAGINATED_LISTS_AT_HEAD`. Either the contract and routes paginate them, or an ADR amendment exempts bounded collections by name. |

**Reproduction of F-1/F-2.** `pnpm test:integration` (or `npx vitest run --project integration apps/api/test/integration/hardening/integrity-sweep.test.ts` under `with-pg.sh`):

1. In a transformation created natively, link a note evidence item to a seeded diagnostic item.
2. Pass G1 (exceptions for missing criteria; Lead submits; synthetic Sponsor approves). The G1 submission snapshot then lists the evidence id.
3. `POST …/evidence-links/{linkId}/remove` with `If-Match` and `{reason}` → 200 `status: removed`.
4. `POST …/evidence/{evidenceId}/archive` with `If-Match` and `{reason}` → 200 `status: archived`.

The sweep prints both statuses (`[integrity-sweep] … 200`).

**What the fix needs (not done here; owner of `evidence/routes.ts`).**

- A rule "evidence in the snapshot of an approved gate submission is finalized" in `archiveEvidence` and `removeEvidenceLink`, and possibly a database guard.
- A refusal code and text. ADR-0052 §1 and §2 have none. Proposed: 409 `evidence.finalized`, "This evidence supports an approved gate decision and cannot be archived or unlinked." Both operations already declare 409.
- The orchestrator or architect decides the problem `type`: the `Problem.type` enum has `version-conflict` and `duplicate` but no generic conflict type.
- When fixed, remove the two `it.fails` marks in `integrity-sweep.test.ts`.

## 6. What remains (stated plainly)

- **P6 entity rows of later slices (the separable second half; name it T-DG6-BE-F2).** ADR-0052 §9.2–§9.3 ask for "every state machine of a P6 entity … and those ADR-0053–0059 define" and "the others of ADR-0053–0059". At `HEAD` only the 9 slice E/F operations of BE-B and BE-E are routed; the 55 operations of slices J/C and B/A are pending. So the sweep has no API rows yet for the transitions and unique keys of service identities, operational exceptions, notification channels, storage settings, connectors, configuration versions, integration runs, imports, webhooks, outbound writes and deliverable external changes. Slices H/G/D/I/K (ARCH-04 to 06) are not designed yet. Part 4 (catalogue) already covers all 32 P6 tables and must be extended with the tables of later migrations. The audit assertion must be added for each newly routed P6 mutation.
- **DG5 illegal-transition row.** Part 2 covers DG1, DG2, DG3, DG4 and P6. DG5 is covered in part 3 only (`automation_rule.code_taken`). A DG5 transition row (for example a configuration review decided twice, or an automation rule version submitted when not a draft) is not in the sweep; those refusals are covered by the DG5 owners' own tests (`methodology/studio-review-publish.test.ts`, `p5-exercises-be-b3.ts`).
- **The two failures of the duplicated contract suite in the full run (§3, row 3) are open.** Proposed repair, in the second half or by the orchestrator:
  - Option 1: let `response-validation.test.ts` run the suite on its own scratch database. The harness already supports `startApi({ database })`, but `contract.test.ts`'s `beforeAll` (not my file) would need to accept it, for example through an exported setup hook.
  - Option 2: drop the import and record the ledger from `contract.test.ts` itself: one named line in that file writing the ledger to a run-scoped file, read by a check that is guaranteed to run after it. That needs the orchestrator's agreement, since `contract.test.ts` is not in my ownership.

  Until then, `pnpm test:integration` is not green with this change. The orchestrator should not merge `response-validation.test.ts` as is without one of these repairs, or should merge it with the import removed.
- **The full integration run was not repeated after the 02:58 Problem-check fix.** The finished run (exit 1, 5 failures) predates the fix for 3 of them.
- **Acceptance checks 1a and 2 are not clean on the final tree** (OOM kills and load timeouts; §3). They need a rerun on an unloaded host.
- **F-DG6-BE-F-1/-2/-3** are open defects in other owners' routes and contract (§5). Not fixed, by rule.
- **User-facing texts:** none changed or made untrue. This task ships tests only; no en/ar string calls these checks planned.
- **Contract, schema or dependency needs:** none for this task. The refusal code for the F-1/F-2 fix is listed in §5.

## 7. Merge instructions

- No migration and no ordering constraint. `apps/api/test/support/contract.ts` is touched only in named, `T-DG6-BE-F`-commented lines (the ledger, the Problem check, `acceptedRequestBodies`). A concurrent edit of that file by another task merges line-wise.
- `response-validation.test.ts` imports `contract.test.ts`. Any future change there (new seams) is picked up automatically. The coverage check then requires every newly routed operation to have a validated response, as `contract.test.ts` already does.
- If an owner fixes F-1/F-2, the two `it.fails` cases in `integrity-sweep.test.ts` turn red until their `.fails` marks are removed.
