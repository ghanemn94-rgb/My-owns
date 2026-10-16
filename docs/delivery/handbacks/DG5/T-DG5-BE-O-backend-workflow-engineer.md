# Handback T-DG5-BE-O: meeting presentation, the evidence register and versions (p5-work-split §F.7)

- **Agent:** backend-workflow-engineer
- **Invocation references:**
  - interrupted first run (T-DG5-BE-O): `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-O-backend-workflow-engineer-20261016T011130Z-d6d38dac","session_id":"d6d38dac-bab6-40a0-a61b-0eb28e15d059"}`;
  - continuation run (T-DG5-BE-OB): `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-OB-backend-workflow-engineer-20261016T030711Z-7046d351","session_id":"7046d351-ced3-41a3-8378-f463f9eaea9b"}`.
- **Stage / gate:** P5, DG5 (BUILDING). Worktree `/home/user/wt/dg5-be-o`, branch `dg5/be-o`.
  - The integration base is `cca2ba571e2030f7a35a4667961ca5625543cc80`.
  - The first run's work sits in the WIP commit `3e3dca9` on top of that base (D-158). The continuation run's changes are **uncommitted**, on top of `3e3dca9`.
  - The orchestrator integrates the diff `cca2ba5..` plus the working tree.
- **Assignments:**
  - `docs/delivery/assignments/DG5/T-DG5-BE-O.md` (first run; sha256 `7baab72e…1c043`, verified by that run);
  - `docs/delivery/assignments/DG5/T-DG5-BE-OB.md` (continuation; sha256 `f818d0af076d55b96c8c2fb3c455fed14ccba79ef04decd1ef724d0cde465923`, verified at the start of this run).
- **Time:**
  - first run: started `2026-10-16T01:14:58Z`, stopped by the container restart at about 03:01Z, with no end line;
  - continuation run: started `2026-10-16T03:12:59Z`, ended `2026-10-16T05:03:15Z` (`date -u`, before the final prettier check).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0.
  - Re-run by the continuation at its start (`validate-dg4-historical-start-B.log`) and at its end (`validate-dg4-historical-end-B.log`).
  - The first run's `validate-dg4-historical.log` is kept for provenance.
- **Product gates.** G1–G6 are business approvals inside the product. Nothing here grants or records one. A pack issue is not an approval. Nothing reads or writes DG0–DG7 records. All test data is synthetic.

## Continuation run (T-DG5-BE-OB)

**The interrupted run.** `DG5-T-DG5-BE-O-backend-workflow-engineer-20261016T011130Z-d6d38dac` was stopped by the container restart at about 03:01Z on 2026-10-16. Its work is the WIP commit `3e3dca9` (D-158). This run finished and confirmed that work. It did not redo it.

**What I found.**
1. **Every file in §1 exists and contains what §1 says.** I read each source file in full, and the tail of each test file. None is truncated:
   - `governance/presentation.ts`: the port, the exact `presentation.snapshot_mismatch` text, snapshot and live modes.
   - `evidence/register.ts`: 15 link-source entries over 14 tables: `evidence_link`, plus 13 domain tables including the agenda materials array. `benefit_evidence` is listed twice (benefit and measurement).
   - `evidence/routes.ts`: three additive hunks.
   - `evidence.test.ts`: 13 routes.
   - `p5-pending-be-o.ts`: `[]` plus `P5_PENDING_TESTS_BE_O`.
   - `p5-exercises-be-o.ts`: 180 lines, ending with the versions refusals.
   - The two integration test files have 9 tests each; the fixtures file is complete.
2. **The handback was a draft with two placeholders:** the end time and the whole of §3 (checks). Both are now filled in from this run's own checks.
3. **The first run's logs** are kept for provenance only. None of them is used as evidence here:
   - `integration.log` is **truncated**: 1,482 lines, no summary and no `exit=` line. The run was cut off mid-suite.
   - `unit-locale-unset.log` and `unit-c-utf8.log` end with **exit 1**. The failures were in files outside my scope:
     - `src/pages/raid/raid.test.tsx` "action register … edit sends If-Match" (an element not found), in both locales;
     - under C.UTF-8 only, `apps/api/src/architecture.test.ts` (a 30 s timeout).
   - The first run's single-file reruns (`unit-*-rerun-*.log`) passed. That run was concurrent with three other W13 tasks, which points to load.
   - This run's full suites passed without those failures (§3).
   - `targeted-presentation-first-run.log` (exit 1) is the first run's first attempt at its new presentation test. It failed on the test's own assertion (`expected undefined to be 'Synthetic: new decision title'`). `targeted-presentation-evidence-register.log` is that run's green rerun after it corrected the test. This run re-ran the final test inside the full integration suite (`integration-B.log`).
4. **No part of §F.7 or of the added scope was left unfinished in code.** Nothing changed in source or tests during this run. The only open item is the one the first run already named: the REQ-S10-013 live test with the real assembler waits for KBE-D2 and the `server.ts` line in §5.1.
5. **The top level of the worktree has empty, read-only, untracked files.** They are `.bashrc`, `.bash_profile`, `.gitconfig`, `.gitmodules`, `.mcp.json`, `.profile`, `.ripgreprc`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`, `.idea`, `.vscode`, all dated 02:05Z.
   - They are sandbox mount points created by the runner, not by me. They are not part of this change; do not integrate them.
   - Prettier checks them (`--ignore-unknown`) and they pass.

**What I re-ran.** Every acceptance check, on the final tree, with real output. The logs carry the `-B` suffix (§3).

**What I changed.** Only this handback, and the new `-B` logs.

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/governance/presentation.ts` | Fills BE-A's stub. Routes `getMeetingPresentation`, with the exact ADR-0045 §11 refusal `presentation.snapshot_mismatch`. Snapshot mode reads `report_snapshot`. Live mode goes through the governance-owned port `setMeetingPackAssembler` (see §5: governance cannot import reporting). |
| `apps/api/src/modules/evidence/register.ts` (new) | Routes `listEvidenceRegister` and `listEvidenceVersions`. `EVIDENCE_LINK_SOURCES` lists `evidence_link` plus the 13 domain link tables (14 entries: `benefit_evidence` twice). Each list runs in one read-only REPEATABLE READ transaction. |
| `apps/api/src/modules/evidence/routes.ts` | The registration line, the two route keys in `EVIDENCE_MODULE_ROUTES`, and two header lines. Nothing else changed: the DG2 upload, review and download paths are untouched. |
| `apps/api/src/modules/evidence/evidence.test.ts` | Unit test: the module now registers 13 routes (was 11), and both new routes declare `transformation.read`. |
| `apps/api/test/support/p5-pending-be-o.ts` | Pending operations list is now `[]`. Adds `P5_PENDING_TESTS_BE_O`: the REQ-S10-013 live test stays pending until KBE-D2 merges (the BE-J precedent). |
| `apps/api/test/integration/contract/p5-exercises-be-o.ts` | Contract exercises for the 3 operations (success and every reachable refusal), with strict zod mirrors of the three OpenAPI components. |
| `apps/api/test/integration/governance/presentation.test.ts` (new) | Integration tests for REQ-S10-013 and presentation authorization (9 tests; 1 runs only once a `meeting_pack` assembler exists). |
| `apps/api/test/integration/governance/presentation-fixtures.ts` (new) | `storeMeetingPack`: stores a synthetic `meeting_pack` snapshot the way the generate route does, from a real generated charter snapshot's context, with its audit event. Also `decisionSection`. |
| `apps/api/test/integration/evidence/evidence-register.test.ts` (new) | Integration tests for REQ-S13-010, register authorization, and a catalogue completeness check (9 tests). |
| `docs/delivery/handbacks/DG5/T-DG5-BE-O-backend-workflow-engineer.md`, `…/T-DG5-BE-O-evidence/*.log` | This handback and its logs. |

- **Migrations:** none. §F.8's `0083` and `0084` are not mine and were not taken.
- **Dependencies:** none added.
- **Shared and contract files:** `packages/shared`, `docs/api/openapi.yaml` and `server.ts` are unchanged.

## 2. Behaviour delivered, per requirement row

### REQ-S10-013

Acceptance: *"A15: changing a linked decision before cut-off changes the presentation; the issued pack remains the snapshot"*. Rule: *"Presentation and print views render live or snapshot records; no copy is edited separately"*. §F.7 literal tests: *"changing a linked decision before cut-off changes the live presentation; the issued meeting-pack snapshot still returns the old decision; a snapshot of another meeting → 422 `presentation.snapshot_mismatch`"*.

**Route:** `GET /api/v1/transformations/{transformationId}/meetings/{meetingId}/presentation[?snapshotId=]` → `MeetingPresentation {meetingId, mode, snapshotId, document}`. It is read-only and writes no rows and no audit events (tested).

**Snapshot mode** (`?snapshotId=`) returns the stored `content` of the snapshot, unchanged.
- The snapshot must be a `meeting_pack` with `subject_type = 'meeting'` and the path's meeting id. Otherwise: 422 `presentation.snapshot_mismatch` with the exact text "This snapshot is not a pack of this meeting." This covers a pack of another meeting and a charter snapshot.
- An unknown snapshot, or one of another transformation, returns 404. It never reveals that the snapshot exists.
- **Tested:** the meeting pack is issued through the real issue route. The linked decision is then renamed through the DG4 PATCH. The presentation of that snapshot still returns the old decision text, with the document byte-equal to what was stored, while the decision itself shows the new title.

**Live mode** (no `snapshotId`) returns the `meeting_pack` document assembled at request time, through the same reporting assembler as the printable pack (no separate copy).
- Live mode answers 404 while no `meeting_pack` assembler is wired. This matches `getLiveReport` for an output without an assembler.
- **Tested:** the port plumbing, with a stub assembler. Its document is read at request time, so a renamed decision shows the new title.
- **Pending:** the literal "changing a linked decision changes the live presentation", run with the real assembler. KBE-D2's `meeting_pack` assembler has not merged.
  - The test is written. It runs automatically (`it.runIf(assemblerOf("meeting_pack") !== undefined)`): agenda item with `decisionId` → live contains title 1 → generate and issue `meeting_pack` → rename → live contains title 2 and the issued snapshot still contains title 1.
  - It is listed in `P5_PENDING_TESTS_BE_O`.
  - **It also needs the `server.ts` wiring line in §5.** Without that line it will fail as soon as KBE-D2 merges. That is deliberate, so the gap cannot pass silently.

### REQ-S13-010

Acceptance: *"A01;A12: an uploaded file stores a SHA-256 checksum and version 1; a second upload becomes version 2"*. Rule: *"Evidence items are stored with these fields; new uploads create versions"*. §F.7 literal tests: *"an uploaded file appears in the register with its SHA-256 and version 1; a second upload makes version 2, and the versions list shows both with their checksums and upload times; a note shows no checksum and 'Not stated' for a missing source; a reader without `transformation.read` → 403; AUD reads."*

**`GET …/evidence-register`** returns one row per evidence item of the transformation. Each row carries the M0255 fields: linkage (`links`), type, source, owner, observation period, upload date, version (`currentRevision` for files, plus `recordVersion` for every item), checksum (`sha256`, files only), review and accessibility status, and item `status`.
- Pagination is a cursor, newest first. Filters: `reviewStatus`, `evidenceType`, `recordType`. The `recordType` filter keeps items with an active link of that type.
- **Upload date:** the current revision's `uploaded_at`; for notes and links, the item's `created_at` (ADR-0045 §8).
- **Links:** every active link across `evidence_link` and the domain link tables:
  - `form_record_attachment`, `benefit_evidence` (benefit and measurement), `kpi_actual_evidence`, `bau_handover_evidence`, `phase_step_evidence`;
  - `diagnostic_workstream_output`, `gate_dispensation` (pending or accepted), `rag_override`, `inherited_record`, `gate_condition_closure`;
  - `day_ninety_response`, `health_assessment_answer`;
  - the DG4 agenda materials array (`agenda_item.materials_evidence_ids`, not withdrawn).
- Removed, revoked, withdrawn and archived link rows are excluded. A catalogue test checks that every table with a foreign key to `evidence` is a link source or a stated exclusion (`evidence_content`, `report_snapshot_evidence`).

**`GET …/evidence/{evidenceId}/versions`** returns every content revision, newest first: revision, SHA-256, size, content type, file name, uploader and upload time. Pagination is a cursor. An item of another transformation, or an unknown item, returns 404.

**Tested:**
- A file shows SHA-256 and revision 1 after one upload. After a second upload it shows revision 2 with the new SHA-256.
- The versions list is `[2, 1]`, each with its own checksum, size, file name, uploader and upload time, and equals the DG2 `evidence_content` rows. The register's upload date equals revision 2's.
- A note has `sha256: null`, `currentRevision: null`, and `source`/`observationStart`/`observationEnd` all `null`. Its versions list is empty.
- A link created through the DG4 agenda appears; a removed `evidence_link` disappears. The filters and pagination work, and a cursor from other filters returns 400.
- Neither read writes anything.

**"Not stated":** the API returns `null` for a missing source or observation period, never a blank or an invented value. The OpenAPI component says null "is shown as Not stated". The words "Not stated" are rendered by the views (FE-E's evidence register screen, §F.10 "Completes with FE-E"). No web screen exists yet in my scope.

### Authorization (both rows)

`transformation.read` in the transformation (the parent-record rule, ADR-0045 §7–§9).
- **AUD reads** all three operations (tested).
- **A caller who holds `transformation.read` nowhere gets 403** (`holdsAnywhere`, the BE-D/BE-M precedent). This is the literal "a reader without `transformation.read` → 403".
- **A caller who holds it only in another scope** (TO of organization B) **gets 404**: the DG1 read rule, no existence leak.
- Anonymous callers get 401. Malformed input gets 400 (strict query objects, UUID params, enum filters, cursor). Tested for each operation.
- None of these operations is a mutation, so `If-Match`, audit and commit-time re-authorization do not apply. The tests prove they write nothing (the audit count is unchanged).

## 3. Checks actually run (logs in `docs/delivery/handbacks/DG5/T-DG5-BE-O-evidence/`)

All commands were run by the continuation run T-DG5-BE-OB on the final tree, which is `3e3dca9` plus this handback and its logs; no source or test file changed in this run.
- **Environment:** Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, in the worktree `/home/user/wt/dg5-be-o`. Harness ports were in 24900–24949 only.
- **Logs:** every log below is this run's own (`-B` suffix). It starts with its `date -u` and ends with the real `exit=` line.
- **Older logs:** the logs without `-B` are the interrupted first run's, kept for provenance only (see the continuation section).

| # | Command | Log | Exit | Result |
|---|---|---|---|---|
| 4 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | `validate-dg4-historical-start-B.log` | 0 | `PASS gate DG4 (historical)` |
| 1 | `pnpm -r typecheck` | `typecheck-B.log` | 0 | every package `Done` |
| 1 | `pnpm -r build` | `build-B.log` | 0 | every package `Done` |
| 1 | `pnpm lint` (`eslint . --max-warnings=0`) | `lint-B.log` | 0 | no output, no warning |
| 1 | `pnpm openapi:lint` | `openapi-lint-B.log` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | `prettier-B.log` | 0 | `All matched files use Prettier code style!`. Run twice on the final tree, with this handback included; run 2 follows the last edit of this cell. Both runs are in the log |
| 2 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (locale unset) | `unit-locale-unset-B.log` | 0 | unit-node 127 files / **2099 passed**; unit-web 74 files / **1429 passed**; unit-formula-nocodegen 3 files / **259 passed, 2 skipped** (261). 0 failed |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | `unit-c-utf8-B.log` | 0 | the same counts: 2099 / 1429 / 259 passed + 2 skipped. 0 failed |
| 3 | `QA_PG_PORT=24901 MTH_PORT_POOL=24902-24949 tests/qa/support/with-pg.sh pnpm test:integration` | `integration-B.log` | none (stopped) | **stopped by the tool's 30-minute background limit, not by a failure.** 250 of 260 files had reported: 2470 tests, **2469 passed, 1 skipped, 0 failed** |
| 3 | the same harness on the 10 files not yet reported (ports 24910/24911-24949) | `integration-rest-B.log` | 0 | **10 files, 24 passed**, 0 failed |
| 3 | `QA_PG_PORT=24920 MTH_PORT_POOL=24921-24949 tests/qa/support/with-pg.sh pnpm test:integration` (full single invocation) | `integration-full-B.log` | 0 | **260 files passed; 2494 tests: 2493 passed, 1 skipped, 0 failed** (04:34:37Z–05:01:26Z). This is the acceptance run |
| 4 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | `validate-dg4-historical-end-B.log` | 0 | `PASS gate DG4 (historical)` |

**Disclosures:**
- **Unit skips.** The 2 skipped unit tests are in `packages/shared/src/formula/fuzz.test.ts`. They are pre-existing, outside my scope, and skipped the same way in the first run's logs.
- **Integration skip.** The 1 skipped integration test is the pending REQ-S10-013 live test in `presentation.test.ts` (`it.runIf(assemblerOf("meeting_pack") !== undefined)`). It is listed in `P5_PENDING_TESTS_BE_O` and starts running once KBE-D2 merges (§2, §7).
- **My new tests**, with the same counts in `integration-B.log` and `integration-full-B.log`:
  - `governance/presentation.test.ts`: 9 tests, 8 passed, 1 skipped;
  - `evidence/evidence-register.test.ts`: 9 passed;
  - `contract/contract.test.ts`: 78 passed, including the three BE-O exercises and the empty pending list;
  - the DG2 `evidence.test.ts`: 6 passed.
- **Pinned counts:** unchanged. The operation count is 846 and the media-type triple delta is 0 (§4).
- **Process failures in this run, both disclosed:**
  1. A first C.UTF-8 unit start at 03:34:04Z was killed together with its shell, because it was backgrounded with `&`, before Vitest printed anything. The full re-run is the one in `unit-c-utf8-B.log`, and that log says so.
  2. The first integration invocation was stopped at the 30-minute background limit. It is annotated at its end.

## 4. Operations routed (delta to `p5-pending-be-o.ts`)

| Operation | Before | After | Exercised in `p5-exercises-be-o.ts` |
|---|---|---|---|
| `getMeetingPresentation` | pending | routed (`governance/presentation.ts`) | 200 (snapshot as TL and AUD; live through the port), 400, 401, 403, 404 (other organization; unknown meeting), 422 `presentation.snapshot_mismatch` |
| `listEvidenceRegister` | pending | routed (`evidence/register.ts`) | 200 (TL; AUD with filters), 400, 401, 403, 404 |
| `listEvidenceVersions` | pending | routed (`evidence/register.ts`) | 200 (file; note = empty), 400, 401, 403, 404 (other organization; unknown item) |

- `P5_PENDING_BE_O` is now `[]`. The 429 response is not reachable here (the rate limiter has its own suite).
- **Pinned counts in `contract.test.ts`:**
  - operation count: unchanged (846);
  - media-type triple: delta **0** (three bodiless GETs);
  - rate-limit floor: unchanged (`>=`; three more routes).

## 5. Contract, schema and wiring needs (for the orchestrator)

1. **Composition-root line in `apps/api/src/server.ts` (not in my file list; not edited).**
   - **Why:** `reporting` depends on `governance` (modules.ts), so `governance/presentation.ts` cannot import the reporting assembler. Doing so would close a module cycle. The live mode therefore uses a port, following the `setWorkflowsReadPort` precedent.
   - **Proposed lines**, next to the other P5 wiring:
     ```ts
     import { setMeetingPackAssembler } from "./modules/governance/presentation.ts";
     import { assemblerOf } from "./modules/reporting/reports/assembler.ts";
     import { assembleReport } from "./modules/reporting/reports/snapshots.ts";
     // T-DG5-BE-O (ADR-0045 §7): the live presentation of a meeting is reporting's meeting_pack document.
     setMeetingPackAssembler(async (db, { transformationId, meetingId }) =>
       assemblerOf("meeting_pack") === undefined
         ? null
         : (await assembleReport(db, { definitionCode: "meeting_pack", transformationId, subjectId: meetingId, parameters: {} })).document,
     );
     ```
   - **Effect:** the snapshot mode works without it. Without it, the live mode answers 404 even after KBE-D2 merges, and my pending REQ-S10-013 test fails then, by design.
2. **Zod mirrors.** `@mth/shared/schemas` has no mirror of `MeetingPresentation`, `EvidenceRegisterPage` or `EvidenceVersionPage`. Strict mirrors that follow the OpenAPI components exactly are in `p5-exercises-be-o.ts`, because `packages/shared` is outside my files. I propose promoting them to `packages/shared/src/schemas/` (FE-E will want them); otherwise they stay in the test file.
3. **Problem code i18n.** `presentation.snapshot_mismatch` (ADR-0045 §11, used verbatim) needs its en/ar web key. Per shared rule 6 and §F.11 item 10, FE-E adds the web keys; the `report.*` codes are in the same position.
4. **No new problem code, migration, dependency or contract change.**

## 6. User-facing texts made untrue

None found. I searched `apps/web/src/i18n/{en,ar}` and `apps/web/src` for "planned", "later", "coming" and "not yet" next to presentation, evidence register, checksum, meeting, pack and print.
- The existing texts are true: nav "Presentation mode: Present and print packs from the same records."; "Evidence register"; "Open the evidence register".
- `app/nav.ts` already states that no area has been "planned" since P5.
- The only stale text was the stub comment in `presentation.ts` ("registers nothing"), which is replaced.

## 7. What remains

- **REQ-S10-013, live mode with the real assembler:** blocked on KBE-D2 (the `meeting_pack` assembler) and on the `server.ts` line in §5.1. The test is written and runs on its own once the assembler exists; it is listed in `P5_PENDING_TESTS_BE_O`.
- **FE-E:** the presentation and evidence-register screens, including rendering `null` as "Not stated" in en and ar (§F.10; the Arabic wording is FE-E's i18n key).
- Nothing else in §F.7 is open.

## 8. Merge instructions

- No migrations.
- **What to integrate:** the diff from `cca2ba5` to the working tree, which is the WIP commit `3e3dca9` plus this run's uncommitted handback and `-B` logs. It applies on `cca2ba5`.
  - Do not take the empty top-level sandbox files listed in the continuation section.
  - The first run's logs without `-B` are provenance. Keep or drop them as D-158 decides.
- **Expected overlaps:**
  - `evidence/routes.ts`: three small additive hunks (import, route keys, registration line).
  - `governance/presentation.ts`: mine only.
  - `server.ts`: §5.1, the orchestrator's edit.
- **Merge order:** with KBE-D2 (which adds the `meeting_pack` line in `reporting/reports/assembler.ts`), apply §5.1 in the same integration so the pending test passes when it activates.
