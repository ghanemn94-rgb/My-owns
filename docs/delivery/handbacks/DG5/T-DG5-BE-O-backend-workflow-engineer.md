# Handback T-DG5-BE-O: meeting presentation, the evidence register and versions (p5-work-split §F.7)

- **Agent:** backend-workflow-engineer
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-O-backend-workflow-engineer-20261016T011130Z-d6d38dac","session_id":"d6d38dac-bab6-40a0-a61b-0eb28e15d059"}`
- **Stage / gate:** P5, DG5 (BUILDING). Worktree `/home/user/wt/dg5-be-o`, branch `dg5/be-o`, base `HEAD` = `cca2ba571e2030f7a35a4667961ca5625543cc80`. The changes are **uncommitted**, for the orchestrator to integrate.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-O.md` (sha256 `7baab72e…1c043`, verified before starting).
- **Time:** started `2026-10-16T01:14:58Z`, ended __END__ (`date -u`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0, at the start and again at the end (`validate-dg4-historical.log`).
- **Product gates.** G1–G6 are business approvals inside the product. Nothing here grants or records one. A pack issue is not an approval. Nothing reads or writes DG0–DG7 records. All test data is synthetic.

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/governance/presentation.ts` | Fills BE-A's stub. Routes `getMeetingPresentation`, with the exact ADR-0045 §11 refusal `presentation.snapshot_mismatch`. Snapshot mode reads `report_snapshot`. Live mode goes through the governance-owned port `setMeetingPackAssembler` (see §5: governance cannot import reporting). |
| `apps/api/src/modules/evidence/register.ts` (new) | Routes `listEvidenceRegister` and `listEvidenceVersions`. `EVIDENCE_LINK_SOURCES` lists `evidence_link` plus the 13 domain link sources. Each list runs in one read-only REPEATABLE READ transaction. |
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

__CHECKS__

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

- No migrations. The change applies cleanly on `cca2ba5`.
- **Expected overlaps:**
  - `evidence/routes.ts`: three small additive hunks (import, route keys, registration line).
  - `governance/presentation.ts`: mine only.
  - `server.ts`: §5.1, the orchestrator's edit.
- **Merge order:** with KBE-D2 (which adds the `meeting_pack` line in `reporting/reports/assembler.ts`), apply §5.1 in the same integration so the pending test passes when it activates.
