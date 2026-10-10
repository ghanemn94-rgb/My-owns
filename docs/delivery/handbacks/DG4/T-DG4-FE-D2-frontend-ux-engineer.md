# Handback T-DG4-FE-D2: budget lines, execution view and schedule network on the initiative page (frontend-ux-engineer)

- **Stage:** P4, gate DG4 (BUILDING). Section: `docs/architecture/p4-work-split.md` §E E.5, second sentence (FE-D's separable second half, FE-D handback §6).
- **Invocation:** `DG4-T-DG4-FE-D2-frontend-ux-engineer-20261010T055015Z-f9545740`, session `f9545740-1ff5-4598-a406-b8578267efd0`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-FE-D2.md`, sha256 `0ccdaae0…cb90` (verified at start).
- **Base:** branch `dg4/fe-d2` at `8db6679bf3ba18d8de0ad8009de2f01d4ec40461`. Changes are left **uncommitted**.
- **Time:** started 05:50:25 UTC, finished about 07:35 UTC (`date -u`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` gave `PASS gate DG3 (historical)`, exit 0, at the start and again at the end (`validate-dg3-historical.log`, `validate-dg3-historical-final.log`).
- **Data:** all synthetic. Nothing here is a business approval. No product gate G1–G6 implies any engineering gate DG0–DG7.

## 1. Changed files

### New (pages/actions, FE-D's folder)

| File | Purpose |
|---|---|
| `apps/web/src/pages/actions/BudgetPanel.tsx` | Budget lines table (sort, filter, pagination, column selection). Totals per currency come from `getInitiativeExecution`. Create, edit (If-Match, only changed members) and archive (If-Match, reason) need `budget.edit`. AUD is read-only. |
| `apps/web/src/pages/actions/ExecutionPanel.tsx` | The execution view (milestone slip in working days, deliverables, demand, dependencies, decisions, critical-path membership) and `InitiativeExecutionSlot`, which holds the three panels. |
| `apps/web/src/pages/actions/ScheduleNetworkPanel.tsx` | The network and critical path, plus the initiative's own duration (`createInitiativeSchedule` / `updateInitiativeSchedule`, `roadmap.edit`). |
| `apps/web/src/pages/actions/executionApi.ts` | **Not in the assignment's list (disclosed).** Request paths and read hooks of the 9 BE-E operations. The execution and network reads are parsed with the shared zod mirrors. |
| `apps/web/src/pages/actions/executionFixtures.ts` | **Not in the assignment's list (disclosed).** Synthetic test fixtures: the ADR-0031 §7 slip examples and the §8 network, plus a render helper. |
| `apps/web/src/pages/actions/BudgetPanel.test.tsx` | 18 tests (en and ar). |
| `apps/web/src/pages/actions/ExecutionPanel.test.tsx` | 12 tests (en and ar). |
| `apps/web/src/pages/actions/ScheduleNetworkPanel.test.tsx` | 11 tests (en and ar). |
| `apps/web/src/i18n/en/executionP4.json`, `apps/web/src/i18n/ar/executionP4.json` | New namespace `executionP4`, with identical key sets. |
| `apps/web/e2e/p4-execution.spec.ts` | New e2e spec: 3 steps per language. |

### Shared or other-owner files (append-only)

- **`apps/web/src/i18n/index.ts`:** +1 comment, +2 imports, +1 catalogue entry per locale (`executionP4`).
- **`apps/web/src/pages/portfolio/InitiativePage.tsx`:** the "one slot on the initiative page" the assignment allows. It adds +1 import, +3 `SectionNav` entries after `selections`, and +1 line `<InitiativeExecutionSlot initiativeId={i.id} />` after `<SelectionHistory>`. Nothing is removed or reordered.
- **`apps/web/e2e/p4-benefits.spec.ts`:** step 9 appended (D-112).
- **Not touched:** `router.tsx`, `nav.ts`, `nav.json`, `Workspace.tsx`, `problems.json`, `myWork.json`. I chose the slot, not a route. No nav entry is needed: the panels sit on the existing initiative page, which the Portfolio tab and the Initiatives and Roadmaps area already reach.
- **`problems.json` keys added:** none. All five budget and schedule codes already existed in both languages (`budget_line__amount_invalid`, `__period_invalid`, `__archived`, `__duplicate`, `initiative_schedule__exists`). Tests assert they translate.

## 2. Behaviour delivered, per requirement row

### REQ-S09-007 (UI half)

Acceptance: _"A05: budget/actual/forecast use decimal SAR; forecast slip vs approved date is shown in working days"_.

**Decimal amounts**
- Amounts are decimal strings formatted by `@mth/shared`, with up to 4 fraction digits, in each line's own currency. They are never a JS number in state or in requests.
- e2e: 0.1 + 0.2 gives the SAR budget total `data-amount="0.3000"`. A later 0.05 + 0.15 actual gives `0.2000`.
- Unit: separate SAR and USD total tables. No conversion and no cross-currency sum.

**Unknown, never 0**
- An empty amount is Unknown.
- A total with `status: "unknown"` shows Unknown with its reason (`missing_amounts`), the count of lines without the amount, and the known part (or "No line has this amount yet").
- No active line shows Unknown "No budget lines" (`budgetUnknownReason: "no_budget_lines"`), with no digit at all.
- Asserted in unit tests and in e2e (`p4exec-01`, `p4exec-03`).

**Working-day slip**
- Shown as "+5 working days (later than approved)", "−5 … (earlier)" or "On the approved date (0 working days)", beside the DG3 calendar-day variance.
- Unknown always comes with its translated reason: `approved_date_missing`, `forecast_date_missing`, `calendar_not_configured` or `range_too_long`. It is never 0 and never "on time".
- The ADR-0031 §7 values +5, −5 and 0 are proven in unit tests. In the e2e stack the API answers Unknown `calendar_not_configured` (seed-dev has no default business calendar). The e2e asserts the UI shows exactly what the API computed, so **the +5 case is not proven end to end**.

**The other M0184 items**
- Deliverable acceptance; demand FTE (available capacity Unknown without a capacity row); dependencies (direction, needed-by, impact Unknown when null); decisions.

### REQ-S09-009 (UI half)

Acceptance: _"A05: for a fixture network the computed critical path matches the expected chain; with missing durations no critical path is claimed"_.

**Computed network**
- Shows the project duration, the critical paths as code chains, and per initiative: duration, "Critical" / "Not critical" (label plus icon, never colour alone), earliest/latest start and finish, and total float. Each edge shows whether it is critical.
- e2e on the real stack with the §8 fixture: `P = 18`, path `INI-A > INI-B > INI-D`, INI-C not critical with float 6 (`p4exec-07`).

**Not computable (E.8 item 8)**
- The panel shows the reason and lists the initiatives without a duration.
- There is no critical column, no offsets, no path list and no `[data-critical]` element. The execution view's membership shows Unknown with no critical styling.
- Asserted in unit tests and in e2e (`p4exec-06`).

**Recording a duration in the UI**
- e2e: the Transformation Lead records the missing duration; the POST carries no If-Match, and the network recomputes on the next read.

### Who sees what, writes and refusals

- **AUD:** sees every panel read-only. There is no add, edit, archive or duration control, and a "read only" note is shown (unit tests; e2e `p4exec-09`).
- **Writes:**
  - Budget edits and archives send `If-Match` with the version the user saw.
  - A stale version is a 409. The dialog's one alert says nothing was saved, and the data is re-read.
  - e2e: Finance changes a line through the API while the UI dialog is open; the UI save is a 409 and the API value stays `0.1500` at version + 1 (`p4exec-05`).
- **Refusals:** every code in ADR-0031 §11 for these operations is translated, in both languages:
  - `budget_line.duplicate`: unit test and e2e `p4exec-04`;
  - `budget_line.amount_invalid`: inline, nothing sent (unit test and e2e `p4exec-02`);
  - `budget_line.period_invalid`: inline;
  - `budget_line.archived`: unit test;
  - `initiative_schedule.exists`: unit test.
- **Robustness:** an execution or network answer outside the contract is that panel's error state. The initiative page still renders, and no 0 is shown (unit test).
- **Narrow width and large text:** e2e on the initiative page with all three panels, at 390 px wide and at 200 % text, shows no page-level horizontal scroll in either language (`p4exec-10`, `p4exec-11`). Tables scroll inside their own labelled regions.

### Plan-value editing (D-112), `p4-benefits.spec.ts` step 9, both languages

- **Real read and If-Match:** opening Edit reads `getBenefitPlanValue` (real route, 200). The PATCH carries `If-Match` equal to that read's version and only `{ amount }`. The API then shows the new amount at version + 1.
- **Stale edit:** the dialog shows "Record version v2". The plan value is changed through the API meanwhile. The UI save gets 409 with `If-Match: "v2"`, the alert is the conflict alert, and the API value stays the other writer's `1300000.0000`: never overwritten (`p4ben-29`, `p4ben-30`).

## 3. Operations routed (pending-list delta)

**None.** This is a web task. `apps/api/test/support/p4-pending-be-e.ts` was already empty: BE-E routed and exercised all 9 operations in `p4-exercises-be-e.ts`. This task adds no API route, so it has no exercise to add and `contract.test.ts` is unchanged. The screens now call all 9:
- `listBudgetLines`, `createBudgetLine`, `updateBudgetLine` and `archiveBudgetLine`;
- `getInitiativeExecution` and `getScheduleNetwork`;
- `createInitiativeSchedule` and `updateInitiativeSchedule`;
- `getBudgetLine`, as an exported helper. The panel takes the edit version from the list read, which carries `version`.

## 4. Checks (real exit codes; logs in `docs/delivery/handbacks/DG4/T-DG4-FE-D2-evidence/`)

Environment: Node 24.21.0, offline. Harness ports 25500–25549 only. Disk had 19 GB free before each full run. Load average was 12–16, with other agents running.

| Check | Command | Result |
|---|---|---|
| Typecheck | `pnpm -r typecheck` | exit 0 (`typecheck.log`; final tree `typecheck-final.log`) |
| Build | `pnpm -r build` | exit 0 (`build.log`) |
| Lint | `pnpm lint` | exit 0 (`lint.log`, `lint-final.log`) |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (`prettier.log`, `prettier-final.log`; re-run after writing this file, see below) |
| OpenAPI | `pnpm openapi:lint` | exit 0, "PASS … 649 operations" (`openapi-lint.log`) |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | exit 0: 135 files / **2588** passed; nocodegen 3 files / 259 passed, 2 skipped (`unit-unset.log`) |
| Unit, C.UTF-8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0: **2588** passed; 259 passed, 2 skipped (`unit-cutf8.log`) |
| Integration | `QA_PG_PORT=25520 MTH_PORT_POOL=25521-25539 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0: 184 files / **1739** passed (`integration.log`). This task adds no integration test; no pinned count changed. |
| e2e, new spec alone | `with-stack.sh npx playwright test apps/web/e2e/p4-execution.spec.ts --workers=1` (ports 25510/25511) | exit 0: **6/6** (`e2e-exec-1.log`) |
| e2e, full product suite | `with-stack.sh npx playwright test apps/web/e2e --workers=1` (ports 25540/25541) | **exit 1: 256 passed, 5 failed** (41.3 min; `e2e-full.log`). See below. |
| e2e, benefits alone (before fix) | same, `p4-benefits.spec.ts` (ports 25500/25501) | exit 1: 16 passed, 2 failed (my step 9, both languages; `e2e-benefits-alone.log`) |
| e2e, benefits alone (after fix) | same | exit 0: **18/18** (`e2e-benefits-alone-2.log`) |
| e2e, RAID and P2 journeys alone | same, `p4-raid-governance.spec.ts` and `p2-journeys.spec.ts` | exit 1: 30 passed, 2 failed (`e2e-rerun-raid-p2.log`). RAID **14/14**; Define → G2 failed in both languages. |
| DG3 historical | `node tools/gates/validate.mjs --historical --stage DG3` | exit 0, start and end |

### Per-spec counts of the full run (`e2e-full.log`, before the step-9 fix)

- **All passed, in both languages (en / ar):**
  - journeys 9/9;
  - p2-blank-text 9/9;
  - p3-business-cases 6/6;
  - p3-g4-refusal 2/2;
  - p3-inherited-approval 5/5;
  - p3-journeys 18/18;
  - p3-portfolio 6/6;
  - p3-prioritization-roadmap 7/7;
  - p3-seams 3/3;
  - p3-ui-completion 7/7;
  - p4-adoption-bau 8/8;
  - **p4-execution 3/3**;
  - p4-governance 8/8;
  - p4-kpi 10/10;
  - session-end 5/5.
- **p2-journeys:** 8 passed, 1 failed in each language.
- **p4-benefits:** 8 passed, 1 failed in each language.
- **p4-raid-governance:** en 7/7; ar 5 passed, 1 failed, 1 not run (serial mode).
- **axe:** every `expectAccessible` call fails its test on any serious or critical issue. All 11 `p4exec-*` axe checks and the `p4ben-30` check passed in both languages, so they report 0 serious or critical issues.

### The 5 failures of the full run, explained

1. **`p4-benefits` step 9, en and ar (my test; fixed).**
   - **Cause:** the save's refresh re-reads the plan value while the dialog is still open, so reopening Edit uses that fresh read and sends no second GET. My step waited for a second GET and ran out its 30 s.
   - **Fix:** the step asserts that the dialog shows the re-read version and that the stale PATCH carries it.
   - **Result:** 18/18 alone. This is not a product defect.
2. **`p4-raid-governance` step 6, ar (caused by my own parallel run; disclosed).**
   - **Cause:** I started the solo benefits run in the same worktree while the full run was going. Playwright's start-up cleared the shared `test-results/` folder, and the full run's trace files vanished (`ENOENT … .playwright-artifacts-5/traces/…`). The test then hit its 30 s timeout while closing the context.
   - **Result:** re-run alone, 14/14.
   - **Lesson:** never run two Playwright invocations in one tree.
3. **`p2-journeys` "Define → G2", en and ar (NOT resolved).**
   - **Runs:** the full run gave 32.5 s and 31.7 s; the solo re-run gave 32.6 s and 33.7 s, at load average 16.
   - **Slow step:** `submitAndApproveGate` (`p2-journeys.spec.ts:675`), where the 30 s test budget runs out while the G2 submit dialog closes.
   - **Context:** D-111 records the same journey crossing 30 s under load, with an A/B that did not show a regression, plus the structural risk of one large `index` chunk.
   - **My contribution to that risk:** this task adds the three panels to that chunk; `index` is now 2,070,832 bytes.
   - **Not done:** I had no time for an A/B against `8db6679`, so **I cannot show that this change has no effect on the journey's time**. I did not raise any timeout.

### Visual evidence

Screenshots are in `screenshots/en/` and `screenshots/ar/`:
- `p4exec-01` … `p4exec-11` come from the full run;
- `p4ben-29` and `p4ben-30` come from the fixed solo benefits run.

I inspected `en/p4exec-07` and `ar/p4exec-03`: RTL mirroring, totals per currency, the computed network. In `p4exec-07` I saw that the "Critical path" column sat off to the side behind five offset columns, so I moved it right after the duration. The full run's screenshots were taken after that change.

**Interaction checks actually run (e2e):**
- inline amount refusal;
- create twice;
- duplicate 409;
- If-Match edit;
- stale-edit 409 with the API value unchanged;
- duration create (no If-Match) and the network recompute;
- auditor read-only;
- 390 px and 200 % text without page overflow;
- the plan-value edit with the real read's If-Match, and its stale 409.

## 5. Contract or schema needs (for the orchestrator)

1. **`ScheduleNode` has no record version, and there is no GET of an initiative's schedule.** The UI cannot take an `If-Match` for `updateInitiativeSchedule` from a read.
   - **What the panel does now:**
     - It sends the version it learned from its own create or update answer, or from a 409's `currentVersion`. Otherwise it sends the create version 1, and the dialog says so.
     - A stale version is a 409: nothing is saved, the network is re-read, the dialog shows the current value, and the next save carries `currentVersion`. There is never a silent retry.
     - The same flow covers a schedule row that exists with a null duration: the POST's 409 `initiative_schedule.exists` switches the dialog to an update.
   - **Residual risk:** between the 409 and the re-read, a third change can land. The next save then gets another 409, so nothing is ever overwritten blindly. Still, the version comes from the conflict, not from the read the user sees.
   - **Request:** add `scheduleVersion` (or `scheduleId` plus `version`) to `ScheduleNode`, or add `getInitiativeSchedule`. This is the same pattern as ARCH-R2's `getBenefitPlanValue`.
2. **seed-dev has no default business calendar,** so the working-day slip is `calendar_not_configured` on the e2e stack. A seeded synthetic Sunday–Thursday calendar would let A05 prove "+5 working days" end to end.

## 6. What remains

- **The schedule-version contract need** in §5.1.
- **The Define → G2 timeout under load** (§4.3): unresolved, and no A/B was done for this change. D-111's route-level code-splitting repair is the structural fix.
- **The archived-lines view** has no "restore" action (the API has none either).
- **Plain lists:** the execution sub-tables use the shared `RegisterTable` even when they are empty, which adds a search box per empty table. This is polish only.
- **Not built:** a transformation-level route for the schedule network. The assignment allowed a slot or a route; I chose the slot, and the network panel there shows the whole transformation's network with "This initiative" marked.

## 7. Merge instructions

- **No migration, and no API or contract change.**
- **Union merges:**
  - `i18n/index.ts`: two imports and one catalogue line per locale, appended after `sustainP4`;
  - `InitiativePage.tsx`: one import, three `SectionNav` entries after `selections`, one line after `<SelectionHistory>`;
  - `p4-benefits.spec.ts`: step 9 appended at the end.
- **Possible conflict:** if FE-F or FE-G also append to `InitiativePage.tsx`'s `SectionNav` or body, keep both entries.
- **Dependencies:** the panels import `useResourceRoles` from `pages/capacity/editing.tsx` (read-only use), and `P4FormDialog`, `FormAlert` and `textOf` from `pages/my-work/p4ui.tsx`.
