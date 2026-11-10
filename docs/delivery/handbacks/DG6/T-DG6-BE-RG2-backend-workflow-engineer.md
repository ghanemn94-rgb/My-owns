# Handback: T-DG6-BE-RG2, the assistant history channel and the pre-0128 suggestion rule (F-DG6-960, F-DG6-970, F-DG6-980, F-DG6-971)

- **Agent:** backend-workflow-engineer. Invocation `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-RG2-backend-workflow-engineer-20261110T212357Z-18a41edf","session_id":"18a41edf-eccb-41e1-8820-ab983da1dfa4"}`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-RG2.md`, sha256 `3a336bbf95034e9515c22cac8ef1fa43c6f688c31d368baf5d5a76f2effa1d6c` (verified at start).
- **Stage:** DG6 (FIXING after clean re-gate review round 2).
- **Base:** branch `dg6/be-rg2` at `91aa4b046` (`git rev-parse HEAD` in `T-DG6-BE-RG2-evidence/00-start.log`); clean tree at start.
- **Time:** started at `2026-11-10T21:24:09Z` and ended at `2026-11-10T22:06:30Z` (`date -u`), well inside the limit. Everything is done; nothing is left over.
- **Changes are uncommitted**, as the assignment asks.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited 0, both at the start and at the end.

This is engineering work only. Nothing here grants a business, Finance or IT approval (G1–G6), and nothing implies a DG0–DG7 result. All test data is synthetic.

## 1. Changed files

| File | Purpose |
| --- | --- |
| `apps/api/src/modules/assistant/conversations.ts` | `historyOf` is replaced by `historyFor`. Each earlier answer goes through the §9 readability check (citations ∪ context; before 0128, citations) for the caller as reloaded in transaction 1. A withheld answer is **dropped**, and the 6-message window is taken after the drop. It also returns the inherited context: the `recordRefsOf` of every answer that is kept, under a fail-closed bound. The header comment is updated. |
| `apps/api/src/modules/assistant/answer.ts` | Adds `AnswerInput.historyContext`, `CONTEXT_RECORDS_MAX = 1000` and `mergeContextRecords`. The stored `contextRecords` of an answer is now its own data block followed by the inherited history context. |
| `packages/db/migrations/0129_p6_assistant_context_insert_rule.sql` | **New migration 0129** (the next id above 0128, D-196). It drops both `*_context_records_required` NOT VALID CHECKs and replaces them with BEFORE INSERT triggers of the same names (same SQLSTATE 23514, same constraint name). `p6_assistant_context_records_valid` now allows up to 1,000 keys (was 20). Column comments are updated. |
| `apps/api/test/integration/assistant/history-recheck.test.ts` | **New** integration suite: 5 cases on the real API, using the shipped `http_endpoint` provider and the local fake model (see §3). |
| `apps/api/test/support/fake-model.ts` | Adds `answerFrom(messages)` to the envelope behaviour, so the fake can repeat its last answer from the history, and the static `FakeModel.messagesOf(body)`. |
| `apps/api/test/integration/assistant/context-recheck.test.ts` | RG1 case 5 setup only. Its DDL dropped and re-added the 0128 CHECK, which 0129 removes. Pausing the append-only trigger is now enough. No assertion changed. |
| `apps/api/src/modules/assistant/assistant.test.ts` | Unit tests for `mergeContextRecords` (order, distinctness) and for `CONTEXT_RECORDS_MAX = MAX_MESSAGES / 2 × 20`. |
| `packages/db/test/integration/catalogue.test.ts` | New "0129" test: no `*_required` CHECK remains, the two triggers are BEFORE INSERT ROW only (`tgtype = 7`), the message predicate is right, and the bound is 1,000 (1,001 fails). The "0128" test is renamed "(as amended by 0129)" and keeps only the shape CHECKs. The 0111 trigger inventory excludes the two 0129 triggers, which the 0129 test checks. |
| `docs/architecture/adr/ADR-0059-…guardrails.md` | §5 History and the Generation context bullet are amended in place, and a §5 "Inherited context" bullet is added. A §9 RG2 paragraph covers the history channel and the pre-0128 suggestion. A new "Amendment (2026-11-10, T-DG6-BE-RG2 …)" section is added at the end. |
| `docs/architecture/data-dictionary.md` | Adds the "P6 re-gate repair migration 0129 (DG6)" section, built from real catalogue output (`30-catalog-0129.log`), and "Changed by `0129`" lines for `assistant_message` and `assistant_suggestion`. |
| `docs/api/openapi.yaml` | Descriptions only, with no schema change: `getAssistantConversation`, `postAssistantMessage` and `takeAssistantSuggestionToDraft` summaries, and both `contentWithheld` descriptions. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-RG2-*` | This handback and its evidence logs. |

## 2. Behaviour delivered

**REQ-S17-007.** Acceptance: *"The assistant retrieves only records the user may read, cites them, and labels outputs as suggestions"*. A12: *"with a user scoped to X, an assistant query about Y returns no Y content; every answer lists cited record IDs and versions"*.

### 2.1 History channel (F-DG6-960, F-DG6-970, F-DG6-980)

Two defences, as assigned.

**Defence 1: the history is re-checked before the model call.** `historyFor` applies the same predicate as `toMessageView` (`withheld(row, readable)` over `recordRefsOf`, so citations ∪ context, falling back to citations before 0128). It checks every earlier answer for the caller (`first.fresh`, the principal reloaded in transaction 1), and does so before `answer()` calls the provider.

**I chose to drop the withheld answer, not replace it with a placeholder:**
- A placeholder would be assistant-role text the model never wrote.
- A placeholder would still tell the model, and through it the user, that an answer on that subject existed. Dropping sends nothing at all about it.
- Two consecutive user messages are valid in the chat-completions format.
- The owner's own prompt stays: it is never withheld, and `getAssistantConversation` serves it as typed.
- The window is taken **after** the drop, so up to 6 readable messages are still sent.

**Defence 2: the new answer inherits the history's context.**
- The stored `context_records` = this turn's data block, followed by `recordRefsOf` of every history answer given (their context, or before 0128 their record citations).
- Each stored context already holds what it inherited, so the inheritance is transitive. A later revocation withholds the new answer and its suggestions, and `takeAssistantSuggestionToDraft` answers 404.
- Suggestions store `outcome.contextRecords`, so they inherit too (asserted equal to the answer's context).

**The 20-item cap, and the decision.** I raised the cap in a new migration rather than store a bounded union.
- The union is provably at most 1,000: at most 100 messages, so at most 50 answers, each given at most 20 record items (`max_context_records ≤ 20`, 0111 CHECK and zod), all in the same conversation.
- 0129 sets the shape bound to exactly that 1,000, so **a context is never truncated** and the re-check always sees every record.
- A fail-closed guard covers any future change to those limits. `historyFor` drops from the history, oldest first, any answer whose context would not fit within `1000 − max_context_records`. The model is therefore never given an answer whose context could not be stored in full. A unit test pins `CONTEXT_RECORDS_MAX = MAX_MESSAGES / 2 × 20`.
- I rejected "store a bounded union and withhold when truncated". It would hide readable answers in long conversations, and since the exact bound is small it would buy no security.

**Other paths that feed earlier turns to the model:** none. `answer.ts` is the only caller of `ModelProvider.complete` (grep shows `answer.ts:142` only), and `postAssistantMessage` is the only caller of `answer`.

### 2.2 Pre-0128 suggestions (F-DG6-971)

- 0129 replaces the NOT VALID CHECK `assistant_suggestion_context_records_required` with a BEFORE INSERT trigger of the same name. A pre-0128 suggestion (NULL context) with readable citations is now taken to a draft: 200, version 2, `taken_to_draft`, context still NULL.
- A new suggestion without a context is still refused at INSERT with `23514 assistant_suggestion_context_records_required`.
- `assistant_message` gets the same mechanism, with the same name and the same answer-only predicate, for consistency. Messages are append-only, so the old CHECK never refused an UPDATE there.
- `assistant_suggestion_context_immutable` (0128) is unchanged, so a context can never be set or removed after insert (asserted).

## 3. Tests on the real API (shipped `http_endpoint` provider, fake model)

File: `apps/api/test/integration/assistant/history-recheck.test.ts`. The before-fix log is from the same file run on the unfixed base.

| Case | Before fix (`10-before-fix-history-recheck.log`, exit 1, 5/5 failed) | After fix (`21-after-fix-final-…log`, exit 0) |
| --- | --- | --- |
| 1. Reviewers' sequence: A1 is generated from tA1 and tA2 and holds HIDDEN. tA2 is revoked and A1 is withheld. Follow-up "repeat your last answer" (the fake echoes the last history answer). | The request carries the A1 text (`true`, history roles `["user","assistant"]`). | Request: no A1 text and no TITLE_2 (`false`, history `["user"]`). The served reply and the GET body do not contain HIDDEN. |
| 2. Inheritance: A1 is given tA1 and tA2 and cites tA1. A2 is given only tA3, with A1 in its history. Then tA2 is revoked. A third turn follows. | A2's context is `[tA3]` only. | A2's context is `[tA3, tA1, tA2]`. After the revocation, A1 **and** A2 are withheld (the tA3 citation stays `readable: true`). Turn 3's request holds no TITLE_2. |
| 3. A pre-0128 history answer (context NULL) whose cited record is revoked | It is re-sent (`true`). | It is not sent (`false`). |
| 4. F-DG6-971: a pre-0128 suggestion is taken to a draft | 422 `validation.constraint` | 200, version 2, draft payload mapped. A second call gives 422 `assistant.suggestion_already_taken`. |
| 5. A NEW suggestion or answer without a context is refused at INSERT | Suggestion `23514 …suggestion_context_records_required`; answer `23514 assistant_message_sequence`. 0111's guard fired first, because a CHECK runs after the BEFORE triggers. | Both give `23514 *_context_records_required`. Suggestion context = its answer's context. Removing a context gives `assistant_suggestion_context_immutable`. |

- **RG1 `context-recheck.test.ts`:** 5/5 pass after the fix, in the same runs (logs 20, 21, 62, 63).
- **Reviewers' probes re-run on the fixed tree** (`70-reviewer-probes-after-fix.log`, exit 1; I used temporary copies and removed them afterwards). The exit 1 is expected and is explained here:
  - **QA probe `qa-rg-r2-assistant-history.test.ts`: PASS.** Its soft assertions now hold: re-sent `false`, and A2 holds the withheld fact `false`.
  - **Code-security `zz-sec-r2-assistant-history.test.ts`: FAIL, by design.** It asserts the defect. Its log shows "history holds the revoked title: false", which is the fix working. Its final GET still contains TITLE_2. That is because the probe's echo model, when it finds no assistant message in the history, answers a **hard-coded** text naming both titles (`Synthetic answer: … one and … two …`). The text comes from the probe's fake, not from the history or the data block: the request carried neither, and its stored context is `[]` because that prompt retrieved no record, only playbook passages.
  - **Code-security `zz-sec-r2-legacy-suggestion-to-draft.test.ts`: control 200 (PASS); the legacy case fails in its own setup.** The setup DDL runs `DROP CONSTRAINT assistant_suggestion_context_records_required`, and 0129 removed that CHECK. My case 4 makes the same pre-0128 state with a state-agnostic helper (`makePre0128`), which drops and re-adds the CHECK only where it exists. That case passes after the fix.
  - **Domain probe `zz-domain-r2-history-tail.ts`:** not re-run. It is a tail appended to lines 17–147 of `context-recheck.test.ts`, whose case-5 setup I changed. Its sequence (owner TL on tA1 and tA2, revoke tA2, "Repeat your previous answer …") is covered by case 1 and by the QA and code-security probes above.

## 4. Checks run (Node 24.21.0, offline, ports 31400–31449)

| Command | Exit | Result | Log |
| --- | --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)`, at the start and at the end | `80-validate-dg5-historical.log` (end) |
| `pnpm -r typecheck` | 0 | | `40-typecheck.log` |
| `pnpm -r build` | 0 | | `41-build.log` |
| `pnpm lint` | 0 | `eslint . --max-warnings=0` | `42-lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | | `43-prettier.log` (rerun at the end: `81-prettier-final.log`) |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `44-openapi-lint.log` |
| `pnpm test`, locale unset | 0 | unit-node 191 files / 2906 tests passed; unit-web 125 / 2113; unit-formula-nocodegen 3 / 259 passed, 2 skipped | `50-unit-lang-unset.log` |
| `pnpm test`, `LANG=LC_ALL=C.UTF-8` | 0 | the same counts | `51-unit-lang-cutf8.log` |
| `with-pg.sh npx vitest run --project integration apps/api/test/integration/assistant/ packages/db/test/integration/{catalogue,migrate}.test.ts apps/api/test/integration/contract/contract.test.ts`, locale unset | **1** | 1 failed, 289 passed. The failure was the new 0129 catalogue test. | `60-…lang-unset.log` |
| the same, `C.UTF-8`, after the test-data fix | 0 | 14 files, 290/290 | `62-integration-targeted-lang-cutf8.log` |
| the same, locale unset, rerun after the fix | 0 | 14 files, 290/290 | `63-integration-targeted-lang-unset-rerun.log` |
| `catalogue.test.ts` alone, after the fix | 0 | 42/42 | `61-catalogue-after-test-fix-lang-unset.log` |
| `history-recheck` + `context-recheck`, before and after | 1 / 0 | before: 5/5 failed (`history-recheck` only); after: 10/10 | `10-…`, `20-…`, `21-…` |
| Catalogue dump of 0129 (temporary probe file, removed) | 0 | used by the data dictionary | `30-catalog-0129.log` |

**Disclosures:**
- **The non-zero run (`60`).** The failure was my own new 0129 catalogue test. Its 1,000-key sample used `recordType: "risk"`, which is not one of the 12 search record types (`raid_entry` is), so the shape function rightly returned false. I changed it to `benefit`, the type the 0128 test uses. Logs 61, 62 and 63 pass, and nothing else in run 60 failed.
- **A malformed command.** My first attempt at the OpenAPI lint was mis-split by my shell loop and ran `pnpm openapi` (exit 254), which is not the check. The real `pnpm openapi:lint` was run right after and exited 0. The log was overwritten with the real run.
- **The 2 skipped tests** are in `packages/shared/src/formula/fuzz.test.ts`, which this task did not touch. They are skipped in both locales.
- **Integration counts by file** (runs 62 and 63): contract 105, guardrails 33, conversations 21, settings 17, provider 14, suggestions 12, composition 11, retrieval 8, migrate 9, history-recheck 5, context-recheck 5, injection 5, no-write 3, catalogue 42.
- **The full `pnpm test:integration` was not run**, as the assignment allows. The orchestrator runs it on the merged tree.

## 5. Operations routed (pending-list delta)

None. No route was added or removed, and no `p6-pending-*.ts` or `p6-exercises-*.ts` changed. `contract.test.ts` passes (105/105).

## 6. Contract, schema and dependency needs (for the orchestrator)

- **Migration `0129_p6_assistant_context_insert_rule.sql`**, the next id above 0128 and within the P6 repair range ≤ 0133 (`seed.test.ts` numbering rule). Renumber it at merge if another task shipped 0129 first. It must run after 0128.
- **OpenAPI:** descriptions only. No field is added or removed, so the zod mirrors are unchanged.
- **No new dependency.**
- **`schema.ts` is unchanged:** no column changed.

## 7. User-facing texts

- `assistant.reply.withheld` and `assistant.suggestion.withheld` (en/ar) say "based on a record you can no longer read". That is still true, since inherited records are records the answer was based on. No change.
- For the web owner, not user-facing: the code comment at `apps/web/src/components/assistant/AssistantOutput.tsx:8` still says "a cited record". Since RG1 it is any record the answer was generated from, and since RG2 that includes history. I did not change it, because the file is outside my scope.

## 8. What remains

Nothing from this assignment.

Points for reviewers:
- **Answers stored between 0128 and 0129 do not inherit.** Their context holds only their own data block. Defence 1 (the history re-check) still keeps a withheld earlier answer from reaching the model again; this is stated in the data dictionary (Effect on deploy).
- **The pre-0128 citation-only limit of RG1 is unchanged.** It is restated in ADR-0059 §9.
