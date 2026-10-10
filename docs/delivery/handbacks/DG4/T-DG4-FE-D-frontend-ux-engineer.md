# Handback T-DG4-FE-D: P4 slices E and D screens: RAID, actions, corrective actions, forums, meetings, T16 (frontend-ux-engineer)

- **Stage:** DG4 (P4 "Execution value and sustainment"), BUILDING. This is an engineering delivery gate only. Nothing here grants or implies a business approval (G1–G6), and no product gate implies any DG gate. All test and demo data is SYNTHETIC. The executive Outcome recorded by the e2e journey (a SteerCo "decided") is a synthetic, in-product demo business decision that approves nothing real.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-FE-D-frontend-ux-engineer-20261010T013204Z-1ed95eb0","session_id":"1ed95eb0-7bc2-491d-93c0-8d10dbfb486b"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-FE-D.md`, sha256 `8f2d7a5e…3e26e`. I checked it with `sha256sum` at the start, and it matches.
- **Worktree / base:** `/home/user/wt/dg4-fe-d`, branch `dg4/fe-d`, base `HEAD` `a8bcf5d`. **Nothing is committed.** The changes are left in the working tree for the orchestrator.
- **Time:** start `Sat Oct 10 01:32:13 UTC 2026`; end in `run-times.txt` and §7.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` printed `PASS gate DG3 (historical)` and exited 0 before any implementation (`validate-dg3-historical-start.log`). It was re-run at the end (§4).
- **Scope read:** p4-work-split §1 (S-1…S-14), §E (E.5 is my paragraph, E.7/E.8) and §D (D.5, D.7, D.8); ADR-0031 and ADR-0032 (§11 and the 2026-10-09 amendments A1/A2); `openapi.yaml` (the slice E and D operations); the zod mirrors `schemas/{raid,corrective,execution,governance-meetings,governance-workflow,executive-decisions}.ts`; D-088…D-090, D-101, D-109, D-110; the FE-A and FE-C handbacks; the ARCH-R1 consolidated code table.

## 1. Changed files

### Owned (all new): `pages/raid/**`, `pages/actions/**`, `pages/forums/**`, `pages/meetings/**`, `pages/executive-decisions/**`

| File | Purpose |
|---|---|
| `pages/raid/api.ts` | Request paths (operationId in a comment) and read hooks of the slice E operations the screens call: T15 register, entry actions, RAID + decision log, action register, corrective cases, signals, case actions, rules. Keys come from FE-A's `p4Keys.area("raid" / "actions" / "corrective-actions", tid, …)`, so `useP4Refresh(tid)` refreshes them. |
| `pages/raid/ui.tsx` | Slice E kit: `LevelCell` ("n/a" with a screen-reader explanation, Unknown never a level), `StatusText` (label + icon), `OverdueFlag`, `TypeLabel`, `RaidSubNav`, `NS = ["raidP4"]`, write-permission lists. |
| `pages/raid/RaidPage.tsx` | `/transformations/:id/raid`: the **T15 register**: ID, Type, Description, Impact, Probability, Owner, Due, Mitigation / action, Status. The mitigation cell carries its per-type header (Action, Validate, Resolve, Mitigate; B0128). Type and status filters; create, edit, close; the entry's actions (list + add). For Dependency entries (ADR-0031 A1): link to T08, **'To' initiative required** in the form, **no 'In progress'** in the edit, and a closed Dependency shows "Resolved in T08; its closure note is in the dependency's record history" (no blank or Unknown closure fields). |
| `pages/raid/DecisionLogPage.tsx` | `/transformations/:id/raid-decision-log`: the **integrated RAID + decision log** (`getRaidDecisionLog`), each row linking to the register that owns it (T15, T08, T04 decisions, T16). |
| `pages/raid/CorrectivePages.tsx` | `/corrective-actions`, `/corrective-actions/:caseId` (the `corrective_case_follow_up` work-item link) and `/corrective-action-rules`. A case shows its source (KPI, benefit with the **benefit's lifecycle step**, adoption or control check, Value Review finding), owner or **"Unassigned"**, follow-up date or **Unknown with its reason**, persistence count, signals (observed RAG with label and icon: Unknown, Stale and Not computable are never green), the recovery plan and its actions. Includes the Value Review create, edit, close and add action. The rules table labels a rule without a stored row **"Default"**; saving it POSTs the row, and a stored rule PATCHes with If-Match. |
| `pages/raid/raidFixtures.ts`, `pages/raid/raid.test.tsx` | 18 unit tests (9 per language, §2), synthetic fixtures. |
| `pages/actions/ActionsPage.tsx` | `/transformations/:id/actions` (the **action register**: source with a link, due date, **follow-up date**, **overdue** flag; source, status and overdue filters; edit with If-Match) and `/transformations/:id/action-register/:actionItemId` (the `raid_action_due` work-item link). Also exports `ActionsTable`, reused by the RAID entry, the corrective case and the meeting. |
| `pages/meetings/api.ts` | Paths and hooks of every slice D operation the screens call (forums, participants, series, meetings, agenda, attendance, minutes, outputs, meeting actions, blocker statuses, T16, escalations, escalation rules). `useMinutes` treats a 404 on a readable meeting as "no minutes yet". |
| `pages/meetings/ui.tsx` | Slice D kit: `MeetingStatusText`, `QuorumState` ("not configured" is never shown as "met"), `MinutesStatusText`, `OverdueFlag`, `useActionRunner` (bodiless versioned POSTs with If-Match in a session guard and one alert per section), `GovSubNav`, `BusinessDecisionNote`. |
| `pages/meetings/MeetingsPage.tsx` | `/transformations/:id/meetings`: forum and status filters; chair, or "No chair" (label + icon); quorum state; cut-off date or Unknown with its reason; create an ad hoc meeting. |
| `pages/meetings/MeetingPage.tsx` | `/transformations/:id/meetings/:meetingId` (the `minutes_to_approve` / `meeting_action_due` link), the **meeting workspace**:<br>- header actions by status and role: publish the agenda (chair only), start, end, edit (chair, quorum, location), cancel with a reason;<br>- **agenda** with the **executive-ask brief** (the seven elements; the **missing-element list** as labelled text) plus edit, publish (chair), withdraw, and record outcome. The decided Outcome is labelled **"Business decision"**, and the quorum is shown in the dialog;<br>- **attendance and quorum**;<br>- **outputs**, with the forum's publication requirement stated;<br>- **minutes** draft → approved → published, **read-only after publication** with a "Published minutes are immutable" note;<br>- **meeting actions** with overdue flags;<br>- the **blocker RAG** per cycle (record while in session or held).<br>A minutes-published or cancelled meeting shows a read-only note and no write control. |
| `pages/meetings/governanceFixtures.ts`, `pages/meetings/governance.test.tsx` | 20 unit tests (10 per language, §2), synthetic fixtures. |
| `pages/forums/ForumsPage.tsx` | `/transformations/:id/forums` (the **five layers** in ordinal order with their **verbatim B0093 source texts**: layer, cadence, purpose, participants, outputs. In Arabic the Arabic text is labelled **"Provisional Arabic translation"**, with the English source under each line) and `/transformations/:id/forums/:forumId` (configuration: chair role, cadence label, quorum, cut-off working days, max items, late rule, executive asks only; participants add and remove; the **series editor**). A series change requires the **"future meetings only" confirmation** (a required choice), and the result dialog **lists the kept meetings** (and the cancelled ones and the created count), or warns that no calendar exists. |
| `pages/executive-decisions/ExecutiveDecisionsPage.tsx` | `/transformations/:id/executive-decisions`: the **T16 log** with its nine columns (ID, Decision, Why now, Options, Rec., Owner, Decision date, Impact if delayed, Outcome), a status filter and the **overdue filter** (server `overdue=true`). An `earlier_record` row shows **Unknown** for the T16 columns it lacks. It also offers "raise an ask" (seven elements; server 400 field errors land on their fields).<br>`/executive-decisions/:decisionId` (the `executive_decision_due` link): detail, SLA date or Unknown with its reason, escalation level, delegate "on behalf of", the decision's escalations, and **record Outcome (business decision)** with If-Match.<br>`/transformations/:id/escalations`: escalations with **routing errors as visible rows** and the delay impact; the **escalation rules** with **"Default"** labels (save default → POST, stored → PATCH). |

### Translations

| File | Purpose |
|---|---|
| `i18n/{en,ar}/raidP4.json`, `i18n/{en,ar}/governanceP4.json` (new) | The two page namespaces; EN and AR key sets are identical (checked by the i18n parity test, which passes). Glossary terms are used: "سجل المخاطر والافتراضات والمشكلات والاعتماديات", "اعتمادية", "خطة الاستدراك والمعالجة", "اللجنة التوجيهية التنفيذية", "مراجعة القيمة", "سجل القرارات التنفيذية". No plural-suffixed keys (Arabic plural forms avoided by count-in-text keys). |
| `i18n/{en,ar}/problems.json` | **Append-only:** 84 keys per language at the end of the file (the only removed line is the old last line gaining a comma). They cover every ADR-0031 §11 code (18) and A2's `validation.not_applicable`; every ADR-0032 §11 code (48) and A2's 9 codes beyond the one already present; and 8 codes BE-F2/BE-G emit outside the tables (`agenda_item.not_published`, `agenda_item.ordinal_taken`, `agenda_item.outcome_not_ask`, `validation.agenda_ask_shape`, `validation.evidence_unknown`, `validation.agenda_item_unknown`, `validation.attendance_proxy`, `validation.record_pair`). `validation.empty_patch` was already present (FE-A) and is asserted, not re-added. ADR texts with `{placeholders}` are rendered without parameters, because problem keys take none (the FE-C precedent). The generator and its code list: `problems-append.py`, `problem-codes.json`. |
| `i18n/index.ts` | 4 import lines and 2 catalogue entries per language register `raidP4` and `governanceP4` (the FE-B/FE-C precedent). |
| `i18n/{en,ar}/nav.json` | **Append-only:** 8 `nav.sub.*` labels for the new side-menu entries. Shell renders `nav.sub.<id>`, so the entries need them. This is outside the named file list; it is disclosed here. |

### Navigation and routes (FE-A's files; append-only, as assigned)

| File | Edit |
|---|---|
| `components/Workspace.tsx` | 8 workspace tabs appended: `kpis` (FE-B) and `benefits` (FE-C), which were not reachable from the workspace (D-109 carry-forward), plus `raid`, `actions`, `corrective-actions`, `forums`, `meetings`, `executive-decisions`. |
| `app/nav.ts` | `AreaWorkspaceTab` gains the 8 ids. Strategy gains `moreWorkspaceTabs: ["kpis"]`, Benefits `["benefits"]`, and Governance appends `forums`, `meetings`, `executive-decisions`. `NavSubPage` gains an optional `workspaceTab` and 8 side-menu entries:<br>- Strategy > KPIs;<br>- Benefits > Benefits register (T14);<br>- Risks and Actions > RAID (T15), Action register, Corrective actions;<br>- Governance > Forums, Meetings, Executive decisions (T16).<br>Risks and Actions **stays "planned"** (its cross-portfolio view is planned), so the DG1 tests that assert a planned area are unchanged. |
| `app/router.tsx` | The 7 FE-D entries were removed from `P4_PLANNED_ROUTES`. 14 real routes were added: the 7 planned paths plus `raid-decision-log`, `action-register/:actionItemId`, `corrective-actions/:caseId`, `corrective-action-rules`, `forums/:forumId`, `executive-decisions/:decisionId` and `escalations`. Every backend `linkPath` of slices E and D now resolves. `subEntryRoutes` renders FE-A's `AreaEntryPage` for each side-menu entry (it lists the transformations and opens the tab). |

### Tests outside my folders (minimal, disclosed)

| File | Edit | Why |
|---|---|---|
| `pages/my-work/my-work.test.tsx` (FE-A's) | 2 lines: the "planned route shows being built" test opens `/transformations/:id/adoption` (FE-E, still planned) and expects `nav.p4.adoption.title`, instead of `/raid`. | `/raid` is now built (the FE-B/FE-C precedent). |
| `e2e/p4-governance.spec.ts` (FE-A's) | 1 line: the planned-route step opens `/adoption` instead of `/raid`. | Same reason. |

### e2e (new)

`apps/web/e2e/p4-raid-governance.spec.ts`: 7 serial steps × 2 projects on the real stack (§2, §4). Synthetic TO, SP and AUD users are created through the admin API, as in FE-A's and FE-C's specs.

No file in `apps/api`, `apps/worker`, `packages/**`, `docs/api/**`, `tools/**`, `docs/source/**`, `components/**` (other than `Workspace.tsx`), `styles/**`, any `package.json` or the lockfile changed. The untracked `.bashrc`, `.zshrc`, `CLAUDE.local.md`, `.idea`, `.vscode` and similar files at the worktree root are not mine (they predate the run) and are not part of the change.

## 2. Behaviour delivered, per requirement row (acceptance text quoted)

E.5 and D.5 give FE-D the **screens**; each E.7/D.7 row has a backend owner who owns the API behaviour. Below is what the screens render for each row and how I checked it. "e2e" means `p4-raid-governance.spec.ts` on the real stack, EN and AR; "unit" means `raid.test.tsx` / `governance.test.tsx`, EN and AR.

- **REQ-PB-079**, "A01: T15 persists all 9 columns; Type outside Risk/Assumption/Issue/Dependency is rejected".
  - The register shows the nine B0128 columns. The type select offers only the four types; a 400 `raid.type_invalid` would be translated (key present, unit).
  - unit: the nine headers. e2e step 1: a Risk and a Dependency created in the UI, listed with code, level and per-type header (`p4raid-02-register`).
- **REQ-PB-080**, "A01: an Issue with Probability H is rejected; a Risk without Probability is rejected".
  - The Probability field is shown and required only for a Risk. Issue, Assumption and Dependency rows read "n/a" (with the reason for screen readers), never blank.
  - unit: n/a cells; a server 422 `raid.probability_not_applicable` is shown in exactly one translated alert. e2e step 1: the Dependency form has no Probability field, and the API row has `probability: null`.
- **REQ-PB-078**, "A01: editing a dependency's owner in T08 changes the same RAID entry; there is no second copy".
  - The Dependency row links to T08 and is the canonical row (`recordTable: "dependency"`, `DEP-nn`). The RAID + decision log reads canonical rows and links each to its owning register.
  - e2e step 1: the created Dependency is listed **once** by `listT08Dependencies` and once by `listRaidEntries`, with the same id.
  - ADR-0031 A1 (D-109): 'To' initiative required (e2e: submit without it → the field is invalid, nothing sent; unit: no POST); no 'In progress' in the Dependency edit (unit, e2e); a closed Dependency shows the record-history note and no closure fields (unit).
  - The T08 owner-edit half is BE-D's (`dependency-entries.test.ts`).
- **REQ-PB-085**, "A04;A11;A13: a benefit below plan creates one corrective action; repeated evaluation does not duplicate it; a KPI deviation persisting two cycles … creates one case and the third cycle updates it".
  - Display side: a case shows source (benefit with its lifecycle step, KPI link), signal count, consecutive off-track count, and the signal list with each signal's effect (recorded / case opened / case updated). A 409 `corrective_case.already_open` is translated.
  - unit: a worker case with source benefit and step `correct`. e2e step 3: a Value Review case created, then closed in the UI.
  - The persistence and no-duplicate behaviour is BE-D2's worker test.
- **REQ-S12-016**, "A11;A13: a failed control check creates one owned action with a follow-up date".
  - Owner, or "Unassigned" (label + icon). Follow-up date, or Unknown with its reason ("no working-day calendar"), never a guessed date. Rules show "Default" until saved.
  - unit: Unassigned, Unknown with its reason; a Default rule POSTs the row with no If-Match. e2e step 3: a stored control-check rule loses the Default label, and the KPI rule keeps it.
- **REQ-S16-018** (A09, entity group: Risk, Assumption, Issue, Action …). The screens create and read Risk, Issue/Assumption (same form), Dependency and Action through the API. The AUD user sees read-only views (unit; e2e step 6). The entity-group integration test is BE-D2's.
- **REQ-PB-060**, "A01: the five layers are seeded with cadence text verbatim; a forum meeting series generates meetings on the configured recurrence".
  - The forums page lists the five layers with the server's verbatim source texts.
  - e2e step 4: the cadences read exactly `Monthly`, `Bi-weekly`, `Weekly`, `Daily / 2-3x week`, `Monthly`. In AR, 5 "provisional translation" labels (`p4gov-06-forums`). A weekly series is created in the UI.
- **REQ-S10-005**, "A06: changing Workstream Review from weekly to fortnightly regenerates future meetings only".
  - The series editor states "future meetings only" and refuses to send until the confirmation is chosen. The result dialog lists the kept meetings, the cancelled ones and the created count.
  - unit and e2e step 4: no PATCH without the confirmation; then PATCH `intervalCount: 2` with If-Match; the kept list is shown (`p4gov-07-series-result`). Participants, cut-off and agenda rules are configurable on the forum page.
- **REQ-PB-068**, "A09: publishing an agenda item missing 'Impact of delay' is rejected by the API".
  - The brief's missing elements are listed by name.
  - e2e step 5: an ask without Impact of delay and Required date lists both. The chair's publish is refused with exactly one translated alert, `data-problem="agenda_item.executive_ask_incomplete"` (`p4gov-08`, `p4gov-09`). Once completed, it publishes.
  - Executive SteerCo offers executive asks only.
- **REQ-S10-012**, "A09: an ask without 'why now' is rejected by the API". The ask form requires all seven elements. unit: a server 400 at `/whyNow` (`executive_decision.field_required`) lands on the Why now field (`aria-invalid`), with its translated message.
- **REQ-PB-061**, "A01: a Value Review meeting cannot be published without a benefit evidence or forecast entry; decisions recorded appear in T16".
  - The outputs section states the forum's required outputs, and `meeting_minutes.required_output_missing` is translated.
  - e2e step 5: the ask published from the agenda is listed in T16 with `askOrigin: "agenda"`; the Outcome recorded in the meeting makes it Decided in T16 (step 6).
  - The Value Review refusal itself is BE-F2's test (not driven by the e2e).
- **REQ-S10-011**, "A02;A09: with quorum configured, decisions cannot be recorded below quorum; published minutes are immutable and actions appear in owners' My Work".
  - Quorum: met / not met (present of required) / **not configured, never "met"** (unit). `meeting.quorum_not_met` is translated.
  - e2e step 5: attendance recorded; minutes drafted → approved → published by the chair; afterwards read-only (`p4gov-11-minutes-published`, no minutes or agenda actions).
  - Meeting actions are listed with overdue flags. The My Work half is BE-F2's test.
- **REQ-PB-081**, "A09: T16 persists all 9 columns; a decision with Outcome recorded is closed and leaves the overdue list".
  - The log shows the nine columns and the overdue filter (server `overdue=true`). An earlier record shows Unknown for the columns it lacks.
  - unit: the nine headers; ≥ 4 Unknown cells on the earlier record; the filter request and result. e2e steps 5–6: the Outcome recorded by the owner, a decided row, and an ask raised in the UI absent from the overdue list (`p4gov-12-t16-log`).
  - The Outcome dialog carries the "Business decision" note, and no page names DG0–DG7 (unit, e2e).
- **REQ-PB-082**, "A09;A13: a blocker Red in 2 consecutive cycles (N=2) produces exactly one open T16 ask …". Display side: blocker RAG per meeting cycle can be recorded in session (label + icon; Unknown is never green), and the blocker-red rule (N, deadline, owner role) is shown and editable. The N-cycle ask is BE-G's worker test.
- **REQ-S12-011**, "A09;A13: an SLA expiring on a working day escalates once to the next authority and shows the delay impact text".
  - Escalations show level, SLA date, the party and person reached, the **delay impact**, and **routing errors as visible rows**.
  - unit: a `party_unmapped` row with its delay impact; the decision_sla rule labelled Default. e2e step 6: both rules Default.
  - The scan is BE-G's worker test.
- **REQ-S16-019** (A09, entity group: Forum, Meeting, AgendaItem, Attendance, Minutes, MeetingActionLink). The meeting workspace creates and reads each through the API, and the AUD user gets read-only views (e2e step 6). The entity-group integration test is BE-F2's.
- **REQ-S09-007 / REQ-S09-009** (budget/actual/forecast, working-day slip, critical path): **not built**; see §6.
- **S-7 / S-6 / S-11.**
  - One form-level alert per dialog or section (unit asserts exactly one).
  - Every action runs in a session guard with If-Match.
  - AUD sees read-only notes and no write control.
  - Labels say "business decision", never DG0–DG7.
  - Every ADR-0031/0032 §11 code, the A2 codes and the extra codes are translated in both languages; AR texts contain Arabic letters (unit).
- **390 px and 200 % text** (e2e step 7):
  - The RAID register, the meeting and the T16 log at 390 px have no page-level horizontal scroll (`scrollWidth − innerWidth ≤ 1`), with axe 0 serious or critical issues.
  - The RAID register and the T16 log at 200 % root font size have no page-level scroll.
  - The first run found a real `scrollable-region-focusable` issue on the frozen meeting's attendance table (no focusable content in its scroll region at 390 px). Fixed by giving every table of mine at least one sortable column (a focusable header button).

## 3. Operations routed (pending-list delta)

FE-D has **no** `p4-pending-fe-d.ts` or `p4-exercises-fe-d.ts`. All slice E and D operations were routed by BE-D, BE-D2, BE-E, BE-F, BE-G and BE-F2 (their pending lists are empty at base `a8bcf5d`). **Delta: none.** `contract.test.ts` is untouched.

The web client now calls **47 of the 49 slice D operations**. Not called: `getMeetingSeries` (the forum page reads the series from `listMeetingSeries`) and `updateExecutiveDecision` (no T16 edit dialog; an ask is raised complete and decided). It calls **21 of the 31 slice E operations**. Not called: `getRaidEntry` (a hook exists but the register rows carry the same record) and the 9 budget-line, execution and schedule-network operations (`listBudgetLines`, `createBudgetLine`, `getBudgetLine`, `updateBudgetLine`, `archiveBudgetLine`, `getInitiativeExecution`, `getScheduleNetwork`, `createInitiativeSchedule`, `updateInitiativeSchedule`); see §6.

## 4. Checks (real exit codes; logs in `docs/delivery/handbacks/DG4/T-DG4-FE-D-evidence/`)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (no browser installed). Harness ports were all from my 25250–25299 range:
- integration: `QA_PG_PORT=25253`;
- final e2e: `E2E_PG_PORT=25254`, `E2E_API_PORT=25255`;
- development e2e runs: 25251/25252;
- `MTH_PORT_POOL=25260-25299` throughout.

Empty `.claude/.cc-writes` directories inside source folders were removed before each test run. Free disk was 21–22 GB before each full run.

| # | Command | Result |
|---|---|---|
| 1 | `pnpm -r typecheck` | exit 0 (`typecheck.log`) |
| 1 | `pnpm -r build` | exit 0 (`build.log`) |
| 1 | `pnpm lint` | exit 0 (`lint.log`) |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (`format.log`; re-run after writing this handback: `format-final.log`, exit 0) |
| 1 | `pnpm openapi:lint` | exit 0 (`openapi-lint.log`) |
| 2 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | exit 0: **2390 passed** (125 files) + **259 passed, 2 skipped** (`unit-locale-unset.log`) |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0: **2390 passed** + **259 passed, 2 skipped** (`unit-c-utf8.log`) |
| 3 | `QA_PG_PORT=25253 MTH_PORT_POOL=25260-25299 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0: **1661/1661** (175 files) (`integration.log`). No pinned count changed (no API or contract change). |
| 4 | `apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | exit 0: **242 passed, 0 failed, 0 flaky**, 20.2 min (`e2e.log`). Per spec and project: `e2e-per-spec.txt`. |
| 5 | `node tools/gates/validate.mjs --historical --stage DG3` | exit 0, `PASS gate DG3 (historical)` at start and end (`validate-dg3-historical-{start,end}.log`) |

**Unit counts:** 2390 = the D-110 baseline 2352 + **38 new** (18 in `raid.test.tsx`, 20 in `governance.test.tsx`).

**e2e counts:** 242 = the D-110 baseline 228 + **14 new**. `p4-raid-governance.spec.ts` is 7 steps × 2 projects. The other specs per project (en = ar): journeys 9, p2-blank-text 9, p2-journeys 12, p3-business-cases 6, p3-g4-refusal 2, p3-inherited-approval 5, p3-journeys 18, p3-portfolio 6, p3-prioritization-roadmap 7, p3-seams 3, p3-ui-completion 7, p4-benefits 8, p4-governance 8, p4-kpi 9, session-end 5. axe is asserted inside every step (0 serious or critical issues, or the step fails), so the 242 passes include it.

**Screenshots** (mine only, 20 per language): `screenshots/{en,ar}/p4raid-*.png`, `p4gov-*.png`. The suite's other specs' screenshots and `axe-summary.json` were pruned from the evidence directory to keep it to this task. I looked at `en/p4raid-02-register.png` and `ar/p4gov-08-ask-missing-elements.png`.

**Disclosed non-zero exits during development** (not the final runs):
- The development runs of the new spec failed four times on test defects: `td` instead of the row header `th`; the entry's action list dialog reopening after "add"; one `waitFor` resolving on null; and an unfilled owner. Each was fixed in the test.
- Two real UI defects were found and fixed:
  - the series confirmation was a checkbox that cannot show a field error; it is now a required choice;
  - the frozen meeting's attendance table had a non-focusable scroll region at 390 px (axe `scrollable-region-focusable`, serious); every table now has a sortable column.
- One `tsc` round (index-signature access) and one lint round (2 unused imports, 1 unused type import) were fixed before the final runs.

## 5. Contract or schema needs (for the orchestrator)

None blocking. Observations:

1. A closed **Dependency** entry's closure note lives in the `dependency.update` audit event (ADR-0031 A1.2). The screen says so and links to T08; it does not fetch the audit trail. A per-record history read for a dependency would let the RAID screen show the note itself.
2. My Work **message keys** for slice E/D work items (`raid.task.action_due`, `raid.task.corrective_follow_up`, `governance.task.executive_decision_due`, `governance.task.executive_decision_escalated`) and the four `governance.notice.*` keys of the ARCH-R1 table belong to `myWork.json` (`myWork.message.*`, FE-A's file), not `problems.json`. I did **not** place them (outside my ownership); without them My Work shows its generic fallback text for those items. This is the "one missing My Work message key" family of D-109.

## 6. What remains (separable second half, D-059/D-070)

**Budget lines, the execution view and the schedule network on the initiative page (REQ-S09-007, REQ-S09-009 UI; E.5 second sentence) are NOT built.** E.5 places them on `pages/initiatives/**` (FE-B's DG3 area) as new FE-D components, plus route and nav entries requested from FE-A. The 9 operations are routed by BE-E and proven by its tests; no screen calls them yet. The separable task:
- new components `pages/actions/BudgetPanel.tsx`, `ExecutionPanel.tsx`, `ScheduleNetworkPanel.tsx`: decimal amounts per currency, with Unknown and its reason (`no_budget_lines`, missing amounts), never 0; working-day slip with its reasons; and **no "critical" styling when `status` is `not_computable`**;
- one route, or a slot on the initiative page;
- unit and e2e coverage.

Also not built (not assigned as screens, mentioned for completeness): editing a forum's output kinds and publication-required outputs (shown read-only; the API accepts them), and a group participant's name (shown by group code).

## 7. Merge instructions

- No migration and no API change. Merge after W13 (base `a8bcf5d`).
- Conflicts are possible only with another FE task that edits `router.tsx`, `nav.ts`, `Workspace.tsx`, `nav.json`, `problems.json` or `i18n/index.ts`: resolve by union (every edit is append-only). If FE-E/FE-F/FE-G remove their planned routes later, the planned-route tests I pointed at `/adoption` must move to another still-planned route, or be retired when none is left.
- End time: `Sat Oct 10 03:01:06 UTC 2026` (about 89 minutes).
