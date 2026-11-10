# T-DG6-BE-RG1 handback: the assistant read-time re-check covers every record given to the model (F-DG6-920)

- **Agent:** backend-workflow-engineer
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-RG1-backend-workflow-engineer-20261110T123618Z-8517a079","session_id":"8517a079-0760-403b-95ca-b9b3105ed6e3"}`
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG6/T-DG6-BE-RG1.md` (sha256 `d7c67f72d21af9d728272d91292c94bbfaa535f2846ac0510841f71aeb1de15a`, verified)
- **Stage:** DG6 (P6), state FIXING after clean re-gate review round 1.
- **Tree:** worktree `/home/user/wt/dg6-be-rg1`, branch `dg6/be-rg1`, base `HEAD` `acc5c2f72`. All changes are **uncommitted**, as asked.
- **Time:** started `2026-11-10T12:36:31Z`, ended `2026-11-10T13:47Z` (about 71 minutes; inside the limit, nothing deferred for time).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0**. It was run before any change, after the checks (`T-DG6-BE-RG1-evidence/30-validate-dg5-historical.log`), and again at the end on Node 24.21.0 (`T-DG6-BE-RG1-evidence/node24/30-validate-dg5-historical.log`).

Nothing here is a business approval (G1–G6) or touches the DG0–DG7 records. All test data is synthetic.

## 1. The finding and the fix

**F-DG6-920 (Medium, REQ-S17-007).** The ADR-0059 §9 read-time re-check only looked at the stored citations, and the model chooses the citations. An answer that quoted a record the model was given but did not cite stayed readable after the owner lost access to that record.

**Fix:**

1. **Generation context stored.** Every answer, and each of its suggestions, now stores `context_records` beside its citations. This holds the `{recordType, recordId}` of **every record item given to the model**, cited or not. Playbook blocks are not records and are not listed, and no version, title or text is stored. The context is never served. Citations shown to the user are unchanged.
2. **Read-time re-check.** `getAssistantConversation`, the `postAssistantMessage` response and `takeAssistantSuggestionToDraft` re-check the union of record citations and context through the existing `readableRecordKeys` (ReadScope `transformation.read` plus the ADR-0051 §2 sensitivity clause). If any of those records is unreadable, the answer is withheld (`content: null, contentWithheld: true`). Suggestions are withheld the same way (`fields: null, textContent: null, contentWithheld: true`), and to-draft answers 404.
3. **Existing rows.** Rows stored before 0128 have a NULL context, and the check falls back to their citations. This limit is recorded in the ADR-0059 §9 amendment and in the data dictionary.

## 2. Changed files

| File | Purpose |
|---|---|
| `packages/db/migrations/0128_p6_assistant_context_records.sql` (**new**) | **Migration 0128.** It is the next id above 0127 on this branch, inside the P6 repair block 0128–0133 (D-196); the orchestrator renumbers at merge if needed. It adds `context_records jsonb NULL` to `assistant_message` and `assistant_suggestion`. It adds two IMMUTABLE functions: `p6_assistant_context_records_valid`, which allows at most 20 distinct `{recordType, recordId}` of the 12 search types, and `p6_assistant_context_covers`, which requires the context to list every record citation. It adds the CHECKs `*_context_records_valid` and `*_context_records_required`; the required ones are **NOT VALID**, following the 0027 precedent, so existing rows are not checked. On `assistant_message` the context is allowed on answers only. It also adds the trigger `assistant_suggestion_context_immutable`. No row changes and no grant changes. |
| `packages/db/src/schema.ts` | Adds `context_records: NullableJson` to `AssistantMessageTable` and `AssistantSuggestionTable`, plus both `SCHEMA_COLUMNS` entries. |
| `apps/api/src/modules/assistant/answer.ts` | Adds `ContextRecord` and `contextRecordsOf(items)` (distinct record keys of every item given, in order, no playbook blocks). The `answer` outcome now carries `contextRecords`. |
| `apps/api/src/modules/assistant/conversations.ts` | Adds `RecordRef` and `recordRefsOf(row)` (citations ∪ context; NULL context means citations only). `withheld`, `readabilityOf` and `readableRecordKeys` now work on record keys. The reply stores `context_records` for answers (NULL for every other kind), and each suggestion stores the answer's context. The header comment is updated. |
| `apps/api/src/modules/assistant/suggestions.ts` | The take-to-draft `check` re-checks citations ∪ context and answers 404 if any is unreadable. Removes the now-unused local `citationsOf`. |
| `apps/api/src/modules/assistant/assistant.test.ts` | Two unit tests: `contextRecordsOf` (cited or not, distinct, no playbook block), and `recordRefsOf` (union; NULL context falls back to citations). |
| `apps/api/test/integration/assistant/context-recheck.test.ts` (**new**) | The five integration cases (§4), through the real API with the shipped `http_endpoint` provider and the local fake model citing a subset. |
| `apps/api/test/support/fake-model.ts` | Adds the opt-in `citeRecords` option to the `envelope` behaviour. When set, the fake cites the refs of the record items in the request's data block that the predicate keeps, so a test can make it cite a chosen subset. Adds `FakeModel.dataRecordsOf(body)`. Existing behaviours are unchanged. |
| `apps/api/test/integration/assistant/conversations.test.ts` | Updates the `appendRaw` fixture: an answer and its suggestion inserted raw now store the context that 0128 requires (the record keys of their record citations, i.e. a model citing everything). Without this, two existing tests failed on `assistant_message_context_records_required` (disclosed in §5). |
| `apps/api/test/support/sensitive-reference-inventory.ts` | Classifies `assistant_message.context_records` and `assistant_suggestion.context_records` as `not-served` (json). The inventory test fails on any unclassified json column. |
| `packages/db/test/integration/catalogue.test.ts` | Adds a "0128: …" test covering the columns, the four CHECKs with their `convalidated` flags and exact texts, the trigger, and the shape and coverage functions (positive and negative). The 0111 trigger list now excludes the 0128 trigger, following the 0127 precedent. |
| `docs/architecture/adr/ADR-0059-…-guardrails.md` | §5 gets a new "Generation context" bullet (amended in place). §9 gets an amended paragraph on the re-check, the to-draft 404 and the **pre-0128 fallback and its limit**, and its logging rule 1 now lists the context as stored. A dated amendment section is added at the end. |
| `docs/architecture/data-dictionary.md` | "Changed by 0128" lines in the `assistant_message` and `assistant_suggestion` sections. New section "P6 re-gate repair migration 0128 (DG6)" with the catalogue texts from `03-catalog-0128.log`. |
| `docs/api/openapi.yaml` | **Descriptions only, no field added or removed:** the `getAssistantConversation` summary and `contentWithheld` on `AssistantMessage` and `AssistantSuggestion`. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-RG1-backend-workflow-engineer.md`, `…/T-DG6-BE-RG1-evidence/*` | This handback and its logs. |

I also removed the empty `.claude/.cc-writes` directories in `packages/db/`, `apps/api/` and `apps/api/src/modules/assistant/` before the tests, as the brief says. The empty parent `.claude` directories went too.

## 3. Behaviour delivered, per requirement row

**REQ-S17-007.**

- Procedure: "The assistant retrieves only records the user may read, cites them, and labels outputs as suggestions".
- Acceptance: "A12: with a user scoped to X, an assistant query about Y returns no Y content; every answer lists cited record IDs and versions".

What this task changes for the row:

- **No Y content after scope loss.** A stored answer generated from a record the owner can no longer read is no longer served, whether or not the model cited that record. This holds for every answer stored after 0128. "No Y content" now also holds after access to Y is lost later.
- **The A12 half is unchanged.** Retrieval, scoping and citations with record id and version are untouched, and still pass in `tests/qa/integration/a12-p6-scope-isolation.test.ts` (26/26) and `apps/api/test/integration/assistant/retrieval.test.ts` (8/8).
- **The response shape is unchanged.** Every answer still lists its cited record ids and versions. The context is never served, and case 3 asserts that no `contextRecords` or `context_records` key appears in the response.

## 4. Tests: before-fix and after-fix

All cases are integration tests against a disposable PostgreSQL 16.15 (`tests/qa/support/with-pg.sh`, ports 31400–31449). They use the real API and the **shipped `http_endpoint` provider** pointed at the suite's local fake chat-completions server; the fake is on loopback and is not a model or an IT endpoint. The fake cites a **subset** of the records it was given.

**How the before-fix logs were made.** The tree is 3.0 GB and the disk had 3.0 GB free, so no copy fitted. Since no other task runs at the same time (D-004), I did this in place:

1. Backed up my five product files to the scratchpad and recorded their SHA-256.
2. Reset `answer.ts`, `conversations.ts`, `suggestions.ts` and `schema.ts` to `HEAD`, removed `0128`, and rebuilt `@mth/db`.
3. Ran the before-fix logs. Only the new test file and the `citeRecords` hook of the fake were present.
4. Restored the files, verified all five hashes (`OK`), and rebuilt.

The code-security probe was copied in for both runs and deleted afterwards. It is not part of the tree.

| Case (assignment item 4) | Before-fix (`01-before-fix-probe-and-context-recheck.log`, exit 1) | After-fix (`02-after-fix-context-recheck.log`, exit 0) |
|---|---|---|
| Code-security probe `zz-sec-r1-assistant-uncited.test.ts` (unedited; it asserts the **bug**) | **passes**: `contentWithheld = false`, and the content still holds "Zephyrine synthetic program two" (bug reproduced, matching the reviewer's log 30) | **fails** as intended: `contentWithheld = true content = null`, `expected true to be false` (`05-after-fix-probe-now-fails.log`, exit 1) |
| 1. F-DG6-920 sequence: two records given, one cited; the **uncited** grant revoked (direct GET 404) → withheld; neither the revoked title nor its id appears in the response | **fails** (`contentWithheld = false`) | **passes** |
| 2. The **cited** record's grant revoked → withheld, citation `readable: false` | **passes**. This is a regression guard for the rule that shipped before the fix, so it passes before and after by design. | **passes** |
| 3. Nothing revoked → readable, content unchanged; the stored context lists both records; the context is not served | **fails**, only on the stored-context assertion (`context_records` undefined). The readability part passes before the fix too, because nothing is revoked. | **passes** |
| 4. A suggestion built from an answer whose **uncited** benefit becomes unreadable: the benefit is marked sensitive through `putRecordSensitivity` by TO, the TL is no named party, the benefit GET is 404 and the cited transformation still 200 → the answer and both suggestions are withheld; to-draft of the charter suggestion is **404**, the row stays `proposed`; an owner UPDATE of the suggestion context is refused (`assistant_suggestion_context_immutable`) | **fails** (answer withheld = false, suggestions withheld = [false,false]) | **passes** |
| 5. A row stored before 0128: the context is set to NULL with the required rule restored NOT VALID, i.e. the post-migration state of an old row. An uncited revoke leaves it readable (the documented limit); a cited revoke withholds it | **fails** (no 0128 constraint) | **passes** |

**Database rules:** the `packages/db/test/integration/catalogue.test.ts` "0128: …" test passes in the targeted runs (catalogue 41/41).

**Unit tests:** `apps/api/src/modules/assistant/assistant.test.ts` passes 4/4 (it is part of `pnpm test`).

## 5. Checks actually run

**Node version.** The first round of runs, the top-level logs in `T-DG6-BE-RG1-evidence/`, used **Node v22.22.0**: the shell's default `node` is `/opt/node22/bin/node`, as each log header records. The brief asks for Node 24.21.0, so I **re-ran every check with `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH`**, and the results were identical. Those logs are in **`T-DG6-BE-RG1-evidence/node24/`**, and their header lines read `node v24.21.0`. The Node 24 logs are the binding evidence; the Node 22 logs are kept as the first run. On Node 24 the probe and `context-recheck.test.ts` ran together in one invocation for the before-fix and the after-fix log (`node24/01-…`, `node24/02-…`).

| Check (Node 24.21.0) | Result | Log under `node24/` |
|---|---|---|
| `pnpm -r typecheck` / `pnpm -r build` / `pnpm lint` / `pnpm openapi:lint` | exit 0 each | `10-typecheck.log`, `11-build.log`, `12-lint.log`, `14-openapi-lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `13-prettier.log` |
| `pnpm test`, locale unset / `C.UTF-8` | exit 0 each. unit-node 191 / 2904 passed; unit-web 125 / 2111 passed; unit-formula-nocodegen 3 files, 259 passed + 2 skipped | `20-unit-lang-unset.log`, `21-unit-lang-cutf8.log` |
| Targeted integration (the 16 files below) **plus `contract.test.ts`**, locale unset / `C.UTF-8` | exit 0 each, **17 files / 324 tests passed** (219 + 105) | `04-integration-targeted-lang-unset.log`, `06-integration-targeted-lang-cutf8.log` |
| Before-fix: probe + `context-recheck.test.ts` on the pre-fix product code | exit 1 as expected. Probe passes (bug: `contentWithheld = false`); cases 1, 3, 4, 5 fail; case 2 passes | `01-before-fix-probe-and-context-recheck.log` |
| After-fix: the same two files | exit 1 as expected, from the probe alone. `context-recheck.test.ts` 5/5 passed; the probe fails because it asserts the bug (`contentWithheld = true content = null`) | `02-after-fix-probe-and-context-recheck.log` |
| `node tools/gates/validate.mjs --historical --stage DG5` | `PASS gate DG5 (historical)`, exit 0 | `30-validate-dg5-historical.log` |

The first round (Node v22.22.0; logs in `docs/delivery/handbacks/DG6/T-DG6-BE-RG1-evidence/`):

| Check | Command | Result | Log |
|---|---|---|---|
| Historical DG5 gate | `node tools/gates/validate.mjs --historical --stage DG5` | `PASS gate DG5 (historical)`, exit 0 (start and end) | `30-validate-dg5-historical.log` |
| Typecheck | `pnpm -r typecheck` | exit 0 | `10-typecheck.log` |
| Build | `pnpm -r build` | exit 0 | `11-build.log` |
| Lint | `pnpm lint` | exit 0 | `12-lint.log` |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `13-prettier.log` |
| OpenAPI lint | `pnpm openapi:lint` | exit 0 | `14-openapi-lint.log` |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | exit 0. unit-node **191 files / 2904 tests passed**. unit-web **125 / 2111 passed**. unit-formula-nocodegen **3 files, 259 passed, 2 skipped**. | `20-unit-lang-unset.log` |
| Unit, `C.UTF-8` | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0, the same counts: 191/2904, 125/2111, 3 files 259 passed + 2 skipped | `21-unit-lang-cutf8.log` |
| Targeted integration, locale unset | `with-pg.sh npx vitest run --project integration` on all 11 files of `apps/api/test/integration/assistant/` plus `packages/db/test/integration/{catalogue,migrate}.test.ts`, `apps/api/test/integration/access/{sensitive-reference-inventory,sensitive-reach-sweep}.test.ts` and `tests/qa/integration/{a12-p6-scope-isolation,a21-p6-adapters-disabled}.test.ts` | exit 0, **16 files / 219 tests passed** | `04-integration-targeted-lang-unset.log` |
| Targeted integration, `C.UTF-8` | the same 16 files | exit 0, **16 / 219 passed** | `06-integration-targeted-lang-cutf8.log` |
| Contract | `with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | exit 0, **105/105** | `07-contract.log` |
| Before-fix | probe + `context-recheck.test.ts` on the pre-fix product code | exit 1 as expected: 4 failed, 2 passed (see §4) | `01-before-fix-probe-and-context-recheck.log` |
| After-fix | `context-recheck.test.ts` | exit 0, 5/5 | `02-after-fix-context-recheck.log` |
| After-fix, the probe | the unedited probe | exit 1 as expected (it asserts the bug) | `05-after-fix-probe-now-fails.log` |
| 0128 catalogue | a temporary probe test printing `pg_get_constraintdef`, `pg_get_triggerdef` and the columns; 120 migrations applied | exit 0 | `03-catalog-0128.log` |

**Disclosures (every non-zero exit, failure and skip):**

- **Two skips.** The 2 skips in unit-formula-nocodegen are `it.skipIf(NOCODEGEN)` at `packages/shared/src/formula/fuzz.test.ts:600` and `:833`. They are declared by design in that project, and I did not touch `packages/shared`.
- **First targeted integration run: 2 failures.** It failed 2 of 183 tests in `conversations.test.ts`, at its `appendRaw` fixture (raw answer inserts without the context the new NOT VALID rule requires). I fixed the fixture and reran. The failing run is kept as `04a-integration-targeted-lang-unset-FIRST-RUN-2-failed.log`.
- **First after-fix run: case 5 failed with 403.** Revoking both TL grants also removed the test user's `assistant.use`. This was a test setup error: I gave the user a third, unrelated TL grant. That run's log was replaced by `02-after-fix-context-recheck.log`.
- **First catalogue dump attempt failed.** A standalone Node script failed with `role "mth_owner" does not exist`, because the roles are created by the Vitest global setup. That log was overwritten by the successful temporary-test run in `03-catalog-0128.log`. The temporary test file was deleted.
- **Not run here.** The full `pnpm test:integration`, as the brief says (the orchestrator runs it on the merged tree), and no e2e. No new e2e spec was added, so no e2e budget applies.

## 6. Operations routed (pending-list delta)

**None.** No route or operation was added or removed. The `apps/api/test/support/p6-pending-*.ts` and `p6-exercises-*.ts` lists are unchanged, and `contract.test.ts` passes 105/105.

## 7. Contract, schema and dependency needs (for the orchestrator)

- **Migration 0128** `0128_p6_assistant_context_records.sql`:
  - It is the next id above 0127 on this branch; renumber at merge if another task took 0128 (D-196).
  - It is forward-only and additive. No backfill is possible, because what the model was given was never stored.
  - If it is renumbered, update the "0128" mentions in: the migration header, `schema.ts` comments, the catalogue test name and comment, ADR-0059, the data dictionary section, the inventory comment, and the test file's header.
  - `packages/db/src/seed.test.ts` needs no change: 0128 is inside the repair block 0128–0133, and its free-id example `0126` stays valid.
- **OpenAPI:** descriptions only, no schema change. The zod mirrors are unchanged, and the web client needs no change.
- **No new dependency.**

## 8. User-facing texts made untrue

The withheld notices now cover a record that was given to the model but **not cited**. Two strings then say something untrue: they claim the answer or suggestion *cites* the record. They are in `apps/web/src/i18n/{en,ar}/assistant.json`, which the frontend owns (p6-work-split §2; FE-RG1 runs in this re-gate). **I did not edit them**, so that I touch only my section's files. They are listed here for the owner:

| Key (line) | Current en | Proposed en | Proposed ar (provisional) |
|---|---|---|---|
| answer `withheld` (en/ar line 48) | "This answer cites a record you can no longer read, so it is hidden." | "This answer was based on a record you can no longer read, so it is hidden." | "استندت هذه الإجابة إلى سجل لم تعد تستطيع قراءته، لذلك هي مخفية." |
| suggestion `withheld` (en/ar line 96) | "This suggestion cites a record you can no longer read, so it is hidden." | "This suggestion was based on a record you can no longer read, so it is hidden." | "استند هذا الاقتراح إلى سجل لم تعد تستطيع قراءته، لذلك هو مخفي." |

## 9. What remains

- **The pre-0128 limit (by design, item 3 of the brief).** Answers and suggestions stored before the 0128 deploy have no context, so they are re-checked by their citations only. For those rows, a record that was given to the model but not cited is still not re-checked. This is recorded in the ADR-0059 §9 amendment and the data dictionary. It affects only the conversation owner, who could read the record when the answer was produced.
- **The two en/ar strings in §8,** for the frontend owner.
- **The full integration suite and e2e** on the merged tree, run by the orchestrator.
- **F-DG6-920 stays OPEN** until a non-author reviewer verifies it (I do not close my own finding).

## 10. Merge instructions

1. Apply the uncommitted changes of `dg6/be-rg1`, then run `pnpm --filter @mth/db build`, because `schema.ts` changed.
2. Migration `0128` runs with the normal `mth-db migrate`. It changes no row, and old answers stay readable under the fallback.
3. Possible conflicts:
   - `apps/api/test/support/sensitive-reference-inventory.ts`: two added rows in the assistant json block.
   - `packages/db/test/integration/catalogue.test.ts`: the 0111 trigger list exclusion and the new test before the "0123" test.
   - `docs/architecture/data-dictionary.md`: the new section before "P6 read-time classifications after round 8".
