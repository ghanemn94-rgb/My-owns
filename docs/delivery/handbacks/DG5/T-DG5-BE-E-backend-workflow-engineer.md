# Handback T-DG5-BE-E (backend-workflow-engineer): slice B form framework, part 1 (version history, comments, attachments)

- **Stage:** P5 / DG5 (BUILDING). **Section:** `docs/architecture/p5-work-split.md` §B.3.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-E-backend-workflow-engineer-20261014T085045Z-9f3c556d","session_id":"9f3c556d-e088-4bab-b1e2-4a125d95e635"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-E.md` (sha256 `40cf3d83…6cdf26f5`, verified).
- **Base:** branch `dg5/be-e`, `HEAD` `f591b7c` (the integrated W4 head, D-146). The changes are left **uncommitted**.
- **Time:** start `2026-10-14T08:50:58Z`; end `2026-10-14T09:59:00Z` (about 1 h 10 min).
- **Two gate systems.** Nothing here reads or writes DG0–DG7. Comments and attachments approve nothing, and no G1–G6 business approval is granted or recorded. All test data is synthetic.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, **exit 0** (`T-DG5-BE-E-evidence/validate-historical-DG4.txt`). I ran it before writing any code.

## 2. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/forms/history.ts` (new) | `listFormRecordVersions` reads the audit trail for (register table, record id), oldest first, keyset on `seq`. It returns field names only, never values. Also holds the shared read gate `requireRecordRead`, the shared record params, and `cursorKey`, which validates the cursor key. |
| `apps/api/src/modules/forms/comments.ts` (new) | `listFormRecordComments` and `createFormRecordComment`. Comments are append-only and allow one level of replies on the same record (422 `form_comment.parent_invalid`). Bodies use the shared free-text rules. Writes need `form_record.comment`, re-checked at commit time, and write one audit event. |
| `apps/api/src/modules/forms/attachments.ts` (new) | `listFormRecordAttachments`, `attachFormRecordEvidence` and `removeFormRecordAttachment`. Each record type has one store: the DG2 `evidence_link` for its twenty tables, otherwise `form_record_attachment`. Removal needs a reason and `If-Match`. Writes need the record type's write permission, re-checked at commit time (plus `evidence.create` on the `evidence_link` store). One audit event per write. |
| `apps/api/src/modules/forms/routes.ts` | The three BE-E registration lines. The BE-E2 placeholder comment is kept. |
| `packages/shared/src/schemas/forms-framework.ts` (new) | Zod mirrors: `FormRecordVersion(Page)`, `FormRecordComment(Page)`, `FormRecordCommentCreate` (`freeText(1, 4000)`), `FormRecordAttachment(Page)`, `FormRecordAttachmentCreate`, `FormRecordAttachmentRemove` (shared `reason`), and the `includeRemoved` filter. |
| `packages/shared/src/schemas/index.ts` | **One barrel line** for `forms-framework.ts`. See §7.1: §B.3 lists the file but does not name the barrel line. |
| `apps/api/test/support/p5-pending-be-e.ts` | Pending list emptied (all six operations routed). |
| `apps/api/test/integration/contract/p5-exercises-be-e.ts` | Contract exercises for the six operations: a success and every reachable declared refusal, through the validating client, plus the six zod mirrors. |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin `[334, 333, 1]` → `[337, 336, 1]`, with a comment. This follows the BE-B, BE-D and BE-H precedent (§4). |
| `apps/api/test/integration/forms/form-framework.test.ts` (new) | Integration tests against real PostgreSQL for REQ-S05-001 on T01 and T14 (§3). |
| `docs/delivery/handbacks/DG5/T-DG5-BE-E-evidence/*` | Command logs cited below. |

No migration, no new dependency, no edit to `evidence/**` or to any DG2–DG4 route, and no OpenAPI change. Migration number `0073` remains BE-E2's.

## 3. Behaviour delivered, per requirement

### REQ-S05-001 (BE-E part: history, comments, attachments; plus permissions for these operations)

Acceptance text (verbatim): *"A01;A14: for T01 and T14, a saved draft reopens, a new version is listed in history, a comment and attachment persist, export returns the rows, and a conflicting concurrent save returns a recoverable conflict"*.

My part covers *"a new version is listed in history, a comment and attachment persist"* for T01 and T14, plus the §B.3 literal tests. BE-E2 owns *"a saved draft reopens"*, *"export returns the rows"* and *"a conflicting concurrent save returns a recoverable conflict"*, and FE-C owns the screens. The row is **not complete** with BE-E alone.

| §B.3 literal test | Where | Result |
|---|---|---|
| After an edit, history lists the new version with the changed fields (T01 and T14) | `form-framework.test.ts`: "T01: after an edit…", "T14: after an edit…; pages oldest first" | PASS. T01 is a `PATCH` of the diagnostic item, T14 a `PATCH` of the benefit. The last history entry has the new `version`, the actor, and the changed field (`root_cause` / `title`). Values are never returned. |
| A comment and a reply persist and read back (T01 and T14) | "T01/T14: a comment and a reply persist and read back…" | PASS. Includes an Arabic body with an RLM, stored verbatim; the `Location` header; and one audit event per write. |
| A reply to a reply → 422 `form_comment.parent_invalid` | same tests, plus "a reply must stay on the same record" | PASS, with the exact ADR text. A parent on another record or a missing parent also gives 422. The database refuses the same thing when the API is bypassed (`form_record_comment_parent_same_record`). |
| An attachment on T14 (`benefit`, `form_record_attachment`) and on T01 (`diagnostic_item`, `evidence_link`) persists and lists | "T14: an attachment persists in form_record_attachment…", "T01: … in the DG2 evidence_link, lists there and through the DG2 route…" | PASS. The T01 link is visible through the DG2 `listEvidenceLinks` route. The same evidence linked through the DG2 route then gives 409 (one attachment place). The database refuses an `evidence_link` type in `form_record_attachment`. |
| Removal needs a reason | T14 attachment test | PASS. A missing or blank reason gives 400. The reason is stored and audited. After removal, a second removal gives 422 `form_attachment.already_removed`, and `includeRemoved=true` lists the removed attachment. |
| AUD 403 on writes | comments "AUD gets 403…", attachments "refusals…", T14 removal | PASS: comment create, attach and remove all give 403, and nothing is written. |
| Free-text rules on comment bodies | "free-text rules on comment bodies…" | PASS. Empty → `validation.too_small`; whitespace or invisible-only → `validation.blank`; NUL or lone surrogate → `validation.invalid_character`; 4001 characters → `validation.too_big`; 4000 characters → 201. |

The §2 rule 4 items for each mutation are all tested:

| Rule 4 item | How it is met and tested |
|---|---|
| Commit-time re-authorization | Comment create and attach: a grant revoked while the request waits gives 403 and nothing is written (the `afterIdentity` technique). |
| Validation | Covered by the tests above. |
| `If-Match` on remove | Missing → 428. Stale → 409 `form_record.conflict` with `currentVersion`. |
| Creates | Comment and attach are creates at version 1. The contract declares no `If-Match` for them, and comments are append-only. |
| Audit event in the same transaction | One per write, asserted per request. |
| No remote I/O inside the transaction | None. |

Other behaviour:

- **Scope.** A caller outside scope gets 404 on every operation.
- **Unknown or planned records.** Reads of an unknown record, a planned type or a record of another transformation give 404; the contract declares no 422 on the reads. Writes on a planned type give 422 `form_record.type_planned`.
- **Pagination.** Each list pages without repeating a row: the keyset compares `(created_at, id)` against the cursor row's stored values, so microseconds are kept. Each list has its own cursor hash. A forged cursor key gives 400 `validation.cursor`, never a cast error.

### Permissions (part of REQ-S05-001's "permissions")

As ADR-0041 §9 sets them:

| Operation | Permission |
|---|---|
| Reads (history, comments list, attachments list) | `transformation.read` in scope |
| Comment create | `form_record.comment` |
| Attach and remove | The record type's `write_permission_code` (e.g. T01 `diagnostic.edit`, T14 `benefit.edit`). A TO without `benefit.edit` gets 403 on T14 (tested). |

## 4. Checks actually run

The environment for all runs was Node 24.21.0, offline, in the worktree `/home/user/wt/dg5-be-e`. Logs are under `docs/delivery/handbacks/DG5/T-DG5-BE-E-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | **0** | clean | `pnpm_r_typecheck.txt` |
| 2 | `pnpm -r build` | **0** | clean | `pnpm_r_build.txt` |
| 3 | `pnpm lint` | **0** | clean | `pnpm_lint.txt` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" | `prettier-check.txt` |
| 5 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 789 operations` | `pnpm_openapi_lint.txt` |
| 6 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | **0** | unit-node 99 files / 1824 tests passed; unit-web 71 / 1385 passed; unit-formula-nocodegen 3 files, 259 passed, 2 skipped | `test-unit-locale-unset.txt` |
| 7 | `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | **0** | Same counts as row 6 | `test-unit-c-utf8.txt` |
| 8 | `QA_PG_PORT=23860 MTH_PORT_POOL=23861-23899 tests/qa/support/with-pg.sh pnpm test:integration` | **0** | **216 files, 2110 tests passed**, 1851.6 s; PostgreSQL on port 23860 (attempt 1) | `test-integration.txt` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG4` | **0** | `PASS gate DG4 (historical)` | `validate-historical-DG4.txt` |

Rows 1–5 were re-run on the final tree after the fix described below, with the same results. Row 4 ran last, after this handback was written.

**Non-zero exits and failures, disclosed:**

1. **My first `pnpm test` runs (both locales) failed with exit 1:** 1 failed / 1823 passed in unit-node. All other projects passed. The logs are kept as `test-unit-locale-unset.run1-failed.txt` and `test-unit-c-utf8.run1-failed.txt`.
   - **Cause:** my file comment in `forms/comments.ts` spelled the reserved lock class number. `platform/advisory-locks.test.ts` ("no module source outside the registry spells a class number") correctly refused it.
   - **Fix:** the comment was reworded. It was a comment-only change.
   - **Re-run:** rows 6 and 7 are the re-runs on the fixed tree, both exit 0.
2. **Early targeted runs failed during development** (`with-pg.sh npx vitest run --project integration <forms + contract>`, exit 1), before the final runs. Causes:
   - a comment-pagination bug: an ISO cursor dropped PostgreSQL's microseconds and repeated the boundary row;
   - two wrong test expectations: `validation.too_small` and `validation.too_big` are the real codes, and `validation.cursor` sits in `errors[]`;
   - the media-type pin.

   All were fixed before rows 1–8.
3. **Timing of row 8.** The integration run (row 8) started at 09:11:51Z, before the comment-only rewording in item 1 (line 6 of `forms/comments.ts`). No executable line differs between that run and the final tree. Rows 1–3 and 6–7 ran on the final tree.

No test was flaky or timed out in the cited logs.

**Pinned-count delta for the orchestrator (rule 14):**

| Pin | Change |
|---|---|
| Media-type triple | `[334, 333, 1]` → `[337, 336, 1]`: +3 JSON bodies (`createFormRecordComment`, `attachFormRecordEvidence`, `removeFormRecordAttachment`). The three GETs add nothing. I updated the pin line, with a comment, as BE-B, BE-D and BE-H did. Reconcile it with the other W5 handbacks. |
| Rate-limit floor | No change; I added no rate-limit configuration. |
| Operation count | Unchanged by me (no OpenAPI edit; `openapi:lint` reports 789 operations on this tree). |

## 5. Operations routed (delta to `p5-pending-be-e.ts`)

Removed all six: `listFormRecordVersions`, `listFormRecordComments`, `createFormRecordComment`, `listFormRecordAttachments`, `attachFormRecordEvidence`, `removeFormRecordAttachment`. The list is now `[]`. Each operation is exercised in `p5-exercises-be-e.ts` with these statuses:

| Operation | Statuses exercised |
|---|---|
| `listFormRecordVersions` | 200, 400, 404 |
| `createFormRecordComment` | 201, 400, 403, 404, 422 (×2 codes) |
| `listFormRecordComments` | 200 (two pages), 400, 404 |
| `attachFormRecordEvidence` | 201, 400, 403, 404, 409, 422 |
| `listFormRecordAttachments` | 200, 400, 404 |
| `removeFormRecordAttachment` | 200, 400, 403, 404, 409, 422, 428 |

The 403 on the three reads is not reachable: a caller without read scope gets 404, as BE-D found for its reads.

## 6. User-facing texts

- **Made untrue by my work: none.** BE-E ships API operations only, with no screen. The problem codes it returns already have en and ar entries in `apps/web/src/i18n/{en,ar}/problems.json`:
  - the ADR-0041 §10 codes: `form_comment__parent_invalid`, `form_attachment__evidence_unknown`, `form_attachment__already_removed`, `form_record__conflict`, `form_record__type_planned`;
  - the reused DG2 codes: `duplicate__evidence_link`, `evidence__archived`, `validation__cursor`.
- **For FE-C, who owns that file:** `apps/web/src/i18n/en/admin.json` `plannedSections` ("Methodology, forms, workflows, automation and branding settings are planned for later releases.") and its ar twin will become untrue for "forms" when the form framework screens ship. I did not edit them, because the screens are not shipped by this task.

## 7. Needs for the orchestrator (contract, schema, dependency)

1. **Barrel line.** I added one line to `packages/shared/src/schemas/index.ts` (`export * from "./forms-framework.ts";`, after BE-D's `forms.ts` line). §B.3 assigns me `forms-framework.ts` but not its barrel line, unlike every other P5 schema file ("+ barrel line"). Without the line the mirrors cannot be imported as `@mth/shared/schemas`. Please confirm it, or move it at merge.
2. **No exported evidence-link function** in `evidence/index.ts`. As §B.3 instructs, I am requesting one, e.g. `linkEvidence(tx, ctx, {evidenceId, recordType, recordId})` and `removeEvidenceLink(...)`, exported by the evidence module owner. Until then, `forms/attachments.ts` writes `evidence_link` rows itself with the DG2 semantics:
   - the same row shape, the same `evidence_link.create` / `evidence_link.remove` audit actions and change shape, and the same active-key rule (409 `duplicate.evidence_link`);
   - archived evidence refused with `evidence.archived`;
   - the DG2 route permission `evidence.create` kept as well, so this path never grants more than the DG2 route.

   When the export lands, swap these writes for it. `EVIDENCE_LINK_TABLES` duplicates the 0012 CHECK list; it is the same list the 0068 trigger uses.
3. **Codes outside the ADR-0041 §10 table (rule 15).** I invented no new code. I reused these existing DG2 codes and texts, and I propose recording them in ADR-0041 §10:

   | Status | Code | Text | Used when |
   |---|---|---|---|
   | 409 | `duplicate.evidence_link` | "This evidence is already linked to the record." | The evidence is already attached, in either store. The contract only says "409 the evidence is already attached". |
   | 422 | `evidence.archived` | "Archived evidence cannot be linked." | Archived evidence of the same transformation. The alternative would have been to call it `form_attachment.evidence_unknown`, which would be untrue. |
4. **Outbox event `form_record.commented` is not emitted (ADR-0041 §8).** `enqueueOutboxEvent` requires the event's payload schema in `packages/shared/src/schemas/events.ts` (`OUTBOX_EVENT_SCHEMAS`). That file is not in my ownership and has no `form_record.*` entry. To finish it:
   - add `"form_record.commented": { 1: z.strictObject({ recordType, recordId, commentId }) }` there, through its owner;
   - then add one `enqueueOutboxEvent(tx, {aggregateType: "form_record_comment", aggregateId: id, eventType: "form_record.commented", schemaVersion: 1, idempotencyKey: \`form_record.commented:${id}\`, …})` call in `createComment`.

   This is about 6 lines. Nothing consumes the event yet (slice E notifications). BE-D's `form_record.custom_values_updated` is in the same state.
5. **The register's own read rule "where stricter" (ADR-0041 §9).** The three reads apply `transformation.read` in scope only. History returns field names and actors, never values. I checked statically for a stricter register read:

- **Route level:** a grep of every `app.get` route `access.permission` in `apps/api/src/modules`. Apart from `transformation.read`, it finds only admin, organization, job, automation and `authenticated` reads, none of them on a registry table.
- **Handler level:** a grep of every `requireRead(…, "<permission>"` call. It finds only `access.read`, `organization.read` and `business_unit.read`, again none on a registry table.

So I found no stricter read permission. I did **not** audit row-level visibility rules inside individual register handlers, if any exist. If one does, add its rule to `requireRecordRead` in `forms/history.ts`.
6. **Recoverable conflict body.** The 409 `form_record.conflict` on remove carries `currentVersion`, as BE-D's does. It does not carry the full current representation (ADR-0041 §5 "and the current representation"). The `Problem` schema has no member for it, and the client can re-read the list. This is the same as BE-D.

## 8. What remains

- **Within §B.3: nothing**, except the outbox event in §7.4, which is blocked on a file I don't own.
- **REQ-S05-001 is complete only with BE-E2** (drafts, export, bulk edit, the recoverable conflict on concurrent save) and **FE-C** (the T01 and T14 screens).

## 9. Merge instructions

- No migration. Merge order: after BE-D (already merged), before BE-E2. BE-E2 edits the same `forms/routes.ts` below my lines (§B.6).
- Expected conflict: the `contract.test.ts` media-type pin line, if another W5 task adds JSON bodies. Add the counts: BE-E contributes +3 / +3 / 0.
- The worktree also contains untracked environment files (`.bashrc`, `.zshrc`, `CLAUDE.local.md`, `.idea`, …) that were not created by this task. Do not integrate them.
