# Handback T-DG5-FE-V1B (frontend-ux-engineer): DG5 round-1 repair. Continues T-DG5-FE-V1 and adds the gate readiness line

- **Run:** `DG5-T-DG5-FE-V1B-frontend-ux-engineer-20261018T063224Z-1f93ed3e`, session `1f93ed3e-c033-432c-b4f8-4f239a7af67e`.
- **Stage:** DG5, FIXING after round 1 (D-170).
- **Tree:** `/home/user/wt/dg5-fe-v1`, branch `dg5/fe-v1`.
  - `HEAD` is the WIP `c89f9a0`, T-DG5-FE-V1's salvaged tree, and it is unchanged.
  - My changes are **uncommitted** on top of it.
- **Time:** `date -u` read 06:41:48Z at the start and 07:27:44Z at the end, about 46 min.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` passed at the start and at the end.
  - Output: `PASS gate DG4 (historical)`, exit 0.
  - Logs: `00-validate-dg4-historical.log` and `40-validate-dg4-historical-end.log`.
- **Logs:** everything below is under `docs/delivery/handbacks/DG5/T-DG5-FE-V1B-evidence/`.
- **Approvals:** none. Product gates G1–G6 are business approvals inside the product. Nothing here grants a real business, Finance or IT approval, and nothing touches the engineering gates DG0–DG7. All test data is synthetic.

## 1. Continuation of T-DG5-FE-V1: the WIP checked against its scope

I read `git show c89f9a0` against the binding scope of T-DG5-FE-V1. Every item was present, so I added no code for the three findings. I re-ran FE-V1's whole acceptance on the final tree (section 4).

| Finding | Cause | Fix in the WIP (`file:line`) | Regression test |
|---|---|---|---|
| **F-DG5-140** (Medium, REQ-PB-093): scoring defaults do not reflow | The rubric `<fieldset>`s keep the browser default `min-inline-size: min-content`, so each one grows to the width of its rubric table. | `apps/web/src/styles/app.css:17-22`: shared rule `fieldset { min-inline-size: 0 }`, so it applies to every fieldset, not one page. Each rubric table is in a focusable, named `.table-wrap`: `ScoringDefaultsPage.tsx:274-279`. | `styles.test.ts` ("lets every fieldset shrink…"); e2e `apps/web/e2e/p5-reflow-axe.spec.ts` |
| **F-DG5-141** (Medium, REQ-S02-001): axe `scrollable-region-focusable` on source coverage | The coverage `.table-wrap` had no `tabIndex`, `role` or name. | `SourceCoveragePage.tsx:127-132`: `tabIndex=0`, `role="region"`, localized name `common.table.scrollRegion` ("{{caption}} (scrollable table)" / "{{caption}} (جدول قابل للتمرير)"). The same fix is in the shared `DataTable.tsx:61-68` and `RegisterTable.tsx:125-130`, and in every other bare P5 `.table-wrap`: ConfigPins, Migrations, Migration, Elements, ReviewPolicies, RevisionProposals, Version ×4, Modular, TracePanels ×2 and Traceability. | `apps/web/src/components/table-regions.test.tsx` (en and ar); e2e `p5-reflow-axe.spec.ts` |
| **F-DG5-121** (Low, REQ-DLV-037): the 30 s budget of the p2 journeys | The serial journeys ran close to the 30 s default timeout. | `apps/web/e2e/p2-journeys.spec.ts:705`: `test.setTimeout(90_000)` on "Define → G2" (measured 25–28 s, 37 s under load). `:1008`: `test.setTimeout(60_000)` on the AUD journey (17–18 s, 26.7 s under load). The other journeys run 4–10 s, so they keep more than half of the 30 s as headroom. Assertions are unchanged. | the journeys themselves |

**Failing before** (recorded by FE-V1 under `docs/delivery/handbacks/DG5/T-DG5-FE-V1-evidence/`):

- **F-DG5-140 and F-DG5-141:** `01-before-fix-p5-reflow-axe.log` shows 2 failed, with en 4 problems and ar 3:
  - `/admin/studio/scoring-defaults — 390 px: page scrolls 49 px`;
  - `… 200 % text: 130 px` (en) and `16 px` (ar);
  - `/admin/source-coverage — 390 px axe scrollable-region-focusable: .table-wrap`, and the same at 200 % text.
- **The unit regressions:** `02-before-fix-unit-web-regressions.log` shows 5 failed out of 11: the 4 table-region tests and the fieldset style test.
- **F-DG5-121:** the domain reviewer's timeouts in `docs/delivery/test-evidence/DG5/domain/round-1/e2e-p2-journeys-cutf8*.log`.

**Disclosed from the WIP's logs:** `19-unit-web-locale-unset-first-run-FAILED.log` (exit 1, 3 failed). It shows FE-V1's first attempt, which named each region by the bare caption. That duplicated existing region names ("Value pools", "Missing updates"). FE-V1 then added the "(scrollable table)" suffix. My final-tree runs show no such failure.

**Passing after (this run):**

- `30-e2e-combined.log`: `P5 reflow/axe en: 31 screens, 0 problem(s)` (2.9 min) and `ar: 31 screens, 0 problem(s)` (2.7 min).
- "Define → G2" took 25.1 s in en and 23.4 s in ar, against the 90 s limit.
- The AUD journey took 16.9 s in en and 15.4 s in ar, against the 60 s limit.
- Unit-web passes in both locales (section 4).

## 2. Gate readiness line (D-170; the F-DG5-120 web need, option 1 of BE-V3's handback; no contract change)

**Behaviour**

- **Where:** the gate page's readiness banner and each gates-list chip.
- **The covered count:** the number of incomplete mandatory criteria that have an exception of the same gate with `covering: true`.
  - `covering` comes from the server: accepted, and today is on or before the expiry, in the transformation's timezone.
  - The client never works out coverage from dates or statuses. An expired, pending, rejected, revoked or withdrawn exception does not count, and neither does an exception on a criterion that is already complete.
- **The text:**
  - **No coverage:** exactly as before, "{{complete}} of {{total}} mandatory outputs complete".
  - **Every gap covered** (`gates.readinessCovered`):
    - en: "6 of 8 mandatory outputs complete; the other 2 are covered by accepted exceptions"
    - ar: "6 من 8 مخرجات إلزامية مكتملة؛ أما الـ 2 الأخرى فتغطيها استثناءات مقبولة"
  - **Some gaps covered** (`gates.readinessCoveredPartly`):
    - en: "1 of 4 mandatory outputs complete; 1 of the other 3 are covered by accepted exceptions"
    - ar: "1 من 4 مخرجات إلزامية مكتملة؛ وتغطي استثناءات مقبولة 1 من الـ 3 الأخرى"
- **The icon and colour:** the check icon and success colour follow the server's readiness rule (ADR-0035 §4, `gates.ts` `allComplete`): every mandatory output is complete or covered.
  - `ready`, meaning "all complete", is unchanged, so the submit dialog's existing `coveredNote` logic behaves as before.
- **Loading or failed exceptions query:** nothing counts as covered, so the line reads as before. Coverage is never assumed.
- **Data:** the existing `listGateExceptions` operation (`transformation.read`).
  - The gate page reuses the per-gate query its exceptions section already makes.
  - The list makes one call without `gateCode`, through the new hook `useTransformationGateExceptions` in the same `p4Keys` area, so `useP4Refresh` refreshes it.
- **Contract:** no new operation and no new response shape.

**Changed files (uncommitted)**

- `apps/web/src/pages/gates/GatesPage.tsx`:
  - `readiness(view, exceptions?)` now returns `covered` and `satisfied`;
  - new `readinessText()` builds the line;
  - the list chip uses them (line 167, with `status-chip--wrap` when the line is long) and carries `data-readiness-covered`.
- `apps/web/src/pages/gates/GateDetailPage.tsx`: the banner reads the gate's exceptions (lines 103 and 237-244) and carries `data-readiness-covered`.
- `apps/web/src/pages/gates/p4api.ts`: new hook `useTransformationGateExceptions` (line 70).
- `apps/web/src/i18n/en/gates.json`, `apps/web/src/i18n/ar/gates.json`: `readinessCovered` and `readinessCoveredPartly`.
- `apps/web/src/pages/gates/readiness-covered.test.tsx` (new, 14 tests):
  - **covered gap, en and ar:** the gate page and the list show the new text, the check icon and the success or on-track style;
  - **no exceptions:** the text is unchanged on the page and the list;
  - **expired exception** (`covering: false`): not counted on the page or the list;
  - **pure helper tests:** a pending, rejected or expired exception, an exception of another gate, and one on a complete criterion are not counted. These also cover the partial text in en and ar.
- `apps/web/e2e/p4-gates-closure.spec.ts`: test 1 now visits a gate page with an accepted, covering exception. After the Sponsor accepts it, the spec asserts `data-readiness-covered="1"` and the text "covered by accepted exceptions" / "استثناءات مقبولة".
- Evidence logs and screenshots under `T-DG5-FE-V1B-evidence/`.

**Visual evidence**

- **The readiness line:** `T-DG5-FE-V1B-evidence/shots/{en,ar}/p4-gates-03-exception-accepted.png`, real stack, from the e2e run.
  - G5 shows the partial variant: "1 of 4 … 1 of the other 3 are covered…" and "1 من 4 … وتغطي استثناءات مقبولة 1 من الـ 3 الأخرى".
  - It has the warning style, because two gaps are uncovered.
  - I opened and checked both images.
- **The FE-V1 screens:** `shots/{en,ar}/p5-reflow-{390,200pct}_admin_{studio_scoring_defaults,source_coverage}.png`.

## 3. Interaction checks actually run

- Unit tests, mocked API, en and ar: the readiness text and icon on the gate page and the list, with no exception, with an expired one, with a covering one, and with partial coverage. For keyboard regions: the shared tables' scroll region is focusable and named.
- e2e, real stack, chromium-en and chromium-ar:
  - the Sponsor accepts an exception, and the readiness line updates to the covered text;
  - on each of the 31 P5 screens, no page-level horizontal scroll at 390 px or with 200 % text;
  - axe with no serious or critical violation at 390 px, at 1366 px and with 200 % text.

## 4. Checks (final tree; one at a time, D-164)

| # | Command | Result | Log |
|---|---|---|---|
| 1 | `pnpm -r typecheck` | exit 0 | `10-typecheck.log` |
| 2 | `pnpm -r build` | exit 0 | `11-build.log` |
| 3 | `pnpm lint` | exit 0 (`--max-warnings=0`) | `12-lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!" | `13-prettier.log` |
| 5 | `pnpm openapi:lint` | exit 0, OpenAPI 3.1.1, 846 operations | `14-openapi-lint.log` |
| 6 | `npx vitest run --project unit-web`, with `LANG`, `LC_ALL`, `LC_CTYPE` and `LANGUAGE` unset | exit 0; 90 files, **1708 passed** | `20-unit-web-locale-unset.log` |
| 7 | the same with `LANG=LC_ALL=C.UTF-8` | exit 0; 90 files, **1708 passed** | `21-unit-web-c-utf8.log` |
| 8 | `E2E_SCREENSHOT_DIR=<scratch> E2E_PG_PORT=23160 E2E_API_PORT=23161 MTH_PORT_POOL=23162-23199 apps/web/e2e/support/with-stack.sh npx playwright test p5-reflow-axe p2-journeys p4-gates-closure + every other p5-*.spec.ts --workers=1`, in chromium-en and chromium-ar | exit 0; **126 passed** (19.9 min); 0 failed, 0 flaky, 0 retries | `30-e2e-combined.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG4` (start and end) | exit 0, both times | `00-…`, `40-…` |

- **Earlier in the session:** before the full runs I ran the gates unit tests once on their own (`vitest run --project unit-web apps/web/src/pages/gates/`): 5 files, 91 passed, exit 0. It is not logged as evidence; the full runs in rows 6 and 7 supersede it.
- **Screenshots (D-162):** the e2e screenshots went to my scratch directory. Only my specs' images are copied into evidence.
- **Not run (D-164):** `pnpm test`, `pnpm test:integration` and the full e2e suite. They are not run, not passed.

## 5. Remaining, gaps and notes

- **The demo's approved G4:**
  - **Not checked here.** I did not render it on the demo stack: BE-V3's seed is not in my tree.
  - **What it should read:** with both G4 gaps covered by accepted, unexpired exceptions, the line reads "6 of 8 mandatory outputs complete; the other 2 are covered by accepted exceptions", with the check icon.
  - **To verify after merge:** run `a02-demo-labels` or the demo probe.
- **The English singular is awkward:** "the other 1 are covered" uses the same style as the existing `gates.submit.coveredNote`, which has no plural forms. That is low-severity polish. A follow-up could add i18next plurals to both strings.
- **The "submission blocked" banner** (`gates.submit.blocked`, "Submission opens when every mandatory output is complete (N of M now)") is unchanged. It is not the readiness line and shows only on unapproved gates the server says cannot be submitted. With covering exceptions its wording is incomplete, because covered outputs also count. I'm flagging it and did not change it, since it is outside the two places this assignment names.
- **Bare `.table-wrap`s outside the P5 screens** (DG2–DG4 pages) are unchanged and outside FE-V1's P5 scope: `GateDetailPage.tsx` (submission criteria table), OrganizationsPage, ReadinessPage, TransformationDetailPage, CaseTotals, InitiativePage, dashboards `ui.tsx`, CharterPage and BenefitFormulaPage. Axe flags such a wrapper only when it actually overflows. The existing DG4 specs do not report them.
- **Contract, schema, dependency:** none needed.
- **ADR and data dictionary, for T-DG5-ARCH-R4:** ADR-0035 §4's web note could say that the readiness line names the outputs covered by accepted exceptions, using the server's `covering`. I found no statement it makes untrue. FE-V1's shared `fieldset { min-inline-size: 0 }` rule and the named table regions extend the existing table-wrap convention.
- **User-facing texts:** "N of M mandatory outputs complete" alone next to "Approved" when the rest is excepted was the misleading text, and it is now replaced by the covered variants. No other string changed meaning.

## 6. Merge instructions

- Integrate `c89f9a0` (the FE-V1 WIP) together with my uncommitted changes. All of it is in `apps/web/**`, plus the handback and evidence.
- No migrations.
- Expected conflicts: none with BE-V1, BE-V2C or BE-V3, which own `apps/api/**` and `packages/db/**`.
