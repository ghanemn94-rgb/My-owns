# Handback T-DG3-FE-E: P3 UI completion: funding decisions, capacity editing, deliverables, milestones and waves, audit labels (frontend-ux-engineer)

- **Stage:** DG3 (P3 "Mobilization and portfolio"), BUILDING. This is engineering delivery work only. Nothing here grants or implies a business, Finance or IT approval. The demo Sponsor selection and funding decisions in the e2e are **synthetic** records that approve nothing real. Product gates G1–G6 never imply any DG gate, and product G6 never implies DG7.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-FE-E-frontend-ux-engineer-20261008T024819Z-35f8cdb4","session_id":"35f8cdb4-62d7-4c7a-bfd0-90bd63e599af"}`
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-FE-E.md`. I checked its sha256 `ca07ac77…2ae3f1` with `sha256sum` before starting, and it matched.
- **Worktree and base:** `/home/user/wt/dg3-fe-e`, branch `dg3/fe-e`, base `HEAD` `e260f5a818df03e1dfec4dc1bd614c830c053036`. Nothing is committed; the changes are in the working tree for the orchestrator to integrate.
- **Time:** started `Thu Oct 8 02:48:31 UTC 2026` (`date -u`) and finished at about 03:45 UTC. All six scope items were done in the assigned order, so the 100-minute cut-off was not reached.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` printed `PASS gate DG2 (historical)` and exited 0, at the start and again at the end (`T-DG3-FE-E-evidence/validate-dg2-historical-{start,end}.log`).
- **Write scope:** I touched only:
  - `apps/web/src/pages/{portfolio,roadmap,capacity}/**`;
  - `lib/auditChanges.ts` and its test;
  - the `namespaces` prop in `components/RecordForm.tsx` (see §5.1 for why that file);
  - the `portfolio`, `roadmap` and `capacity` i18n files and the audit keys of `transformations` (EN and AR);
  - the new spec `apps/web/e2e/p3-ui-completion.spec.ts` with its `p3-completion-*` screenshots;
  - this handback and its evidence.

  I did not touch `app/**`, `api/**`, `i18n/index.ts`, any other e2e spec, `apps/api/**`, `packages/**` or `docs/**` outside the handback. I removed the empty harness `.claude/.cc-writes` directories before every test run.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/components/RecordForm.tsx` | **Item 6c.** Adds an optional `namespaces` prop to `RecordFormProps` (so to `RecordDialog` and `InlineRecordForm`). When set, the form-level alert and the inline field errors look up `<ns>.problem.<code>` first: the problem code, then its field-error codes. After that they fall back to `problems.*` as before. When the prop is absent, behaviour is unchanged. |
| `pages/portfolio/funding.tsx` (new) | **Item 1.** `useFundingDecisions` (`GET /funding-decisions?transformationId&initiativeId`, key `p3Keys.initiativePart(…,"funding-decisions")`) and `FundingSection`: the history, the deselect-rule note, and the "Record funding decision" business-approval dialog. |
| `pages/portfolio/roadmapParts.tsx` (new) | **Item 3.** The card's deliverables (create, edit, archive) and milestones (create, edit). They replace FE-A's read-only lists. |
| `pages/portfolio/InitiativePage.tsx` | Mounts the funding, deliverables and milestones sections and adds the "Funding decisions" nav entry. The edit form passes `namespaces={PORTFOLIO_NS}` (6c). The old read-only `Deliverables`/`Milestones` and their unused imports are removed. |
| `pages/portfolio/PortfolioPage.tsx` | The create form passes `namespaces={PORTFOLIO_NS}` (6c). |
| `pages/portfolio/common.tsx` | `PORTFOLIO_NS`. `ActionDialog` gains an optional `method` (`POST` by default, or `PATCH`), used for the deliverable archive. |
| `pages/portfolio/fe-e.test.tsx` (new) | 18 tests (9 EN, 9 AR), stubbed API. |
| `pages/capacity/editing.tsx` (new) | **Item 2.** `useResourceRoles`, `useCapacityRows`, month helpers, `RolesSection` (create, edit labels, archive), `CapacityRowsSection` (create, edit), `DemandDialog` (create, or edit while planned), and a small If-Match confirm dialog. |
| `pages/capacity/CapacityPage.tsx` | Mounts the roles and capacity-row sections. Adds "Add demand" and "Edit" (planned only, `capacity.edit`) next to FE-B's commit and release, which are unchanged. |
| `pages/capacity/api.ts` | The contract views `ResourceRole` and `ResourceDemand` become `type` aliases instead of interfaces, so they satisfy `RecordDialog<R extends Record<string, unknown>>`. The shape is unchanged. |
| `pages/capacity/fe-e.test.tsx` (new) | 13 tests: 1 month-helper test, plus 6 EN and 6 AR, stubbed API. |
| `pages/roadmap/waves.tsx` (new) | **Item 4.** `EditWaveDialog` (planned start and end, owner, notes; the source text is shown read-only), `AddWaveDialog` (a non-source wave), and `ROADMAP_NS`. |
| `pages/roadmap/RoadmapPage.tsx` | The waves table gains "Planned dates", "Owner" and an "Edit" action, plus "Add wave" (all need `roadmap.edit`). |
| `pages/roadmap/api.ts` | `RoadmapWave` becomes a `type` alias (same reason as capacity). |
| `pages/roadmap/fe-e.test.tsx` (new) | 8 tests (4 EN, 4 AR), stubbed API. |
| `lib/auditChanges.ts` | **Items 6a and 6b.** Labels `line_kind`, `benefit_class`, `investment_class`, `unit_kind`, `polarity`, `confidence`, `result_kind`, `result_period`, `frequency` and `recurrence` from a **closed code list** taken from the shared constants. `confidence` is trimmed because it is stored as char-padded H/M/L. Adds `label_en`/`label_ar` (BE-E mismatch). |
| `lib/auditChanges.test.ts` | +28 tests (97 → 125). |
| `i18n/{en,ar}/portfolio.json` | `fundingDecision.*`, new `deliverable.*`/`milestone.*` keys, and `problem.funding__{not_selected,not_revocable,amount_invalid,on_behalf_not_supported}`. |
| `i18n/{en,ar}/capacity.json` | `status.*`, `edit.*`, `roles.*`, `rows.*`, new `demands.*`, and `problem.{resource_role__code_taken, resource_role__archived, capacity__duplicate, resource_demand__{not_planned,not_committed,release_first,archived}, initiative__read_only, validation__period_month}`. |
| `i18n/{en,ar}/roadmap.json` | `waves.*` (edit, add, create fields) and `problem.roadmap_wave__{planned_range,horizon_range,duplicate_code,too_many,seeded_not_archivable}`, `initiative__read_only`. |
| `i18n/{en,ar}/transformations.json` | Audit keys only: `actions.resource_role_archive`, `field.label_en/label_ar`, `value.kind.executive`, and the ten enum value maps. The labels are copied from the existing `businessCases`, `kpi` and `benefitFormulas` texts, so the trail uses the same words as the screens. |
| `apps/web/e2e/p3-ui-completion.spec.ts` (new) | Real-stack e2e: 7 tests per project. |
| `apps/web/e2e/screenshots/{en,ar}/p3-completion-*.png`, `axe-summary-p3-completion.json` | 20 screenshots per language plus the axe summary. The directory is gitignored; the tracked copies are in `T-DG3-FE-E-evidence/screenshots/{en,ar}/`. |

## 2. Flows and the requirements they close

All data is synthetic. Every string is translated at render time (AR-RTL and EN-LTR), and server problems are translated from their **code**; the English `detail` is never shown. There is one form-level alert per dialog, with inline field errors. Every edit sends If-Match, and every create sends an Idempotency-Key. A version 409 shows `RecordDialog`'s conflict panel, or the page's `ConflictNotice` for the confirm-only actions. No DG0–DG7 text appears.

### 2.1 Funding decisions: REQ-S09-003, REQ-S04-006 (funding part); ADR-0021 §3/§6, ADR-0023 §7

- REQ-S09-003 acceptance: *"A08: a selected initiative without a funding approval shows 'Selected - unfunded' and cannot be launched."*
- REQ-S04-006 acceptance (the G4 part is BE-E's): *"G4 submission with an initiative lacking a funding decision or capacity commitment is rejected naming it…"*. This task adds the UI that records the funding decision G4 looks for.

**The dialog.** On the Initiative Card, the "Funding decisions" section offers **"Record funding decision (Business approval)"**:

- It is offered only when the initiative is `selected` or `funded`, is not closed, and the user holds `funding.approve` (FIN and SP by default).
- It is a `RecordDialog` with these fields:
  - outcome: approved, rejected, deferred or revoked;
  - amount: a decimal string; empty means Unknown, never 0;
  - currency: the transformation's currency, default SAR;
  - funding source;
  - conditions;
  - **rationale (required)**;
  - optional business case: the transformation's cases that are unlinked or linked to this initiative.
- The body is validated with the shared `fundingDecisionCreate` before it is sent.
- The description reads "Business approval: you record your own decision…".
- A lock note reads "Decided in person: recording a decision on someone else's behalf is not available." **No `onBehalfOfUserId` control exists.** Both the unit tests and the e2e assert this.

**The 422s.** Each is the dialog's single `role="alert"`:

- `funding.not_selected`;
- `funding.not_revocable`, also seen on the real stack;
- `funding.amount_invalid`, which is also **inline at `/amount`** (`aria-invalid`);
- `funding.on_behalf_not_supported`.

**History.** The history shows outcome (icon and text), `DEC-nn`, amount (exact decimal through `formatDecimal` with up to 4 fraction digits, plus the currency) or **Unknown**, rationale, source, conditions, business-case link, time, decider and role.

**Funded and the deselect rule.** After an approved decision, `useP3Refresh` re-reads the initiative: the card's Funding shows **Funded**, and so does the portfolio list's Funding column (real stack, EN and AR). The **deselect rule** (BE-E §7.1) is visible: when the initiative is `selected` and not funded but its latest decision is `approved`, the card shows a warning note that the earlier approval predates the latest selection and no longer counts. The Funding cell shows "Selected - unfunded" / "مختارة - غير ممولة". This was verified on the real stack after a deselect and a re-selection.

### 2.2 Capacity editing: REQ-PB-059, REQ-S09-004

- REQ-PB-059 acceptance: *"A01: a capacity demand exceeding availability shows a conflict indicator; G4 lists initiatives without owners."*
- REQ-S09-004 acceptance: *"…overlapping demand above capacity shows a conflict indicator."*

**Resourcing roles.**

- Create: code, then the EN and AR labels. The code is fixed after creation.
- Edit the labels with If-Match. Archive is a confirmation that sends `PATCH {status:"archived"}` with If-Match.
- `resource_role.code_taken` (409) and `resource_role.archived` (422) are translated. The 409 was unit-tested, and the retry reuses the form's Idempotency-Key.

**Capacity rows.**

- Create: role, then month (a select of `YYYY-MM-01` periods, 6 months back to 24 ahead plus any recorded month), then available FTE as a decimal string, owner and note.
- Edit the FTE, owner and note with If-Match.
- `capacity.duplicate` (409) is translated. This was seen on the real stack.

**Resource demand.**

- Create: initiative (closed ones are not offered), role, month, demand FTE, owner and note.
- Edit while it is planned, with If-Match. `resource_demand.not_planned` and the other `resource_demand.*` codes are translated.
- FE-B's commit and release are kept unchanged. The demand row's "Edit" has a hidden row context. In Arabic, edit is **"تعديل"**, because FE-B's "Release" is already "تحرير" on the same row; using تحرير for both would have given two buttons with the same accessible name.

**Conflict indicator.** Every save runs `useP3Refresh`, which invalidates `["capacity", tid, …]`. The grid's conflict indicator and shortfall are therefore always the server's.

- Real stack: 1.00 available against 2.50 demand shows **"Conflict: short by 1.5 FTE"**.
- A month without a capacity row stays **Unknown** (icon and text, `capacity.unknown`), never 0.

### 2.3 Deliverables and milestones: REQ-PB-045, REQ-S09-006

- REQ-PB-045 acceptance: *"A01: T05 persists all 14 source fields; Key deliverables outside 3-7 shows a warning."*
- REQ-S09-006 acceptance: *"A14: moving a milestone on the timeline updates the table and board; conflicting concurrent edits show a conflict."*

**Deliverables on the card.**

- Create, edit (title, description, owner, due date) and archive. Archive is an `ActionDialog` `PATCH {archiveReason}` with If-Match. The reason is required, at least 3 characters, and the blank-text rule applies.
- The server's `countWarning` drives the 3–7 note. Real stack: the warning shows at 0, and clears once the third deliverable is saved. It is never a block.

**Milestones on the card.**

- Create needs `initiative.edit`. The fields are title, description, owner, wave (defaulting to the initiative's wave) and forecast date.
- Edit needs `roadmap.edit` and uses If-Match.
- The approved (baseline) date stays on the roadmap's approve-date. It is never an edit field.

**Closed initiatives.** A cancelled or completed initiative shows these sections with no write control. A closure that races an open dialog answers 422 `initiative.read_only`, which is translated as the dialog's one alert (unit test).

**Roadmap views.** After the saves, `useP3Refresh` also invalidates the single `["roadmap", tid]` entry. Real stack, EN and AR:

- the roadmap timeline lists the new milestone;
- the initiative table's "Next milestone" and the work board card show **the same formatted date** as the timeline;
- the roadmap's deliverables list shows all three.

### 2.4 Waves: ADR-0023 §1; REQ-PB-050

- REQ-PB-050 acceptance: *"…four waves seeded with values verbatim … overlapping horizons are accepted."*
- **Edit** (`roadmap.edit`, If-Match): planned start, planned end, owner and notes.
  - The dialog shows the wave's name, purpose, horizon, entry criteria and exit evidence in EN and AR in a locked "Source text (B0079, verbatim): not editable" panel. **No control edits them** (unit test and e2e).
  - The hint says that overlap is allowed.
  - `roadmap_wave.planned_range` is inline at the planned end and translated (unit test).
  - Real stack: wave 1 is set to 2026-11-01 – 2027-02-28 and wave 2 to 2026-12-01 – 2027-06-30. **The overlap is accepted.**
- **Add a non-source wave:** code, the EN and AR name, purpose, horizon, entry criteria and exit evidence, the horizon weeks, the planned dates and owner. Unit-tested: POST with an Idempotency-Key.
- **EN/AR label overrides are not built,** because the API and the contract don't accept them. See §4.1.

### 2.5 The initiative's wave and planned dates (item 5)

Already present in FE-A's card edit (`waveId`, `plannedStart`, `plannedEnd`), so **nothing was added**. What changed is that the form now translates `initiative.planned_range` specifically, inline at the planned end and in the alert, through `namespaces` (unit test, EN and AR).

### 2.6 Translation gaps (item 6)

**(a)** Every remaining P3 enum on the audit trail is now labelled in EN and AR:

- `line_kind`, `benefit_class`, `unit_kind`, `polarity`, `confidence`, `result_kind`, `result_period`, `frequency` and `recurrence`;
- also `investment_class`, the counterpart of `benefit_class`.

Only codes from the shared closed lists become catalogue keys. Any other value stays marked "without a translation". `result_unit` and `result_currency` stay exact technical codes: they are a free unit text and an ISO 4217 code, not enums.

**(b)** I checked FE-A's anticipated names against BE-E's actual writes in `funding.ts`, `capacity.ts` and `resource-demands.ts` at this base. There were **three mismatches, all fixed**:

1. the action **`resource_role.archive`** had no label;
2. the fields **`label_en` and `label_ar`** (on `resource_role.create/update`) were not in the catalogue, so they showed as raw keys;
3. the value **`kind: "executive"`**, on the `decision.create` written with each funding decision, had no label.

Every other action and field BE-E writes was already labelled:

- `funding_decision.create`, `decision.create`, `initiative.fund/unfund`;
- `resource_role.create/update`;
- `capacity.create/update/archive`;
- `resource_demand.create/update/archive/commit/release`;
- the fields `initiativeId`, `decisionCode`, `outcome`, `amount`, `currency`, `approverRoleCode`, `resource_role_id`, `period_month`, `available_fte`, `demand_fte`, `owner_user_id`, `note`, `status`, `committed_by`.

The new test "BE-E audit writes…" pins each action with the exact `changes` keys copied from the API source. The e2e checks the live trail: it shows "Resource demand committed" and similar labels, with no raw code and nothing marked untranslated.

**(c)** The `RecordDialog` `namespaces` prop (see §1). The portfolio create and edit forms translate `initiative.read_only` and `initiative.planned_range` from `portfolio.problem.*`, and so do all the new forms (`portfolio`, `capacity`, `roadmap`).

### 2.7 Access

- AUD sees everything read-only. On the real stack, the card, capacity and roadmap showed no record, add, edit or archive control, and **no non-GET request** was sent apart from the language preference.
- Write controls follow the permissions the routes enforce:
  - `funding.approve`;
  - `capacity.edit`;
  - `initiative.edit` (deliverables, milestone create);
  - `roadmap.edit` (milestone edit, waves).
- The server re-checks every write; the UI only hides what would be refused.

## 3. Checks run (final tree, Node 24.21.0, offline)

The logs are in `docs/delivery/handbacks/DG3/T-DG3-FE-E-evidence/`.

| Check | Command | Exit | Result / log |
|---|---|---|---|
| Historical DG2 gate (start, end) | `node tools/gates/validate.mjs --historical --stage DG2` | 0, 0 | `PASS gate DG2 (historical)` (`validate-dg2-historical-{start,end}.log`) |
| Typecheck | `pnpm -r typecheck` | 0 | `typecheck.log` |
| Build | `pnpm -r build` | 0 | `build.log` |
| Lint | `pnpm lint` | 0 | `lint.log` |
| Prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log` (rerun after the handback was written: `prettier-final.log`) |
| Contrast | `pnpm --filter @mth/design-tokens run check:contrast` | 0 | `contrast.log` |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | 79 files, **1517/1517** (`test-locale-unset.log`) |
| Unit, C.UTF-8 | `env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | 79 files, **1517/1517** (`test-c-utf8.log`) |
| e2e, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE QA_PG_PORT=23850 E2E_API_PORT=23851 MTH_PORT_POOL=23860-23899 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | 0 | **128 passed** (8.2 min) (`e2e-locale-unset.log`) |
| e2e, C.UTF-8 | the same with `LANG=C.UTF-8 LC_ALL=C.UTF-8`, `QA_PG_PORT=23852 E2E_API_PORT=23853` | 0 | **128 passed** (8.1 min) (`e2e-c-utf8.log`) |

**New web tests:** 67 in all, every one passing in both locale settings.

- 39 component tests with stubbed API responses, EN and AR:
  - `portfolio/fe-e.test.tsx`: 18;
  - `capacity/fe-e.test.tsx`: 13 (one of them a locale-independent month-helper test);
  - `roadmap/fe-e.test.tsx`: 8.
- 28 audit tests in `auditChanges.test.ts` (97 → 125):
  - 15 BE-E actions;
  - 10 enums;
  - 3 others.

**e2e per spec and project** (`T-DG3-FE-E-evidence/e2e-counts.txt`):

| Spec | chromium-en (unset / C.UTF-8) | chromium-ar (unset / C.UTF-8) |
|---|---|---|
| `p3-ui-completion.spec.ts` (new) | 7/7 · 7/7 | 7/7 · 7/7 |
| `journeys.spec.ts` | 9/9 · 9/9 | 9/9 · 9/9 |
| `p2-journeys.spec.ts` | 12/12 · 12/12 | 12/12 · 12/12 |
| `p2-blank-text.spec.ts` | 9/9 · 9/9 | 9/9 · 9/9 |
| `session-end.spec.ts` | 5/5 · 5/5 | 5/5 · 5/5 |
| `p3-portfolio.spec.ts` | 6/6 · 6/6 | 6/6 · 6/6 |
| `p3-prioritization-roadmap.spec.ts` | 7/7 · 7/7 | 7/7 · 7/7 |
| `p3-business-cases.spec.ts` | 6/6 · 6/6 | 6/6 · 6/6 |
| `p3-seams.spec.ts` | 3/3 · 3/3 | 3/3 · 3/3 |

### Earlier non-zero runs (disclosed, logs kept)

- **The background wrapper of the two full e2e runs exited 1, but both suite runs exited 0.** The wrapper's last command, `tail -6 e2e-locale-unset.log e2e-c-utf8.log` (a summary print), failed with "tail: option used in invalid context -- 6". The two Playwright commands before it each recorded `exit=0` at the end of their own logs, and the counts above come from those logs.

- **`e2e-p3-ui-completion-dryrun1.log`** (my spec alone): exit 1. The setup's initiative submit got 422 `initiative.outcome_before_activity`, because the contribution had no KPI. That is correct server behaviour; I added the outcome KPI to the setup.
- **`e2e-p3-ui-completion-dryrun2.log`**: exit 1, 4 passed and 2 failed. My locator `section:has(#deliverables)` was wrong, because `Section` puts the id on the `<section>` itself. I changed it to `section#deliverables`.
- **`e2e-p3-ui-completion-dryrun3.log`**: exit 1, 4 passed and 2 failed. The work board shows only the next milestone's **date**, not its title. The test now asserts that the timeline, table and board all show the same date.
- **`e2e-p3-ui-completion-dryrun4.log`**: 14/14 passed, exit 0.
- **Unit iterations** (not logged separately):
  - The glossary test flagged "التحول" without its shadda in three new AR strings; fixed.
  - The capacity test regexes needed escaping for the parentheses in labels.
  - The AR edit/release name clash described in §2.2 was a real UI defect, and is fixed.
  - The first deliverable-archive design (a `RecordDialog` edit with one field) answered "no changes to save" instead of an inline required error. I replaced it with `ActionDialog` `PATCH`.
- `apps/web/e2e/screenshots/` is gitignored (`.gitignore:22`), so suite runs change no tracked file there. The durable copies of my screenshots and axe summaries are in `T-DG3-FE-E-evidence/screenshots/{en,ar}/`.

### Interaction checks run on the real stack (EN and AR)

1. **Demo SP (dev.office) funding:**
   - opened the dialog; saw the business-approval text and the in-person note, and no on-behalf field;
   - submitted with no rationale and got an inline error, with nothing sent;
   - recorded 1250000.50 SAR with a source and a rationale;
   - the card showed Funded and the history showed `1250000.5000` SAR; the portfolio list's row showed Funded;
   - after an API deselect and re-select, the card showed 'Selected - unfunded' plus the deselect-rule note;
   - outcome Revoked was refused with exactly one alert, the translated `funding.not_revocable`.
2. **Lead, deliverables and milestone:**
   - 3 deliverables with due dates; the count went 1, 2, 3 and the 3–7 warning cleared;
   - 1 milestone with a wave and a forecast;
   - the roadmap timeline, table and board showed the same date, and the deliverables list showed the three.
3. **Lead, waves:** edited the planned dates and owner of wave 1, then gave wave 2 overlapping dates, which was accepted. The source text stayed read-only.
4. **Capacity owner (TO):**
   - created a role and a 1.00 FTE row for Nov 2026;
   - a duplicate row was refused with one alert, the translated `capacity.duplicate`;
   - demands of 2.50 (Nov) and 0.50 (Dec) gave "short by 1.5 FTE" and an Unknown December;
   - committed the November demand.
5. **Lead, audit trail:** labelled, with no raw codes and nothing marked untranslated.
6. **Auditor:** visited the card, capacity and roadmap. There were no write controls and only GET requests.
7. **Same origin:** every request stayed on the application origin (`trackRequests` in the funding test).

**Accessibility.** axe (WCAG 2.0/2.1 A and AA) found **0 violations of any impact** on 11 states per language, recorded in `screenshots/{en,ar}/axe-summary-p3-completion.json`:

- funding dialog, funding refused;
- deliverable, milestone and wave dialogs;
- role and capacity dialogs, capacity duplicate, demand dialog;
- capacity page, auditor capacity.

**Screenshots.** In `apps/web/e2e/screenshots/{en,ar}/` and copied to `T-DG3-FE-E-evidence/screenshots/{en,ar}/`:

- funding: `p3-completion-funding-dialog`, `-funded`, `-portfolio-funded`, `-funding-refused`, `-reselected-unfunded`;
- card and roadmap: `-deliverable-dialog`, `-milestone-dialog`, `-card-parts`, `-roadmap`, `-wave-dialog`, `-waves`;
- capacity: `-role-dialog`, `-capacity-duplicate`, `-demand-dialog`, `-capacity-conflict`, `-capacity-committed`;
- trail and auditor: `-audit-trail`, `-aud-card`, `-aud-capacity`, `-aud-roadmap`.

I reviewed the AR funding dialog, the EN capacity conflict and the AR wave dialog/roadmap. In each, RTL/LTR is correct, numbers and codes are isolated LTR, and Unknown shows its icon and text.

## 4. Backend or contract mismatches

1. **Wave label overrides (ADR-0023 §1 against the contract and the API).**
   - ADR-0023 §1 says the editable wave columns include "`label_en/ar` overrides".
   - Neither `RoadmapWaveUpdate` in `docs/api/openapi.yaml` (`plannedStart`, `plannedEnd`, `ownerUserId`, `notes`, `status`) nor `apps/api/src/modules/portfolio/waves.ts` `roadmapWaveUpdate` (a `strictObject` with the same five keys) has them, and `RoadmapWave` has no label column.
   - **Reproduction (by inspection; I did not send this request):** `PATCH /api/v1/transformations/{id}/waves/{waveId}` with `If-Match` and `{"labelEn":"X"}`. The body goes through `parseBody(roadmapWaveUpdate, …)`, and `roadmapWaveUpdate` is a `z.strictObject` without that key, so it should be refused as a validation error. I did not observe the exact status.
   - So the UI edits the five accepted columns and offers no override control. The architect (ARCH-04 owns the contract and ADR follow-ups) should either add the columns to the contract and API or amend the ADR. **This part of item 4 stays open.**
2. **Wave GET for the conflict reload.** `RecordDialog` reloads through `GET /transformations/{id}/waves/{waveId}`, which exists. The resource-role routes have **no single-item GET** (`GET …/resource-roles/{id}` is not in the contract), so the role edit's 409 reload reads the list and picks the role (`loadLatest`). This is not a defect; it is recorded for reviewers.
3. **No shared zod mirrors** for `ResourceRole`, `Capacity`, `ResourceDemand` or `RoadmapWave`(`Create/Update`), nor `milestoneUpdate`. Those forms validate on the server only. Field errors land inline through their pointers, and the funding, deliverable and milestone creates use the shared schemas. If ARCH adds the mirrors, the forms should pass them as `createSchema`/`updateSchema`.

## 5. Notes, deviations and what is left undone

1. **The assignment names `apps/web/src/components/RecordDialog.tsx`, which does not exist.** `RecordDialog` is exported from `components/RecordForm.tsx`, so I made the item-6c `namespaces` change there and changed nothing else in that file.
2. **Item 4's label overrides are not done**, because the API doesn't accept them (§4.1).
3. **Item 5 needed no change** (§2.5).
4. **The roadmap page has no create button for deliverables and milestones.** The card is the creation point, as item 3 asks ("initiative card, and the roadmap where it fits"). The roadmap shows them through the shared key, and its existing move, approve-date, submit and accept actions are unchanged.
5. **Not built (out of scope):**
   - re-activating an archived role or capacity row;
   - archiving a planned demand from the UI. The API supports it with `PATCH {status:"archived"}`; FE-B's release stays the UI path.

## 6. Merge instructions

- No migrations, no dependency or lockfile changes, and no API or contract changes.
- Merge `apps/web/**` as delivered.
- Expected conflicts:
  - `i18n/{en,ar}/transformations.json` if ARCH-04 or another task adds audit keys. They are additive keys only, so merge them by key.
  - `components/RecordForm.tsx` only if another task edits `RecordFormProps` or `RecordFields`.
- Run `pnpm -r build` before the e2e: `with-stack.sh` serves `apps/web/dist`.
