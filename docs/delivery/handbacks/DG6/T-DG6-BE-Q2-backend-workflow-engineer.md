# Handback T-DG6-BE-Q2 (backend-workflow-engineer): draft recovery list, version comparison, help topics

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING. Section: `docs/architecture/p6-work-split.md` §H/G.4.
- **Invocation:** `DG6-T-DG6-BE-Q2-backend-workflow-engineer-20261030T125132Z-d4fc83f7`, session `d4fc83f7-b8bb-41ea-90eb-4daf45581362`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Q2.md` (sha256 `9b7d09df5dd405190421099fce5b83be3cc61190b27bb3f9e9b751ed542ec410`, verified).
- **Start revision:** `4edfe8faa0c2a5f7861c8a22d7046d410c795d12` on `dg6/be-q2`, clean tree. Changes are left **uncommitted**.
- **Time:** start `Fri Oct 30 12:51:48 UTC 2026`; end: see the last line of this file.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` exited 0 (`PASS gate DG5 (historical)`) before any edit, and again at the end (§3).
- **Two gate systems:** nothing here reads or writes DG0–DG7. Comparing versions, listing drafts or reading help approves nothing; no G1–G6 business approval is involved. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/forms/compare.ts` | BE-A's stub filled: `compareFormRecordVersions` (ADR-0057 §7, D-199 item 6). Folds the record's audit events with `new_version` in (from, to] per column (first `from`, last `to`). Returns only fields of the pinned resolved form that are stored on the record's own table. `recorded: false` marks Unknown. Values go only to `audit.read` holders. Sensitive records get a 404. Exact 422 text. Pure `foldComparison` exported for the unit cases. |
| `apps/api/src/modules/forms/drafts.ts` | Only the `listMyFormDrafts` lines: the header line, the `MY_FORM_DRAFTS` path, `listMyDrafts` (ReadScope predicate for `transformation.read` on the draft's transformation, open drafts only, `updated_at desc, id desc` keyset) and its route registration. The P5 routes are unchanged. |
| `apps/api/src/modules/search/help-topics.ts` | BE-A's stub filled: `listHelpTopics` (optional `screenKey`, ordered by screen and ordinal, keyset cursor) and `getHelpTopic` (404 for an unknown key), both read from `help_topic` (0108). |
| `apps/api/src/modules/forms/form-draft-readers.test.ts` | New static unit test (ADR-0057 §6). No module other than `forms/drafts.ts` selects from or joins `form_draft`. It scans the API, worker, shared and db sources, and includes a non-vacuity case and detector self-tests. |
| `apps/api/test/integration/forms/compare.test.ts` | New. Folds versions 1 → 3 across two PATCHes. Checks values by role, the 422/400/401/404 refusals, the sensitive benefit, Unknown steps and the pure fold. 13 tests. |
| `apps/api/test/integration/forms/my-drafts.test.ts` | New. Drafts across two transformations, newest first. A revoked assignment hides the draft, which stays stored unchanged. Also paging, cursors, `baseChanged`, AUD and 401. 7 tests. |
| `apps/api/test/integration/forms/bulk-conflict-p6.test.ts` | New. The A14 API proof of the DG5 bulk response (ADR-0057 §8): three items, one stale → 409 naming only that item; all versions unchanged. 2 tests. |
| `apps/api/test/integration/search/help-topics.test.ts` | New. 11 topics in en and ar, Arabic provisional; `screenKey` filter; paging; 404; any signed-in user reads; 401. 5 tests. |
| `apps/api/test/support/p6-pending-be-q2.ts` | Emptied: all 4 operations are routed. |
| `apps/api/test/integration/contract/p6-exercises-be-q.ts` | BE-Q2 block appended after BE-Q's: mirrors for the 4 operations (`p6MirrorsBeQ2()`, spread into `P6_MIRRORS_BE_Q`), plus `exerciseP6BeQ2Operations`, which is called at the end of `exerciseP6BeQOperations`. `contract.test.ts` is unchanged. |
| `docs/api/openapi.yaml` | Two description texts only (compare summary; `FormRecordComparison.valuesWithheld`): they said editors get values, which D-199 item 6 made untrue. No schema, status or operation change. |

## 2. Behaviour delivered, per requirement row

### REQ-S15-010

Acceptance (verbatim): _"A12;A14: search as a user scoped to transformation X returns no Y records; a bulk update touching a stale record reports a conflict for that record only; a draft survives a browser reload"_.

My parts of this row:

- **"a bulk update touching a stale record reports a conflict for that record only"**: `bulk-conflict-p6.test.ts`.
  - Two users edit, and the second user's PATCH makes item 1 stale. The first user's bulk of three items gets 409 `form_record.bulk_conflict` with exactly one error, at `/items/1/version`: "Record <id> is at version 2."
  - The other two record ids do not appear anywhere in the body. All three rows (version, owner, objective) are unchanged, and the request wrote no audit event.
  - After a reload the same bulk commits all three, and the second user's change stays.
  - `forms/bulk.ts` is unchanged (D-199 item 1).
- **"unsaved drafts are recoverable"** (procedure): `listMyFormDrafts` gives the cross-transformation "Your drafts" list that FE-D2 builds on. The drafts are server-side P5 `form_draft` rows.
  - The e2e "a draft survives a browser reload" belongs to FE-D2 and is not delivered here.
- **"record comparison"** (procedure): `compareFormRecordVersions`; details under REQ-S16-026.
- **"contextual help"** (M0303): `listHelpTopics`, `getHelpTopic`.
- A12 (search) belongs to BE-P2 and is not in this task.

### REQ-S15-011

Acceptance (verbatim): _"A14;A20: component tests render each of the six states; a draft is labelled 'Draft - not submitted' and never counted in approved totals"_.

- My part is **"never counted in approved totals"**, as the `form_draft` readers test (`form-draft-readers.test.ts`, 4 tests).
  - The only reader of `form_draft` in `apps/api/src`, `apps/worker/src`, `packages/shared/src` and `packages/db/src` is `forms/drafts.ts`. No report, dashboard, export, job or seed query selects from or joins it.
  - The test proves its detector is not vacuous: it finds at least 4 reads in `drafts.ts`, and recognises Kysely and raw SQL forms.
- The six states and the badge belong to FE-D2.

### REQ-S16-026

Acceptance (verbatim): _"A14: two users edit the same initiative; the second save returns 409 and the UI offers compare and reapply without losing the first change"_.

My part is the version-comparison route (compare-and-reapply itself is client-side, FE-D2, ADR-0057 §7). In `compare.test.ts`:

- **Folding:** versions 1 → 3 of an initiative fold two PATCHes.
  - `initiative_name` goes from v1 to v2. `objective` goes from v1 to v3: the first `from` and the last `to`.
  - The composite `scope_in_out` carries `{scope_in, scope_out}`.
  - `risks` was changed in v2 and changed back in v3, so it is not listed.
  - Fields come in form order with the en/ar labels from the pinned form. A one-step comparison (2 → 3) folds only that step.
- **Values (D-199 item 6, the `audit.read`-only variant):**
  - AUD, TO and TL (all hold `audit.read`) see values.
  - WL (an editor of T05 without `audit.read`) and SP (a plain reader) get `valuesWithheld: true`, field names only, and no value text in the body.
- **Refusals:**
  - `toVersion` ≤ `fromVersion` (3 → 2 and 2 → 2), or above the current version (1 → 4): 422 `form_record.compare_versions_invalid`, "Choose two different versions of this record, the older one first."
  - Schema bounds, a missing or non-integer parameter, or an unknown parameter: 400. No session: 401.
  - Another organization, a user without grants, an unknown record, a planned type (`launch_plan`) or the wrong type for the id: 404.
- **Sensitive benefit (T14):**
  - Before marking, a TD member gets 200. After marking, the TD member and AUD alone get 404.
  - The owner (a named party) gets 200 with values withheld. TO (`sensitive_record.grant` and `audit.read`) gets 200 with values.
- **Unknown, never guessed:**
  - A step whose audit `changes` has no `{from, to}` for `objective` reports `objective` as `recorded: false` with no values, next to a normally recorded `name` diff.
  - A step with no diff object at all reports every shown field as `recorded: false`.
- **No writes:** the record's audit trail is identical before and after a comparison.

### `listMyFormDrafts` details (ADR-0057 §6)

From `my-drafts.test.ts`:

- **Listing:**
  - A user's open drafts across two transformations come newest first, with `transformationCode` and `transformationName` and without the payload.
  - Closed drafts and other users' drafts are not listed. An update moves a draft to the top.
- **Revoked assignment** (the work-split test): after the T1 assignment is revoked, the T1 draft is left out on the next request.
  - Its `form_draft` row and its audit trail are byte-identical to before.
  - Once read access returns, it is listed again as it was.
- **Paging:** `limit=1` walks both drafts once. A cursor of other filters, or an altered keyset, gives 400 at `/query/cursor`.
- **`baseChanged`** turns true after the record moves past the draft's base version.
- **Other callers:** AUD gets 200 with an empty list (it holds no write code, so it has no drafts). Another user sees only its own drafts. No session: 401. An unknown parameter: 400.

### Help topics details (ADR-0057 §9)

From `help-topics.test.ts`:

- **The list:** the 11 seeded topics, equal to the stored rows, ordered by screen and ordinal, on 5 screens.
  - Every topic has `arabicProvisional: true`, and its Arabic title and body end with "(ترجمة مؤقتة)".
  - No English body mentions PMI or certification.
- **Filtering and paging:** `screenKey` filters to one screen. An unknown screen returns an empty list. A malformed key: 400. `limit=2` walks all 11 once. A foreign cursor: 400.
- **One topic:** `getHelpTopic` returns `records.drafts`. An unknown key: 404. A malformed key: 400.
- **Callers:** AUD, a user without grants and another organization all read. No session: 401.

## 3. Checks actually run

Environment: Node 24.21.0, offline. Harness ports were in 25750–25799. The evidence logs are under `docs/delivery/handbacks/DG6/T-DG6-BE-Q2-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start, before any edit) | 0 | `PASS gate DG5 (historical)` | console only (run before the evidence folder existed) |
| 1 | `pnpm -r typecheck` | 0 | clean | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | clean | `build.log` |
| 3 | `pnpm lint` | 0 | 0 warnings | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `format.log` |
| 5 | `pnpm openapi:lint` | 0 | clean | `openapi-lint.log` |
| 6 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LANGUAGE -u LC_CTYPE`) | **1** | Every test passed in all 3 Vitest invocations: unit-node 177 files / 2726 tests; unit-web 99 / 1789; unit-formula-nocodegen 3 / 259 passed, 2 skipped. The exit 1 is 1 Vitest **unhandled error** in unit-node: `[vitest-worker]: Timeout calling "onTaskUpdate"` (see below) | `unit-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | Every test passed in all 3 invocations, with the same counts as row 6. The exit 1 is 2 Vitest **unhandled errors** in unit-node, the same worker RPC timeout | `unit-c-utf8.log` |
| 8 | `QA_PG_PORT=25750 MTH_PORT_POOL=25751-25779 tests/qa/support/with-pg.sh pnpm test:integration` | **not finished** | Still running at handback (see below). Snapshot at 14:36:49 UTC: 184 files finished, 2703 tests, **3 failed**, 1 skipped. All 3 failures are outside this task's files | `integration-snapshot-at-handback.log` (frozen); `integration.log` (live; lines after the snapshot were not reviewed by me) |
| 9 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `PASS gate DG5 (historical)` | `validate-dg5-historical.log` |

Disclosed non-zero exits:

- **The first run of checks 1–5 had a typecheck failure** (exit 2), kept in `run1-superseded/`. The errors were in my two new test files: index-signature access under `noPropertyAccessFromIndexSignature`, and an `exactOptionalPropertyTypes` mismatch on the test's `insertAuditEvent` input. I fixed both and re-ran all five checks; the table shows the re-run. In that first run build, lint, format and openapi:lint all exited 0.
- **One focused run failed before the final runs.** The first focused run of `my-drafts.test.ts` failed one assertion: I had asserted the cursor code at the top level, but the uniform 400 body carries it in `errors[]`. I fixed the test assertion. No product code changed.
- **Rows 6 and 7 (`pnpm test`): exit 1 with zero failed tests.**
  - Both runs overlapped the full integration run (row 8) on the same host. Under that load Vitest's worker-to-main RPC timed out: `Error: [vitest-worker]: Timeout calling "onTaskUpdate"`, at `vitest/dist/chunks/rpc.-pEldfrD.js:53`. It happened once with the locale unset and twice with C.UTF-8.
  - No test failed: every file and test passed, and the counts are identical in both locales. Vitest still counts an unhandled error as a failure, so the exit is 1.
  - This is a harness timeout under load (the F-DG4-143–148 class), not a product defect. **These rows are therefore not a clean exit 0.** A re-run on a quiet host is listed in §7.
- **Row 8 (integration): not finished, and 3 failures so far, none in this task's files.**
  - `assistant/conversations.test.ts`, "over the per-minute budget a post is 429 …": the log line has `dataItems: 1, replyKind: "answer"` where the test expects `0` and `"no_sources"`.
    - **It is not caused by this task.** It fails the same way when the file runs alone on this tree (`rerun-assistant-conversations.log`: 1 failed, 16 passed, exit 1).
    - It also fails the same way on a **clean clone of the start revision `4edfe8faa` without any BE-Q2 change** (`head-baseline-assistant-conversations.log`: 1 failed, 16 passed, exit 1).
    - The assistant module references none of the files I changed. It is a pre-existing failure of BE-U's test on the integrated tree, for the orchestrator (owner BE-U).
  - `contract/response-validation.test.ts`, "P5 BE-J operations (p5-exercises-be-j.ts)": this is the "P5 BE-J length" failure D-201 records on the merged W5 tree, which passed when re-run alone there. I did not re-run it alone (time box). Note that `contract.test.ts` itself, which runs the same exercises, passed 102/102 in this full run and alone.
  - `contract/response-validation.test.ts`, "every operation: an undeclared request media type …": a **30 s timeout** (30005 ms) under load. It is the timeout D-201 records for the same test on the merged W5 tree. I did not re-run it alone (time box).
  - **Not finished:** at about 105 minutes, 184 of about 351 integration files had run, and the remainder needed about 45–55 more minutes. Per the assignment's time rule I stopped waiting and wrote this handback.
    - The run was started as a background task. Its processes are not visible to my sandboxed shell, so I could not stop it, and it may finish after this handback.
    - I froze the snapshot I report. **The full integration result is therefore not established by this task** (BLOCKED by the time box, not passed).
  - My four new integration files had not been reached in the full run at snapshot time. They pass in focused runs (below).

Focused runs during the work (disposable PostgreSQL through `with-pg.sh`), all exit 0:

- the four BE-Q2 integration files: 27/27;
- `contract.test.ts` alone: 102/102 (it includes the BE-Q2 block);
- `form-draft-readers.test.ts`: 4/4.

## 4. Operations routed (delta to `p6-pending-be-q2.ts`)

`P6_PENDING_BE_Q2`: 4 → 0. Routed and exercised in `p6-exercises-be-q.ts` (BE-Q2 block):

| Operation | Route | Exercised statuses | Not reached in the contract suite (why) |
|---|---|---|---|
| `listMyFormDrafts` | `GET /api/v1/me/form-drafts` | 200, 400 (unknown parameter; foreign cursor), 401 | 403 (service principal only), 429 (the live rate-limit sweep) |
| `compareFormRecordVersions` | `GET /api/v1/transformations/{t}/form-records/{recordType}/{recordId}/compare` | 200, 400, 401, 404, 422 | 403 (a caller without `transformation.read` gets the ADR-0006 404; only a service principal is refused 403), 429 |
| `listHelpTopics` | `GET /api/v1/help-topics` | 200, 400, 401 | 403, 429 (as above) |
| `getHelpTopic` | `GET /api/v1/help-topics/{topicKey}` | 200, 400, 401, 404 | 403, 429 (as above) |

Pinned counts:

- **Unchanged:** the operation count (the 4 were already declared), media types and CSRF-exempt routes. None of the 4 has a request body (bodiless GETs declare no `config.consumes`).
- **The JSON-body pin:** no change from me.
- **The rate-limit floor:** the 4 routes use the default class.

## 5. For the orchestrator: contract, schema, dependency

1. **No migration**, no schema change, no new dependency, no new problem code (`form_record.compare_versions_invalid` is ADR-0057 §10's, text verbatim).
2. **D-199 item 6 against the work split.** §H/G.4's test line "an editor sees values" predates D-199 item 6, which decides the `audit.read`-only variant. I implemented and tested D-199 (an editor gets `valuesWithheld: true`).
   - I corrected the two `openapi.yaml` description texts that said otherwise (descriptions only; overlap file, reconcile at merge).
   - **Still untrue, outside my files:**
     - ADR-0057 §7 ("only for a caller who holds the record type's `write_permission_code` or `audit.read`");
     - ADR-0057 §10's permission table row "values need the type's write code or `audit.read`";
     - `docs/analysis/permissions-matrix.md` §27 line 1092 ("each form record type's `write_permission_code` or `audit.read` (comparison **values**, ADR-0057 §7)").
   - These are the architect's files; please route the one-line corrections.
3. **No shared zod mirror** exists for `MyFormDraft`, `FormRecordComparison` or `HelpTopic` in `packages/shared/src/schemas` (outside my files). The contract-exercise mirrors restate the contract, and the route files declare matching TypeScript interfaces. If FE-D2 wants a shared mirror, it needs an owner.
4. **Comparison scope.** Comparison covers the protected source columns stored on the record's own table.
   - Extension-field values (`form_custom_value`) have their own version and audit trail, and do not step the record's version.
   - Child-record composites (deliverables, milestones, links) are separate records.
   - Neither appears in a record comparison. This is stated in the `compare.ts` header and is not claimed otherwise.
5. **DG5 observation (not changed; not in my scope):** `listFormRecordVersions` (`forms/history.ts`) applies no ADR-0051 sensitivity check. A user without admission to a sensitive benefit still gets that benefit's changed field names (never values) through `/versions`. `compareFormRecordVersions` does apply it (404). The owner of `forms/history.ts`, or BE-C2's route sweep, may want to align it.

## 6. User-facing texts made untrue

- **en/ar web catalogues:** none. I searched `apps/web/src/i18n/{en,ar}` for strings calling draft recovery, comparison or help planned or later, and none exist. The generic "not available in this release" texts concern planned form types and are still true.
- **Contract descriptions:** the compare summary and `valuesWithheld` were corrected (§5 item 2).
- **ADR texts:** ADR-0057 §7/§10 are listed for the architect (§5 item 2).

## 7. What remains

The implementation of §H/G.4 is complete. What remains is verification I could not finish inside the time box:

1. **The full `pnpm test:integration` run to its end.** At handback it had reached 184 of about 351 files, with 3 failures outside this task (§3). The orchestrator's merged-tree run needs to establish the result, including:
   - `forms/compare.test.ts`, `forms/my-drafts.test.ts`, `forms/bulk-conflict-p6.test.ts`, `search/help-topics.test.ts` (27/27 in focused runs);
   - `form-draft-readers.test.ts` (unit; passed in rows 6–7).
2. **`pnpm test` on a quiet host in both locales** for a clean exit 0. Every test already passed. Only the Vitest worker RPC timeout under concurrent load made the exit 1.
3. **Single-file re-runs of the two `response-validation.test.ts` failures** (the D-201 pair).
4. **For BE-U's owner:** `assistant/conversations.test.ts` fails at the start revision too (§3), so it is not caused by this task.
5. **Owned by other tasks, not delivered here:**
   - the "Draft - not submitted" badge, the six states, the "Your drafts" UI, compare-and-reapply, and the draft-reload and A14 e2e (FE-D2);
   - the QA-C A14 run;
   - the ADR-0057 §7/§10 and permissions-matrix §27 one-line corrections (§5 item 2).

## 8. Merge instructions

- No migration and no ordering constraint beyond §H/G.12 (after BE-Q).
- **Expected overlaps:**
  - `docs/api/openapi.yaml`: two description lines.
  - `apps/api/test/integration/contract/p6-exercises-be-q.ts`: the BE-Q2 block, appended after BE-Q's, plus one spread line in `P6_MIRRORS_BE_Q` and one call line at the end of `exerciseP6BeQOperations`.
  - `apps/api/src/modules/forms/drafts.ts`: route lines added; no P5 line changed apart from two import names and the header.

End: `Fri Oct 30 14:37:51 UTC 2026`.

## Addendum (after the handback, Fri Oct 30 15:05:31 UTC 2026)

The full integration run (row 8) kept running in the background after the snapshot. At this time it has reached 347 of about 351 files and has still not printed a summary or exit code. Its progress since the snapshot:

- `forms/compare.test.ts` 13/13 and `forms/my-drafts.test.ts` 7/7 **passed** inside the full run. `bulk-conflict-p6.test.ts` and `help-topics.test.ts` had not been reached yet (both pass in the focused runs).
- **One more failure, not in this task's files:** `admin/security.test.ts`, "getSecurityRateLimits > ADM_TECH and AUD read every class …".
  - The response lists `"operationIds": ["receiveWebhook"]` for a class where the test expects `[]`.
  - It fails the same way on this tree alone (`rerun-admin-security.log`: 1 failed, 7 passed, exit 1).
  - It also fails on the **clean clone of the start revision `4edfe8faa`** (`head-baseline-admin-security.log`: 1 failed, 7 passed, exit 1, same `receiveWebhook` diff).
  - So it predates this task: a merge seam between the webhook route (BE-N) and the security view's expectation (BE-E), for the orchestrator. This task adds no webhook route and no rate-limit class.
- Failures in the run so far: 4. All are outside this task, and the two I re-ran (assistant, security) fail identically at the start revision. The full integration result is still not established by this task.

## Addendum 2: the full integration run finished (Fri Oct 30 15:12:22 UTC 2026)

`integration.log` now ends with: **exit=1**. Test Files: 3 failed, 379 passed (382). Tests: 4 failed, 3925 passed, 1 skipped, 2 todo (3932). Duration 5491 s.

(The background task wrapper reported exit 0; that is the wrapper's own shell, not the suite. The suite's exit is the `exit=1` line.)

- **My files all passed in the full run:**
  - `forms/compare.test.ts` 13/13
  - `forms/my-drafts.test.ts` 7/7
  - `forms/bulk-conflict-p6.test.ts` 2/2
  - `search/help-topics.test.ts` 5/5
  - `contract/contract.test.ts` 102/102, which includes the BE-Q2 exercises
- **The 4 failures are exactly the ones listed above, all outside this task:**
  - `assistant/conversations.test.ts` (1): fails at the start revision too.
  - `admin/security.test.ts` (1): fails at the start revision too.
  - `contract/response-validation.test.ts` (2): the D-201 BE-J pair, and the 30 s timeout. Not re-run alone.
- **Acceptance item 3 is therefore not met on this tree.** The cause is failures that exist at the start revision (two proven by baseline runs) plus the D-201 pair. No pinned count changed.
