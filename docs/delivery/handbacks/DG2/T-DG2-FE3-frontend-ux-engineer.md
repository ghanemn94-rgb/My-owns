# Handback T-DG2-FE3: DG2 round-2 UI repairs (frontend-ux-engineer)

- **Stage:** DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`
- **Base revision:** `ecfa5afbb76229b9cc4f39d27760853c20bb6e78` (verified with `git rev-parse HEAD` before writing). The working tree was clean apart from untracked environment dotfiles and this run's `docs/delivery/runs/...` directory.
- **Assignment:** `docs/delivery/assignments/DG2/round-2/T-DG2-FE3.md` (sha256 `cf5db0c8…2060f8`, verified)
- **Invocation:** run `DG2-T-DG2-FE3-frontend-ux-engineer-20261002T112152Z-fd9c8f81`, session `fd9c8f81-4b3b-4adf-a208-ff8a682aa37f`
- **Scope respected:** only `apps/web/**` plus this handback. No dependency change. Nothing in `apps/api/**`, `packages/**`, `docs/**` (other than this file), `tools/**` or `.claude/**` was touched.

All demonstration data in the tests is SYNTHETIC. The G1/G2/G3 approvals recorded by the e2e are synthetic demo approvals by a synthetic dev user (`dev.office` with a synthetic per-transformation SP grant). They approve nothing real, and none of them implies any DG0–DG7 engineering gate.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/define/DefinePage.tsx` | F-DG2-201: **Activate** row action on draft KPI definitions (only for `kpi_definition.edit` holders). Adds the `ActivateKpiDialog` (POST `…/kpi-definitions/{id}/activate`, `If-Match`, no body; a 422 shows the translated problem plus the specific unmet precondition from the error pointer; a 409 refreshes). Adds the exported `activationReason()` helper. |
| `apps/web/src/pages/define/CharterPage.tsx` | F-DG2-203: the `Thesis` component (composed B0037 sentence via `@mth/shared` `composeThesis` with a localized template of the same structure; per-part display; Incomplete state). F-DG2-204: the `CharterNorthStar` component for field 5 (current statement, Current chip, Stale notice for `charter.north_star_superseded`, and a superseded statement never shown as current). Also: localized thesis and North Star warnings, and the warning list moved inside a `div role=status`, because a `ul role=status` broke axe `listitem`. |
| `apps/web/src/styles/app.css` | `.thesis-block` and `.thesis-sentence` (tokens only, logical properties). |
| `apps/web/src/i18n/en/kpi.json`, `apps/web/src/i18n/ar/kpi.json` | `kpi.definition.activate.*`: action, title, description, preconditions, confirm, and the per-pointer `missing.{unitKind,polarity,currency,unitLabel}` reasons (EN and AR). |
| `apps/web/src/i18n/en/problems.json`, `apps/web/src/i18n/ar/problems.json` | `kpi_definition__already_active`, `kpi_definition__not_draft`, `kpi_definition__not_measurable` (EN and AR). |
| `apps/web/src/i18n/en/define.json`, `apps/web/src/i18n/ar/define.json` | Thesis labels and pattern aligned to B0037 ("If we change […], then […] will improve, which will create […], because […]"). Adds `thesis.template` (EN = `THESIS_SOURCE_TEMPLATE_EN` verbatim; AR has the same structure and placeholders), `complete`, `incomplete`, `incompleteBody`, `partIncomplete`, `warnings.charter__thesis_incomplete` (names the part), `warnings.charter__north_star_superseded`, and `charter.northStar.{notCurrent,savedWithSuperseded}`. |
| `apps/web/src/pages/p2.test.tsx` | Eight new unit tests (activation EN and AR, active KPI, thesis incomplete, API-flagged part, composed EN and AR sentence, North Star stale link, superseded NS never shown as current). The AUD test now also forbids "Activate" and includes a draft KPI. |
| `apps/web/e2e/p2-journeys.spec.ts` | Two new journeys, **"Define → G2 …"** and **"Design → G3 …"**, plus the `submitAndApproveGate` helper. The AUD write-label list now includes `kpi.definition.activate.action` and `kpi.t02.approve`. |

## 2. Behaviour delivered

### F-DG2-201 (High, REQ-PB-017): KPI activation affordance

- **KPI dictionary rows:** a `draft` definition shows `Draft – not submitted` and an **Activate** row action. The action has a visually hidden `: <KPI name>` for screen readers. It is offered only when `ws.can("kpi_definition.edit")`; an AUD sees the status read-only with no Activate.
- **Activation request:** the confirm dialog explains the effect and the preconditions. It sends `POST /api/v1/transformations/{tid}/kpi-definitions/{id}/activate` with `If-Match: "<version>"` and no body.
- **Refused (422):** the dialog shows the translated problem plus the specific reason taken from the error pointer (`/unitKind`, `/polarity`, `/currency`, `/unitLabel`). It is marked with `data-problem` and `data-activation-reason`.
- **Conflict (409):** the list refreshes and the dialog shows the problem.
- **After activation:** the row shows the `Active` status, and Activate disappears.
- **G2 through native workflows:** the e2e now drives G2 to a decision through the UI: activation, good outcome, guardrail, thesis, trajectory approval by the SP, then G2 submission and decision.

### F-DG2-203 (Medium, REQ-PB-030): thesis on the Charter

- **Complete thesis:** the Charter "Transformation thesis" section renders the composed sentence `If we change {change}, then {outcomes} will improve, which will create {benefits}, because {because}.` (Arabic template in AR) and a "Complete" chip. Each part is shown below it under its B0037 label.
- **When a part is incomplete:** a part counts as incomplete if it is empty client-side (`composeThesis().missing`) **or** the API flags it (`charter.thesis_incomplete` with pointer `/charter/<part>`). In that case:
  - no sentence is composed;
  - an "Incomplete" banner states "empty parts N of 4" and that G2 stays incomplete;
  - each missing part shows an "Incomplete – not stated yet" chip, never "None" or blank;
  - the warning banner names the empty part.

### F-DG2-204 (Medium, REQ-PB-033): North Star on the charter

- **Current statement:** field 5 renders `view.northStar`, the current one returned by the API, with a "Current" chip and "Current since …".
- **Saved with a superseded North Star:** when the API returns `charter.north_star_superseded`, a "Stale" notice under the current statement says this charter version was saved with an earlier, since-superseded North Star, and asks the user to save the charter to record the current one.
- **Defensive case:** if the API ever returned a North Star with `status !== "current"`, the statement is **not** displayed. A "Stale" chip and a pointer to the Define screen are shown instead.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), pnpm workspace, offline. Playwright uses the pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; `playwright install` was not run). PostgreSQL 16 is a disposable cluster created by `with-stack.sh`. All results below are from the final tree.

| # | Command | Result |
|---|---|---|
| 1 | `pnpm -r typecheck` | exit 0 (`apps/worker typecheck: Done`, `apps/api typecheck: Done`; web runs `tsc` for both app and e2e configs) |
| 2 | `pnpm -r build` | exit 0 (`apps/worker build: Done`, `apps/api build: Done`) |
| 3 | `pnpm lint` | exit 0 (`eslint . --max-warnings=0`, no output) |
| 4 | `pnpm --filter @mth/web test` | exit 0, `Test Files 11 passed (11)`, `Tests 161 passed (161)` |
| 5 | `pnpm --filter @mth/design-tokens run check:contrast` | exit 0, `PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented` (unchanged; the documented prohibited pairs include `brand.primary #0078FF on surface.page` at 3.84:1, which is why body links use `action.primary`) |
| 6 | `E2E_PG_PORT=54782 E2E_API_PORT=3782 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` (full web e2e dir, projects chromium-en and chromium-ar) | exit 0, **`42 passed (3.3m)`**, 0 failed/flaky/skipped |
| 7 | `npx prettier --check apps/web` | exit 0, "All matched files use Prettier code style!" |
| 8 | `node tools/gates/validate.mjs --historical --stage DG1` | exit 0, `PASS gate DG1 (historical)` |

Relevant e2e lines from run 6:

```
  ✓  12 [chromium-en] › apps/web/e2e/p2-journeys.spec.ts:168:1 › Charter: create, save a second version, compare versions; the 3-5 top-outcomes warning (3.8s)
  ✓  18 [chromium-en] › apps/web/e2e/p2-journeys.spec.ts:797:1 › Define → G2: activate a KPI, pass the good outcome test, add a guardrail, compose the thesis; G2 is decided (17.0s)
  ✓  19 [chromium-en] › apps/web/e2e/p2-journeys.spec.ts:1000:1 › Design → G3: the target state is complete and G3 is decided by the Sponsor (4.6s)
  ✓  33 [chromium-ar] › apps/web/e2e/p2-journeys.spec.ts:168:1 › Charter: create, save a second version, compare versions; the 3-5 top-outcomes warning (3.5s)
  ✓  39 [chromium-ar] › apps/web/e2e/p2-journeys.spec.ts:797:1 › Define → G2: activate a KPI, pass the good outcome test, add a guardrail, compose the thesis; G2 is decided (16.3s)
  ✓  40 [chromium-ar] › apps/web/e2e/p2-journeys.spec.ts:1000:1 › Design → G3: the target state is complete and G3 is decided by the Sponsor (4.3s)
  42 passed (3.3m)
```

### Interaction checks in the "Define → G2" journey (EN and AR, real API and PostgreSQL)

Each step has `expectAccessible` (axe, no serious or critical violations) and a screenshot.

1. As `dev.lead`, Activate on "Synthetic unlabelled KPI" (unit kind *other*, no unit label) → 422. The dialog shows `problems.kpi_definition__not_measurable` and the reason `kpi.definition.activate.missing.unitLabel`. The row stays Draft.
2. Activate on "Synthetic billing error rate" → the dialog closes, the row shows `[data-status='active']` "Active", and the Activate action is gone.
3. Edit the outcome in the UI: statement, owner, specific = yes, relevant = yes, causal chain → `[data-good-outcome='pass']` with 5 criterion rows `pass`.
4. Add a strategic guardrail in the UI.
5. Charter: initially `[data-thesis='incomplete']` with 4 incomplete parts. Edit three parts and link the North Star, then save. The thesis is still incomplete, `thesisBecause` shows "Incomplete – not stated yet", no sentence is shown, and one `charter.thesis_incomplete` warning appears. Edit `because` and save: the composed sentence equals the localized template filled with the four parts, 4 parts are complete, and no thesis warning remains.
6. Define: refine the North Star in the UI. Charter field 5 then shows the **new** statement (`q.north-star` has exactly the new text), with "Current" and the `[data-north-star-link='stale']` "Stale" notice.
7. As `dev.office` (synthetic SP, not the target's author): Approve the T02 trajectory in the UI → `[data-trajectory='approved']`.
8. Gate G2: every readiness criterion is complete (asserted: zero `incomplete`), and Submit is enabled. The lead submits in the UI, `dev.office` records Approved with a rationale in the UI, and the phase subtitle becomes Design.

The **"Design → G3"** journey sets up the target-state records through the real API (10 canvas boxes ready, a gap with an owner, a capability rated 2→4, a future journey). G3 readiness is all complete; the lead submits and `dev.office` approves in the UI.

**AUD journey:** across all P2 screens, the auditor gets no enabled Activate or T02 Approve (added to the forbidden write labels).

### Screenshots (local, both languages)

The files are in `apps/web/e2e/screenshots/{en,ar}/`. This directory is **gitignored** (`.gitignore:22`), so the PNGs exist in the working tree but are not committed. The orchestrator should copy them into `docs/delivery/test-evidence/DG2/` if they are needed as committed evidence; I may not write there.

- `p2-19-kpi-activation-refused.png`: 422 with reason
- `p2-20-kpi-activated.png`
- `p2-21-good-outcome-pass.png`
- `p2-22-charter-thesis-incomplete.png`: 3 parts stated, "because" incomplete
- `p2-23-charter-thesis-composed.png`
- `p2-24-charter-north-star-current.png`: current NS plus stale link notice
- `p2-25-trajectory-approved.png`
- `p2-26-g2-ready.png`, `p2-26-g2-approved.png`
- `p2-27-g3-ready.png`, `p2-27-g3-approved.png`
- All earlier `p2-*` and `axe-summary-p2.json` were refreshed by the same run.

I visually inspected `en/p2-19`, `en/p2-22` and `ar/p2-24` (RTL layout, Arabic labels, Stale and Current chips with text and icon).

## 4. Known gaps / notes

- **The thesis is composed on the client.** The API does not return a pre-composed sentence. The live contract's `CharterView` has no sentence field; the server composes only for its `charter.thesis_incomplete` warnings and the G2 criterion. The UI calls the same pure `composeThesis` from `@mth/shared`, with a localized template of the identical B0037 structure. It also treats any API `thesis_incomplete` pointer as incomplete, so the UI can never show a part as answered that the API flags.
- **Mixed-language sentence in Arabic.** In the AR view a thesis typed in English renders inside the Arabic template with mixed bidi order. This is expected for mixed-language user content and is visible in `ar/p2-24`.
- **G3 setup goes through the API.** The canvas, gap, capability and journey records for G3 are created through the API in the e2e (their screens were already exercised in the Design journey). Only the G3 submission and decision are driven through the UI.
- **Screenshots are not committed** (gitignored; see above).
- **Pre-existing accessibility issue fixed in passing.** The charter's "other warnings" list was a `ul role="status"`, which failed axe `listitem` once it had items (it was always empty before this change). It is now a `div role="status"` wrapping a plain `ul`.

## 5. Merge instructions

- No migrations and no dependency or lockfile changes.
- Only the `apps/web/**` files listed above changed. A plain merge onto `ecfa5af` is expected to be conflict-free.
- Run `pnpm -r build` before the e2e (the web dist is served by the API in `with-stack.sh`).
