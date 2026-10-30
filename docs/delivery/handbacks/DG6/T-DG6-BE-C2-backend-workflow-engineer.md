# Handback T-DG6-BE-C2 (backend-workflow-engineer): the S02-006 route-inventory sweep

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING. Task T-DG6-BE-C2, `docs/architecture/p6-work-split.md` §E/F.5.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-C2.md`, sha256 `c5bf538915cd69b177c9bb9ddb770f14e736b0560aad462d4418ae7f436c5815` (verified before starting).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-C2-backend-workflow-engineer-20261030T175841Z-ebed9be8","session_id":"ebed9be8-cd75-463b-89c0-e89626a99bb6"}`.
- **Working tree:** worktree `/home/user/wt/dg6-be-c2`, branch `dg6/be-c2`, base `HEAD` `3181245397e3512737b7a614e404027881427317`. The changes are **uncommitted**, as the assignment asks.
- **Time:** `date -u` at start `Fri Oct 30 17:58:59 UTC 2026`; at end `Fri Oct 30 19:31:42 UTC 2026` (§7). The full integration run (§4 #9) finished at 20:12:23 UTC, after the first version of this handback; §4 and §7 were updated with its result.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` gave `PASS gate DG5 (historical)`, **exit 0**, before any change. It was run again at the end (§4 #10).
- **Decisions applied:** D-195, D-196 (no migration needed, so item 2 does not apply), D-199/D-200/D-201 (the merged state at `HEAD`), D-138 (no growing delivery folder is read), D-142.
- **Product gates:** G1–G6 are business approvals inside the product. The sweep calls `decideGate`, `decideDecision`, the Finance validation operations and every other approval operation **only to prove that they are refused**: unauthenticated, without CSRF, unauthorized, or with invalid input. Nothing persisted in any of those cases (§2). The positive control (§2.6) runs only `create*` operations on synthetic records, never an approval. Nothing reads or writes DG0–DG7, and product G6 never implies DG7. All data is synthetic.

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/api/test/support/route-inventory.ts` (new) | Request generation from the contract schemas. `eligibleOperations` and `SWEEP_EXCLUSIONS`: the ADR-0051 §5 inventory. `exampleOf`: a minimal instance that the contract schema accepts, covering `$ref`, `allOf`, `oneOf`/`anyOf` (a branch's `required` and `properties` merged with the parent's), enums, formats, patterns (the schema's `examples` first), bounds, `minProperties` maps and nullable branches. Each value is checked with ajv against the schema itself. Path, required query and required header parameters are generated too. `invalidRequest` builds the case-4 input. `explain` gives the ajv error text for failure messages. |
| `apps/api/test/integration/hardening/route-inventory.test.ts` (new) | The sweep: 9 tests (§2). It runs against its own scratch database (`createScratchDatabase` + `migrate`), so the whole-database "nothing persisted" fingerprint is deterministic. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-C2-evidence/*.log`, `static-exit-codes.txt` | Check logs (§4). |

No product source file, migration, contract, schema, i18n file, pending list or exercise seam was edited. No dependency was added: ajv, ajv-formats and uuid are already used by `test/support/contract.ts` and `harness.ts`.

## 2. Behaviour delivered: REQ-S02-006

Acceptance (quoted, `requirements.csv`): *"A08;A12: each control test that bypasses the UI and calls the API with invalid or unauthorized input is rejected; clearing browser storage loses no submitted business data"*.

The sweep delivers the **first half** of this text. As ADR-0051 §5 states, the second half ("clearing browser storage loses no submitted business data") belongs to ADR-0057's server-side drafts (slice H) and QA-D's e2e. **This task does not claim it.**

Every request is made directly against the API (Fastify `inject`; no UI, no browser), against the real PostgreSQL 16.15 disposable cluster. Results come from the final-code run `route-inventory-alone.log`, exit 0, 9/9 tests.

### 2.1 The inventory (ADR-0051 §5)

- **Derived from `docs/api/openapi.yaml`, not hand-listed:** every POST, PUT, PATCH and DELETE operation, minus the `p2-pending.ts` aggregate, minus `devLogin` and `receiveWebhook`.
- **Counts:** `contract unsafe operations 486; pending (not routed) 0 (none); excluded devLogin, receiveWebhook; eligible 484`. No unsafe operation is pending at `HEAD`.
- **Every eligible operation is routed** on the running server. The test fails if one is not.
- **The exclusions are exactly the public unsafe routes** of the running server (`access: { public: true }`): `devLogin` and `receiveWebhook`. A new public mutation therefore fails the test. ADR-0051 §5 named `devLogin` and the ADR-0056 webhook receivers; `receiveWebhook` is the one receiver shipped at `HEAD`.
- **`logout` is swept** in cases 1 and 2, as ADR-0051 §5 asks.

### 2.2 Case 1, unauthenticated (no session cookie)

**484/484 operations answer 401 `urn:mth:problem:unauthenticated`, code `unauthenticated`.**

The body sent is valid under the contract, with the declared media type (JSON, `application/octet-stream` for the upload, `text/csv` for the import). The refusal therefore comes from authentication, not from parsing.

### 2.3 Case 2, CSRF (a session without `X-CSRF-Token`)

**484/484 operations answer 403 `urn:mth:problem:csrf`, code `csrf`.**

The session belongs to a synthetic user who holds every catalogue role, so the refusal can only be the CSRF check.

### 2.4 Case 3, unauthorized (valid CSRF, contract-valid request)

The verdict is **403 forbidden or 404 not_found, never 2xx**. It ran with two users.

**3a: org A's member with no assignment** (`seedWorld`'s `nobody`, exactly "a user with no assignment in the target organization").
- **481 operations: 137 × 403, 344 × 404, no other status.**
- 312 of the 481 address a real record of org A by path: the real transformation, organization, business unit or user. The other 169 address a record by an id the sweep generated, which exists nowhere, so they show the refusal of a non-existent target (see §6, gap 1).
- **Excluded from 3a, derived and pinned** (the test fails if the derived set changes):
  - `logout`, `updateMyPreferences` and `previewFormula` are `permission: "authenticated"` routes with no path parameter. They act on the caller's own data; `previewFormula` is a stateless evaluation that persists nothing (ADR-0047). No foreign target exists to be refused.

**3b: a user of org B who holds every catalogue role in org B**, against each of the 312 operations whose path names an org A record.
- **312 operations: 70 × 403, 242 × 404.** A user with every permission elsewhere is refused on another organization's records.

### 2.5 Case 4, invalid input (an authorized session: every role on org A and on the transformation)

**482 operations: 481 × 400 with the uniform body; 1 pinned deviation (422).**

The uniform body is `urn:mth:problem:validation`, a `code`, and a non-empty `errors[]` whose pointers are all RFC 6901. No 2xx and no 500 occurred.

Input kinds: `missing-required-property` 115, `malformed-path-id` 340, `malformed-path-parameter` 25 (a gate code, record type, job code and so on), `body-not-an-object` 2.

- **Why the malformed id comes first.** An operation that addresses a record by a generated id or code gets the malformed id, not the missing property. Its target does not exist, so a route that loads the record before reading the body answers 404, which is correct. The first measured run proved it: 77 such 404s, all gone once the id was malformed instead.
- **Excluded, derived and pinned:** `logout` and `requestDemoReset`. They take no body and no parameter, so no input can be made invalid.
- **Pinned deviation:** `4:createTomGap`. See finding F-DG6-BE-C2-1 in §5. The test asserts that the deviation reproduces exactly (status 422, code `t03.dimension_required`), so the pin must be removed once the route is fixed.

### 2.6 "Nothing persisted" (ADR-0051 §5), every case

Three checks, for every case:
- **Per request:** the request wrote no `audit_event` row other than `authorization.denied`. 0 violations in every case.
- **Per case, the ADR's literal assertion:** the count of `audit_event` rows other than `authorization.denied` is the same before and after (`157 -> 157` in all five case runs).
- **Per case, stronger than the ADR:** a row fingerprint (count plus md5 of every row) of **all 334 base tables** of the private database is identical before and after. Two exclusions:
  - the `user_session` table, because an authenticated request refreshes its own session's idle timer (ADR-0005);
  - the `authorization.denied` rows of `audit_event`.
  - Result: `changed 0 (none)` in every case.

Every response was also checked against the contract (`assertContract`). 0 deviations in every case.

### 2.7 Positive control: the sweep is not vacuous

The same generated requests for the 62 transformation-scoped `create*` operations were sent by the authorized user:
- **18 × 201**, each writing its audit event (audit rows `157 -> 176`; 22 tables changed). The detectors see real writes.
- The others: 36 × 422, 5 × 400, 2 × 404, 1 × 403. These are business rules refusing a minimal synthetic body, for example a referenced record that does not exist.
- Case 3 never produced a 400 or 422, so no refusal there came from validation: authorization always answered first.

## 3. Operations routed: pending-list delta

**None.** This task routes no operation. No `p6-pending-be-c2.ts` exists, and no pending list or exercise seam was edited.

The pinned counts in `contract.test.ts` are unchanged: operation count, media types, rate-limit floor and CSRF-exempt routes. The integration project gains **1 file and 9 tests**; no pinned test count elsewhere changes.

## 4. Checks actually run

Environment: Node 24.21.0, offline, worktree `/home/user/wt/dg6-be-c2`. Harness ports 26200–26249 only. The shell's locale is `LC_CTYPE=C.UTF-8` unless noted. An empty `apps/api/.claude/.cc-writes` directory was removed before the tests. Exit codes are also in `T-DG6-BE-C2-evidence/static-exit-codes.txt`.

| # | Command | Exit | Result / log |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | **0** | `PASS gate DG5 (historical)` |
| 2 | `pnpm -r typecheck` | **0** | `pnpm_r_typecheck.log` |
| 3 | `pnpm -r build` | **0** | `pnpm_r_build.log` |
| 4 | `pnpm lint` | **0** | `pnpm_lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | `prettier-check.log` (run again at the end, §7) |
| 6 | `pnpm openapi:lint` | **0** | `pnpm_openapi:lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (locale unset) | **1** | `pnpm-test-locale-unset.log`: unit-node 179/179 files, **2737/2737**; unit-web **1 failed** / 1869 passed (1870), 103/104 files; unit-formula-nocodegen 3/3 files, 259 passed + 2 skipped (261) |
| 8 | `LC_ALL=C.UTF-8 LANG=C.UTF-8 pnpm test` | **1** | `pnpm-test-locale-C.UTF-8.log`: identical counts, and the same single failure |
| 8a | `npx vitest run --project unit-web apps/web/src/pages/admin/security/p6-admin-screens.test.tsx` (alone) | **1** | `p6-admin-screens-alone.log`: 1 failed / 32 passed. **Deterministic, not load** |
| 9 | `QA_PG_PORT=26210 MTH_PORT_POOL=26211-26249 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | `pnpm-test-integration.log`, 19:11:36 → 20:12:23 UTC on a loaded host: **385 files: 381 passed, 4 failed; 3969 tests: 3961 passed, 5 failed, 1 skipped, 2 todo**. `route-inventory.test.ts` ✓ 9/9 inside the suite. The 5 failures are all outside this task's files; they are classified in §7 |
| 9a | `QA_PG_PORT=26200 MTH_PORT_POOL=26201-26209 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/hardening/route-inventory.test.ts` (final code) | **0** | `route-inventory-alone.log`: **9/9**, 109.95 s on the loaded host. PostgreSQL 16.15, 112 migrations on a fresh database. Four earlier development runs of the same file are described in §4.1 |
| 10 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | **0** | `validate-historical-DG5.log`: `PASS gate DG5 (historical)` |
| 11 | `QA_PG_PORT=26200 … with-pg.sh npx vitest run --project integration apps/api/test/integration/assistant/conversations.test.ts` (alone, to classify #9's failure) | **1** | `assistant-conversations-alone.log`: 1 failed / 16 passed, deterministic (§7) |
| 12 | `QA_PG_PORT=26200 … with-pg.sh npx vitest run --project integration apps/api/test/integration/admin/security.test.ts apps/api/test/integration/gates/g4.test.ts` (alone) | **1** | `security-g4-alone.log`: `g4.test.ts` 5/5 ✓ (its suite failure was a load timeout); `security.test.ts` 1 failed / 7 passed, deterministic (§7) |

**The unit-web failure (#7, #8, #8a)** is not caused by this task, which changes only two API test files. It is a **merge seam inside `HEAD`**:
- `p6-admin-screens.test.tsx:461` (FE-B, `71e013b96`) asserts `document.querySelector("input, textarea")` is `null` on Administration > Identity.
- FE-D's global search box (`apps/web/src/pages/search/GlobalSearchBox.tsx`, `480717236`, merged in `318124539`) now renders an `<input class="global-search__input">` in the shell on every page.
- **For the orchestrator / frontend-ux-engineer:** the assertion should be scoped to the page's main region rather than the whole document. Not fixed here: outside my file ownership.

### 4.1 Development runs of the sweep (disclosed)

Runs 1–4 of `route-inventory.test.ts` exited 1. They were development iterations of the generator, and each failure was in the sweep's own request generation or pins, not in a product route:
- run 1: the authorized user lacked organization-level business roles, so 3 case-4 calls were answered 403;
- run 1: 77 case-4 404s from missing-property bodies sent to non-existent targets (§2.5);
- run 1: required query parameters were not sent;
- runs 2–3: required headers were not sent, and a pattern-constrained query value was not generated from the schema's `examples`;
- the caller-scoped pin needed adjusting to the derived set.

Run 5 and the final run (#9a) exited 0. The run logs were not kept apart from the final one.

## 5. Findings for the orchestrator (proposed IDs; p6-plan R1: reported, not fixed here)

- **F-DG6-BE-C2-1 (Low, `mandatory_violation: false`), REQ-S02-006 / ADR-0051 §5 case 4.**
  - **Operation:** `createTomGap` (`POST /api/v1/transformations/{transformationId}/tom-gaps`).
  - **Behaviour:** without `dimensionCode` it answers **422** `t03.dimension_required` (pointer `/dimensionCode`) instead of the uniform **400**.
  - **Contract:** `TomGapCreate` lists `dimensionCode` as required.
  - **Cause:** the route parses the body with `tomGapCreateLenient = tomGapCreate.partial({ dimensionCode: true })` and refuses the absence later as a business rule (`apps/api/src/modules/transformations/registers.ts`, around lines 460–475; DG2, `43942b6d2`).
  - **Impact:** the input is rejected and nothing is persisted (all three checks of §2.6), with a problem body and a pointer. Only the status and type differ from ADR-0051 §5 case 4.
  - **Reproduce:** the sweep's case 4 with the pin removed.
  - **Fix options for the owner:**
    - parse with `tomGapCreate`, which gives a 400;
    - or, if the lenient create is intended (the 422 rule text suggests an incomplete row may be saved elsewhere), make `dimensionCode` optional in the contract and keep the 422.
  - Either way, the sweep's `REPORTED_DEVIATIONS` entry must be removed in the same change; the test enforces it.
- **No other DG1–DG5 or P6 operation failed any case.**

## 6. Known gaps and limits, stated plainly

1. **Case 3 targets.** 169 of the 481 case-3a operations address their record only by an id the sweep generated, for example `/initiatives/{initiativeId}` and `/decisions/{decisionId}`. The 404 they get proves that a non-existent target is refused without persisting anything. It does **not** prove that authorization would refuse an existing record of org A on those paths.
   - That proof exists only for the 312 operations whose path names the real transformation, organization, business unit or user (cases 3a and 3b).
   - Part of it is covered elsewhere on real records: the P2 AUD sweep `aud-write-deny.test.ts`, and the auditor write sweep of `response-validation.test.ts`.
   - A full real-record case 3 would need a fixture world with every record type. It is the natural extension (for example, reusing the contract suite's created ids, as `response-validation.test.ts` does with `acceptedRequestBodies`).
2. **Case 4 input kind.** 340 operations are tested with a malformed path id and 25 with a malformed coded path parameter, not with a missing body property, for the reason in §2.5. Both are inputs that "violate the contract schema" under ADR-0051 §5. The missing-property variant on those operations' existing records would also need the full fixture world of gap 1.
3. **The second half of the REQ-S02-006 acceptance** (browser storage) is not claimed here (ADR-0051 §5; slice H and QA-D).
4. **The full integration suite (§4 #9) exits 1** (5 failures, none in this task's files; §7). Acceptance item 3 is therefore **not met** on this tree. The new sweep passed both inside the suite and alone.

## 7. State at handback, and what remains

- **End of work:** `date -u` `Fri Oct 30 19:31:42 UTC 2026` (about 93 minutes).
- **`validate --historical --stage DG5` at the end:** exit **0**, `PASS gate DG5 (historical)` (`validate-historical-DG5.log`).
- **`prettier --check` at the end** (after the handback was written): exit **0** (`prettier-check-end.log`).
- **Full integration run (§4 #9): finished after this handback was first written** (20:12:23 UTC; exit **1**). Results: 385 files (381 passed, 4 failed), 3969 tests (3961 passed, 5 failed, 1 skipped, 2 todo). The new sweep passed inside the suite (9/9). No pinned test count changed because of this task; the suite gains 1 file and 9 tests. Every failure is in a file this task did not touch:

| Failing test | Classification | Evidence |
|---|---|---|
| `assistant/conversations.test.ts:670`, the `assistant` rate-limit class log line | **Deterministic seam inside `HEAD`.** It expects BE-T's stub reply (`replyKind: "no_sources"`, `dataItems: 0`); the merged tree answers `answer`, `dataItems: 1` (BE-U's retrieval) | Re-run alone: 1 failed / 16 passed (`assistant-conversations-alone.log`) |
| `admin/security.test.ts:62`, `getSecurityRateLimits` classes | **Deterministic seam inside `HEAD`.** It pins the `webhook` class's `operationIds` as `[]`; the merged tree lists `receiveWebhook` (BE-N joined the class) | Re-run alone: 1 failed / 7 passed (`security-g4-alone.log`) |
| `gates/g4.test.ts:472`, "Schedule unknown: DEP-nn" | **Load:** a 30 s timeout in the suite | Re-run alone: 5/5 passed (`security-g4-alone.log`) |
| `contract/response-validation.test.ts`, the media-type sweep (`contract.test.ts:1120`) | 30 s timeout in the suite; **not re-run alone** (over the time limit). D-201 attributed the same timeout to load | Suite log only |
| `contract/response-validation.test.ts`, P5 BE-J operations (`p5-exercises-be-j.ts:61`, "expected [] to have a length of 1") | **Not re-run alone and not classified.** D-201 recorded the same failure in W5 as passing alone, attributed to load | Suite log only |

- **Seams found inside `HEAD` (not caused by this task, not fixed here):**
  - **unit-web:** `p6-admin-screens.test.tsx:461` against FE-D's global search input (§4);
  - **integration:** `assistant/conversations.test.ts:670` against BE-U's retrieval;
  - **integration:** `admin/security.test.ts:62` against BE-N's `webhook` class line.

**What remains:**
1. A green `pnpm test:integration` on the merged tree, once the seams are repaired. Also a re-run of `response-validation.test.ts` alone, to confirm its two failures are load.
2. The three seams (owners: frontend-ux-engineer; the assistant tests' owner; the security view tests' owner).
3. F-DG6-BE-C2-1 (`createTomGap` 422 vs 400), for its owner.
4. Optionally, the real-record extension of case 3 and case 4 (§6 gaps 1 and 2).

A separable second half is not defined in §E/F.5; the sweep itself is complete.

## 8. Merge instructions

- Two new files and the evidence folder. No conflict is expected: no shared file was touched.
- No migration (so no migration id taken), no contract change, no `P6_OPERATION_IDS` change, no pending-list change.
- After merge, run the sweep once on the merged tree. A later task that routes a pending unsafe operation is swept automatically:
  - its generated request must be refused in cases 1–4;
  - a new public mutation fails "the exclusions are exactly the public unsafe routes";
  - a new caller-scoped `authenticated` mutation without path parameters fails the derived pin until it is added, with its reason, to `CALLER_SCOPED`.
- The sweep takes about 40–75 s of test time on a loaded host (110 s wall with collection). It sets its own test timeouts (600 s per case), well above the measured worst case.
- No user-facing en/ar text calls this sweep planned. `grep` finds it only in architecture documents, so no string was made untrue and none was edited.
