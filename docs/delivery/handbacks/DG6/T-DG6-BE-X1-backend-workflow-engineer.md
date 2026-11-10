# Handback T-DG6-BE-X1 (backend-workflow-engineer): declare the 403 `evidence.parent_forbidden` of the evidence reads

- **Stage:** P6 / DG6 (BUILDING). **Task:** T-DG6-BE-X1, p6-work-split §E/F (pre-freeze repair of QA findings).
- **Invocation:** `DG6-T-DG6-BE-X1-backend-workflow-engineer-20261030T210723Z-c296356d`, session `c296356d-6621-4530-8030-61e038597004`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-X1.md`, sha256 `eec281bf312472a1ffa6b6fc7191c568e9909335e38567bf4ee364f87e04ec66` (verified).
- **Base:** branch `dg6/be-x1` at `9889bc9cb` (clean tree at start). **Changes are uncommitted**, for the orchestrator to integrate.
- **Time:** start `2026-10-30T21:07:39Z`, end `2026-10-30T22:50:51Z`.
- **Repairs:** proposed **F-DG6-QA-B-1** (T-DG6-QA-B handback §6 D1). An engineering change only. No business approval (G1–G6), Finance or IT approval was granted. All test data is synthetic. Nothing reads or writes DG0–DG7 records.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/api/openapi.yaml` | `downloadEvidenceContent` now declares `"403": { $ref: "#/components/responses/Forbidden" }` (`application/problem+json`, `Problem`), and its summary names the 404/403 split and the code `evidence.parent_forbidden`. `getEvidence` gets the same 403 and a summary. It already answered this 403 for a sensitive parent (ADR-0051 §4 rule 3; D-196 point 1) without declaring it. `previewEvidenceContent` already declared 403, so it is unchanged. |
| `apps/api/test/integration/contract/p6-exercises-be-x1.ts` (new) | Uses the contract-validating client to exercise the newly declared 403 on both operations: a sensitive parent benefit (download 403 and GET 403), and a sensitive item (download 403, GET keeps the §2 404). It also checks the positive cases: 200 for the benefit's owner, and 200 again after unmarking. |
| `apps/api/test/integration/contract/contract.test.ts` | Three seam lines: the import, the `...P6_MIRRORS_BE_X1` spread (an empty map, since no new JSON body), and the `it("P6 BE-X1 …")` call. No pinned count changed. |
| `apps/api/test/integration/evidence/ownership-transfer.test.ts` | Removes BE-C's interim `contract: false` bypass, which BE-C's "CONTRACT NEED" note describes. Every 403 in this suite is now asserted against the contract. No assertion was changed. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-X1-evidence/*` | The logs cited below. |

**Not changed:**
- `tests/qa/integration/a12-p6-scope-isolation.test.ts` is unedited (`git diff --quiet -- tests/qa` exits 0).
- No route, source module, zod mirror, migration, i18n string or dependency was changed.

## 2. Behaviour delivered, per requirement row

**Runtime behaviour is unchanged.** The routes already answered 403 `evidence.parent_forbidden` (BE-C, ADR-0051 §4). This task makes the published contract match that behaviour, and proves the match through the validating client.

- **REQ-S16-027.** Acceptance: *"A12;A08: contract tests validate responses against the OpenAPI document; invalid input returns the uniform 400 body; an unauthorized call returns 403"*.
  - Before the fix, QA-B's kept test failed with `contract: downloadEvidenceContent does not declare status 403 (declared: 200, 400, 401, 404, 429)`. Log: `T-DG6-BE-X1-evidence/baseline-before-fix-a12.log`. That run used HEAD's `openapi.yaml`, restored temporarily and then put back.
  - After the fix it passes, unedited.
  - The download's and the metadata GET's 403 bodies are now validated against the OpenAPI document in three places: QA-B's A12, BE-C's ownership-transfer suite and the new contract exercise.
- **REQ-S13-013.** Acceptance: *"A12: a user without access to the parent gets 403 on the evidence download URL; after BAU handover the new owner can download it"*.
  - The 403 on the download URL is now a declared response. Contract-validated proof: A12 "sensitive evidence: an in-scope reader not admitted gets 403 evidence.parent_forbidden on the download URL" and `p6-exercises-be-x1.ts` (sensitive parent benefit → 403 for BO2, 200 for the benefit's owner).
  - The post-handover download (ownership-transfer (c)) still passes, now with no contract bypass.
  - D-196 Option A is unchanged: a caller without `transformation.read` keeps the 404.

**Sibling check, as the assignment asks.**
- `previewEvidenceContent` already declared 403 (BE-D), so it needed no change.
- `getEvidence` throws the same 403 for a sensitive parent (`evidence/routes.ts` `registerEvidenceMetadataReads`, `refusal === "parent"`) but declared no 403. That is the same defect, already raised by BE-C's handback §5 and by D-196 point 1 ("the download and the metadata GET"). I declared it as well. That is a contract-only change, with no behaviour change.
- The other consumers of `requireEvidenceRead`/`evidenceReadDecision` need nothing:
  - `evidence/text-excerpt.ts` turns the refusal into an internal `not_read` and never sends the 403;
  - `portfolio/deliverable-confirmation.ts` is a mutation, and BE-O's contract governs its statuses.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. Disposable PostgreSQL through `tests/qa/support/with-pg.sh`, ports 26550–26599. Empty `.claude/.cc-writes` directories were removed before the tests.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (before implementation) | 0 | `PASS gate DG5 (historical)` | `validate-dg5-historical.log` |
| 1 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` (count unchanged) | `openapi-lint.log` |
| 2 | `pnpm -r typecheck` | 0 | | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | | `build.log` |
| 4 | `pnpm lint` | 0 | | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 6 | Baseline before the fix, HEAD `openapi.yaml`: `QA_PG_PORT=26560 MTH_PORT_POOL=26561-26599 tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/a12-p6-scope-isolation.test.ts -t "sensitive evidence"` | **1** (expected) | 1 failed, 1 passed, 24 skipped. The failure is QA-B's D1 error, verbatim. | `baseline-before-fix-a12.log` |
| 7 | Targeted run after the fix: `QA_PG_PORT=26550 MTH_PORT_POOL=26551-26599 tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/a12-p6-scope-isolation.test.ts apps/api/test/integration/evidence/ownership-transfer.test.ts apps/api/test/integration/contract/contract.test.ts` | 0 | 3 files, **136/136 passed** | `targeted-integration.log` |
| 8 | `pnpm test` with the locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | **1** | unit-node 182 files / **2762 passed**; unit-web **1 failed** / 1936 passed (1937); unit-formula-nocodegen **259 passed + 2 skipped** | `unit-locale-unset.log` |
| 9 | `pnpm test` with `LANG=LC_ALL=C.UTF-8` | **1** | The same counts, and the same single failure | `unit-c-utf8.log` |
| 10 | `QA_PG_PORT=26570 MTH_PORT_POOL=26571-26599 tests/qa/support/with-pg.sh pnpm test:integration` (21:51–22:20Z, load average about 9–11 from concurrent agents) | **1** | **Incomplete.** The log stops mid-line after 173 of 388 files, with no Vitest summary (see §3.2). Among the files that ran, three failed. Both P6 BE-X1 `it`s passed: in `contract.test.ts` (log line 117) and in `response-validation.test.ts` (line 976). | `integration-full.log` |
| 11 | The three failing files, alone: `QA_PG_PORT=26580 … with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/response-validation.test.ts apps/api/test/integration/assistant/conversations.test.ts apps/api/test/integration/access-scope.test.ts` | 1 | 147 passed, 1 failed (148). `response-validation` (113) and `access-scope` (18) pass. The one failure is the assistant test (§3.3). | `integration-rerun-failed-files.log` |
| 12 | `assistant/conversations.test.ts` alone, with my change | 1 | 16 passed, 1 failed | `integration-assistant-alone-with-change.log` |
| 13 | The same file alone **at HEAD** (all my edits reverted, then restored byte-identical: `git diff \| cmp` and `cmp` on the new file) | 1 | 16 passed, 1 failed, with the same assertion | `integration-assistant-alone-at-HEAD.log` |
| 14 | The 215 files that #10 never reached, in one invocation (`QA_PG_PORT=26595 …`; list in `integration-files-not-run-in-full.txt`) | **1** | 215 files: 214 passed, 1 failed. **1398 passed, 1 failed, 1 skipped, 1 todo (1401).** The failure is `admin/security.test.ts` (§3.4). | `integration-remainder.log` |

### The one unit failure (#8, #9) predates this task and is not caused by it

- **Test:** `apps/web/src/pages/admin/security/p6-admin-screens.test.tsx` › "Administration > Identity, Storage, Notifications … > identity shows whether a client secret is configured, never a secret value".
- **Failing assertion:** line 461 `expect(document.querySelector("input, textarea")).toBeNull()`. It receives the app shell's global-search `<input class="global-search__input" data-global-search="true" placeholder="Search records">`.
- **Cause, as I read it:** the slice-H global search added a text input to the shell, and the identity screen test (FE-B, `71e013b96`) asserts that the document has no input at all. Its intent is "no secret field on the identity page".
- **Not caused by this task:**
  - My diff touches no file under `apps/web`.
  - I reran the test alone with **all my changes reverted to HEAD**: it failed with 1 failed / 32 passed (`unit-web-p6-admin-screens-at-HEAD.log`).
  - I then restored my changes and checked them byte-identical against the saved diff. With my changes the result is the same (`unit-web-p6-admin-screens-isolated.log`).
  - It is deterministic, not a flake.
- **Not fixed here.** It is outside my scope ("change no other behaviour"), and the file belongs to the frontend owner. Proposed for the orchestrator as a separate finding for the FE owner: scope the assertion to the page's main region, or exclude the shell's search input.
- **Consequence:** acceptance item 2 ("`pnpm test` passes") is **not met on this branch** because of this pre-existing failure, in both locale settings. Every other unit test passes.

### 3.2 The full integration run (#10) did not complete

- The process ended about 29 minutes in, with exit 1.
- Its log is cut mid-line inside `access-scope.test.ts`'s skipped list, with no `Test Files`/`Tests` summary. Of the 388 integration files, 173 ran.
- No Vitest error, `ENOSPC` or timeout message explains the stop. At that point `/dev/vda` had 4.5 GB free and memory showed 7.7 GB available. I cannot read `dmesg` here, so an OOM kill by the host is **not confirmed**. The cause stays unexplained.
- Among the 173 files that ran:
  - `contract/response-validation.test.ts`: 2 failed. "P5 BE-J operations" got `expected [] to have a length of 1 but got +0`, and "an undeclared request media type…" timed out at 30 000 ms under load.
  - `access-scope.test.ts`: 18 skipped, because its `beforeAll` failed. The error text was lost with the truncated summary.
  - `assistant/conversations.test.ts`: 1 failed (§3.3).
- **`response-validation` and `access-scope` pass when run alone with my change (#11).** I classify their failures as load-related flakes in that run, not defects of this change. I disclose them, and did not investigate further.
- Because the run did not finish, I ran the 215 unreached files separately (#14). **No single complete `pnpm test:integration` pass exists on this branch, and I do not claim one.** Acceptance item 3 is not met as written. Counts: #10 (partial), #11 and #14.
- **Pinned-count change:** none. The integration test count rises by 2: one new `it` in `contract.test.ts`, which `response-validation.test.ts` also registers through its import.

### 3.4 `admin/security.test.ts` › "ADM_TECH and AUD read every class …" is a stale pin, not this change

- The test pins the `webhook` class with `operationIds: []`. The route now reports `["receiveWebhook"]`: BE-N routed the signed webhook receiver into that class, and BE-E's pin was not updated.
- I changed no route, no rate-limit configuration and no file in `admin/` or `platform/`.
- This is classified **by inspection only**. I did not rerun it at HEAD, to stay inside the time limit. It is for the orchestrator or the BE-E/BE-N owner.

### 3.3 `assistant/conversations.test.ts` › "over the per-minute budget a post is 429 …" predates this task

- At line 670 the test expects `replyKind: "no_sources", dataItems: 0`. It receives `replyKind: "answer", dataItems: 1`.
- It fails identically at HEAD with none of my changes (#13). So it is a pre-existing defect of the assistant slice (retrieval now returns a data item that the test's fixture assumes absent), and not mine.
- Not fixed here (out of scope). I propose it to the orchestrator for the assistant owner.

## 4. Operations routed (pending-list delta)

None. BE-X1 routes no operation, so there is no `p6-pending-be-x1.ts` and no pending list changes. The pinned counts in `contract.test.ts` (932 operations, media types, the rate-limit floor, the CSRF-exempt routes) are unchanged. The only contract-test delta is one new `it` ("P6 BE-X1 declared 403s of the evidence reads"), which adds one test to the integration count.

## 5. Contract, schema or dependency needs (for the orchestrator)

- **Contract change made:** an additive 403 on `downloadEvidenceContent` and on `getEvidence`, plus their summaries. The `info.version` stays `1.5.0-p6`, since this is a P6-internal correction of the P6 contract. Bump it if your convention requires that.
- **Zod mirrors:** no change needed. The 403 body is the shared `Problem`, and the download has no JSON mirror (`contract.test.ts` line 224 note).
- **Migration:** none. **Dependency:** none.
- **Pre-existing:** `apps/api/test/integration/admin/storage.test.ts:376` still uses `contract: false`, because `downloadEvidenceContent` does not declare the 503 its route answers when the store is unavailable. That is a separate, known gap (not D1), and I left it untouched. The orchestrator may want it declared in the same way.

## 6. User-facing texts

None became untrue. The problem text already exists in both languages: `apps/web/src/i18n/en/problems.json` `evidence__parent_forbidden` ("You do not have access to the record this evidence belongs to.") and `ar/problems.json` (provisional Arabic, FE-A). No en/ar string calls this behaviour planned.

## 7. What remains

- The pre-existing `p6-admin-screens.test.tsx` failure (§3), for the FE owner. It blocks acceptance item 2 on any branch at this HEAD.
- **Integration evidence is split.** #10 is a partial run (173 files, stopped for an unexplained reason). #14 covers the 215 files that #10 never reached. I did not get a single uninterrupted `pnpm test:integration` pass, and the orchestrator should rerun one on the merged tree.
  - Failures across #10, #11 and #14 that this change did not cause:
    - `assistant/conversations.test.ts`: 1 test, fails at HEAD;
    - `admin/security.test.ts`: 1 test, a stale `webhook` pin;
    - `response-validation.test.ts` and `access-scope.test.ts`: they failed only in the loaded, interrupted run, and pass alone.
- The `downloadEvidenceContent` 503 that `storage.test.ts` still bypasses (§5). It is outside D1.
- **Proposed findings for the orchestrator** (none fixed here):
  - (a) `p6-admin-screens.test.tsx` vs the shell's global search input (FE);
  - (b) the `assistant/conversations.test.ts` `no_sources` expectation (assistant owner);
  - (c) the `admin/security.test.ts` webhook-class pin (BE-E/BE-N).

## 8. Merge instructions

- Apply the uncommitted diff. No migration, no install and no renumbering.
- Expect conflicts only in `contract.test.ts`, on the three seam lines next to `BE-W`: keep both sides.
- End time: `2026-10-30T22:50:51Z` (`date -u`). Final `validate.mjs --historical --stage DG5`: exit 0 (`validate-dg5-historical-end.log`).
