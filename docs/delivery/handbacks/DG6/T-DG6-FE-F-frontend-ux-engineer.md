# Handback T-DG6-FE-F — explanation panels, status cues, catalogue completeness (frontend-ux-engineer)

- **Stage / gate:** P6, DG6 (BUILDING). Section `docs/architecture/p6-work-split.md` §I/K.3.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-FE-F.md` (sha256 `2c81e31c…5c570`, verified at start).
- **Invocation:** `DG6-T-DG6-FE-F-frontend-ux-engineer-20261030T183650Z-4719251c`, session `4719251c-88bb-42bc-adf7-597608adb208`.
- **Base:** branch `dg6/fe-f`, `HEAD` `60499658496e605bee73fe46543e296d87975086`. Changes are left **uncommitted**.
- **Time:** start `2026-10-30T18:37:15Z`; end in §9.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0** (`T-DG6-FE-F-evidence/validate-historical-DG5.log`).
- **Dependencies:** FE-D, FE-E, KBE-B and BE-W were all merged in the base before work began.
- **Data:** all data in tests and screenshots is SYNTHETIC. The demo G1 decision in the capture run approves nothing real. Product gates G1–G6 are never DG0–DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/components/explanation/ExplanationPanel.tsx` (new) | One panel component with:<br>- a disclosure button (`aria-expanded`, `aria-controls`; accessible name "Explain the {value}" / "اشرح {value}");<br>- a labelled region (`role=region`, `aria-labelledby`) holding the formula in words, period, version (optional), state chip, inputs tables and facts.<br>Unknown, incomplete, not computable and disabled each show a `status-chip--unknown` with a `question` icon and a label. "Calculated" is a neutral lifecycle chip, never a status colour. Also `Num` (an LTR `<bdi>` isolate) and `NoValue`. |
| `apps/web/src/components/explanation/panels.tsx` (new) | E1 `WeightedScoreExplanation`, E2 `BenefitRealizedExplanation`, E4 `FinancialMetricsExplanation` and E5 `HealthScoreExplanation`. Each calls KBE-B's `explain*` view model (`@mth/shared/calc`) and only formats the view model's decimal strings. No business number is computed in the web. |
| `apps/web/src/components/explanation/explanation.css` (new) | Panel layout. Tokens only, logical properties only (mirrors in RTL). |
| `apps/web/src/components/explanation/index.ts` (new) | Barrel. |
| `apps/web/src/components/explanation/explanation.test.tsx` (new) | 18 component tests: E1, E2, E4 and E5 in en and ar, plus a catalogue parity test. |
| `apps/web/src/components/Badges.test.tsx` (new) | ADR-0061 §3 item 1: five statuses → five distinct icons and five distinct non-empty labels (en and ar); Unknown → `question` icon and label. 5 tests. |
| `packages/design-tokens/src/status-tokens.test.ts` (new) | No `status.*` token equals, or references through any `ref` chain, a `brand.*`, `action.*`, `nav.*` or `focus.*` token. The on-track colours are not blue-dominant. A rebrand (`brandedTokenSource`) leaves every status colour unchanged. 5 tests. |
| `apps/web/src/i18n/problems-all.test.ts` (new) | ADR-0061 §7.3 catalogue completeness. Details in §2. 5 tests. |
| `apps/web/src/i18n/{en,ar}/explanations.json` (new) | The `explanations` namespace: panel words (ADR-0061 §8 English verbatim for E1, E2, E4 and E5) and the Branding contrast-report texts. Arabic is provisional. |
| `apps/web/src/i18n/index.ts` | Registers the `explanations` namespace (2 imports, 2 catalogue lines). This is a shared file; the orchestrator merges it. |
| `apps/web/src/i18n/{en,ar}/problems.json` | Append-only, **14 keys** (§2): BE-W's two contrast codes, exactly as ADR-0061 §6, and 12 codes the API emits that had no text anywhere. This is a shared file (FE-A's append-only merge). |
| `apps/web/src/i18n/provisional-ar-p6.ts` | Adds source `"fe-f"`. Lists the new problem keys and `explanations.` as provisional Arabic; the two BE-W keys are listed as `"adr"`. |
| `apps/web/src/pages/prioritization/Scorecard.tsx` (named lines) | The "incomplete" chip (formerly line 230) gains its `question` icon and `data-health="unknown"`. The E1 panel is mounted under the weighted score, fed the full score sheet. |
| `apps/web/src/pages/benefits/BenefitPage.tsx` (named lines) | The E2 panel is mounted under the values table. For a non-financial benefit only, `realized.kpiActual` is read from the register query (§6 item 2). |
| `apps/web/src/pages/financial-metrics/FinancialMetricsPage.tsx` (named lines) | The E4 panel is mounted under the opened case's cash flows (it receives that case's metrics). The reason chips (NPV/ROI/payback "not shown / not computable") gain the `question` icon. |
| `apps/web/src/pages/health-check/HealthCheckPage.tsx` (named lines) | The E5 panel is mounted in the assessment facts card. The "no score" and "no band" chips gain the `question` icon. |
| `apps/web/src/pages/branding/api.ts` | `brandingPaths.contrast`, `brandingKeys.contrast` and the `useBrandingContrast(versionNo)` hook (`getBrandingVersionContrast`). |
| `apps/web/src/pages/branding/BrandingPage.tsx` | Contrast refusal and report (details in §2). |
| `apps/web/src/pages/branding/branding-contrast.test.tsx` (new) | 7 tests (en/ar refusal, en/ar report, the exact warning text, 403 for two non-admin permission sets). |
| `docs/delivery/handbacks/DG6/T-DG6-FE-F-evidence/**` | Logs, screenshots, and the capture spec, kept as `.txt` because it is not a deliverable. |

No migration, no new dependency, no API, contract or OpenAPI change, and no route added.

## 2. Behaviour delivered, per requirement row

### REQ-S15-014

> **Acceptance:** "A05;A20: the weighted score and benefit realized value show plain-language explanations in en and ar; non-admin screens show no stack traces or infrastructure terms"

**Delivered:**
- **E1 (weighted score)** on the prioritization scorecard. The panel shows:
  - the ADR-0061 §8 words verbatim;
  - one row per criterion: score, weight, and score × weight ÷ 100 (KBE-B decimals);
  - the sum (= the server's `weightedScore`) and the 0–100 view;
  - the period (`computedAt`, Asia/Riyadh) and the version (weight set N).

  When the score is incomplete, the panel names the missing criteria and shows no sum; no cell shows 0. When the weight set is of another version, the panel is Unknown with its reason.
- **E2 (benefit realized value)** on the benefit page. The panel shows:
  - the §8 words (or the non-financial words);
  - three separate tables (validated, sustained, pending Finance validation), each with its lines, periods and its own server total — never added together;
  - "No value yet" for a group without lines, never `0.0000`;
  - Unknown for a total with a missing amount;
  - the overall period (earliest to latest line).
- **E4 (NPV, ROI and payback)** on the opened business case's cash flows. The panel shows:
  - the three §8 sentences, plus a notes sentence (§6 item 1);
  - per period: outflow, inflow, net, the exponent, the discount factor (6 decimals), the discounted net, the cumulative net and the payback marker;
  - totals, the NPV and its exact value, ROI and payback, each with its reason when absent.

  Disabled, incomplete and revision or currency mismatch show their texts and no rows.
- **E5 (health check score)** in the assessment facts card. The panel shows:
  - the §8 words plus a notes sentence;
  - the response counts, credit and points;
  - answered of 25, the applicable count, points, score of max, the band (LTR isolate) and the assumption note;
  - the assessment date and the scheme version.

  Incomplete and not computable show no score and no band, never 0.
- **All panels:** read-only (the only control is the disclosure button), so the AUD user sees exactly the same panel. AUD cannot reach Branding Settings (403).
- **Tests:** in en and ar. E1 and E2 assert the §8 English words verbatim and the Arabic catalogue text.
- **Not part of FE-F:** the infrastructure-term scan of non-admin screens is QA-D's (ADR-0061 §8). The panel texts contain none of the listed terms.

### REQ-S15-003 (FE-F part: chips, status tokens, Branding Settings)

> **Acceptance:** "A20: the contrast test lists every pair and passes; white small text on #0078FF is not used for action buttons; status chips are distinguishable in greyscale"

**Delivered:**
- `Badges.test.tsx` proves the five statuses have five distinct icons and five distinct labels in en and ar, so they are distinguishable once colour is removed.
- `status-tokens.test.ts` proves no status token is, or references, a blue-family token.
- The chips on the screens I own gain icons: Scorecard (line 230), health-check score and band, and financial-metrics reasons.
- **Branding Settings:**
  - A 422 `branding.contrast_insufficient` shows **one** form-level alert. Inside it (via `FormAlert`'s `extra`) is the list of failing pairs: the translated `branding.contrast_pair_below_threshold` text plus the server's `"<fg> / <bg> | <use> | <ratio>:1 < <threshold>:1"` in an LTR `<bdi>`.
  - The colour field each pair points at (`/primaryColour` or `/secondaryColour`) shows the pair-code text inline.
  - A new "Contrast report" section reads `getBrandingVersionContrast` for the current version by default, or for any version chosen with the new "Show the contrast report" button in the versions table (`aria-pressed`, version in the accessible name). It shows the status (recorded / not recorded), the time, the token-source SHA-256, a pass/fail chip (with icon) and one row per pair (tokens and hexes in LTR, `ratio:1`, `threshold:1`).
  - A `not_recorded` version with `failingCount > 0` shows the warning "The current colours fail the contrast rules; publish corrected colours." (en, verbatim from the work split) and the Arabic text.
- **For QA-D:** the CI contrast gate (`check:contrast`) and QA-D's greyscale screenshots remain QA-D's.

### REQ-S15-007 (FE-F part)

> **Acceptance:** "A20;A15: a test finds no missing ar or en key; a validation error returned by the API is shown in the selected language; an Arabic export keeps 'KPI-001' and '12.5%' readable"

**Delivered:** `problems-all.test.ts` collects every problem code from two sources:
- **The API source** (`apps/api/src/modules/**`, tests excluded):
  - `problems.businessRule/duplicate/badRequest("…"`;
  - every `code:` inside a `new HttpProblem({…})`, including the `errors` item codes;
  - every `code:` in `platform/db-errors.ts`.

  That is 484 codes.
- **The refusal tables of ADR-0051–0059 and ADR-0061**, in both row formats.

It asserts the following:
- **en and ar text:** each code has an en and an ar text, either under `problems.*` or in a page namespace's `problem`/`problems` block (the `codeText` path of the DG3 pages).
- **Arabic:** the Arabic text contains Arabic letters and differs from the English.
- **No raw placeholders:** `problemText` renders every `problems.*` code without a raw placeholder, in both languages.
- **BE-W's two codes:** they match ADR-0061 §6 exactly.
- **Not vacuous:** a made-up code is reported as missing.

The first scan found **14 codes without any text**. I added them, append-only, to `problems.json` (en and ar):
- `branding.contrast_insufficient`, `branding.contrast_pair_below_threshold` (ADR-0061 §6 texts);
- `evidence.reviewer_is_author`;
- `health_scheme.definition_invalid`;
- `assistant.test_adapter_shape`;
- `validation.weight_percent`;
- `validation.validation.reference` (see §6 item 3);
- `validation.upload_policy_allowed_types`;
- `validation.upload_policy_max_bytes`;
- `validation.idempotency_key`;
- `validation.transformation_not_allowed`;
- `gate.out_of_sequence`;
- `gate.g1_agreements_required` and `gate.agreements_not_applicable`. These two reuse the existing `gates.agreements.problem.*` texts, which `GateProblem` already showed; now the generic renderer has them too.

For the 12 non-ADR codes, the English text is the API's detail text, made placeholder-free where the detail interpolates values. The Arabic is labelled provisional (`fe-f`). The rendered-in-selected-language check against a real API is QA-D's (§7.3); the component test does it against the mocked API in both languages.

## 3. Checks (real exit codes; logs in `T-DG6-FE-F-evidence/`)

| Command | Exit | Result / counts |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG5` | **0** | `PASS gate DG5 (historical)` |
| `pnpm -r typecheck` (attempt 1) | **137** | OOM kill of `apps/api` `tsc` while the packages ran in parallel (`typecheck-attempt1-oom.log`). Same class as FE-D's attempt 1. |
| `pnpm -r --workspace-concurrency=1 typecheck` | **0** | `typecheck.log` |
| `pnpm -r build` | **0** | `build.log`. An earlier build exited 2 on two type errors in my new test file; fixed and rebuilt. |
| `pnpm lint` | **0** | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | `prettier.log` |
| `pnpm openapi:lint` | **0** | `openapi-lint.log` |
| `pnpm test`, locale unset (attempt 1) | **1** | `test-locale-unset-attempt1.log`. Failures, all fixed:<br>- architecture test (empty harness `.claude` dirs; removed);<br>- glossary (my Arabic "التحول" without shadda; fixed);<br>- 4 `fef.test.tsx` exact-text assertions (the leading space I added before chip labels; removed);<br>- plus the pre-existing failure below. |
| `pnpm test`, locale unset (final) | **1** | unit-node **2750/2750**; unit-web **1936 passed, 1 failed** of 1937 (111 files); unit-formula **259 passed, 2 skipped**. The single failure is **pre-existing**: see below. |
| `pnpm test`, `LANG=LC_ALL=C.UTF-8` | **1** | unit-node **2750/2750**; unit-web **1936 passed, 1 failed** of 1937; unit-formula **259 passed, 2 skipped**. The same single pre-existing failure as with the locale unset (`test-c-utf8.log`). |
| `QA_PG_PORT=26310 MTH_PORT_POOL=26311-26349 tests/qa/support/with-pg.sh pnpm test:integration` | **KILLED / INCOMPLETE** | Stopped by the agent shell's 30-minute background limit after 227 test files, so **no pass is claimed**. **3 failures** were seen, all in files FE-F does not touch (details in §9). `test-integration.log`. |
| Capture spec on the real stack (`with-stack.sh`, `E2E_PG_PORT=26301`, `E2E_API_PORT=26302`, `MTH_PORT_POOL=26303-26349`) | **0** | `capture-run.log`: 10/10 passed (5 steps × chromium-en, chromium-ar), with `expectAccessible` (axe, 0 serious or critical) on E1, E2, E5, the Branding refusal and the Branding report. Two earlier runs failed on my own spec (a strict-mode selector; a missing `financialStatementLine`), not on the product. |

**Pre-existing failure, not caused by FE-F:**
- **Test:** `apps/web/src/pages/admin/security/p6-admin-screens.test.tsx` › "identity shows whether a client secret is configured, never a secret value".
- **Why it fails:** it expects no `input` on the page, but finds the header's global-search input (`.global-search__input`, FE-D).
- **Proof:** I reproduced it on a clean clone of `HEAD 604996584` without my changes: 1 failed / 32 passed, exit 1 (`preexisting-p6-admin-screens-at-HEAD-604996584.log`).
- **Owner:** this is FE-B's test or FE-D's header. Neither file is in my ownership. **For the orchestrator:** the assertion should be scoped to `main`.

**Targeted runs of my files** (all passed):
- `explanation.test.tsx` 18/18;
- `Badges.test.tsx` 5/5;
- `branding-contrast.test.tsx` 7/7;
- `problems-all.test.ts` 5/5;
- `status-tokens.test.ts` 5/5;
- `feg.test.tsx` 19/19 (existing Branding tests unchanged);
- `problems-p6.test.ts`, which binds `provisional-ar-p6.ts`.

## 4. Visual evidence and interaction checks

**Screenshots:** `T-DG6-FE-F-evidence/screenshots/{en,ar}/`. Real API and PostgreSQL, 1366 × 900.

| Screenshot | Content |
|---|---|
| `fe-f-e1-weighted-score-complete.png` | 5 rows, sum 3.50, 0–100 view 62.5 |
| `fe-f-e1-weighted-score-incomplete.png` | missing time-to-value named, "incomplete" chips with icons, no sum |
| `fe-f-e1-scorecard-page.png` | the full page |
| `fe-f-e2-benefit-realized.png` | planned value only: three groups "No value yet", state Incomplete |
| `fe-f-e5-health-incomplete.png` | 24/25 answered |
| `fe-f-e5-health-scored.png` | 17 of 25, band 16–20 |
| `fe-f-branding-contrast-report-initial.png` | default branding: the designed empty state |
| `fe-f-branding-contrast-refusal.png` | `#FFD700`: one alert, 2 failing pairs in LTR, the field error |
| `fe-f-branding-contrast-report-recorded.png` | after publishing a passing colour: 50 pairs, recorded, SHA-256 |

**Interaction checks actually run:**
- **Disclosure:** each panel opens by its accessible name and toggles `aria-expanded`; `aria-controls` points at a `role=region` labelled by its heading. Asserted in component tests and the real-stack spec.
- **Read-only:** a panel contains no input, select, textarea or form, and exactly one button.
- **Branding report selection:** a `aria-pressed` button per version, with the version in a visually hidden part of its name; the report changes to the chosen version.
- **One form-level alert:** asserted on the real stack and in the component tests.
- **Direction and isolation:** RTL layout in ar (screenshots); numbers, token names and ratios are in `dir=ltr` isolates (asserted).
- **Axe:** 0 serious or critical on the five captured states, in both languages.

**Not done here:**
- E4 was not captured on the real stack, because enabling the extension needs Finance and admin setup beyond this run's budget. It is covered by 4 component tests (en/ar rows, incomplete, revision mismatch, no discount rate).
- The keyboard-only walkthrough and 360 px work belong to FE-F2 and QA-D.

## 5. Operations routed (pending-list delta)

**None.** FE-F routes no API operation; it consumes BE-W's `getBrandingVersionContrast`, which BE-W already routed (`p6-pending-be-w.ts` is empty). Pending delta: 0. Contract pins unchanged.

## 6. Contract, schema, dependency and wording needs (for the orchestrator)

1. **E4/E5 words vs code (KBE-B handback §3).** No decision is recorded, and I did not change the ADR words. The §8 English is used verbatim. A separate, clearly additional sentence (`explanations.financialMetrics.formulaNotes`, `explanations.healthScore.formulaNotes`) states what the code does beyond the words:
   - **E4:** payback "not computable" when there are no outflows or the cumulative net is never negative; NPV rounded once to 2 decimals; ROI as a fraction shown as a percentage; 0-based periods; out-of-range not shown.
   - **E5:** partial credit; N/A not applicable; rounded to 2 decimals; all-N/A not computable.

   If the architect prefers to amend ADR-0061 §8 instead, these keys can be folded in.
2. **ADR-0061 §8 E2 names `getBenefit → realized.kpiActual`, but `getBenefit` (contract `Benefit`) has no `realized`.** Only the register row (`BenefitRegisterRow.realized`) has it. For a non-financial benefit, the page reads it from `useBenefitRegister(tid)` (`fetchAllPages`; the same query key as the register page, so it is usually cached). For a financial benefit, nothing extra is read. **Proposal:** correct the ADR row, or add `realized` to `getBenefit` in a later task.
3. **API code typo (not mine to fix):** `platform/db-errors.ts` (`day_ninety_response_evidence_fkey`, around line 2987) emits the field-error code `validation.validation.reference`. I added a text for it so the user sees a correct message. **The owner of `db-errors.ts` should change it to `validation.reference`**; my key then becomes unused and can be removed.
4. **No new dependency.** `vitest-axe` is not present, so component-level axe is covered by the real-stack `expectAccessible` runs above and by QA-D, as §I/K.3 allows.
5. **Shared-file merges:** `i18n/index.ts` (+2 imports, +2 lines), `i18n/{en,ar}/problems.json` (+14 keys each, appended at the end) and `i18n/provisional-ar-p6.ts` (source `fe-f`, +14 entries). There may be append conflicts with other FE tasks; resolve by union.

## 7. User-facing texts made untrue

None found. I searched the en catalogues for planned, later, coming or P6 texts about explanations, contrast, calculations and branding (§ check in the run). The P5 Branding texts ("contrastHeaderFail … Choose a darker colour", "rules", "settingsIntro") remain true. The client-side preview lines are still shown, and the server now enforces the declared pairs as well.

## 8. What remains (not done by FE-F)

- **Status chips outside my file ownership** still have no icon, which the ADR-0061 §3 item 2 DOM rule (QA-D) will flag. `grep` finds 120 `className="status-chip` sites in the web. Ones I saw without an icon:
  - `pages/prioritization/{Rankings.tsx:196, RankedTable.tsx:125, WeightSets.tsx:123, p3ui.tsx:114}`;
  - `pages/benefits/BenefitPage.tsx:436, 938, 1224` (not my named lines).

  QA-D's DOM rule will produce the authoritative list. Each owner (or a repair task) adds `<Icon/>` the same way as here: icon first, no leading space, because some tests compare the exact text.
- The E4 real-stack screenshot (§4).
- QA-D's parts of every row (A05/A20 e2e, the greyscale screenshots, the infrastructure-term scan, the API error shown in each language on the real stack, the Arabic exports).
- REQ-S15-003, -007, -012 and -014 are **not complete** until FE-F2 and QA-D land (work-split §I/K.10).

## 9. End-of-run results and remaining items (time limit)

- **End time:** `2026-10-30T20:43:46Z`. That is about 2 h 06 min, past the ~2 h limit. I stopped after the integration suite was killed and did not rerun it.
- **Integration (`test-integration.log`): INCOMPLETE, so acceptance item 3 is NOT MET by this run.**
  - **Why it stopped:** it ran in parallel with the C.UTF-8 unit suite and a web build (load), and the shell stopped it at its 30-minute background limit after 227 files.
  - **Failures seen:** 3 tests in 2 files. FE-F changed no API, worker, database or contract file, and no test support file.
    - `assistant/conversations.test.ts` › "the rate-limit class `assistant` … over the per-minute budget a post is 429 with Retry-After …" → `expected { …(8) } to match object { …(5) }`.
    - `contract/response-validation.test.ts` › "P5 BE-J operations (p5-exercises-be-j.ts)" → `expected [] to have a length of 1 but got +0`.
    - `contract/response-validation.test.ts` › "every operation: an undeclared request media type is a declared 400 validation.content_type; nothing written" → `Test timed out in 30000ms` (a load timeout).
  - **Not established:** whether these are pre-existing on `HEAD 604996584` or load effects. I did not prove either.
  - **For the orchestrator:** run `pnpm test:integration` on the merged tree in the foreground with no other suite running. Pinned counts are unchanged by FE-F (no operation, media type or route added).
- **Unit, both locales:** exit 1, only because of the pre-existing `p6-admin-screens` failure (§3; reproduced on clean `HEAD`). Every other test passes, including every FE-F test.
- **Final tree checks** (after the last source edits):
  - prettier check exit 0;
  - `pnpm lint` exit 0;
  - `apps/web` build (`tsc` + vite) exit 0 (`build-web-final.log`);
  - `pnpm -r --workspace-concurrency=1 typecheck` exit 0 and `pnpm -r build` exit 0. These two ran before three small JSX and i18n edits (chip label spacing, the Arabic shadda, E2's version row); the final web build re-typechecks the web.
- **Separable remainder** (in addition to §8): the full integration run, and the E4 real-stack screenshot.
