# Handback T-DG4-BE-F2 (backend-workflow-engineer): agenda items and briefs, attendance and quorum, minutes, outputs and meeting actions

- **Stage:** DG4 (P4 "Execution value and sustainment"), BUILDING. Section: `docs/architecture/p4-work-split.md` §D.3.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-BE-F2-backend-workflow-engineer-20261009T232706Z-170bbf19","session_id":"170bbf19-3cbf-44f8-a32e-4f77a1f1bf0b"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-F2.md`; the sha256 `f52b32ba…4cce6c2` was verified at the start.
- **Base:** branch `dg4/be-f2` at `8a641e1` (W13 assignments, over D-109's integrated tree). The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** start `Fri Oct 9 23:27:16 UTC 2026`, end `Sat Oct 10 00:33:26 UTC 2026` (`date -u`; `evidence/end-time.txt`), about 66 minutes.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` exited **0** at the start (`PASS gate DG3 (historical)`; `evidence/validate-historical-DG3-start.txt`) and at the end (`evidence/validate-historical-DG3-end.txt`).
- **No business approval granted.** Product gates G1–G6 are business approvals inside the product. Recording an Outcome, approving minutes and the decisions in the tests are synthetic records inside the product. Nothing here reads or writes DG0–DG7, and all test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/governance/agenda.ts` (stub filled) | `listAgendaItems`, `createAgendaItem`, `updateAgendaItem`, `publishAgendaItem`, `withdrawAgendaItem`, `recordAgendaItemOutcome`. Also the committee helpers the other four files share: `requireCommitteeAction` (commit-time re-check), `lockMeeting`, `assertMeetingEditable` (`meeting.frozen`), `assertChair`, `presentCount`, `sendCreated` |
| `apps/api/src/modules/governance/minutes.ts` (stub filled) | `getMeetingMinutes`, `createMeetingMinutes`, `updateMeetingMinutes`, `approveMeetingMinutes`, `publishMeetingMinutes`, and the chair's `minutes_to_approve` work item. It also calls the three registration functions below, because `index.ts` is not mine (§D.3: "it also calls the three registration functions below") |
| `apps/api/src/modules/governance/attendance.ts` (new) | `listMeetingAttendance`, `recordMeetingAttendance`, `updateMeetingAttendance`; `countsForQuorum` from the forum's participants |
| `apps/api/src/modules/governance/meeting-outputs.ts` (new) | `listMeetingOutputs`, `createMeetingOutput`; the ADR-0032 §4 kind → record-type table |
| `apps/api/src/modules/governance/meeting-actions.ts` (new) | `listMeetingActions` (status and overdue), `createMeetingAction` (action + link + `meeting_action_due` work item) |
| `apps/api/src/modules/platform/db-errors.ts` | BE-F2 lines of the slice D block, after BE-G's, ending with an explicit `return problems.internal()` for the fall-through labels |
| `packages/shared/src/schemas/governance-workflow.ts` (new) | zod mirrors: `agendaItem*`, `executiveAskBrief*`, `meetingAttendance*`, `meetingMinutes*`, `meetingOutput*`, `meetingAction*` |
| `packages/shared/src/schemas/index.ts` | One export line (after BE-G's `executive-decisions.ts`) |
| `apps/api/test/support/p4-pending-be-f2.ts` | Emptied (18 → 0) |
| `apps/api/test/integration/contract/p4-exercises-be-f.ts` | 18 mirrors added to `P4_MIRRORS_BE_F`. `exerciseP4BeF2Operations` is appended and called at the end of `exerciseP4BeFOperations` (no new seam file; `contract.test.ts` calls only BE-F's function) |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin only: `[304, 303, 1]` → `[313, 312, 1]` (+9 JSON bodies; delta in §5) |
| `apps/api/test/integration/governance/agenda.test.ts` (new, 11 tests) | REQ-PB-068, REQ-PB-061 (T16), executive-asks-only, linking, chair, late and limit, If-Match, authorization, commit time |
| `apps/api/test/integration/governance/attendance-quorum.test.ts` (new, 6) | REQ-S10-011 quorum, the Outcome rules, attendance rules, authorization, commit time |
| `apps/api/test/integration/governance/minutes.test.ts` (new, 5) | REQ-S10-011 immutability and frozen meeting, REQ-PB-061 Value Review, state machine, work item, authorization, commit time |
| `apps/api/test/integration/governance/meeting-outputs.test.ts` (new, 3) | Kind, record and note rules, append-only, authorization, frozen, commit time |
| `apps/api/test/integration/governance/meeting-actions.test.ts` (new, 3) | REQ-S10-011 My Work, monitor closure (overdue, paging), authorization, frozen, commit time |
| `apps/api/test/integration/governance/entity-group.test.ts` (new, 1) | REQ-S16-019 entity group through the API |
| `docs/delivery/handbacks/DG4/T-DG4-BE-F2-backend-workflow-engineer.md`, `…-evidence/` | This handback and its logs |

No migration was added and no migration was edited. I did not touch `governance/index.ts`, `server.ts`, `modules.ts` or any BE-F/BE-G service file.

## 2. Behaviour delivered, per requirement row

### REQ-PB-068: "A09: publishing an agenda item missing 'Impact of delay' is rejected by the API"

- `publishAgendaItem` checks the seven elements (decision required, why now, options ≥ 2, recommendation, impact of delay, decision owner, required date) **before any write**. It reads them from the draft brief, or from the linked T16 decision.
- A missing element gives 422 `agenda_item.executive_ask_incomplete` with the exact ADR-0032 §11 detail ("… Missing: impact of delay.") and one error per element, at `/brief/<member>`.
- `agenda.test.ts` "REQ-PB-068 A09" proves it:
  - the error is `{pointer: "/brief/impactOfDelay", code: "agenda_item.executive_ask_incomplete", message: "Impact of delay is required."}`;
  - nothing is written: no new executive decision, the item stays `draft` v1 with no `decision_id`, and its only audit event is `agenda_item.create`.
- A second test shows all seven missing elements, each at its own pointer.
- "Escalate decisions, not status": on Executive SteerCo (`executive_asks_only`), an information item gives 422 `agenda_item.executive_asks_only` with nothing written. Another layer accepts it.

### REQ-PB-061: "A01: a Value Review meeting cannot be published without a benefit evidence or forecast entry; decisions recorded appear in T16"

- **Value Review** (`minutes.test.ts`):
  - publishing approved minutes without a `benefit_evidence` or `forecast` output gives 422 `meeting_minutes.required_output_missing`: "A Value Review meeting cannot be published without at least one of: benefit evidence, forecast.";
  - nothing is written: the minutes stay `approved` v2 and the meeting stays `held`;
  - after a `forecast` output linked to a benefit created through the API, publication succeeds and the meeting is `minutes_published` (the same transaction publishes the meeting record).
- **Decisions in T16** (`agenda.test.ts` "REQ-PB-061"):
  - a complete brief publishes through BE-G's `createExecutiveAsk` (`ask_origin 'agenda'`, `sourceAgendaItemId`). The brief columns are cleared in the same UPDATE that links `decision_id`, so one copy of the ask exists;
  - `GET …/executive-decisions?origin=agenda` lists the ask with its why now, impact of delay and owner;
  - `recordAgendaItemOutcome` `decided` (SP owner, in session) records the Outcome through BE-G's `recordExecutiveOutcome`. T16 then shows `status: decided`, the outcome text and `decidedBy`, and `?status=decided` lists it;
  - the meeting's outputs contain a `decision` output linking the decision and the agenda item, in the same transaction.

### REQ-S10-011: "A02;A09: with quorum configured, decisions cannot be recorded below quorum; published minutes are immutable and actions appear in owners' My Work"

- **Quorum** (`attendance-quorum.test.ts`):
  - with quorum 2 and one counted person present, `decided` gives 422 `meeting.quorum_not_met` ("…: 1 of 2 counted present. Decisions cannot be recorded below quorum.");
  - nothing is written: the decision stays `open` v1, the item stays `published` v2, and there is no output;
  - with two present it succeeds, with `outcomeQuorumPresent: 2`;
  - a present non-participant counts `false`;
  - "quorum not configured" never blocks and reads `quorumState: "not_configured"`.
- **Published minutes are immutable** (`minutes.test.ts`):
  - after publication, `updateMeetingMinutes` gives 422 `meeting_minutes.published` ("Published minutes are immutable."), for an edit and for a return to draft, and the row is unchanged;
  - the meeting's records are frozen: agenda, outputs, actions and attendance all give 422 `meeting.frozen` ("This meeting is minutes_published; its records can no longer be changed.").
- **Actions in My Work** (`meeting-actions.test.ts`):
  - `createMeetingAction` creates the canonical `action_item`, the `assigned` link and the owner's `meeting_action_due` item (subject = the action, due date = the action's due date, dedupe `meeting.action:<actionItemId>:<ownerUserId>`);
  - the item appears in the owner's `GET /me/work-items` and not in anyone else's;
  - `listMeetingActions` shows status and `overdue` ("monitor closure").
- **Committee steps (M0212):** draft agenda, linked briefs, materials (`materialsEvidenceIds`, checked against the transformation's evidence), attendance, decisions, approve and publish minutes, assign actions and monitor closure. Each is a route with tests.

### REQ-S16-019 (AgendaItem, Attendance, Minutes, MeetingActionLink, and the entity-group test): "A09: … an integration test creates and reads each one through the API with authorization enforced"

`entity-group.test.ts` creates and reads, through the API, a Forum, a Meeting, an AgendaItem, an Attendance row, a MeetingActionLink (with its action) and Minutes:

- every write is 403 for AUD and 404 for a user of another organization and for an ADM-only admin;
- every read succeeds for AUD and is 404 for the other two;
- AUD is also refused on a meeting PATCH and on a minutes PATCH.

The ERD and migration parts of the row are the architect's (`0044`, ERD §1h).

### Shared rules (S-1 … S-14), per mutation

| Rule | How it is met | Proof |
|---|---|---|
| S-4: authorization re-checked at commit | `requireCommitteeAction` reloads the principal inside the transaction | commit-time tests (TL grant revoked while waiting → 403, nothing written) in agenda, attendance, minutes, outputs and actions |
| S-4: validation | zod mirrors with `freeText` (S-1), plus server checks (users, evidence, agenda item, record pair, proxy) | 400 cases in every file; a blank action title → 400 |
| S-4: `If-Match` | 428 when missing, 409 when stale on `updateAgendaItem`, `publish`, `withdraw`, `outcome`, `updateMeetingAttendance`, `updateMeetingMinutes`, `approve` and `publish` minutes; creates are v1 with `ETag: "1"` | agenda, attendance and minutes tests (428/409); a stale `decisionVersion` → 409 |
| S-4: audit in the same transaction | `agenda_item.{create,update,publish,withdraw,outcome}`, `meeting_attendance.{create,update}`, `meeting_minutes.{create,update,return,approve,publish}`, `meeting.publish_minutes`, `meeting_output.create`, `action_item.create`, `meeting_action_link.create` | `auditOf` assertions |
| S-4: no remote I/O | none in any transaction | — |
| S-3 | `config.consumes` is `application/json` on the 9 body routes; the 4 bodiless POSTs declare none | contract `consumesDrift` test (in the integration run) |
| S-6 | Work items store `messageKey` + `messageParams` | §6 |
| S-10 | Pending list empty; all 18 operations exercised through the validating client | contract test |
| S-11 | ADR-0032 §11 codes and English texts used verbatim | new codes listed in §6 |
| S-13 | `createWorkItemOnce`, and `reassignWorkItemOfSubject` for the minutes item | — |
| S-14 | No `approval*` table is written. Recording an Outcome goes through BE-G's T16 service (owner or active delegate holding `executive_decision.decide`); no job decides | — |
| D.8 item 10 | AUD 403 and ADM-only 404 on every operation, except `recordAgendaItemOutcome` `decided`: a business-decision path, so an ADM-only caller gets **403**, as on BE-G's `recordExecutiveDecisionOutcome` (REQ-S10-003 / D-094) | `attendance-quorum.test.ts` |

## 3. Checks actually run (final tree; logs in `T-DG4-BE-F2-evidence/`)

Environment: Node 24.21.0, offline, PostgreSQL 16.13 disposable cluster (UTF8, C locale) from `tests/qa/support/with-pg.sh`, harness ports 25051 (pool 25052–25099). Empty `.claude/.cc-writes` directories were checked before the runs (none found). `df -h .` showed 21 GB free before each full run.

| Command | Exit | Result | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | `PASS gate DG3 (historical)` | `validate-historical-DG3-start.txt` |
| `pnpm -r typecheck` | 0 | — | `typecheck.txt` |
| `pnpm -r build` | 0 | — | `build.txt` |
| `pnpm lint` | 0 | — | `lint.txt` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.txt` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 647 operations` | `openapi-lint.txt` |
| `pnpm test` (locale unset: `env -u LANG -u LC_ALL -u LC_CTYPE`) | 0 | unit-node + unit-web: 122 files, **2342 passed**; unit-formula-nocodegen: **259 passed, 2 skipped** | `unit-locale-unset.txt` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | 2342 passed; 259 passed, 2 skipped | `unit-c-utf8.txt` |
| `QA_PG_PORT=25051 MTH_PORT_POOL=25052-25099 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **167 files, 1616/1616 passed** (695 s) | `integration.txt` |
| `node tools/gates/validate.mjs --historical --stage DG3` (end) | 0 | `PASS gate DG3 (historical)` | — | `validate-historical-DG3-end.txt` |

`exit-codes.txt` collects the exit codes of the final run.

**Pinned-count change:** integration 1587 → **1616** (+29 = agenda 11 + attendance-quorum 6 + minutes 5 + meeting-outputs 3 + meeting-actions 3 + entity-group 1; the 18 contract exercises run inside the existing "P4 BE-F operations" test, so the contract file count of tests is unchanged). The unit counts are unchanged from D-109 (2342 + 259/2): every BE-F2 test is an integration test. The contract operation count is unchanged at 647. The only pin I changed is the media-type pin (§5).

**Disclosed failures during development** (all fixed before the final run; none remain):

1. `withdrawAgendaItem` on a published item returned **500**. Cause: `agenda_item_published_complete` allows publication stamps only on `published` or `closed` items. Fix: withdrawal clears `published_at`/`published_by` (audited as a change).
2. The page-2 paging assertion in `meeting-actions.test.ts` failed. Cause: a `created_at` cursor serialized through JS `Date` lost PostgreSQL's microseconds, so the next page repeated a row. This was a real defect. Fix: attendance, outputs and actions now page by their time-ordered UUIDv7 `id`.
3. The first full `pnpm test` (both locales) failed 1 test: `architecture.test.ts`, "computed member with a non-literal key" in my files. Fix: the lookups now use `Map.get`. The final runs above pass.
4. Lint found an unused assignment in the exercises; fixed.

## 4. Operations routed (delta to `p4-pending-be-f2.ts`)

All 18 were removed, from 18 to 0. Each is exercised through the validating client in `exerciseP4BeF2Operations`:

`listAgendaItems`, `createAgendaItem`, `updateAgendaItem`, `publishAgendaItem`, `withdrawAgendaItem`, `recordAgendaItemOutcome`, `listMeetingAttendance`, `recordMeetingAttendance`, `updateMeetingAttendance`, `getMeetingMinutes`, `createMeetingMinutes`, `updateMeetingMinutes`, `approveMeetingMinutes`, `publishMeetingMinutes`, `listMeetingOutputs`, `createMeetingOutput`, `listMeetingActions`, `createMeetingAction`.

API endpoints added (all under `/api/v1/transformations/{transformationId}/meetings/{meetingId}`):

- `GET|POST /agenda-items`, `PATCH /agenda-items/{agendaItemId}`, `POST /agenda-items/{agendaItemId}/{publish,withdraw,outcome}`;
- `GET|POST /attendance`, `PATCH /attendance/{meetingAttendanceId}`;
- `GET|POST|PATCH /minutes`, `POST /minutes/{approve,publish}`;
- `GET|POST /outputs`;
- `GET|POST /actions`.

## 5. Contract and schema needs, for the orchestrator

1. **Media-type pin delta: +9 JSON bodies.** `[304, 303, 1]` → `[313, 312, 1]`. They are `createAgendaItem`, `updateAgendaItem`, `recordAgendaItemOutcome`, `recordMeetingAttendance`, `updateMeetingAttendance`, `createMeetingMinutes`, `updateMeetingMinutes`, `createMeetingOutput` and `createMeetingAction`. `publishAgendaItem`, `withdrawAgendaItem`, `approveMeetingMinutes` and `publishMeetingMinutes` are bodiless. Reconcile with the concurrent W13 pins by adding the deltas.
2. **No schema change and no migration needed.**
3. **Production wiring (D-107):** none needed. The routes register through `registerMinutesRoutes` and `registerAgendaRoutes`, whose lines already exist in `governance/index.ts`. Every test builds the real server through the harness (`startApi`), with no manual wiring.
4. **Location headers for append-only creates.** The contract declares `Location` on `createMeetingOutput` and `createMeetingAction` but defines no single-record GET:
   - an output's `Location` is the meeting's output list;
   - an action's `Location` is the action-register record `…/action-register/{actionItemId}` (a real GET);
   - minutes use `…/minutes`; agenda items and attendance use their PATCH paths (the contract has no GET by id).
   If the architect wants single-record reads, that is a contract addition.
5. **Module boundary (createMeetingAction).** §D.3 says "through BE-D's `createLinkedAction` or the DG2 action service". This is not reachable without editing frozen files:
   - `governance`'s `dependsOn` (in `apps/api/src/modules.ts`) does not include `raid`;
   - `ActionLink` requires a RAID, dependency or corrective-case source;
   - `workflows/index.ts` exports no action service.

   `meeting-actions.ts` therefore inserts the `action_item` itself, following `createLinkedAction` field for field: the same `action_item.create` audit action and audited fields, person-authored, no source link. The representation mirrors `toRaidAction`. **Option for the orchestrator:** add `raid` to `governance.dependsOn` (acyclic: raid does not depend on governance) and export an unlinked variant of `createLinkedAction`, so there is one insert path.

## 6. Codes and keys added outside ADR-0032 §11 (each needs architect acceptance and EN/AR text for FE-D)

| Code / key | Kind | English text (exact, as sent) | Why |
|---|---|---|---|
| `agenda_item.not_published` | 422 | Only a published agenda item can take an outcome. | An outcome on a draft (the DB has only `agenda_item_status_transition`, a 500 line) |
| `agenda_item.outcome_not_ask` | 422 | Only an executive ask records a decision; record this item as noted or deferred. | `agenda_item_outcome_complete`: `decided` only on an executive ask |
| `agenda_item.ordinal_taken` | 409 (`urn:mth:problem:duplicate`) | Another agenda item of this meeting has this position. | `agenda_item_ordinal_key` (unique, deferred); also mapped in `db-errors.ts` |
| `validation.agenda_ask_shape` | 400 field (`/decisionId` or `/brief`) | Only an executive ask links a decision or carries a brief, and never both. | `agenda_item_ask_shape`, answered before the DB |
| `validation.evidence_unknown` | 400 field (`/materialsEvidenceIds`) | Choose evidence of this transformation. | Materials are P2 evidence ids of the transformation |
| `validation.attendance_proxy` | 400 field (`/onBehalfOfUserId`) | A representative is recorded only for a present person, and never for themselves. | `meeting_attendance_proxy_present`, `meeting_attendance_not_self_proxy` |
| `validation.record_pair` | 400 field (`/recordType` or `/recordId`) | A linked record names both its record type and its record. | `meeting_output_record_pair` |
| `validation.agenda_item_unknown` | 400 field (`/agendaItemId`) | Choose an agenda item of this meeting. | An output or action naming another meeting's item |
| `governance.task.meeting_action_due` | message key, params `{title, meetingDate}` | (proposed) Meeting action assigned to you: {title} (meeting of {meetingDate}). | The `meeting_action_due` work item (S-6) |
| `governance.task.minutes_to_approve` | message key, params `{forum, meetingDate}` | (proposed) Approve the minutes of the {forum} meeting of {meetingDate}. | The `minutes_to_approve` work item (S-6) |

Existing codes are reused with their texts: `validation.required` ("A required value is missing.") for a missing `decisionVersion` on `decided` and a missing `note` on a record-less output, and `validation.user_unknown` for people.

The 422 `agenda_item.executive_ask_incomplete` errors carry `message` "{Element} is required." (for example "Impact of delay is required."). The top-level `detail` is the exact §11 sentence. Element names in "Missing: …" are the lower-case names of that sentence.

**`db-errors.ts` last-line texts.** Three refusals map from guard messages that do not hold every placeholder, so their texts are generic. API callers get the exact texts before any write.

| Constraint | Code | Text sent |
|---|---|---|
| `meeting_minutes_required_output` | `meeting_minutes.required_output_missing` | "A forum meeting cannot be published without at least one of: {kinds}." (the guard does not name the forum) |
| `meeting_output_record_type` | `meeting_output.record_required` | "This output links a record of type its kind requires." |
| `agenda_item_published_ask_linked` | `agenda_item.executive_ask_incomplete` | lists "decision required" |

## 7. Interpretations taken (for the reviewers)

1. **Publishing a brief is a chair action** (`meeting.chair` and the meeting's chair; ADR-0032 §9 table). The chair is not also required to hold `executive_decision.create`. The ask's `created_by` is the chair. The owner check (`executive_decision.owner_not_executive`) and the required date (`required_date_past`) are BE-G's `createExecutiveAsk` refusals, so their pointers are BE-G's (`/ownerUserId`, `/requiredDate`), not `/brief/...`.
2. **The decision output kind follows the forum.** `recordAgendaItemOutcome` `decided` inserts a `decision` output when the forum lists `decision`, else `decision_log` (record type `decision`), else none. The Transformation Review lists only `integrated_status`/`decision_log`, and the `meeting_output_kind_of_forum` guard would refuse a `decision` output there. The decision is a T16 entry in every case.
3. **`recordAgendaItemOutcome` order for `decided`:**
   1. `executive_decision.decide` (ADM-only → 403);
   2. the published executive ask;
   3. `decisionVersion` required;
   4. the owner or active delegate (403 `executive_decision.not_owner`);
   5. meeting in session or held (422 `meeting.not_in_session`);
   6. quorum (422 `meeting.quorum_not_met`).
   All of these come before any write. Then BE-G's `recordExecutiveOutcome` runs at `decisionVersion` (a stale value → 409).

   `deferred`/`noted` are `meeting.prepare`. They close the item and leave the T16 decision unchanged; the `AgendaItemOutcome` contract has no `deferUntil`. The in-session rule applies to `decided` only, as the ADR and the guard state.
4. **`outcomeQuorumPresent`** stores the server-counted present number on every outcome. With a quorum it is the number the guard recounts.
5. **`countsForQuorum`** comes from an active person participant row of the meeting's forum, else from an active membership of an active participant group, else `false`. It is not editable through `updateMeetingAttendance` (the contract has no field for it).
6. **Late items:** "after the cut-off" means today's business date in the meeting's timezone is after `cutoff_date`. An Unknown cut-off flags nothing.
7. **Minutes work item:**
   - when minutes are drafted or returned to draft, the meeting's current chair holds exactly one open `minutes_to_approve` item, through `reassignWorkItemOfSubject`. A return re-opens it under `…#2`, the BE-R1 rule;
   - approval closes it (`done`);
   - a meeting without a chair gets no item (the chair is a visible `chair_unassigned`).
8. **Minutes of a cancelled meeting** are refused with `meeting.frozen` on create and on edit. The DB freezes only the children, so this is an API rule consistent with §3.1.

## 8. What remains (known gaps, stated plainly)

1. **Meeting-action work items do not yet follow owner or due-date changes.**
   - The assignment says to use the tasks module's reschedule and reassign services for meeting actions whose owner or due date changes. No BE-F2 route changes a meeting action's owner or due date. The action is edited through BE-D's action register (`raid/actions.ts`) or the DG2 `/actions` path, neither of which I own.
   - BE-D's `followActionTask` and `closeActionTasks` handle only `raid_action_due` on linked actions, so a meeting action's `meeting_action_due` item does not move or close when the action is edited, done or cancelled.
   - **Needed in `raid/actions.ts` (BE-D's file):**
     - include `meeting_action_due` in the `kinds` of `rescheduleWorkItemsOfSubject` and `closeWorkItemsOfSubject`;
     - on an owner change of an action that has a `meeting_action_link`, call `reassignWorkItemOfSubject` with kind `meeting_action_due`, the dedupe key `meeting.action:<actionItemId>:<newOwner>` and the message key `governance.task.meeting_action_due`.
   - The DG2 `/actions` PATCH path would need the same.
   - I did not edit those files.
2. **The `minutes_to_approve` item does not follow a chair change made through `updateMeeting`** (BE-F's `meetings.ts`). It is re-targeted only when minutes are drafted or returned. Approval by the new chair still closes every open item of the minutes.
3. **Codes and keys in §6** need architect acceptance, and the two message keys need EN/AR text (FE-D).
4. **Pin reconciliation** with the concurrent W13 tasks (§5 item 1).
5. **Optional single-insert path** for actions (§5 item 5).

There is no separable second half: all 18 operations and the six test files of §D.3 are delivered.

## 9. Merge instructions

- No migration to run. No migration number used.
- Expected conflicts:
  - `contract.test.ts`: the media-type pin line and its comment block (add the deltas);
  - `packages/shared/src/schemas/index.ts`: one appended line after BE-G's;
  - `platform/db-errors.ts`: my lines are inside `mapP4GovernanceMeetingError`, after BE-G's `case "governance_escalation_rule_kind_immutable": … return problems.internal();` and before `default:`. A duplicate-label check over the file found none.
- **Untracked files that are not mine** (pre-existing environment files in the worktree; leave them out of the merge): `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea/`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode/`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`.
