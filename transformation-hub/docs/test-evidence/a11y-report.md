# Accessibility (axe) report — REQ-ARC-008

Automated accessibility checks for the web app, run in CI as part of `pnpm test:e2e` (Playwright job) by
`e2e/tests/a11y.spec.ts` with `@axe-core/playwright` 4.13.0 (axe-core 4.13.0).

> **Scope of the claim.** Automated rules find only part of the WCAG failures that exist. A clean axe run is
> **not** a statement of WCAG 2.1 AA conformance. Screen-reader testing (NVDA/JAWS/VoiceOver, Arabic and English),
> zoom/reflow at 400 %, and a manual review of the items listed under "Open items" are still required before any
> conformance claim.

## What is checked

- **Rule sets:** `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` (gating) plus `best-practice` (reported, advisory).
- **Gate:** a scan fails on any WCAG violation of impact `serious` or `critical`. `moderate`/`minor` WCAG findings
  and best-practice findings are listed below but do not fail the build.
- **Excluded rules:** none. The spec keeps an `EXCLUDED_RULES` list (each entry needs a written reason repeated in
  this report); it is empty.
- **Screens (57 states × 2 languages = 114 scans):** login; portfolio home (+ 390 px mobile); My Work / Inbox;
  project wizard — every step (template, details, people, people with the user combobox open, review; nothing is
  submitted); project cockpit, status-dimension page, charter, members; Committee Hub — overview, committee detail,
  meetings, meeting detail, decisions, decision detail, actions, escalations; plan — WBS, timeline (Gantt),
  milestones, deliverables, dependencies, baselines, look-ahead, what-if, health, task / milestone / deliverable /
  baseline / periodic-update detail; workstreams list, workstream detail (+ tasks tab); RAID — risks, issues,
  assumptions, dependencies, change requests, risk detail, change-request detail; gates list, gate detail
  (+ criterion expanded, + 390 px mobile); Documents & Evidence Center — documents, evidence (+ record chosen and
  "link evidence" dialog open), sources, document detail, source detail with claims; administration; an open modal
  dialog (new risk).
- **Languages:** every state in English (`lang=en dir=ltr`) and Arabic (`lang=ar dir=rtl`); the spec asserts
  `lang`/`dir` before scanning. The language is set with the `hub_locale` cookie, so the personas' saved preference is
  never changed.
- **Personas:** Demo Project Manager (project screens, inbox), Demo Portfolio Admin (wizard, administration),
  signed out (login). Fixture ids are looked up by their seeded codes (DEMO-DC, DEC-004, WS01-A01, G1, SRC-001 …).
- **Tooling licence:** `@axe-core/playwright` 4.13.0 and `axe-core` 4.13.0 are MPL-2.0 (file-level weak copyleft;
  "review required" in `scripts/ops/licence-policy.json` *if shipped*). They are unmodified dev-only dependencies of
  the private `e2e` test package and are not part of any shipped image: `node scripts/ops/licence-check.mjs` (which
  lists `--prod` dependencies) does not include them — 0 FAIL, 2 pre-existing WARN, 258 OK.
- **Run time:** 7–9 minutes for the 118 a11y tests (whole e2e suite 10.5 minutes) on the shared build machine.
- **Evidence:** the full axe JSON of every scan is attached to its Playwright test (`axe-<locale>-<screen>.json`) and
  written to `e2e/test-results/a11y/axe/`; the per-scan summary is `e2e/test-results/a11y/axe-summary.json`
  (both uploaded with the CI `e2e-report` artifact). The block at the end of this file is regenerated after every
  complete run.

## Violations found and fixed

Baseline: first complete run of the spec against the web app before any fix (only `data-testid` hooks added for the
spec) — 112 scans; the "link evidence" dialog state (2 scans) was added afterwards. 15 of 112 scans failed the gate.

How to run: start the stack as for the rest of the e2e suite (API in DEMO mode with
`HUB_RATE_LIMIT_PUBLIC_PER_MINUTE=1000`, production web build), then
`HUB_WEB_URL=<web url> pnpm --filter @hub/e2e exec playwright test tests/a11y.spec.ts`.

| Rule (axe id) | Impact | Kind | Found (nodes / scans) | Where | Fix |
|---|---|---|---|---|---|
| `aria-prohibited-attr` | serious | WCAG 4.1.2 | 42 / 2 | RAID risk heat map (risks tab, en+ar) | `aria-label` on a plain `<span>` is not allowed. The visible count is now `aria-hidden` and each cell carries screen-reader text ("Probability 5, impact 1: 0 risk(s)"). `components/planning/raid.tsx` |
| `definition-list` | serious | WCAG 1.3.1 | 16 / 4 | Portfolio project cards (desktop and 390 px, en+ar) | The "Open project" link was a direct child of the `<dl>`; moved outside so the list holds only `dt`/`dd` groups (same layout). `app/(app)/page.tsx` |
| `nested-interactive` | serious | WCAG 4.1.2 | 40 / 2 | Evidence tab record picker (en+ar) | `role="listbox"`/`option` wrapped real buttons. Now a plain list of toggle buttons with `aria-pressed`; same fix in the document picker of the "link evidence" dialog. `components/EvidenceTargetPicker.tsx`, `components/EvidencePanel.tsx` |
| `scrollable-region-focusable` | serious | WCAG 2.1.1 | 7 / 7 | Gantt timeline, health-tab table, change-request "proposed change" JSON, source compare table | New `components/ScrollRegion.tsx`: when (and only when) the content overflows, the container gets `tabindex=0`, `role=group` and a name (table caption / section title), so keyboard users can scroll it; focus ring drawn inside. Used by `DataTable`, `Gantt`, the WBS table, the what-if table and the change-request `pre`. |
| `empty-table-header` | minor | best practice | 20 / 20 | Demo-badge column of 8 tables | Header text "Demo record" / "سجل تجريبي" for assistive technology (`Column.headerHidden`), never an empty `<th>`. |
| `heading-order` | moderate | best practice | 2 / 2 | Gate detail, criterion expanded | Criterion key is now an `h3` under the "Criteria" `h2`, so its "Evidence"/"Waivers" `h4`s nest correctly (no visual change). |
| `landmark-unique` | moderate | best practice | 6 / 6 | Portfolio cards (one "Status dimensions" region per card); Committee meetings (two "Pagination" navs) | Card section is no longer a named landmark (its `h3` stays); `Pagination` takes a label, `DataTable` passes its caption ("Pagination — Meetings"). |

Totals at baseline: **105 serious nodes in 4 rules (15 failing scans)** and 28 advisory nodes in 3 best-practice
rules. After the fixes: **0 violations of any impact** (see the generated block). One intermediate regression was
caught by the spec itself: naming the scroll containers as `region` landmarks duplicated their section's name
(`landmark-unique`, 5 nodes) — they are `group`s now.

### Found outside axe (manual checks) and fixed

- **Non-text contrast of form-control borders (WCAG 1.4.11).** Token `--hub-border-strong` (#9aa7b8, used for
  input/select/textarea and secondary-button borders) had only 2.20–2.44:1 against the surface tokens. Changed to
  #7a8799: 3.65:1 on `surface`, 3.40:1 on `bg`, 3.28:1 on `surface-muted`, 3.14:1 on `primary-soft`. All text/
  background token pairs were recalculated and are ≥ 6.28:1 (lowest: warning on primary-soft); focus colour
  #1b66c9 is ≥ 4.98:1 against every surface. `--hub-border` stays decorative (card edges/dividers only).
- **Administration tabs** referenced tab panels that are not rendered (`aria-controls` of unselected tabs pointed at
  missing ids). Only the selected tab now references its panel. (axe did not flag it.)

## Keyboard operability (automated in the same spec, en and ar)

| Check | Result |
|---|---|
| Skip link is the first tab stop, has a visible focus ring, and moves focus to `<main>` | Pass (en, ar) |
| 25 consecutive tab stops on the plan screen each show a visible focus indicator; focus moves through > 10 distinct elements (no trap) | Pass (en, ar) |
| Tabs widget: Arrow keys move selection in reading direction (Right in LTR, Left in RTL), Home/End jump | Pass (en, ar) |
| Modal dialog opened with Enter: focus moves inside, 15 × Tab stays inside, Escape closes it and focus returns to the opener | Pass (en, ar) |
| Overflowing Gantt chart: reachable with Tab (named group), visible focus, arrow keys scroll it in reading direction | Pass (en, ar) |
| Evidence record picker: option focusable with visible focus, Enter chooses it | Pass (en, ar) |
| "Link evidence" dialog opened with Enter: document chosen with Space (`aria-pressed=true`), Escape closes and returns focus | Pass (en, ar) |

Not covered by automation (manual review still needed): full tab order of every screen, keyboard use of every
command dialog, the user combobox with a screen reader, 400 % zoom / reflow, and Windows High Contrast mode.

## Open items (not fixed here)

- **Language of parts (WCAG 3.1.2):** some server-provided strings are English only (e.g. template RACI functions,
  dimension explanations — see `apps/web/README.md`). In the Arabic UI they are not marked `lang="en"`, because the
  API does not say which language a string is in. Needs a language tag from the API or bilingual data.
- **axe "incomplete" items** (listed in the generated block) are cases axe cannot decide automatically. Reviewed:
  SVG axis labels and the "Today" marker of the Gantt use `--hub-text-muted` (7.56:1) and `--hub-warning` (7.29:1)
  on white; list items in scrolling containers and dialog text use the same token pairs as above. The WBS table uses
  `th scope="rowgroup"` workstream group headers spanning all columns, and the heat map puts its impact column
  headers in the last row (each data cell also carries a full text description) — both valid patterns axe cannot
  resolve. A manual screen-reader pass should confirm the table announcements.
- The heat-map cells with zero risks are drawn at 50 % opacity and contain no text (their text is screen-reader
  only); the colour itself is decorative — the count and rating are conveyed in text.

<!-- a11y:auto:start -->

_Generated by `e2e/tests/a11y.spec.ts` (axe-core 4.13.0, tags wcag2a, wcag2aa, wcag21a, wcag21aa + best-practice). Do not edit this block by hand._

- Scans: **140** (70 screen states × 2 locales: en/LTR, ar/RTL)
- Gating result (serious/critical WCAG violations): **PASS — 0**
- Excluded rules: none
- axe "incomplete" (could not be decided automatically — manual review): `color-contrast` 80 nodes in 9 scans; `th-has-data-cells` 4 nodes in 4 scans

| Rule | Impact | Kind | Nodes | Scans | Example selector (screen) |
|---|---|---|---|---|---|
| `page-has-heading-one` | moderate | best-practice (advisory) | 2 | 2 | `html (finance-restricted [en])` |

<details><summary>Per-scan results</summary>

| Screen | Locale | Violations (rule ×nodes) |
|---|---|---|
| login | en | 0 |
| portfolio-home | en | 0 |
| portfolio-home-390 | en | 0 |
| inbox | en | 0 |
| wizard-1-template | en | 0 |
| wizard-2-details | en | 0 |
| wizard-3-people | en | 0 |
| wizard-3-people-combobox-open | en | 0 |
| wizard-4-review | en | 0 |
| project-cockpit | en | 0 |
| project-dimension | en | 0 |
| project-charter | en | 0 |
| project-members | en | 0 |
| committee-hub | en | 0 |
| committee-detail | en | 0 |
| committee-meetings | en | 0 |
| committee-meeting-detail | en | 0 |
| committee-decisions | en | 0 |
| committee-decision-detail | en | 0 |
| committee-actions | en | 0 |
| committee-escalations | en | 0 |
| plan-wbs | en | 0 |
| plan-timeline | en | 0 |
| plan-milestones | en | 0 |
| plan-deliverables | en | 0 |
| plan-dependencies | en | 0 |
| plan-baselines | en | 0 |
| plan-lookahead | en | 0 |
| plan-whatif | en | 0 |
| plan-health | en | 0 |
| plan-task-detail | en | 0 |
| plan-milestone-detail | en | 0 |
| plan-deliverable-detail | en | 0 |
| plan-baseline-detail | en | 0 |
| plan-update-detail | en | 0 |
| workstreams | en | 0 |
| workstream-detail | en | 0 |
| workstream-detail-tasks | en | 0 |
| raid-risks | en | 0 |
| raid-issues | en | 0 |
| raid-assumptions | en | 0 |
| raid-dependencies | en | 0 |
| raid-changes | en | 0 |
| raid-risk-detail | en | 0 |
| change-request-detail | en | 0 |
| gates | en | 0 |
| gate-detail | en | 0 |
| gate-detail-criterion-open | en | 0 |
| gate-detail-390 | en | 0 |
| documents | en | 0 |
| documents-evidence | en | 0 |
| evidence-link-dialog-open | en | 0 |
| documents-sources | en | 0 |
| document-detail | en | 0 |
| source-detail-claims | en | 0 |
| finance-summary | en | 0 |
| finance-summary-390 | en | 0 |
| finance-figures | en | 0 |
| finance-figure-form-open | en | 0 |
| finance-budget | en | 0 |
| finance-budget-line | en | 0 |
| finance-reconciliations | en | 0 |
| finance-models | en | 0 |
| finance-model-detail | en | 0 |
| finance-benefits-kpis | en | 0 |
| finance-benefit-detail | en | 0 |
| finance-kpi-detail | en | 0 |
| finance-restricted | en | page-has-heading-one ×1 |
| admin | en | 0 |
| dialog-open | en | 0 |
| login | ar | 0 |
| portfolio-home | ar | 0 |
| portfolio-home-390 | ar | 0 |
| inbox | ar | 0 |
| wizard-1-template | ar | 0 |
| wizard-2-details | ar | 0 |
| wizard-3-people | ar | 0 |
| wizard-3-people-combobox-open | ar | 0 |
| wizard-4-review | ar | 0 |
| project-cockpit | ar | 0 |
| project-dimension | ar | 0 |
| project-charter | ar | 0 |
| project-members | ar | 0 |
| committee-hub | ar | 0 |
| committee-detail | ar | 0 |
| committee-meetings | ar | 0 |
| committee-meeting-detail | ar | 0 |
| committee-decisions | ar | 0 |
| committee-decision-detail | ar | 0 |
| committee-actions | ar | 0 |
| committee-escalations | ar | 0 |
| plan-wbs | ar | 0 |
| plan-timeline | ar | 0 |
| plan-milestones | ar | 0 |
| plan-deliverables | ar | 0 |
| plan-dependencies | ar | 0 |
| plan-baselines | ar | 0 |
| plan-lookahead | ar | 0 |
| plan-whatif | ar | 0 |
| plan-health | ar | 0 |
| plan-task-detail | ar | 0 |
| plan-milestone-detail | ar | 0 |
| plan-deliverable-detail | ar | 0 |
| plan-baseline-detail | ar | 0 |
| plan-update-detail | ar | 0 |
| workstreams | ar | 0 |
| workstream-detail | ar | 0 |
| workstream-detail-tasks | ar | 0 |
| raid-risks | ar | 0 |
| raid-issues | ar | 0 |
| raid-assumptions | ar | 0 |
| raid-dependencies | ar | 0 |
| raid-changes | ar | 0 |
| raid-risk-detail | ar | 0 |
| change-request-detail | ar | 0 |
| gates | ar | 0 |
| gate-detail | ar | 0 |
| gate-detail-criterion-open | ar | 0 |
| gate-detail-390 | ar | 0 |
| documents | ar | 0 |
| documents-evidence | ar | 0 |
| evidence-link-dialog-open | ar | 0 |
| documents-sources | ar | 0 |
| document-detail | ar | 0 |
| source-detail-claims | ar | 0 |
| finance-summary | ar | 0 |
| finance-summary-390 | ar | 0 |
| finance-figures | ar | 0 |
| finance-figure-form-open | ar | 0 |
| finance-budget | ar | 0 |
| finance-budget-line | ar | 0 |
| finance-reconciliations | ar | 0 |
| finance-models | ar | 0 |
| finance-model-detail | ar | 0 |
| finance-benefits-kpis | ar | 0 |
| finance-benefit-detail | ar | 0 |
| finance-kpi-detail | ar | 0 |
| finance-restricted | ar | page-has-heading-one ×1 |
| admin | ar | 0 |
| dialog-open | ar | 0 |

</details>

<!-- a11y:auto:end -->
