# Handback T-DG5-KBE-D (kpi-benefits-engineer): structured owner updates, update tasks and the executive pack

- **Stage:** P5, gate DG5 (BUILDING). **Task:** T-DG5-KBE-D, p5-work-split §F.3. **Requirement:** REQ-S09-011.
- **Invocation:** `DG5-T-DG5-KBE-D-kpi-benefits-engineer-20261015T024602Z-208e8c64` (session `208e8c64-a5e1-4352-b9dd-a88dcce3dcaf`).
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-KBE-D.md`, sha256 `52784d1c06effc7f9f93ca28bd69ddd250ffec822b117aa15056334d5c59f581` (verified at the start).
- **Base:** worktree `/home/user/wt/dg5-kbe-d`, branch `dg5/kbe-d`, `HEAD` `5b4597ccb9477a521c1683a3bf5d91c99eb53208` (D-152). The changes are **uncommitted**, as the assignment requires.
- **Time:** start `Thu Oct 15 02:46:16 UTC 2026`, end `Thu Oct 15 04:44:27 UTC 2026` (`date -u`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0, at the start (`T-DG5-KBE-D-evidence/validate-historical-DG4.txt`). It was run again at the end (§4).
- **Gates:** submitting an update and generating or issuing a pack approve nothing. Product gates G1–G6 are business approvals inside the product. Nothing here reads or writes DG0–DG7, and no agent granted any business, Finance or IT approval. All test and fixture data is synthetic.

## 1. Changed files

| File | Status | Purpose |
|---|---|---|
| `apps/api/src/modules/portfolio/updates.ts` | filled (BE-A stub) | The 7 owner-update operations. Covers the write gate (commit-time re-authorization, `owner_update.submit`), subject ownership (the workstream lead; for the transformation, a TL whose grant applies to it), the open-period rule, the `draft → submitted → draft` state machine, the revision row, one audit event per mutation, completing the owner tasks on submit, and the `submittedUpdatesOfPeriod` read service for the pack. |
| `apps/api/src/modules/portfolio/index.ts` | +2 lines | Exports `submittedUpdatesOfPeriod` and `ownerUpdateDueKey`, so `reporting` reads updates through portfolio's public surface (the architecture rule forbids deep imports). Outside the literal §F.3 list; see §5. |
| `apps/api/src/modules/reporting/reports/assemblers/executive-pack.ts` | new | The `executive_pack` assembler: per subject, its update section and its metrics section (§2). |
| `apps/api/src/modules/reporting/reports/assembler.ts` | +1 registry line (+import) | `["executive_pack", executivePackAssembler]`, appended after KBE-C2's lines. |
| `apps/api/src/modules/platform/db-errors.ts` | +33 lines | The `owner_update.*` lines: `mapP5OwnerUpdateError` and its call in `mapDatabaseGuardError`. |
| `apps/worker/src/handlers/reports.ts` | filled (BE-A stub) | `reports.owner_update_tasks`: one `owner_update_due` task per owner, subject and open monthly period, exactly once via `createWorkItemOnce`. |
| `apps/worker/src/queues/reports.ts` | filled (BE-A stub) | The `reports.owner_update_tasks` queue (standard retry policy, `ops.failed` DLQ). |
| `packages/shared/src/schemas/owner-updates.ts` | new | Zod mirrors of `OwnerUpdate`, `OwnerUpdatePage`, `OwnerUpdateCreate`, `OwnerUpdatePatch`, `OwnerUpdateReopen`, `OwnerUpdateRevision` and `OwnerUpdateRevisionPage`, plus `OWNER_UPDATE_REFUSALS` (the exact ADR-0045 §11 texts). Outside the literal §F.3 list; see §5. |
| `packages/shared/src/schemas/index.ts` | +2 lines (barrel) | `export * from "./owner-updates.ts";` |
| `apps/api/test/support/p5-pending-kbe-d.ts` | 7 → 0 entries | Routed operations removed (§3). |
| `apps/api/test/integration/contract/p5-exercises-kbe-d.ts` | filled (stub) | Contract exercises of all 7 operations, and the 7 response mirrors. |
| `apps/api/test/integration/contract/contract.test.ts` | pin + comment | Media-type pin `[361, 360, 1]` → `[364, 363, 1]` (§3). |
| `apps/api/test/integration/reporting/owner-updates.test.ts` | new | Integration tests of REQ-S09-011 (7 tests). |
| `apps/api/src/modules/reporting/reports/assemblers/executive-pack.test.ts` | new | Unit tests of the pack's pure mapping (13 tests, worked fixtures). |
| `apps/api/src/modules/platform/db-errors-p5-owner-updates.test.ts` | new | Unit tests of the guard mapping (4 tests). |
| `docs/delivery/handbacks/DG5/T-DG5-KBE-D-*` | new | This handback and its evidence logs. |

No migration was added. `0083`, reserved for KBE-C/KBE-D, stays unused because no index was needed. No dependency was added. Nothing under `tools/**`, `.claude/**`, `docs/source/**`, the reviews, gate records, `stages.json`, `findings.json` or `trading_agent/` was touched. The untracked dotfiles at the worktree top level (`.bashrc`, `.zshrc`, `CLAUDE.local.md`, …) are not mine. They were present at the start and are not part of this change.

## 2. Behaviour delivered: REQ-S09-011

**Acceptance (requirements.csv), quoted:** "Owners submit a structured update per period; executive views and packs are generated from updates plus canonical metrics without slide re-creation". **Test reference:** "A02;A15: the executive pack's workstream section contains the submitted update text and current metrics without manual editing". Per D-142 R1, the row is judged on its own text.

1. **Structured update per subject and period (ADR-0045 §6).**
   - `POST /transformations/{t}/updates` creates a draft (version 1, `ETag "1"`, `Location`). It holds the eight M0185 fields: achievements, next steps, milestones, outcomes, adoption, risks, dependencies and asks. Each is null or 1–2000 characters through the shared `freeText` rule (never blank, no U+0000 or lone surrogate, stored as entered).
   - `PATCH` edits a draft (If-Match; `null` clears a field).
   - `POST …/submit` (bodiless, If-Match) makes the next revision. It writes the `owner_update_revision` row in the same transaction and needs at least one field.
   - `POST …/reopen` (If-Match, `reason` 3–1000 characters) moves `submitted → draft` and keeps the revision history.
   - `GET …/revisions` lists the submitted revisions, newest first, with a cursor.
   - Every write needs the period `open`. The API refuses first, with a shared lock on the period row, and the 0080 guard is the backstop, mapped to the same 422.
2. **Who writes.**
   - The caller needs `owner_update.submit` in the transformation (TL, WL) and must be the subject's owner: the workstream's current `lead_user_id`, or, for the transformation, a holder of the TL role whose grant applies to it (`grantApplies`, so a BU-scope TL that inherits downward counts).
   - Anyone else holding the permission gets **403 `owner_update.not_owner`**.
   - A reader without the permission (AUD) gets **403 `forbidden`** on every write, before the body is validated.
   - A caller who cannot read the transformation gets 404.
   - Reads need `transformation.read`.
3. **Executive pack (`executive_pack`, period required).**
   - **Section order:** the transformation first, then each active workstream by code.
   - **Update section** (`update_<subject>`, kind `fields`):
     - With a submitted revision: the subject, its owner (or the code `no_owner` for a workstream without a lead), `update_state` = `submitted`, the revision number, submitter and time, and the eight fields **verbatim** (`authored: "user"`; a field left empty is `not_applicable`, never placeholder text).
     - Without one: `update_state` = **`no_update_submitted`** ("No update submitted" / "لم يُقدَّم تحديث"). It is never blank and never shows an older period's text, because only updates of *this* period are read.
   - **Metrics section** (`metrics_<subject>`, kind `metrics`): the subject's **current canonical metrics** from the DG4 dashboard read model (ADR-0037), with the same engine calls as `GET …/dashboard` / `GET …/workstreams/{w}/dashboard` and the pack's period as the dashboard period filter:
     - each Template 10 area's RAG (`rag_<area>`);
     - every headline (KPI outcome count, benefit value per state × basis × currency, investment, initiatives, dependencies, and for the transformation also decisions and adoption);
     - the open RAID entries per type (`open_raid_<type>`) through the `raid_register` view of the DG4 RAID list route, narrowed to the workstream's initiatives for a workstream.
   - **Labels (ADR-0045 §5):**
     - planned value is a plan figure (`not_applicable`);
     - forecast and submitted value are `provisional` (not Finance-validated);
     - validated value is `validated`;
     - Unknown and Stale headlines and RAGs carry **no number and no code**, so they are never 0 and never green;
     - value bases and currencies are separate fields and are never summed (D-117, D-119, D-122).
   - **Sources:** each `owner_update` at its row `version`, the revision row cited, and the transformation or workstream rows.
   - **Snapshot approval state:** `not_applicable` (ADR-0045 §3).
   - The live view, the generated snapshot and every export come from this one assembler, so nothing is typed into the pack.
4. **Update tasks ("Reporting period opens -> update tasks").**
   - The daily job `reports.owner_update_tasks` (seeded by 0080, 00:40 Asia/Riyadh) runs for every open `monthly` period and every live transformation of its organization. It creates one `owner_update_due` item per subject owner who has no submitted update:
     - for the transformation: the active TL holders whose grant applies to it;
     - for each active workstream: its active lead (no lead, no task).
   - **Exactly once:** the dedupe key `owner_update_due:<periodId>:<subjectType>:<subjectId>:<userId>`, with the `work_item` unique key as backstop. Running the job twice creates one task per owner and period.
   - **Task contents:** due date = the period's `update_due_date`; link `/transformations/{t}/owner-updates`; message key `reports.task.owner_update_due` with `{subjectType, subjectCode, subjectName, periodLabel}`.
   - Submitting an update **completes** the open tasks of that subject and period, each with a `work_item.complete` audit event, so the next run creates none for it.
   - The item appears in My Work under "Missing updates" (the F.0 mapping).
5. **Every mutation (shared rule 4):**
   - authorization re-checked inside the transaction on reloaded grants (commit-time; a grant revoked while the request waits → 403, nothing written);
   - validation;
   - `If-Match` (428 missing, 409 stale; the create is version 1);
   - one audit event per mutated `owner_update` row in the same transaction (`owner_update.create|update|submit|reopen`; the revision row is covered by the submit event);
   - no remote I/O inside the transaction.

**The literal §F.3 tests, and where each is proven** (`apps/api/test/integration/reporting/owner-updates.test.ts` unless noted):

| §F.3 test | Proof |
|---|---|
| a WL submits the update of their workstream for the open period | test 1 (create → edit → clear → submit; revision 1) |
| the generated executive pack's workstream section contains the submitted text and the workstream's current metrics, with no manual edit | test 2. The snapshot's `update_<ws>` fields equal the submitted text. Each `metrics_<ws>` RAG equals the DG4 workstream dashboard's for the same period, and the headline label keys equal the dashboard's headlines one for one. The live view returns the same text. |
| a workstream without an update shows "No update submitted" | test 2 (`update_state = no_update_submitted`, none of the eight fields); a workstream without a lead shows `no_owner` |
| a non-lead WL → 403 `owner_update.not_owner` | test 4 (also on reopen in test 3, and on patch in the contract exercises) |
| a closed period → 422 `owner_update.period_not_open` | test 5 (create in a closed period; patch and submit after the period closed) |
| an empty submit → 422 `owner_update.empty` | test 5; contract exercises |
| editing a submitted update → 422 `owner_update.not_draft` | test 3; contract exercises |
| reopen needs a reason | test 3 (missing, too short or blank reason → 400; a draft → 422 `owner_update.not_submitted`; with a reason → 200, the reason is in the audit event) |
| the task job run twice creates one task per owner and period | test 7 (run 1 creates ≥ 3; run 2 creates 0 and leaves an identical set; unique per owner and subject; the submit completes the ws1 task; run 3 creates 0) |
| AUD 403 | test 4 (create, including with an invalid body, patch, submit, reopen); contract exercises |
| `If-Match` 428/409 | test 3 (reopen); contract exercises (patch, submit, reopen) |
| one audit event per mutation | test 1 (create, update, update, submit); test 3 (the reopen event with its reason); test 5 |
| (commit-time re-authorization) | test 6 |

Every refusal is asserted with its exact ADR-0045 §11 English text, through the shared `OWNER_UPDATE_REFUSALS` table, which `db-errors-p5-owner-updates.test.ts` also checks.

## 3. Operations routed (delta to the pending list) and pins

- **`p5-pending-kbe-d.ts`:** 7 → 0. Removed: `listOwnerUpdates`, `createOwnerUpdate`, `getOwnerUpdate`, `updateOwnerUpdate`, `submitOwnerUpdate`, `reopenOwnerUpdate`, `listOwnerUpdateRevisions`. Each is exercised through the validating client in `p5-exercises-kbe-d.ts`, with every declared refusal reachable:
  - create: 400/403/403 `not_owner`/404/422/201/409;
  - list: 200/400/404;
  - get and revisions: 200/400/404;
  - update: 400/403/403 `not_owner`/404/428/409/200/422 `not_draft`;
  - submit: 400/403/404/428/409/200/422 `empty`/422 `not_draft`;
  - reopen: 400/403/404/428/409/200/422 `not_submitted`.
  - Not reachable there: 401 and 429 (their own suites) and 403 on the reads (a caller who cannot read gets 404).
- **Media-type pin** (`contract.test.ts`): `[361, 360, 1]` → **`[364, 363, 1]`**. This is +3 JSON bodies: `createOwnerUpdate`, `updateOwnerUpdate`, `reopenOwnerUpdate`. `submitOwnerUpdate` is bodiless (default consumes, as the drift check expects), and the three reads are GETs. I applied it in my tree so the contract test is green there; the orchestrator reconciles the sum at the merge (the D-079/D-150 precedent).
- **Rate-limit floor and operation count:** unchanged. The count stays 846, and the contract file passed 74/74.
- `config.consumes`: the three JSON-body routes declare `application/json`; submit declares none (shared rule 3).

## 4. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. The harness ports used are 23950–23999 only. Empty `.claude/.cc-writes` folders inside source trees were removed before the test runs. Load average was about 11–19 during the runs, because four W9 tasks were running.

| # | Command | Result | Log |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | exit 0, `PASS gate DG4 (historical)` | `validate-historical-DG4.txt` |
| 2 | `pnpm -r typecheck` | exit 0 | `typecheck.txt` |
| 3 | `pnpm -r build` | exit 0 | `build.txt` |
| 4 | `pnpm lint` | exit 0 | `lint.txt` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (0 `[warn]` lines) | `prettier-check.txt` |
| 6 | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `openapi-lint.txt` |
| 7 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | exit 0. unit-node 109 files / **1919 passed**; unit-web 72 / **1400 passed**; unit-formula-nocodegen 3 / **259 passed + 2 skipped** (by design) | `unit-locale-unset.txt` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0. unit-node 109 files / **1919 passed**; unit-web 72 / **1400 passed**; unit-formula-nocodegen 3 / **259 passed + 2 skipped** (by design) | `unit-c-utf8.txt` |
| 9 | `QA_PG_PORT=23960 MTH_PORT_POOL=23961-23999 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0. **237 files, 2302/2302 passed**: the W8 baseline of 2295 (D-152) + 7 new (`owner-updates.test.ts`). Disposable PostgreSQL 16.13, UTF8 / C. Run 04:14:59–04:42:53 UTC. Pinned-count change: the media-type pin only (§3). | `integration.txt` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | exit 0, `PASS gate DG4 (historical)` | `validate-historical-DG4-end.txt` |

**Disclosed non-zero and intermediate runs:**

- **The first full `pnpm test` (locale unset) exited 1:** 2 failed out of 1919 in unit-node; unit-web and formula were green. Log: `unit-locale-unset-run1-failed.txt`. The failures were `architecture.test.ts` › "every import respects dependsOn…" and `reporting.test.ts` › "its declared boundary holds". Both are the same rule: computed member access with a non-literal key (`obj[key]`) bypasses the module-interface check. I had used it in `updates.ts`, `executive-pack.ts` and the new db-errors test. I replaced each with explicit field lists and Maps; behaviour is unchanged. The targeted re-run (architecture, reporting, report assemblers, db-errors: 6 files, 191 tests) passed, then every static check (rows 2–6) and the full suites (rows 7–9) were re-run on the final tree.
- **During development:**
  - The first targeted integration run of `owner-updates.test.ts` failed in `beforeAll`: my fixture set `updateDueDate` = period end, which DG4 refuses (422 `validation.constraint`; the due date must be after the end). This was a test-fixture fix.
  - A second run had 2 test-side failures: a `limit=200` above the API maximum of 100, and an outsider expecting 404. The second exposed a real ordering defect in my code. The write gate ran only inside the transaction, where `commitTimeDenial` turns the read-404 into 403. I added a pre-transaction read check on the request's grants (the KBE-C pattern), so an outsider gets 404 and a read right lost mid-request still gets 403.
  - A third run had 1 assertion-shape fix in the test.
  - The final targeted run of the contract file and `owner-updates.test.ts` passed 81/81 (74 + 7), before the refactor above. Rows 7–9 are the full runs after it.
- **Flaky tests and timeouts:** none in the logs cited.
- **Shell-level events (not checks):** several of my shell commands passed the 600 s foreground limit under load and the harness moved them to the background; each finished and its log is cited. One helper wait loop of mine (task `b9k5bt4mm`, a polling `until` loop with a faulty exit condition, not a check) was stopped by the harness at its background time limit. The checks it waited for had already finished with exit 0 (rows 2–6).

## 5. Contract, schema and dependency needs (for the orchestrator)

1. **No contract change.** The OpenAPI 1.4.0-p5 owner-update schemas were implemented exactly; no operation, schema, parameter or response was added or changed.
2. **Shared schema file outside the literal §F.3 list.** `packages/shared/src/schemas/owner-updates.ts` and its barrel line. §F.3 names no schema file, but rule 14 needs a zod mirror per success body, and FE-E needs the same types. I followed the KBE-C/BE-J precedent (one new shared file plus one appended barrel line). Merge note: the barrel line is an append, and other W9 tasks may append there too; keep both sides.
3. **`portfolio/index.ts` +1 export line** (`submittedUpdatesOfPeriod`, `ownerUpdateDueKey`). `reporting` must read portfolio through its public index (architecture test). The line is additive.
4. **Two refusals not in the ADR-0045 §11 table.** These are existing generic codes, reused rather than invented (rule 15). I propose that ARCH note them in ADR-0045 §11:
   - **422 `validation.reference`** ("The referenced record does not exist in this transformation.", the DG2 generic code and text). Used for a `reportingPeriodId` not of the organization, a `subjectId` that is not a workstream of the transformation, or a transformation subject whose id is not the transformation's. The contract declares 422 for `createOwnerUpdate`.
   - **422 `workstream.archived`** ("This workstream is archived.", the DG4 ADR-0038 code and text). Used when creating an update for an archived workstream.
   - The DG2 code **422 `transformation.archived`** applies, as on every DG2 write.
5. **Interpretations, stated so a reviewer can check them:**
   - **"Each active transformation"** (ADR-0045 §6, the task job) is read as *live*: not archived and not `closed`. Draft and on-hold transformations still report; this is the DG4 period-open job's scope minus closed ones. If the orchestrator wants `status = 'active'` only, it is a one-line change in `apps/worker/src/handlers/reports.ts`.
   - **`owner_user_id`** is the creator, the subject owner at creation, and is never rewritten. Ownership is re-decided at every write against the *current* lead or TL, so a new lead can write and a removed lead cannot.
   - **Reopen** clears `submitted_at`/`submitted_by`, as the 0080 CHECK `owner_update_submit_complete` requires. The revision rows keep every submission's stamps, and the pack cites the last submitted revision of a reopened update.
   - **The pack's metrics** use the pack's period as the dashboard period filter (window = the period; as-of = the earlier of its end and today). This equals the dashboard screen with the same filter.
6. **No dependency need.** No migration need (`0083` stays free).

## 6. User-facing texts made untrue (F-DG4-160), and new keys for their owners

- **Texts made untrue: none found.**
  - I searched the en/ar web catalogues for "planned / not available / later" texts about owner updates, structured updates, the executive pack and update tasks.
  - The only related placeholder is the `transformations/:id/owner-updates` route (`P5_PLANNED_ROUTES`, `nav.p5.notAvailableBody`: "This screen is part of the current release and is being built…"). It stays true, because the screen is FE-E's (`pages/updates/**`) and is not built yet. FE-E replaces it when the screen ships.
  - `nav.p5.ownerUpdates.summary` ("Structured period updates from owners that feed the executive pack.") is now accurate.
  - The work-item kind label `owner_update_due` (en/ar) already exists (F.0).
- **New i18n keys my code emits, with no en/ar text yet.** None is a sentence stored in data; all are keys translated at render time. These are for FE-E and for BE-M/BE-N's export label table:
  - **Work item `messageKey` `reports.task.owner_update_due`**, params `{subjectType, subjectCode, subjectName, periodLabel}`. It needs `myWork.json` `message.reports__task__owner_update_due` in en and ar, e.g. "Submit the structured update of {{subjectCode}} {{subjectName}} for {{periodLabel}}". Until then My Work renders the neutral, true fallback "Structured update due for the reporting period: open the record for details". `myWork.json` is not in my ownership.
  - **Report labels:**
    - `report.executive_pack.{update, metrics, subject, owner, update_state, revision_no, submitted_at, submitted_by, achievements, next_steps, milestones, outcomes, adoption, risks, dependencies, asks, open_raid_risk, open_raid_assumption, open_raid_issue, open_raid_dependency}`;
    - code labels `report.executive_pack.update_state.{submitted, no_update_submitted}` ("No update submitted" / "لم يُقدَّم تحديث", ADR-0045 §6) and `report.executive_pack.owner_state.no_owner` ("No owner");
    - `report.rag_status.{green, amber, red, not_applicable}`;
    - `report.t10_area.{outcomes, value, portfolio, dependencies, decisions, people_adoption}`.
    - Headline fields reuse the DG4 dashboard keys `dashboard.headline.*` unchanged.
  - **Problem codes for the web problem catalogue** (FE-E): `owner_update.not_owner`, `owner_update.exists`, `owner_update.period_not_open`, `owner_update.not_draft`, `owner_update.empty`, `owner_update.not_submitted`. The exact English texts are in ADR-0045 §11 and `OWNER_UPDATE_REFUSALS`.

## 7. What remains

- **Web:** FE-E builds `pages/updates/**` (the screens, the problem-code and message translations listed in §6) and the pack's rendering keys. It is not in this task.
- **Exports:** BE-M/BE-N render the pack to PDF/PPTX/DOCX from this assembler's content and add the label table (§6).
- **Pin:** the orchestrator reconciles the media-type pin with the other W9 deltas (§3).
- **ADR:** the two reused refusals in §5 item 4 go into ADR-0045 §11 as a dated note, if accepted.
- No §F.3 item is left undone; this task has no separable second half.

## 8. Merge instructions

- No migration. No ordering constraint inside W9.
- **Expected conflicts, all additive:**
  - `packages/shared/src/schemas/index.ts` (barrel append);
  - `apps/api/test/integration/contract/contract.test.ts` (media-type pin and comment: sum the W9 increments);
  - `apps/api/src/modules/platform/db-errors.ts` (one function and one call, appended after KBE-C's report lines);
  - `apps/api/src/modules/reporting/reports/assembler.ts` (my registry line and import; KBE-D2 later appends after it).
- BE-M's worker lines for `reports.export` go into `apps/worker/src/{handlers,queues}/reports.ts` after mine (§F.9).
- End time: `Thu Oct 15 04:44:27 UTC 2026` (about 1 h 58 min).
