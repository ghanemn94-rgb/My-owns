# Handback T-DG4-ARCH-R2 (solution-architect): P4 architecture repairs, round 2

- **Stage:** DG4 (BUILDING), branch `claude/mobily-transformation-platform-regate`, base `HEAD` `a8bcf5d1409005ae725538ca30764fcf340e16d2`, main tree. The changes are **uncommitted**, for the orchestrator to integrate.
- **Invocation:** `DG4-T-DG4-ARCH-R2-solution-architect-20261010T013224Z-75fcc0b3` (session `75fcc0b3-b47b-4ca6-9df1-95838b0ae528`). The assignment's sha256 `34f018e547d684f99705d9ec22dece2abbad5675ca01ea6a54cfdcbdcc1b9fc1` was verified with `sha256sum` before I started.
- **Time:** start `Sat Oct 10 01:32:33 UTC 2026`, end `Sat Oct 10 02:26:35 UTC 2026`, about 54 minutes (`date -u`; `evidence/start-time.txt`, `end-time.txt`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` printed `PASS gate DG3 (historical)` and exited 0. I ran it first, before any edit; §3 has the re-run at the end.
- **Two gate systems.** Nothing here reads or writes DG0–DG7 records other than this handback and its evidence. Product gates G1–G6 and the Modular G3 waiver are business approvals inside the product. No document, test or script of this task grants one. Product G6 never implies DG7.
- **Ports and disk.** Integration used ports 23700–23749 only. Disk was 22 GB free (`df -h .`) before each full run.
- **Untracked files I did not create.** The top-level untracked files (`.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`) and the other agents' `docs/delivery/runs/DG4/*` folders were already present at the start (`git status` before any edit). I left them untouched. The format check below ran over them as well (`git ls-files -co`) and passed.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0021-p3-portfolio-initiative-lifecycle-g4.md` | Amendment W1–W7: the Modular G3 waiver of the missing-links precondition (item 1) |
| `docs/architecture/adr/ADR-0038-p4-traceability-orphans-allocation-impact-modular.md` | Amendment B0–B4: §7.4 decided and corrected (item 2), the gate side of the waiver (item 1), `getInheritedRecord` (item 3), codes (item 8) |
| `docs/architecture/adr/ADR-0030-p4-benefit-values-finance-validation-totals.md` | Amendment P1: `getBenefitPlanValue` (item 4) |
| `docs/architecture/adr/ADR-0027-p4-kpi-data-model-and-pipeline.md` | Amendment C1–C3: formula lineage shape (item 5), §8 step 4 as built (item 7), `kpi.recalculate_failed` (item 8) |
| `docs/architecture/adr/ADR-0028-p4-kpi-calculation-semantics.md` | Amendment: pointer from §8 to the lineage shape (item 5) |
| `docs/architecture/adr/ADR-0032-p4-forums-meetings-t16-escalation.md` | Amendment G1–G2: the governance → raid dependency (item 6), BE-F2's codes and keys (item 8) |
| `docs/architecture/adr/ADR-0025-p4-calendar-time-jobs-work-items.md` | Amendment D1–D4: the worker passes the attempt; reschedule/reassign, the `#n` suffix and `work_item.reschedule`; the neutral `work_item.system_managed` text (item 7) |
| `docs/architecture/adr/ADR-0026-p4-groups-delegation-approvals-t11-t12.md` | Amendment E1–E6: A2–A4 as built (item 7) |
| `docs/architecture/adr/ADR-0031-p4-raid-actions-corrective-execution.md` | Amendment F1–F3: the §11 duplicate-case mapping is now 500; the follow-up task; `#n` keys (item 7) |
| `docs/api/openapi.yaml` | Two new GET operations (`getInheritedRecord`, `getBenefitPlanValue`), four dispensation description lines, the `KpiEvaluation.inputs` description, and one info paragraph. 647 → 649 operations. Every changed line is in §5 |
| `apps/api/test/support/p4-pending-arch-r2.ts` (new) | Pending list for the two new operations |
| `apps/api/test/support/p4-pending.ts` | Imports that list (one import line, one spread line, one comment word change) |
| `apps/api/test/support/p4-operations.ts` | The two new operation ids in the P4 set (keeps the P2-scoped sweeps on their scope; the ARCH-R1 precedent) |
| `apps/api/test/integration/contract/contract.test.ts` | Operation-count pin 647 → 649, with its comment line. The media-type pin is unchanged: both new operations are GETs with no request body |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-R2-evidence/**` | Logs, the module-graph proof (`module-graph.mjs`, output), the code scan and its diff against ARCH-R1, the contract diff |

**Not changed:**
- No migration. `0061` is not written, because no item needs a schema change (§2 item 1, W1; item 5, C1).
- No ERD or data-dictionary change, because no table, column or constraint changes.
- No application source under `apps/*/src` or `packages/*/src`. Every behaviour change is specified for the implementer tasks in §6.

## 2. Decisions, item by item

### Item 1. The Modular G3 waiver (D-110 option a): ADR-0021 amendment W1–W7 and ADR-0038 amendment B1

- **Exact condition (W1).** `createGateDispensation` accepts `kind = 'waiver'` on a Modular transformation only when `gateCode = 'G3'` and the body has no `initiativeId`.
  - **The code change is one condition.** `if (t.mode !== 'end_to_end')` becomes `if (t.mode !== 'end_to_end' && !(body.gateCode === 'G3' && body.initiativeId === undefined))`.
  - **Every later check runs unchanged, in order:** `waiver_gate`, `waiver_incomplete`, `waiver_shape`, the initiative check, `expired`, `gate_approved`.
- **What stays byte-identical:**
  - every other Modular waiver: G1, G2, and G3 with an initiative still answer 422 `dispensation.waiver_requires_end_to_end` with the DG3 text;
  - every End-to-End response;
  - every other dispensation response;
  - the `GateDispensation` schema.
- **What it covers (W2).**
  - It covers only `gate.modular_links_missing` (`baseline_missing`, `outcome_link_missing`).
  - It never covers a G3 criterion: criteria read only `gate_exception`.
  - It is never an approval and never supplies the links: the report keeps listing them.
  - It has no launch-sequencing effect, because `checkDirectionForLaunch` returns OK for every Modular transformation before it reads any dispensation.
  - Deciding it is unchanged: G3's configured approver, never the recorder, never delegated.
- **Expiry (W3).**
  - At submission and at approval, the waiver counts while `expires_on >= exceptionBusinessDate`, BE-K2's database clock (`p4_business_date(now(), timezone)`). The expiry date itself is included.
  - Creation and acceptance keep the DG3 `todayIn` checks.
  - The list's `counts` uses `todayIn` (the API host clock). That difference is stated in the ADR, not changed, because changing it would change DG3 responses.
- **Audit (W4).**
  - The existing `gate_dispensation.create`, `decide` and `revoke` events are unchanged.
  - Use at submission is recorded in the G3 snapshot member `modularLinks` (B1). The snapshot's SHA-256 is in `gate_submission.snapshot_sha256` and in the `gate_submission.create` audit event.
  - No new audit action.
- **Gate side (B1).**
  - **Which waiver.** When several are in force, the one with the latest `expires_on` is used, ties broken by the greatest `id`. The query gets `ORDER BY` for this; today it has no order.
  - **Snapshot member.** `modularLinks: {missing[], waiver: {dispensationId, expiresOn, reason, decidedBy}}`, written only when a waiver let the submission through.
  - **At approval** (approve only, after the exception checks): a recorded waiver that is revoked gives 422 **`gate.modular_waiver_revoked`**, and one that has expired gives 422 **`gate.modular_waiver_expired`**. Reject, request changes and defer stay allowed.
  - A snapshot without the member is unchanged and reads nothing more.
- **Refusal codes (W5, B4):**
  - no new code on the dispensation route;
  - two new gate codes, with exact texts in §4;
  - `dispensation.waiver_requires_end_to_end` is recorded in an ADR for the first time.
- **Contract change.** Description text only (§5). No schema change: the snapshot is `{type: object}` in the contract, and no DB CHECK or trigger reads its members.
- **The proof BE-R3 owes.** Byte identity by the BE-M2 A/B method, plus the new tests of W7 (§6).

### Item 2. ADR-0038 §7.4 corrected (B0, B2)

- §7.4 is decided (D-106 (e)), no longer a candidate.
- **Scope:** G3 only. Mobilize-or-later Modular entries never submit G3. Their G4 keeps `gate.out_of_sequence`.
- **Order:** the precondition runs after the sequence check **and after the criteria check** (exception coverage included). The reason is `dg2-repairs.test.ts:461`.
- **The pure rule** lives in `packages/shared/src/schemas/missing-links.ts`. `traceability/missing-links.ts` does not exist.

### Item 3. `getInheritedRecord` (B3)

- `GET /api/v1/transformations/{transformationId}/inherited-records/{inheritedRecordId}`, `transformation.read`.
- 200 `InheritedRecord` with `ETag`, for an active **or withdrawn** row.
- 404 for anything else, including a `prior_approval` entry, which is a dispensation. 400, 401, 429.
- Pending in `p4-pending-arch-r2.ts`. BE-R3 routes it.

### Item 4. Plan-value version (ADR-0030 amendment P1)

- **Decided: a plan-value read**, `getBenefitPlanValue`: `GET /api/v1/transformations/{transformationId}/benefit-plan-values/{benefitPlanValueId}`, on the PATCH's existing path, `transformation.read`, 200 `BenefitPlanValue` with `ETag`, 404/400/401/429.
- **Not `version` on `BenefitValueLine`.** That would change an existing response and a schema shared with measurement lines, and the line lacks `note` and `valueKind` for an edit form anyway.
- **It also makes `createBenefitPlanValue`'s `Location` resolve.** Pending in `p4-pending-arch-r2.ts`. A kpi-benefits-engineer task routes it.

### Item 5. Formula lineage (ADR-0027 amendment C1; ADR-0028 amendment)

- **Decided: store it; do not leave lineage at the input-value level.** REQ-S08-006 says "any displayed number can show its lineage … input actual versions".
- **The shape, per formula evaluation:** `sources` keyed by variable. Each entry is `{kpiDefinitionId, kpiVersionId, inputBasis, scopeKind, scopeId, reportingPeriodId, valueSource, valueStatus, value, inputs}`, where `inputs` is the source slot's own lineage. So an entered source gives `{kpiActualId, valueNo, window?}`, and a formula source nests.
- **Roll-ups** gain `entries[{scopeId, kpiActualId, valueNo}]`.
- **Binding-only sources** (KBE-R1) produce the same shape.
- **No migration:** the column is `jsonb` with an object CHECK. **The contract** gets a description only. **Exposure** in the drill-down is not claimed.

### Item 6. Governance → RAID (ADR-0032 amendment G1)

- **Decided: add `raid` to `governance.dependsOn`** and retire the copy. `raid/actions.ts` exports `insertActionItem(ctx, link | null, body)`, the insert plus `action_item.create`. `createLinkedAction` wraps it, unchanged.
- **Governance calls `insertActionItem` instead of its copy.** It keeps its own owner check and refusal (`validation.user_unknown`), its link row and its `meeting_action_due` task.
- **Acyclicity proven mechanically** (`evidence/module-graph.mjs`, exit 0):
  - the graph is acyclic as it is, and with `governance → raid`;
  - `raid` does not reach `governance` today;
  - with both edges, there is a cycle (governance, raid, reporting, sustainment), so `raid` must never import `governance`.
- **Rejected: keep the copy with a parity test.** It detects drift only after the fact and only on the fields it compares.
- **The carried-forward "meeting action task follows later edits"** stays BE-R3's. It needs no reverse import.

### Item 7. ADR text that no longer matched the build

- **ADR-0025 (D1–D4):**
  - the worker passes `{retryCount, retryLimit}` (`includeMetadata: true`), and the last attempt is `retryCount >= retryLimit`;
  - `rescheduleWorkItemsOfSubject` and `reassignWorkItemOfSubject`, with their checks, audit events (`work_item.reschedule` with `changes.due_date`; `work_item.cancel` with reason `reassigned`), the `<key>#n` suffix (n ≥ 2, at most 100), the worker twins and the parity test.
- **`work_item.system_managed` (D3).** Decided neutral text: "This task closes automatically when the record it belongs to is decided or closed." The code, status and kinds are unchanged. BE-R3 changes the API text and FE changes the EN/AR keys.
- **ADR-0026 (E1–E6):**
  - `approval.subject_unknown` (pointer `/subjectId`) on resubmit;
  - the denial audit on `approval.not_requester`;
  - requester-only round-2 submit and withdraw on the three subjects;
  - the `bindServices` hook;
  - the server-written withdraw reasons "Change request {code} withdrawn." and "Transition decision {code} withdrawn.", decided as kept;
  - the matrix round-2 201 with `Location` = the existing approval, and the round-2 `title` ignored.

  All of these are accepted as built.
- **ADR-0027 §8 (C2):** the attempt source, the failed run with `kpi.recalculate_failed`, and replays answering `already_run`.
- **ADR-0031 §11 (F1):** `corrective_case_one_open_key` → 500. The client still sees 409 `corrective_case.already_open` with the real code from `createCorrectiveCase`.

### Item 8. Codes added since ARCH-R1

- **Method.** I took every code that BE-F2 §6, BE-M2 §0.5 and KBE-R1 report, plus the new codes of items 1–6. I also re-ran ARCH-R1's mechanical scan (`evidence/codes-scan.py`, the same script; output `codes-scan-output.txt`) and diffed its hits against ARCH-R1's own output (`codes-new-since-arch-r1.txt`).
- **What the diff found.** It finds exactly these codes or keys, besides SQL column aliases and audit actions:
  - the 8 BE-F2 refusal codes;
  - the 2 BE-F2 message keys;
  - `inherited_record.record_not_found`;
  - `kpi.recalculate_failed`.
- **Coverage limit.** The `gate.modular_links_missing` item messages are not dotted literals, so I took them from BE-M2 §0.5 and `missing-links.ts`. A code reached only through a variable that neither the handbacks nor the scan finds is not covered; none is known.
- **The table is in §4.**

## 3. Checks actually run

All in the main tree (`/home/user/My-owns`), Node 24, offline. Logs under `docs/delivery/handbacks/DG4/T-DG4-ARCH-R2-evidence/`. They were kept in `$TMPDIR` until the integration suite finished, then copied (the ARCH-R1 lesson: the G6 test asserts nothing under `docs/delivery/` changes while it runs). The ADR and contract edits were made before any suite ran.

| Check | Command | Result |
|---|---|---|
| Historical DG3 (start) | `node tools/gates/validate.mjs --historical --stage DG3` | exit 0, `PASS gate DG3 (historical)`, run first, before any edit (`validate-dg3-historical-start.log` is transcribed from that output and labelled as such, because the evidence folder did not exist yet) |
| Module graph proof (item 6) | `node docs/delivery/handbacks/DG4/T-DG4-ARCH-R2-evidence/module-graph.mjs` | exit 0, `RESULT: PASS` (`module-graph-output.txt`). The first version of the script exited 1, because its reverse-edge check was wrong: `raid → governance` alone is acyclic. I corrected it to check both edges together, which closes a cycle, and corrected the ADR-0032 G1 sentence to match. That first output is not kept |
| OpenAPI | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 649 operations` (`openapi-lint.log`) |
| Typecheck | `pnpm -r typecheck` | exit 0 (`typecheck.log`) |
| Build | `pnpm -r build` | exit 0 (`build.log`) |
| Lint | `pnpm lint` | exit 0, `--max-warnings=0` (`lint.log`) |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (`format.log`). Run before the handback and evidence existed; the handback and the evidence `.md`/`.mjs` files were checked separately afterwards (last row) |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | exit 0: 123 files / **2352 passed**; 3 files / **259 passed, 2 skipped** (`unit-locale-unset.log`). Unchanged from D-110, as expected: no unit test was added |
| Unit, `C.UTF-8` | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0: the same counts (`unit-c-utf8.log`) |
| Integration, run 1 | `QA_PG_PORT=23700 MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 1**: 175 files, **1660 passed, 1 failed** of 1661 (`integration-run1-interfered.log`). The failure: `g5-g6.test.ts` › "G6 Sustain … writes nothing under docs/delivery/". The test hashes every file under `docs/delivery/` before and after a G6 approval. The **only** differing entry is `runs/DG4/DG4-T-DG4-BE-M3-backend-workflow-engineer-…/transcript.jsonl`, the live transcript of the concurrent BE-M3 agent run, which the runner appends to while that agent works. No file of this task changed during the suite: the logs stayed in `$TMPDIR`, and I made no edit under `docs/delivery/`. **Interference, not a product defect.** |
| Integration, the failing file alone | `QA_PG_PORT=23700 MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh pnpm vitest run --project integration apps/api/test/integration/workflows/g5-g6.test.ts` | exit 0: 1 file, **13 passed** (`integration-g5-g6-rerun.log`) |
| Integration, run 2 (full re-run) | same as run 1 | **exit 1**: again **1660 passed, 1 failed** of 1661, the same test, again differing only on BE-M3's live `transcript.jsonl` (`integration-run2.log`) |
| Historical DG3 (end) | `node tools/gates/validate.mjs --historical --stage DG3` | exit 0, `PASS gate DG3 (historical)` (`validate-dg3-historical-end.log`) |
| Format of the handback and evidence | `npx prettier --check` on this handback, `evidence/module-graph.mjs` and `evidence/codes-table.md` | exit 0, run last, on the final files (`format-handback.log`) |

**What acceptance 3 shows, stated exactly.**
- The full integration suite did **not** exit 0 in this run: twice, 1660/1661.
- The one failure is the `docs/delivery/` tree check. Both times it was tripped by a concurrent agent's run transcript, which this task cannot stop.
- The failing file passes on its own (13/13).
- The other 1660 tests pass, including every contract test with the 649-operation pin and the two new pending operations.
- **I do not claim a clean exit 0.** The orchestrator's merged-tree run, with no agent running, is where this check can pass cleanly. The count is 1661 = D-110's 1661, as expected, because no integration test was added.
- No test was skipped, retried inside a run, or marked flaky.

## 4. Extended code table (continues ARCH-R1's 1–163)

"server" texts are what the API already sends, or will send once BE-R3 implements them; placeholders are named. "authored" texts are written here, because the server sends only the key or stores only the code. Arabic is for FE to write, marked provisional until it is linguistically reviewed.

| # | Code or key | Kind | Owning ADR | Decision | English text | Text origin | Where (as built, or to build) |
|---|---|---|---|---|---|---|---|
| 164 | `dispensation.waiver_requires_end_to_end` (at `/kind`) | 422 | ADR-0021 W5 | recorded (DG3 code; unchanged; now only for Modular waivers that are not Modular-links waivers) | A waiver applies to the End-to-End launch sequencing; a Modular transformation is not held to it. | server | api portfolio/dispensations.ts |
| 165 | `gate.modular_links_missing` | 422 | ADR-0038 §12, B4 | accepted (decided D-106 (e)) | Modular entry: supply the missing baseline and outcome links, or record an authorized waiver, before submitting this gate. | server | shared schemas/missing-links.ts; api workflows/gates.ts |
| 166 | `baseline_missing` (an `errors[]` item of 165, at `/baseline`) | 422 error item | ADR-0038 B4 | accepted (BE-M2) | No active baseline with a value is recorded. | server | shared schemas/missing-links.ts |
| 167 | `outcome_link_missing` (an `errors[]` item of 165, at `/outcomes`) | 422 error item | ADR-0038 B4 | accepted (BE-M2) | No active outcome has an active KPI. | server | shared schemas/missing-links.ts |
| 168 | `inherited_record.record_not_found` (at `/evidenceId` or `/baselineId`) | 422 | ADR-0038 B4 | accepted (BE-M2) | The evidence item or baseline does not exist in this transformation or is archived. | server | api reporting/modular.ts |
| 169 | `gate.modular_waiver_revoked` | 422 | ADR-0038 B1, B4 | **new** (BE-R3) | The waiver of the missing baseline and outcome links was revoked on {date}; supply them or record a new waiver, then resubmit G3. | server (to build) | api workflows/gates.ts (decideGate, approve) |
| 170 | `gate.modular_waiver_expired` | 422 | ADR-0038 B1, B4 | **new** (BE-R3) | The waiver of the missing baseline and outcome links expired on {date}; supply them or record a new waiver, then resubmit G3. | server (to build) | api workflows/gates.ts (decideGate, approve) |
| 171 | `kpi.recalculate_failed` | stored `calculation_run.error_code` | ADR-0027 C3 | accepted (KBE-R1) | The calculation failed after its last retry; the last calculated status is still shown. | authored | worker handlers/kpi.ts |
| 172 | `work_item.system_managed` | 422 | ADR-0025 D3 | **text changed** (BE-R3 API, FE keys) | This task closes automatically when the record it belongs to is decided or closed. | server (to change) | api tasks/routes.ts |
| 173 | `work_item.reschedule` | audit action | ADR-0025 D2, D4 | accepted (BE-R1) | Task due date changed | authored (audit-trail label) | api tasks/service.ts; worker kit.ts |
| 174 | `agenda_item.not_published` | 422 | ADR-0032 G2 | accepted (BE-F2) | Only a published agenda item can take an outcome. | server | api governance/agenda.ts |
| 175 | `agenda_item.outcome_not_ask` | 422 | ADR-0032 G2 | accepted (BE-F2) | Only an executive ask records a decision; record this item as noted or deferred. | server | api governance/agenda.ts |
| 176 | `agenda_item.ordinal_taken` | 409 (`urn:mth:problem:duplicate`) | ADR-0032 G2 | accepted (BE-F2) | Another agenda item of this meeting has this position. | server | api governance/agenda.ts; platform/db-errors.ts |
| 177 | `validation.agenda_ask_shape` (at `/decisionId` or `/brief`) | 400 field | ADR-0032 G2 | accepted (BE-F2) | Only an executive ask links a decision or carries a brief, and never both. | server | api governance/agenda.ts |
| 178 | `validation.evidence_unknown` (at `/materialsEvidenceIds`) | 400 field | ADR-0032 G2 | accepted (BE-F2) | Choose evidence of this transformation. | server | api governance/agenda.ts |
| 179 | `validation.attendance_proxy` (at `/onBehalfOfUserId`) | 400 field | ADR-0032 G2 | accepted (BE-F2) | A representative is recorded only for a present person, and never for themselves. | server | api governance/attendance.ts; platform/db-errors.ts |
| 180 | `validation.record_pair` (at `/recordType` or `/recordId`) | 400 field | ADR-0032 G2 | accepted (BE-F2) | A linked record names both its record type and its record. | server | api governance/meeting-outputs.ts; platform/db-errors.ts |
| 181 | `validation.agenda_item_unknown` (at `/agendaItemId`) | 400 field | ADR-0032 G2 | accepted (BE-F2) | Choose an agenda item of this meeting. | server | api governance/meeting-outputs.ts |
| 182 | `governance.task.meeting_action_due` (params `title`, `meetingDate`) | work-item message key | ADR-0032 G2 | accepted (BE-F2 proposal) | Meeting action assigned to you: {title} (meeting of {meetingDate}). | authored | api governance/meeting-actions.ts |
| 183 | `governance.task.minutes_to_approve` (params `forum`, `meetingDate`) | work-item message key | ADR-0032 G2 | accepted (BE-F2 proposal) | Approve the minutes of the {forum} meeting of {meetingDate}. | authored | api governance/minutes.ts |
| 184 | `approval.subject_unknown` (existing ADR-0026 A5 code; now also on resubmit, pointer `/subjectId`) | 422 | ADR-0026 E1 | accepted reuse | The record to approve does not exist in this transformation. | server | api workflows/approvals.ts |
| 185 | `approval.not_requester` (existing code; now also on the three subjects' round-2 submit and withdraw) | 403 | ADR-0026 E2, E3 | accepted reuse | Only the requester can resubmit or withdraw this approval. | server | api workflows/approvals.ts |

The rows also live in their ADR amendments (ADR-0021 W5, ADR-0025 D4, ADR-0026 E1–E3, ADR-0027 C3, ADR-0032 G2, ADR-0038 B4). `evidence/codes-table.md` is a copy of this table.

## 5. Every contract line changed (`docs/api/openapi.yaml`; diff `evidence/openapi-diff.txt`)

**Removed or replaced lines: 5.** Each is replaced by the same line with longer text; no schema keyword changes.

| # | Line before | After | Reason |
|---|---|---|---|
| 1 | `listGateDispensations` summary "Modular inherited approvals and End-to-End waivers (ADR-0021 §5). They never create a gate decision." | adds "… and Modular G3 waivers of the missing-links precondition (ADR-0021 §5 and amendment W1)" | item 1: the old text is untrue once the waiver exists |
| 2 | `createGateDispensation` summary | adds the Modular condition, what it waives, and the refusal for every other Modular waiver | item 1 |
| 3 | `GateDispensation.description` | names the Modular G3 waiver | item 1 |
| 4 | `GateDispensation.counts` description "Whether it currently satisfies the sequencing rule …" | "Whether it currently counts …: for the sequencing rule, or for a Modular G3 waiver the missing-links precondition (ADR-0021 amendment W3)." | item 1 |
| 5 | `KpiEvaluation.inputs: { type: object }` | `{ type: object, description: "Lineage of the value, by valueSource …" }` | item 5. The type is unchanged, so every response stays valid |

**Added lines:**

- **Info paragraph** "P4 repairs (T-DG4-ARCH-R2, 2026-10-10)": 6 lines including the blank line.
- **`getBenefitPlanValue`** (`get:` added on the existing `…/benefit-plan-values/{benefitPlanValueId}` path, before `patch:`): 16 lines.
- **`getInheritedRecord`** (a new path `…/inherited-records/{inheritedRecordId}`, inserted before `…/withdraw`): 20 lines.
- **Unchanged:** every other P1–P3 path and every other existing P4 operation (`git diff -U0` shows no other hunk). There is no new schema, parameter, response or header component. Both new operations reuse `BenefitPlanValue`, `InheritedRecord`, `BenefitPlanValueId`, `InheritedRecordId` and `ETag`.
- **`pnpm openapi:lint`:** `PASS … OpenAPI 3.1.1, 649 operations`.

## 6. Exact implementer changes

### BE-R3 (backend-workflow-engineer)

1. **`apps/api/src/modules/portfolio/dispensations.ts`.** In `createDispensation`'s waiver branch, change the first condition to `t.mode !== "end_to_end" && !(body.gateCode === "G3" && body.initiativeId === undefined)` (ADR-0021 W1). Nothing else in the file changes.
2. **`apps/api/src/modules/workflows/gates.ts`:**
   - (a) `assertModularLinks`: add `.orderBy("expires_on", "desc").orderBy("id", "desc")`, and return the chosen waiver row (id, `expires_on`, reason, `decided_by`) and the blocking codes to `submitGate`;
   - (b) `submitGate`: add the snapshot member `modularLinks` after `evidence` and before `note`, **only** when a waiver was used (ADR-0038 B1);
   - (c) `decideGate`, outcome `approved`, right after `assertRecordedExceptionsUnexpired`: when the pending snapshot has `modularLinks.waiver`, read that dispensation. If it is revoked, answer 422 `gate.modular_waiver_revoked` with `{date}` = `p4_business_date(revoked_at, timezone)`. Else, if `expires_on < exceptionBusinessDate`, answer 422 `gate.modular_waiver_expired` with `{date}` = `expires_on`. Use `problems.businessRule`. Put the two texts in `packages/shared/src/schemas/missing-links.ts`, beside `MODULAR_LINKS_MISSING_DETAIL`.
3. **Byte-identity proof** (ADR-0021 W7 item 3), by the BE-M2 A/B method:
   - every End-to-End dispensation create, decide, revoke and list response of the existing DG3 tests;
   - the Modular refusals for G1, G2 and G3 with an initiative;
   - the 21 End-to-End G1–G4 gate responses.

   Then the new tests of W7 item 4.
4. **`getInheritedRecord`.** Route it in `apps/api/src/modules/reporting/modular.ts` (`transformation.read`; 200 with `ETag`, active or withdrawn; 404 otherwise, a `prior_approval` id included). Exercise it in the contract test (the `p4-exercises-be-m.ts` section). Remove it from `P4_PENDING_ARCH_R2`.
5. **`work_item.system_managed` text** (ADR-0025 D3). Change `taskRefusals.systemManaged` in `apps/api/src/modules/tasks/routes.ts` to "This task closes automatically when the record it belongs to is decided or closed.", and update its assertion in `tasks.test.ts` and any integration test that pins the old text.
6. **Governance → raid** (ADR-0032 G1, items 1–4):
   - `modules.ts` `governance.dependsOn` gains `"raid"`;
   - extract `insertActionItem` in `raid/actions.ts` and export it from `raid/index.ts`;
   - replace the copy in `governance/meeting-actions.ts`;
   - the before/after row and audit comparison;
   - the boundary test passes.
7. **Carried from D-110 (not decided here):** whether a meeting action's `meeting_action_due` task follows later edits made through `raid/actions.ts` (ADR-0032 G1 item 5).

### kpi-benefits-engineer task

1. **`getBenefitPlanValue`** (ADR-0030 P1). Route it in `apps/api/src/modules/benefits/values.ts` (`transformation.read`; 200 `BenefitPlanValue` with `ETag`; 404 outside the transformation). Exercise it in the contract test and remove it from `P4_PENDING_ARCH_R2`.
2. **Formula lineage** (ADR-0027 C1) in `apps/worker/src/handlers/kpi.ts`:
   - `sources` on formula evaluations;
   - `entries` on roll-ups;
   - the same shape for binding-only inputs;
   - the C1 tests.

### Frontend tasks

1. **Dispensations page** (`apps/web/src/pages/dispensations/DispensationsPage.tsx`):
   - for a Modular transformation, offer kind `waiver` with gate G3 only and no initiative field, labelled as a waiver of the missing baseline and outcome links;
   - in the list and on the readiness page, label such a waiver that way, never as a launch waiver or an approval.
2. **Problem keys** (`apps/web/src/i18n/{en,ar}/problems.json`):
   - `gate__modular_waiver_revoked` and `gate__modular_waiver_expired` (new; texts in §4, with `{date}`);
   - `work_item__system_managed` (new English text; new provisional Arabic);
   - `inherited_record__record_not_found`, and the `baseline_missing` and `outcome_link_missing` error items, if not already present;
   - BE-F2's 8 codes (FE-D's scope as I understand it; listed so that none is missed).
3. **Other texts:**
   - the `governance.task.*` message keys (§4 rows 182–183);
   - the audit label `work_item_reschedule` "Task due date changed" (`transformations.json`, the existing `work_item_*` labels);
   - a display text for a failed calculation run, `kpi.recalculate_failed` (§4 row 171).
4. **Benefit values screen:** plan-value edit through `getBenefitPlanValue` → `If-Match` → `updateBenefitPlanValue` (ADR-0030 P1). This unblocks FE-C's decision 1.
5. **Governance matrix round-2 submit:** no title field (ADR-0026 E6).

## 7. Known gaps and not done

- **Nothing in this task changes runtime behaviour.**
  - Item 1's waiver path still cannot be reached through the API until BE-R3 implements W1 and B1. Until then, REQ-PB-005 and REQ-S03-005's "or waived" clause stays as BE-M2 left it.
  - The two new operations have no route until their tasks route them.
  - The lineage shape is not written by the worker until the kpi-benefits task does it.
- **Item 6's code change is BE-R3's.** I did not edit `modules.ts`, `raid/actions.ts` or `meeting-actions.ts`, because they are outside this assignment's outputs. The acyclicity proof is over the graph with the edge added in memory.
- **The data dictionary** (`docs/architecture/data-dictionary.md`) is not edited for `kpi_evaluation.inputs`: its column rows record catalogue facts (type, CHECK), and those do not change.
- **ADR text not edited in place.** Every correction is a dated amendment appended to its ADR. The superseded sentences remain above it, marked superseded by the amendment's opening rule ("where this amendment and §x differ, this amendment wins"), as in ARCH-R1.

## 8. Merge instructions

- **No migration.** Apply nothing.
- **Conflicts to expect:**
  - `apps/api/test/integration/contract/contract.test.ts`: only the operation-count pin (649) and its comment line. If a concurrent task changes the media-type pin, the two edits are on different lines.
  - `apps/api/test/support/p4-pending.ts` and `p4-operations.ts`: append-only lines.
  - `docs/api/openapi.yaml`: the info paragraph, two inserted operations and five description lines. BE-M3, KBE-G2 and FE-D do not own this file (p4-plan §5.3).
- **After the merge:** the P4 aggregate pending list gains 2 operations (`getInheritedRecord`, `getBenefitPlanValue`). Both must be routed before the DG4 candidate freezes.
- **Ordering:** BE-R3 and the kpi-benefits task depend on these amendments. FE work on the waiver form and on plan-value editing depends on BE-R3 and the kpi-benefits task respectively.
