# Handback T-DG4-FE-A: P4 web shell and the slice I and C screens (frontend-ux-engineer)

- **Stage:** DG4 (P4 "Execution value and sustainment"), BUILDING. This is an engineering delivery gate only. Nothing here grants or implies a business approval (G1–G6), and no product gate implies any DG gate. All test and demo data is SYNTHETIC.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-FE-A-frontend-ux-engineer-20261009T070301Z-fd6a124e","session_id":"fd6a124e-9654-4c93-af1d-093a399823e1"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-FE-A.md`, sha256 `bd10b246…e249a` (verified with `sha256sum` at the start).
- **Worktree / base:** `/home/user/wt/dg4-fe-a`, branch `dg4/fe-a`, base `HEAD` `588fe12875ce9d88c819034ec277aa5c3ab9dae9`. **Nothing is committed**: the changes are left in the working tree for the orchestrator.
- **Time:** `date -u` at the start: `Fri Oct  9 07:03:17 UTC 2026`; at the end: `Fri Oct  9 09:04 UTC 2026` (§7).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` printed `PASS gate DG3 (historical)`, exit 0, before any implementation (re-run at the end: §4).
- **Scope read:** `p4-work-split.md` §1 (S-1…S-14) and §I+C (incl. I+C.5), `p4-plan.md` §3 row 21, §4, §5.1, §5.3, ADR-0025, ADR-0026, `docs/api/openapi.yaml` (the 51 slice I+C operations), the zod mirrors (`calendar`, `jobs`, `tasks`, `groups`, `delegations`, `approvals`, `governance`), D-088…D-098, and the BE-A, BE-B, BE-B2, BE-C, KBE-C, KBE-D and KBE-D2 handbacks.

## 1. Changed files

### Shell, routes, nav, API seams (owned: `app/{router.tsx,nav.ts}`, `api/**`, `AreaPages.tsx`, nav/problems P4 blocks)

| File | Purpose |
|---|---|
| `apps/web/src/api/p4.ts` (new) | `p4Keys`: query keys of **every P4 area** up front (`P4_TRANSFORMATION_AREAS`: FE-A…FE-G areas; personal keys `["p4","me",…]`; organization keys). `isP4KeyOf`, `useP4Refresh(tid?)`, `useP4KeyRefresh()`. `p4Paths`: the request paths of all **51** slice I+C operations (operationId in a comment on each). Read hooks for every slice I+C GET. Re-exports the zod-inferred types. |
| `apps/web/src/app/router.tsx` | 12 slice I+C routes (below), and `P4_PLANNED_ROUTES`: 26 routes of FE-B…FE-G (KPIs, KPI actuals incl. KBE-C's work-item link `/transformations/:id/kpis/:kpiId/actuals/:actualId`, benefits, KBE-D2's `/transformations/:id/benefit-overlaps/:overlapId`, Finance validation, RAID, actions, corrective actions, forums, meetings, T16, adoption, BAU, improvement, lessons, change requests, closure, dashboards, traceability). Each shows `P4BeingBuiltPage` until its task replaces the element (orchestrator merge, p4-plan §5.3). The Governance entry page gets `moreTabs`. |
| `apps/web/src/app/nav.ts` | My Work becomes `available`. Governance leads to decision rights, RACI, role mapping and Transform readiness (`moreWorkspaceTabs`). New `NAV_SUBPAGES`: My Work > Tasks and inbox / Approvals / Delegations; Administration > Calendar / Jobs; Governance > Groups. The 14 primary areas are unchanged. |
| `apps/web/src/app/Shell.tsx` | Renders the sub-entries as a nested, labelled list under their area (visible to holders of the hinted permission only; the server decides). Sub-entry labels never repeat the area label. |
| `apps/web/src/components/Workspace.tsx` | Five P4 workspace tabs: Role mapping, Decision rights, RACI, Transform readiness, Approval records (labels from their own namespaces). **Outside the file list of p4-plan row 21; the P3 FE-A0 precedent edited this file for the P3 tabs.** `WorkspaceFrame` only accepts registered tabs, so the transformation-scoped screens need it. Flagged for the orchestrator (§5). |
| `apps/web/src/pages/AreaPages.tsx` | `P4BeingBuiltPage` (honest "being built" state, no data, no action). `AreaEntryPage` lists the extra tabs per transformation. `MyWorkPage` moved to `pages/my-work/`. |
| `apps/web/src/styles/app.css` | A P4 block, tokens only: nav sub-list, message list, RACI grid, inline filters. A link inside an error or warning banner takes the banner text colour and stays underlined: the axe contrast finding on the stale-409 link, fixed. **app.css is not in the row 21 file list either (P3 FE-A0 precedent);** flagged in §5. |
| `apps/web/src/i18n/{en,ar}/problems.json` | The P4 problem block: 73 keys per language. Every ADR-0025 and ADR-0026 refusal code, BE-B's extra codes (groups, role mappings, delegations, approvals), BE-C's `raci.party_unknown`, KBE-D2's `benefit_valuation_method.not_approved`, `benefit_value.period_range` and `benefit_value.value_required`, KBE-D's three Unknown-reason keys, and the P4 validation pointers (`party_unknown`, `party_code`, `defer_only`, `scope_pair`, `job_code`, `link_path`, `duplicate_party`, `empty_patch`, `pattern`). |
| `apps/web/src/i18n/{en,ar}/nav.json` | `nav.sub.*` (6) and `nav.p4.*` (being-built title and body, plus a title and summary for each of the 25 planned features). |
| `apps/web/src/i18n/index.ts` | Registers the 7 new namespaces for both locales. |
| `apps/web/src/i18n/{en,ar}/transformations.json` | **Outside my list:** 26 additive `audit.actions.*` labels for the P4 audit actions in a transformation's trail (forum, governance matrix, T11, T12, role mapping, approval, work item, inbox). Without them the DG1 e2e `journeys.spec.ts:560` fails at base (§4, item 1). |
| `apps/web/src/i18n/{en,ar}/{myWork,approvals,delegations,calendar,groups,decisionRights,raci}.json` (14 new) | The page namespaces. EN and AR have identical key sets. Glossary terms are used: "مصفوفة صلاحيات القرار", "مصفوفة المسؤوليات (منفّذ/مساءَل/مستشار/مُطّلع)", "مستوى الخدمة المتفق عليه للقرار (SLA)", "التحويل والتنفيذ", and "تحوّل" with shadda. |

### Screens (owned: `pages/{calendar,groups,delegations,approvals,decision-rights,raci,my-work}/**`)

| File | Route | Purpose |
|---|---|---|
| `pages/my-work/MyWorkPage.tsx` | `/my-work` | Work items (status filter; sort, filter, columns and pages via `RegisterTable`) and inbox (unread count, unread-only, mark as read). Texts come from `messageKey` + `messageParams` at render time. |
| `pages/my-work/p4ui.tsx` | — | Shared kit: `P4FormDialog` (one form-level alert, blank and required rules, session guard, If-Match, field-error mapping, 409/422 refresh), `FormAlert`, `useUserNames`, `DueDate` (Unknown with reason), `BusinessApprovalNote`, `ReadOnlyNote`. |
| `pages/approvals/ApprovalsPage.tsx` | `/my-work/approvals`, `/my-work/approvals/:approvalId` | List (assigned to me or requested by me; status filter). Detail: summary, decision history ("B on behalf of A"), escalations with routing errors. Actions: decide (4 outcomes), resubmit, withdraw. |
| `pages/approvals/ApprovalRecordsPage.tsx` | `/transformations/:id/approval-decisions` | The read-only union of business approval decision records (P4 approvals, gate decisions, funding decisions) with "B on behalf of A". |
| `pages/delegations/DelegationsPage.tsx` | `/my-work/delegations` | List (mine either side, I delegated, delegated to me; status). Record (own, or on request by `delegation.manage` with a required reason). Revoke with a reason. |
| `pages/calendar/CalendarPage.tsx` | `/admin/calendar` | Calendars, detail, create and edit (`calendar.configure`; read-only otherwise), holidays (year filter, add, edit, remove), working-day calculator (server `computeWorkingDayDueDate`). |
| `pages/calendar/JobsPage.tsx` | `/admin/jobs` | Job schedules: enable or disable, 5-field cron (checked with the shared `isFiveFieldCron`), time zone (`job.configure`). No-permission state without `job.read`. |
| `pages/groups/GroupsPage.tsx` | `/governance/groups`, `/governance/groups/:groupId` | Groups (create, edit, archive), members (add with a window, remove with a reason). States that membership grants no permission. |
| `pages/groups/RoleMappingsPage.tsx` | `/transformations/:id/role-mappings` | Governance parties, each mapped to a person or group, or flagged with the visible routing error. Map and end, plus the ended mappings. |
| `pages/decision-rights/DecisionRightsPage.tsx` | `/transformations/:id/decision-rights` | T11 rows (seeded rows marked), add and edit (party lists, SLA type, working days, urgent days, escalation chain, retire), due-date preview, matrix status and submit for business approval, and "request a business approval" (`decision_request` routed by the row). |
| `pages/decision-rights/TransformReadinessPage.tsx` | `/transformations/:id/transform-readiness` | Ready or not ready, the 4 checks with their missing items, and a link to the screen that fixes each. |
| `pages/raci/RaciPage.tsx` | `/transformations/:id/raci` | T12 grid. Cell editor: a select of exactly `""`, A, R, C, I, A/R. Per-row accountable count with text. Save a row as one PATCH with If-Match, or discard. Add a deliverable (with an accountability exception). Matrix submit. Read-only for non-editors. |

### Tests (owned)

| File | Count | What it checks |
|---|---|---|
| `pages/approvals/approvals.test.tsx` | 16 | Detailed in §2. |
| `pages/raci/governance.test.tsx` | 15 | Detailed in §2. |
| `pages/my-work/my-work.test.tsx` | 21 | My Work, calendar, jobs, groups, and the P4 seams (routes, labels, the problem-code list, the reminder message keys, the query-key scope, the being-built state). |
| `pages/my-work/p4fixtures.ts` | — | Synthetic fixtures. |
| `apps/web/e2e/p4-governance.spec.ts` | 8 tests × 2 projects | Real stack, detailed in §2 and §4. |

The unit tests run in EN and AR. Before any test, the empty sandbox `.claude/.cc-writes` directories inside source folders were removed, as the assignment asks.

## 2. Behaviour delivered, per requirement row

FE-A owns **no** row of §I+C.7 alone: every row has a backend owner. The screens below are the "screen_api" side of the rows. Each acceptance text is quoted, followed by what the UI shows and how it was checked.

- **REQ-S10-018**, "A08: 'request changes' returns the item to the requester without closing it; 'defer' requires a new date". The decide dialog offers exactly four outcomes (approve, reject, request changes, defer). `defer` shows a required "Defer until" date: with no date the field is `aria-invalid` and nothing is sent (unit EN and AR; e2e step 4, screenshot `p4-11-defer-needs-date`). A `changes_requested` approval shows **Resubmit** and **Withdraw** to the requester, not a final status (unit).
- **REQ-S10-014**, "A08: a decision without rationale is rejected; the stored record includes the request version". The rationale is required, and blank text is refused before sending (unit). The body carries `subjectVersion` (the version the approver saw) plus `If-Match` (unit asserts the body and the header). The history table shows the record version of each decision. A server 422 `approval.rationale_required` is translated.
- **REQ-S10-017**, "A08;A14: approving version 3 after the record moved to version 4 returns 409". On 409 `approval.stale_version` the dialog's single alert says "The record changed after this approval was requested. Nothing was recorded. Review the changes before deciding." It links to the record and to its decision history (`/transformations/:id/approval-decisions`). Checked by unit EN and AR, and by e2e step 5 on the real API: the decision record was edited after the request, the 409 came back, and the API confirms the approval is still `pending` with no decision (screenshot `p4-13-stale-record-changed`).
- **REQ-S10-016**, "the requester approving their own scope change returns 403 under the default policy". The requester is never offered **Decide**: the page says so (separation of duties). The server's 403 `approval.sod_requester` is translated if reached.
- **REQ-S10-010**, "A delegating to B and B to A is rejected; an approval by B shows 'B on behalf of A' in audit; after expiry B loses the capability".
  - Delegations screen: record and revoke. e2e step 6, real API: the Sponsor delegates to the Business Owner, then the Business Owner's delegation back is refused with the translated 422 `delegation.loop` (screenshots `p4-14…`, `p4-15…`).
  - "B on behalf of A" renders in the approval history and in the Approval records view (unit).
  - "On behalf of" is offered only for an active delegation to the caller.
  - Capability after expiry is decided by the server at use time; the UI shows the displayed status (active, revoked, expired).
- **REQ-S10-008**, "a decision routed to 'Business Owner' reaches the mapped person; an unmapped role blocks routing with a visible error".
  - Role mapping tab: an unmapped role shows "Routing error: not mapped", with a count banner (unit; e2e step 1, `p4-01-role-mappings-unmapped`).
  - The Lead maps the Sponsor in the UI (`p4-03-role-mapped`). A request routed through T11 then reaches that person: e2e step 3 asserts `assignee = {SP, sponsor}` through the API, and step 4 shows the task in the Sponsor's My Work.
  - 422 `routing.role_unmapped` is translated: "Routing error … Nothing was sent. Map the role first."
  - **Deviation:** the row's screen is "Transformations > Team"; mapping lives in its own workspace tab "Role mapping" beside Team. `pages/team/**` is not FE-A's.
- **REQ-PB-065**, "A01: four rows seeded verbatim; a change request of type Business scope change routes approval to the Sponsor". The four B0099 rows are visible and marked "From the playbook template" (e2e step 2 asserts all four template keys, `p4-04-decision-rights`). The UI requests a `decision_request` through the "Business scope change" row, and it routes to the mapped Sponsor (e2e step 3). The change-request form itself is slice H (FE-F, BE-L).
- **REQ-PB-066**, "a Business scope change raised Thursday gets a due date 5 working days later skipping the configured weekend days and holidays".
  - The decision-rights due-date preview and the Calendar's working-day calculator both use the server. e2e step 8: Thursday 2026-10-01 + 5 working days on a new Sunday–Thursday calendar gives `2026-10-08`.
  - A due date that cannot be known shows **Unknown** with its reason ("no SteerCo meeting scheduled", "no working-day calendar"), never a date (unit).
- **REQ-PB-067**, "seeded RACI matches B0101 exactly; a cell value 'X' is rejected; 'A/R' is accepted". The cell editor is a select of exactly `""`, A, R, C, I, A/R (unit; e2e step 2 reads the options), so "X" cannot be entered. A server 422 `raci.invalid_value` is translated anyway.
- **REQ-S10-009**, "a RACI row with two A entries is rejected; 'A/R' … counts as one accountable".
  - The per-row count counts A/R once (unit `accountableCount`) and is shown with text and an icon ("Accountable: 2 (needs exactly 1)").
  - e2e step 2: a second A on the real API gives 422 `raci.accountable_count`, the translated alert, and nothing saved (`p4-06-raci-two-accountables-refused`).
- **REQ-S10-007**, "changing a transformation's RACI does not change the seeded default or other transformations". RACI and T11 edits go only to the transformation-scoped endpoints, and the page says so. Isolation is proven by BE-C's tests, not by FE.
- **REQ-PB-008**, "readiness for Transform shows 'not ready' … and 'ready' once they are completed". The Transform readiness tab shows the server's status, the four checks with their missing items and a "go to the screen to fix it" link (unit; e2e step 8, `p4-21-transform-readiness`). "Ready" is shown only when the server says so; an error is never shown as ready.
- **REQ-S10-006**, "a 5-working-day SLA raised on the day before a configured holiday skips the holiday and weekend days; no holiday exists until configured". Administration > Calendar:
  - ADM_TECH creates and edits calendars and holidays; everyone else gets a read-only view (unit).
  - The holiday range check runs before sending (unit).
  - The working-day calculator lists the skipped dates and why each was skipped.
  - The seeded dev organization has **no** calendar. The screen shows "No business calendar is configured. Working-day due dates are Unknown until one is." (true as built).
- **REQ-S16-005**, "killing the worker mid-job …": display side only. Administration > Jobs lists and edits the schedules (`p4-19-jobs-admin`).
- **REQ-S12-005**, "a period opening creates one task per KPI owner …": display side only. My Work renders `kpi.update_due`, `kpi_actual.review_due`, `kpi_actual.rejected` and every `approvals.task.*` key (BE-B and BE-B2) from `messageKey` + `messageParams`. An unknown key renders a neutral text, never the raw key. Approval tasks are system-managed: no "mark done" (unit; e2e step 4, `p4-08-sponsor-my-work`).
- **REQ-S16-011**: Governance > Groups lists, creates, edits and archives groups and manages members (e2e step 8, `p4-20-groups`).
- **REQ-S10-003**: no UI path offers a technical administrator a decision. Decide is shown only to holders of `approval.decide`, and the server still decides.
- **S-7.**
  - One form-level alert per form. In the RACI grid, each row editor has its own single alert.
  - Every action runs inside `beginSessionGuard()`.
  - The auditor sees read-only views: the e2e checks no cell editor and no save on RACI (`p4-17-raci-auditor-read-only`).
  - Every approval is labelled "business approval" / "موافقة أعمال", never DG0–DG7.
- **S-6.** Every problem code and message key is translated at render time.

## 3. Operations routed (pending-list delta)

FE-A has **no** `p4-pending-fe-a.ts` or `p4-exercises-fe-a.ts`. The 51 slice I+C operations were already routed by BE-A, BE-B and BE-C: `p4-pending-be-{a,b,c}.ts` are empty at base `588fe12`. **Delta: none.** The web client now *calls* all 51 (paths in `api/p4.ts`, `p4Paths`), and `contract.test.ts` is untouched.

## 4. Checks (real exit codes; logs in `docs/delivery/handbacks/DG4/T-DG4-FE-A-evidence/`)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (no browser installed). Harness ports were 23551 (PG), 23552 (API) and 23553 (integration PG), with `MTH_PORT_POOL=23560-23599`. Empty `.claude/.cc-writes` directories inside source folders were removed before each test run.

The table below is the **final tree** (after the last code change). Typecheck, lint, prettier, openapi lint and validate were run after the last source edit. Build, the full e2e and both unit runs ran in `run-checks2.sh` after it (`run-times.txt`).

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | clean | `typecheck.log` |
| 1 | `pnpm -r build` | 0 | all packages | `build.log` |
| 1 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean | `lint.log` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 1 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 485 operations` (unchanged) | `openapi-lint.log` |
| 2 | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | 0 | invocation 1: 109 files, **2132 passed**; invocation 2 (`unit-formula-nocodegen`): 3 files, **259 passed, 2 skipped** | `unit-locale-unset.log` |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same: **2132** passed; **259 passed, 2 skipped** | `unit-c-utf8.log` |
| 3 | `QA_PG_PORT=23553 MTH_PORT_POOL=23560-23599 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 89 files, **1062/1062** (equal to D-098; **no pinned count changed**) | `integration.log` |
| 4 | `E2E_PG_PORT=23551 E2E_API_PORT=23552 MTH_PORT_POOL=23560-23599 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | 0 | **194 passed** (97 chromium-en + 97 chromium-ar), 0 failed, 0 flaky; axe 0 serious/critical on every `expectAccessible` page (a violation fails the test) | `e2e-all.log`, `e2e-per-spec-counts.txt` |
| 5 | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)` (at the start and again at the end) | `validate-dg3-historical.log` |

Unit delta: 2080 → 2132, i.e. +52, which is my 16 + 15 + 21 tests.

**Per-spec e2e counts (chromium-en / chromium-ar), final run:**

| Spec | en / ar |
|---|---|
| `journeys.spec.ts` | 9 / 9 |
| `p2-blank-text.spec.ts` | 9 / 9 |
| `p2-journeys.spec.ts` | 12 / 12 |
| `p3-business-cases.spec.ts` | 6 / 6 |
| `p3-g4-refusal.spec.ts` | 2 / 2 |
| `p3-inherited-approval.spec.ts` | 5 / 5 |
| `p3-journeys.spec.ts` | 18 / 18 |
| `p3-portfolio.spec.ts` | 6 / 6 |
| `p3-prioritization-roadmap.spec.ts` | 7 / 7 |
| `p3-seams.spec.ts` | 3 / 3 |
| `p3-ui-completion.spec.ts` | 7 / 7 |
| `p4-governance.spec.ts` (new) | 8 / 8 |
| `session-end.spec.ts` | 5 / 5 |

**Screenshots:** `T-DG4-FE-A-evidence/screenshots/{en,ar}/p4-01…p4-22*.png`, 24 per language, all from the final full run:

- role mapping (unmapped → mapped);
- decision rights;
- RACI, and RACI with two accountables refused;
- request approval;
- Sponsor's My Work, approvals list, approval detail;
- defer needing a date, approved;
- stale 409 "record changed";
- delegation recorded, loop refused;
- auditor approval records, auditor read-only RACI;
- calendar (admin), jobs, groups;
- Transform readiness;
- a planned P4 route.

**Disclosed non-zero exits and failures during the run (all fixed, none open):**

1. **e2e full run 1** (`e2e-all-run1-before-audit-labels.log`, exit 1): 192 passed, **2 failed**. The failing test was `journeys.spec.ts:560` (DG1 F-DG1-008) in en and ar.
   - The new transformation's audit trail showed `forum.create` and `transformation_raci_assignment.create` as "action without a translation".
   - Cause: the merged backend. Since BE-C's switch to `p4_instantiate_transformation()` (with ARCH-05's forum seeding), creating a transformation writes audited forum, T11, T12 and matrix rows. So it fails at base `588fe12` too; D-098's merge verification ran unit and integration, not this e2e.
   - Fix: 26 additive `transformations.audit.actions.*` labels (EN/AR) in `apps/web/src/i18n/{en,ar}/transformations.json`, covering the 5 instantiation actions and the other transformation-scoped slice I+C audit actions. **That file is outside my list (P3 FE-A0 precedent: "fixes outside the listed scope that the required e2e needed").** Run 2: 194/194.
2. **p4 spec, first real-stack runs** (`e2e-p4-spec-only.log` is the last, green one, 16/16). The two earlier runs failed on things I then fixed:
   - axe `color-contrast` on the stale-409 history link in the error banner. Fixed with the banner-link rule.
   - Arabic: "No calendars". The dev organization has none (§5.4), so the spec now creates one through the UI.
   - axe `scrollable-region-focusable` on the read-only RACI grid. The table wrappers are now focusable, labelled regions.
   - Serial mode skipped the remaining EN tests after the first failure.
3. **Unit, the first two full runs** (`pnpm test` and an earlier `vitest run`): 1 failure each, in frozen auth tests: `session-identity.test.tsx` "signing out here clears everything…" and then `session-end.test.tsx` "signing out here shows 'signed out'…".
   - Reproduced in isolation: 2 of 3 runs failed.
   - Cause, mine: the new My Work sections rendered the shared `LoadingState` (`role="status"`) right after sign-out cleared the cache, and the test's `findByRole("status")` could catch it.
   - Fix: My Work's pending state is a plain `aria-busy` note (§5.5). Afterwards 5 of 5 isolated runs passed, and both final full runs pass.
4. **Lint** run 1: exit 1, an unused `Lang` import in the new spec. Fixed; the final run exits 0.
5. **Unit tests while writing the screens:** some of my own new tests failed and were fixed before the final runs:
   - Arabic "إلغاء" was both "Revoke" and "Cancel" in one dialog, a real ambiguity. Revoke is now "إبطال".
   - A fixture's default inbox route shadowed the test route.
   - Two tests did not wait for data.
6. **Integration** ran once, exit 0, before two later web-only edits (the My Work pending note and the audit labels). The `integration` project does not include `apps/web`.

## 5. For the orchestrator (contract, schema and ownership notes)

1. **Ownership flags.** Besides the listed files, I edited `components/Workspace.tsx` (5 tab entries) and `styles/app.css` (an appended P4 block plus a banner-link rule). Both follow the P3 FE-A0 precedent for the shell. Neither is in another P4 task's list.
2. **Planned routes for FE-B…FE-G.** Each later FE task swaps the element of its `P4_PLANNED_ROUTES` entries in `router.tsx`, an orchestrator merge, and can rename `nav.p4.<feature>` keys. The paths are my proposal from the contract and the backend `linkPath`s; FE-B…FE-G may request others.
3. **No contract or schema need.**
4. **The dev organization has no business calendar.** `seed-dev` creates the organization outside the API, so `p4_ensure_default_calendar` never runs for it. Every working-day due date in a dev or demo stack is therefore Unknown (`calendar_not_configured`) until an ADM_TECH creates a calendar. That is honest, and the UI shows it, but a demo may want `seed-dev` to call it (BE-A or the orchestrator).
5. **Frozen auth tests and My Work.** `auth/session-end.test.tsx` uses `findByRole("status")` right after signing out from `/my-work`. Once My Work had data sections, the shared `LoadingState` (`role="status"`) could be found first. My Work's pending state is therefore a plain `aria-busy` note, not a live region. I did not edit the test (§4 discloses the runs).

## 6. Known gaps / not done

- **Slice A and B problem codes** (ADR-0027…ADR-0030: KPI, benefits, Finance validation, about 120 codes) are **not** in `problems.json`. Only the codes the assignment names (KBE-D2's three, KBE-D's three Unknown reasons) were added. FE-B and FE-C can render them from their own `<ns>.problem.*` keys, which `p4ProblemMessage` reads first, or request them append-only. The same applies to slices D, E, F, G and H.
- **"Transformations > Team" (REQ-S10-008):** role mapping is its own workspace tab ("Role mapping"), not a section of the P2 Team page (`pages/team/**`, not FE-A's).
- **Scoped delegations:** the UI records organization-wide delegations or ones limited to one transformation. Scopes `business_unit`/`portfolio`/`workstream`/`initiative`/`performance_area`/`forum`/`record` and `recordTypes` are API-only for now (they are displayed when present).
- **Requesting a business approval** from the UI covers `decision_request` on **design** decisions (T04). Executive decisions (T16) belong to slice D, and change requests to slice H.
- **Resubmit:** the record's new version is pre-filled for governance matrices and T04 decisions. For other subject types (e.g. `kpi_version`) the requester types it, with a hint.
- **Planned routes** for FE-B…FE-G are placeholders by design; their screens are not built here.
- **Not run:** a separate visual check at 390 px or 200% text for the new screens (the DG3 carried observation, D-088 (3)). The layouts use the existing responsive table and dialog components.

## 7. Merge instructions

- Apply the working-tree changes of `apps/web/**` and this handback with its evidence. There are no migrations, and nothing in `apps/api`, `apps/worker`, `packages/**`, `tools/**`, `docs/source/**` or any `package.json` or lockfile changed.
- Expect conflicts only with a later FE task that also edits `router.tsx`, `nav.json` or `problems.json`. Resolve by union (append-only).
- Untracked top-level files `.zshrc` and `CLAUDE.local.md`, and the dotfiles listed at the start of `git status`, appeared in the worktree from the sandbox. They are not mine and I did not touch them. Do not integrate them.

**End:** `date -u` = `Fri Oct  9 09:04 UTC 2026` (about 2 h). Final checks finished at 09:03:47 UTC (`run-times.txt`).
