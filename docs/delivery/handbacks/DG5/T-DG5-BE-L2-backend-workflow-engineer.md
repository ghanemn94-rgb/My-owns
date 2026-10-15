# Handback T-DG5-BE-L2 (backend-workflow-engineer): meeting cut-off draft agenda and pack (p5-work-split §E.4), plus the notify-action delivery wiring (D-153 a)

- **Stage:** P5, gate DG5 (BUILDING). **Branch:** `dg5/be-l2`, base `HEAD` `1487877` (verified with `git rev-parse HEAD` / `git status` before writing). Changes are left **uncommitted**.
- **Invocation:** `DG5-T-DG5-BE-L2-backend-workflow-engineer-20261015T101807Z-997760c2`, session `997760c2-3ccf-4d12-916f-09a94a441c60`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-L2.md` (sha256 `8fcb53a3…01fa34`, verified).
- **Time:** start `2026-10-15T10:27:10Z`, end: see §8.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, **exit 0** (before implementation; `T-DG5-BE-L2-evidence/validate-historical-DG4.log`). It was re-run at the end; see §8.
- **Two gate systems.** Product gates G1–G6 are business approvals inside the product. A pack review is a human action of the meeting's chair or secretary. It is **not** a G1–G6 business approval, and no job or service reviews, publishes or decides anything. Nothing here reads or writes DG0–DG7. All test data is synthetic.
- **Migrations:** **none.** `0079` is left unused (§5 item 1 explains the one schema point and how it was handled without a migration).

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/cutoff.ts` (new) | zod mirrors of `MeetingCutoffPack` and `MeetingCutoffPackReview` (note via the shared `freeText(3, 2000)`), plus the typed open-ask snapshot entry. |
| `packages/shared/src/schemas/index.ts` | One barrel line (`export * from "./cutoff.ts"`). |
| `apps/api/src/modules/governance/cut-off.ts` | Fills BE-A's stub. `GET …/cutoff-pack` and `POST …/cutoff-pack/review`. `assertCutoffPackReviewed`, the publish check. `generateCutoffPackInTx`, the generation service and API twin of the worker job. The ADR-0044 §10 refusal codes with their exact texts. |
| `apps/api/src/modules/governance/agenda.ts` | **Two named lines:** the import, and one call `assertCutoffPackReviewed(tx, meetingId, agendaItemId)` in the DG4 per-item publish, after the draft check and before any write. This is the "mapping line" of §E.4: the API refuses before the `0075` trigger would. |
| `apps/worker/src/handlers/meetings.ts` | **New function only:** `governance.meeting_cutoff_scan` (`handleMeetingCutoffScan`, `generateCutoffPackInTx`). Also one handler line in `MEETINGS_HANDLERS` and two import edits (`createWorkItemOnce` from the kit, `truncateText`). The DG4 series handler is unchanged. |
| `apps/worker/src/queues/meetings.ts` | The queue line `governance.meeting_cutoff_scan`. |
| `apps/worker/src/automation/actions/notify.ts` | D-153 (a): each notify notification goes through BE-L's `decideDelivery` with the kit's `loadDeliveryInput`. The row stores `urgency`, `delivery_state` and `deliver_after`, and its audit event carries the decision. |
| `apps/api/test/integration/governance/cutoff-pack.test.ts` (new) | The REQ-S12-015 literal tests plus authorization, concurrency, audit, parity and registration tests (12 tests). |
| `apps/api/test/integration/automation/automation-notify-delivery.test.ts` (new) | The D-153 (a) tests (2 tests). |
| `apps/api/test/integration/contract/p5-exercises-be-l2.ts` (new) | Contract exercises of both operations: the success and every declared refusal reachable. |
| `apps/api/test/support/p5-pending-be-l2.ts` | Emptied (both operations routed). |
| `apps/api/test/integration/contract/contract.test.ts` | **Outside my listed files; see §5 item 2.** Three wiring lines for `p5-exercises-be-l2.ts` (import, mirror spread, `it`), because BE-A created no BE-L2 seam. Also the media-type pin `[368, 367, 1]` → `[369, 368, 1]`, with its comment (+1 JSON body: `reviewMeetingCutoffPack`). |
| `docs/delivery/handbacks/DG5/T-DG5-BE-L2-evidence/*` | Logs of every check below. |

Untracked files I did not create and did not touch: `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md` (environment files in the worktree root).

## 2. Behaviour delivered

### REQ-S12-015 (owner: BE-L2)

Acceptance (`requirements.csv`): *"A13;A15: cut-off creates one draft agenda containing current open asks; it is not published without review"*. The procedure: *"The draft agenda/pack is created in Draft and requires review before publish"*.

**Generation** (ADR-0044 §6; worker `governance.meeting_cutoff_scan`, daily 00:30 Asia/Riyadh from the `0075` schedule; starter 12):

- **Which meetings:** status `scheduled`, cut-off date today or earlier, scheduled date today or later (business dates in the meeting's time zone), and no pack yet.
- **Exactly once:** one `runOnce` transaction per meeting, key `meeting_cutoff:<meetingId>`, backed by UNIQUE `meeting_cutoff_pack_once_key` (MP03).
- **Re-check before writing:** inside the transaction the meeting is re-read `FOR UPDATE`. A meeting that is no longer due rolls back **with** its ledger row, so a later scan still sees it.
- **Open asks:** the predicate of the DG4 agenda's linkable-ask check, minus asks already on this meeting's agenda (any item that is not withdrawn). The predicate is executive decision of the transformation, `ask_origin` set, status `open`/`deferred`.
- **Agenda items:** one `draft` `executive_ask` item linked to each ask, at the next free ordinals. Capped by the forum's `agenda_max_items` (else 200) and ordinal 999. An ask that does not fit stays in the snapshot with `agendaItemId: null`.
- **The pack:** a `draft` pack with `as_of`, the meeting's `cutoff_date`, the open-ask snapshot and the created item ids (content fixed, MP05).
- **Review task:** one `meeting_pack_review` work item to the chair (else the secretary), through the kit's `createWorkItemOnce`, so it follows BE-L's delivery policy. With neither person, no work item is created and the pack reads `reviewerAssigned: false`.
- **Audit:** one event for every agenda item and for the pack.
- **Starter wrapping:** the scan is registered on its own queue. `withStarterRules` wraps it as `starter.meeting_cutoff` (already in BE-J's `STARTER_RULE_BY_QUEUE`), so each run is recorded as an execution of the starter's effective version.

**Review before publication:**

- `POST …/cutoff-pack/review` requires `If-Match` (428 when missing, 409 when stale).
- The reviewer is the meeting's chair holding `meeting.chair`, or its secretary holding `meeting.prepare`, decided on grants reloaded inside the transaction. Anyone else gets 403 `meeting_cutoff_pack.not_reviewer`; that includes AUD and the TL or WL when they are not this meeting's chair or secretary.
- The transition is `draft → reviewed` once; a second review gets 422 `meeting_cutoff_pack.already_reviewed`.
- The review stores who, when and the optional note, writes one audit event `meeting_cutoff_pack.review` (`reviewed_as` chair or secretary), and closes the `meeting_pack_review` work item.
- **Publish check:** until the review, the DG4 per-item publish refuses a pack item with 422 `agenda_item.pack_not_reviewed` ("Review the meeting's cut-off pack before publishing its items."), before any write. Items outside packs publish exactly as in DG4. Publishing stays the chair's DG4 per-item action.
- `GET …/cutoff-pack` requires `transformation.read` in scope (AUD reads; 404 outside scope or without a pack) and returns ETag = version.

**Tests, the §E.4 literal list** (`cutoff-pack.test.ts`):

| §E.4 literal test | Test |
|---|---|
| cut-off creates one draft agenda containing the current open asks (and only those) | "one pack, one draft executive-ask item per open ask not yet on the agenda…": the snapshot equals the open asks minus the one already linked; the design decision is excluded; one item per ask, all `draft`; ordinals follow the existing item; an ask raised after the cut-off is not added |
| a second scan creates nothing | same test: a second scan, then two concurrent scans, add no item and no pack |
| publishing one of its items before review → 422 `agenda_item.pack_not_reviewed` | "publishing a pack item before review…": exact code and detail; the item is unchanged (draft, v1, only its create audit event) |
| after the chair reviews, the chair publishes | same test: review 200 (ETag "2", reviewedBy, note, audit, work item `done`), then publish 200 |
| a non-chair/secretary reviewing → 403 `meeting_cutoff_pack.not_reviewer` | "a non-chair/secretary reviewing…": WL (has `meeting.chair`, not this meeting's chair), TL (has `meeting.prepare`, not its secretary) and AUD each get 403 with the exact text; nothing is written |
| DG4 agenda items outside packs publish as before (regression) | "DG4 regression…": an item outside the pack publishes while the pack is still a draft; the whole DG4 `agenda.test.ts` also stays green |
| AUD 403 | in the non-reviewer test, and in the contract exercises |

Also tested:

- the secretary with `meeting.prepare` reviews (positive);
- a BO named secretary, without `meeting.prepare`, is refused (negative);
- 428, 409, two 400s (blank note, unknown member), and 404 from another organization on both operations;
- no chair and no secretary: no work item, `reviewerAssigned: false`;
- a meeting whose cut-off is in the future gets no pack (GET 404);
- the database trigger refuses a direct publish of a pack item (MP04);
- **parity:** the API generation service and the worker job write field-equal rows for two identical meetings (asks, items, work item, and audit actions with actor, on-behalf-of and source);
- the worker registers the queue, and the registered handler is the wrapped one.

**Open-asks read (named, as §E.4 asks):** the governance read the DG4 agenda uses is `checkLinkable` in `apps/api/src/modules/governance/agenda.ts`. It is **not exported**, and it checks one decision, not a list. `cut-off.ts` (and its worker twin) applies the same predicate as a list query, with the "not already on this meeting's agenda" exclusion from ADR-0044 §6. If the orchestrator prefers one source, exporting a list form of `checkLinkable` from `agenda.ts` would let both use it.

### D-153 (a): the notify action under the notification policy

Assigned test: *"a rule with a notify action produces exactly one policy-governed notification per recipient; a recipient who opted out of that kind (where the policy allows opting out) receives none; the execution log records the outcome."*

- **Delivered:** `executeNotify` now decides each recipient's delivery exactly like `createWorkItemOnce`, using `decideDelivery` with the kit's `loadDeliveryInput`.
  - The urgency is that of the automation's work-item kind `automation_task`, which is `normal`.
  - A recipient with no preference and no policy gets the notification delivered at once (DG4).
  - A recipient in quiet hours with a daily digest gets it `held` until the next digest time. The digest job then releases it (`digested`).
  - The audit event carries `delivery_state` and `deliver_after`.
- **Tested** (`automation-notify-delivery.test.ts`):
  - one enabled transformation-scoped rule, the same `gate.decided` event delivered three times sequentially plus twice concurrently;
  - result: one execution `succeeded`, one notify action result `done`, exactly one notification per recipient (two TLs), one delivered and one held;
  - the held row is not in the inbox until the digest job releases it.
- **"A recipient who opted out of that kind receives none": not implementable as written.** ADR-0044 §5's policy has four settings (business-day timing, quiet hours, digest, urgent escalation) and **no per-kind opt-out**. `notification_preference` and `notification_policy` (`0075`) have no such column, so the policy never allows opting out. The test pins the current truth: every planned recipient gets exactly one row, delivered or held, never dropped. See §5 item 3 for the decision needed.
- Only the notify action's file and its tests were touched, as assigned. `create_task` and `escalate` already went through `createWorkItemOnce`, and so through the policy (§7).

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. PostgreSQL 16.13 disposable clusters via `tests/qa/support/with-pg.sh` on ports 24001–24049. The load average was about 11–18 because four W10 agents were running. Empty `.claude/.cc-writes` folders were removed before every test run.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` | `validate-historical-DG4.log` |
| 2 | `pnpm -r typecheck` | 0 | | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | | `build.log` |
| 4 | `pnpm lint` | 0 | `eslint . --max-warnings=0` | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `openapi-lint.log` |
| 7 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | 0 | unit-node 111 files / **1943** passed; unit-web 72 / **1400**; unit-formula-nocodegen 3 / **259 passed + 2 skipped** (by design) | `unit-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | unit-node 111 / **1943**; unit-web 72 / **1400**; unit-formula-nocodegen 3 / **259 + 2 skipped** | `unit-locale-C.UTF-8.log` |
| 9 | `QA_PG_PORT=24010 MTH_PORT_POOL=24011-24049 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | **244 / 245 files, 2356 / 2357 tests.** One failure: `contract.test.ts:923` › "every operation: an undeclared request media type is a declared 400 validation.content_type; nothing written", **timed out at 30026 ms** (its 30 s limit), at load about 17–20 with four W10 agents running. Disclosed below | `integration.log` |
| 10 | Targeted, during development: `with-pg.sh npx vitest run --project integration` over `contract/contract.test.ts`, `governance/`, `automation/` | 0 | 24 files / 274 tests passed | (scratch; superseded by #9) |
| 9b | Re-run of the failed file alone: `QA_PG_PORT=24020 MTH_PORT_POOL=24021-24049 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | 0 | **76 / 76**; the same test passed in **11233 ms** at load about 5 | `integration-contract-rerun.log` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` | `validate-historical-DG4-end.log` |

**About the integration failure (#9).** The full run did **not** exit 0, so acceptance item 3 is **not met by that run**. The orchestrator should re-run the integration suite at normal load, at merge or in a verify run.

- **What the test does:** it sends one undeclared-media-type request to every one of the 846 operations, all in one `it` with a 30 s limit.
- **Timings:** 10.6 s in my earlier targeted run (load about 11), 11.2 s in the re-run (#9b, load about 5), and over 30 s in the full run at load about 17–20.
- **My change** adds one operation to the loop, which is not a material change in its run time.
- **Assessment:** I judge this the F-DG4-143/148 load-timeout class, not a functional failure. Every assertion in the file passes whenever the test finishes. I did not change the test or raise its timeout.

Pinned counts: the media-type pin changes `[368, 367, 1]` → `[369, 368, 1]` (+1, `reviewMeetingCutoffPack`'s JSON body). No rate-limit floor change. `getMeetingCutoffPack` is a bodiless GET.

## 4. Operations routed (delta to `p5-pending-be-l2.ts`)

| Operation | Before | After | Route | Exercised in `p5-exercises-be-l2.ts` |
|---|---|---|---|---|
| `getMeetingCutoffPack` | pending | routed | `GET /api/v1/transformations/{transformationId}/meetings/{meetingId}/cutoff-pack` | 200 (TL; AUD), 400, 401, 404 |
| `reviewMeetingCutoffPack` | pending | routed | `POST …/cutoff-pack/review` (`config.consumes: ["application/json"]`) | 428, 400, 401, 403 (non-reviewer; AUD), 404, 409, 200, 422 |

`P5_PENDING_BE_L2` is now `[]`.

## 5. Contract, schema and dependency needs (for the orchestrator)

1. **`agenda_item.created_by` / `updated_by` are `NOT NULL` (0044); no migration was taken.** The worker creates pack items as a service, but the column needs a person.
   - **What I did:** the items carry the meeting's *owner of record*: `meeting.created_by`, else the series author `meeting_series.created_by`; `meeting_created_source` guarantees one exists. The audit event's actor is the service (`source` worker), **on behalf of** that person.
   - **Alternative:** if reviewers judge that attribution misleading, `0079` (BE-L/BE-L2's free number) can make both columns nullable for `created_source`-style service rows. That also touches `schema.ts` and the `AgendaItem` contract (`createdBy` would become nullable), so it is the orchestrator's call.
2. **`contract.test.ts` wiring (outside my listed files).** BE-A created a `p5-exercises-<task>.ts` seam and its three `contract.test.ts` lines for every slice task except BE-L2, which was inserted later. Without them the "every operation exercised" check would fail.
   - I added the three lines, marked `// T-DG5-BE-L2`, and the pin change with its comment.
   - At merge the orchestrator reconciles the pin from all W10 handbacks: my delta is **+1 JSON body**.
3. **Notification opt-out (D-153 a).** The assigned test names a per-kind opt-out "where the policy allows opting out". ADR-0044 §5 and `0075` define none.
   - **Options:** (a) record that P5 has no opt-out (M0241 requires business-day timing, quiet hours, digests and urgent escalation; it does not require opt-out), and drop that clause; or (b) design one (an ADR-0044 amendment plus a migration, e.g. a `notification_preference.muted_kinds text[]` honoured only for non-urgent kinds), assigned to a later task.
   - I implemented neither.
4. **Database-error mapping (optional hardening).** The API refuses a pack item's publish before the trigger, and the review rule before `meeting_cutoff_pack_reviewer`. If a race ever reached the trigger, `agenda_item_cutoff_pack_unreviewed` and `meeting_cutoff_pack_reviewer` would surface as 500, because `platform/db-errors.ts` (BE-A's, frozen) does not map them.
   - Proposed lines for its owner: `agenda_item_cutoff_pack_unreviewed` → 422 `agenda_item.pack_not_reviewed`; `meeting_cutoff_pack_reviewer` → 403 `meeting_cutoff_pack.not_reviewer`; `meeting_cutoff_pack_transition` → 422 `meeting_cutoff_pack.already_reviewed`.
   - A race cannot produce them in the current code (pack status only moves forward, and items are created in the pack's own transaction).
5. **No new dependency, no new problem code.** Every code used is in ADR-0044 §10, with its exact English text.

## 6. User-facing texts

- **Made untrue by this work: none found.** I searched the en/ar web texts for strings calling the cut-off pack, the review step or notify delivery planned or later; none exist. `admin.plannedSections` ("…automation … settings are planned for later releases") concerns the admin automation screens (FE-D's scope), not this backend work, so I did not change it.
- **Missing texts, for the web owner** (`apps/web/src/i18n/{en,ar}/…`, not my files). Until they exist, the work item renders the My Work fallback and the codes show the generic problem text.
  - `myWork.json`, `governance__task__meeting_pack_review`, params `{forum, forumAr, meetingDate, askCount}`:
    - en: "Review the draft agenda and pack of the {{forum}} meeting of {{meetingDate}} ({{askCount}} open asks) before publication"
    - ar: "راجِع مسودة جدول الأعمال والحزمة لاجتماع {{forum}} بتاريخ {{meetingDate}} ({{askCount}} من الطلبات المفتوحة) قبل النشر"
    - (`forumAr` for the Arabic name, following the ADR-0025 L1 twin rule.)
  - `problems.json`, ADR-0044 §10 exact English texts:
    - `meeting_cutoff_pack__already_reviewed`: "This pack is already reviewed." / ar "هذه الحزمة مراجَعة بالفعل."
    - `meeting_cutoff_pack__not_reviewer`: "Only the meeting's chair or secretary can review its pack." / ar "لا يراجع حزمة الاجتماع إلا رئيسه أو أمين سره."
    - `agenda_item__pack_not_reviewed`: "Review the meeting's cut-off pack before publishing its items." / ar "راجِع حزمة الإقفال للاجتماع قبل نشر بنودها."
  - The `meeting_pack_review` kind label already exists in both languages.

## 7. What remains

- The opt-out clause of D-153 (a): §5 item 3 (decision needed; not implemented).
- No further action wiring is needed. `create_task` and `escalate` already create their notifications through the kit's `createWorkItemOnce` (`actions/items.ts`), which BE-L wired into the policy. `notify` was the only action that wrote `inbox_notification` directly, and it now goes through the policy too.
- The pack screen (draft agenda, the "No reviewer assigned" state, the review button) is a web task, not assigned here.
- The scan writes no `automation_execution_id` on the pack (nullable). The starter wrapper records the execution, but the handler is called unchanged and receives no execution id. Linking it would need a wrapper change (BE-J's file).

## 8. Final check results (summary)

- **typecheck, build, lint, prettier, openapi:lint:** exit 0.
- **`pnpm test`:** exit 0 in both locales (1943 / 1400 / 259 + 2 skipped).
- **Integration:** exit 1, 2356 / 2357. The one failure is a load timeout of the all-operations media-type sweep in `contract.test.ts`, which passed alone 76 / 76 at low load. A full re-run at normal load is still needed.
- **`validate.mjs --historical --stage DG4`:** exit 0 at the start and at the end.
- **Requirement rows:** REQ-S12-015 delivered and tested literally. D-153 (a) delivered and tested, except the opt-out clause, which has no model (§5 item 3).
- **End time:** `2026-10-15T12:19Z`, about 112 minutes after the start.
