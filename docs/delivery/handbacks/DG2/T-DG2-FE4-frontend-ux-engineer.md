# Handback T-DG2-FE4: DG2 round-2 repairs (frontend-ux-engineer)

- **Stage:** DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`.
- **Base:** `HEAD` = `e9b14ca7523d7a1c120284ebce7365efa8979a53`.
- **Assignment:** `docs/delivery/assignments/DG2/round-3/T-DG2-FE4.md` (sha256 `6f9de823…a3c1`, verified).
- **Invocation:** `DG2-T-DG2-FE4-frontend-ux-engineer-20261006T050551Z-cba82451` / session `cba82451-cd4a-4896-8f92-75da09ada887`.
- **Scope:** I edited only `apps/web/**` and this handback with its evidence directory. I did not touch `apps/api/**`, `packages/db/**`, `docs/api/openapi.yaml`, `requirements.csv`, gate tooling, agents, sources, reviews or gate records.
- **Gates:** no business approval (G1–G6) was granted. All data is synthetic.

## 1. F-DG2-151 (Low, REQ-PB-017 / B0023): gate titles repeat the gate code

**Fix.** One shared helper, `gateLabel(def, locale)` in `apps/web/src/lib/methodology.ts`, returns `pick(locale, def.sourceNameEn, def.nameAr)` exactly as seeded. It never adds the code and never strips or rebuilds the name. `gateName(m, code, locale)` now delegates to it; when the catalogue has no such gate it falls back to the bare code. Both gate screens use the helper instead of the inline `` `${code} – ${…}` ``:
- `GatesPage.tsx`: the card titles;
- `GateDetailPage.tsx`: the section heading.

**Other places checked.** I searched the web app for every place that composes a gate label:
- `gateName` had no callers.
- The workspace header link `HeaderGate` shows only the bare code (`G1`) next to a status chip. It does not compose a name, and the e2e asserts the exact `G1` link.
- `gates.gateTitle` ("Gate {{code}}") and `gates.decision.title` use only the code.
- The gate decision log shows the API's decision `code` and `title`; the UI does not compose them.
- There are no phase headers that compose gate names.

So no other place doubles the code.

**Fixtures.** `p2fixtures.ts` `gateDef` now carries the verbatim seeded form (`G2 - Direction` / `G2 - التوجّه`, as in migration 0011 lines 290–295). Before, the fixtures carried names without the code, which hid the bug.

**Tests.**
- `lib.test.ts`: `gateLabel` and `gateName` in EN and AR, plus the bare-code fallback.
- `p2.test.tsx`:
  - The gate list titles equal the six verbatim names in EN, and `G2 - التوجّه` in AR. No `G\d – G\d` pattern appears.
  - The gate detail heading is exactly `G2 - Direction` (EN) and `G2 - التوجّه` (AR).
- `e2e/p2-journeys.spec.ts`, against the real API and seed:
  - `.gate-card__title` equals the six verbatim names per language.
  - The G1 detail heading equals `G1 - Case for Change` / `G1 - مبررات التغيير`.
  - `main` never contains `G\d – G\d`.

## 2. F-DG2-150, UI part (Medium, mandatory, REQ-PB-031 / B0041): the exclusions check must read as failing

**Fix.**
- **Detail string.** `define.charter.precheck.detail.exclusions_documented.attention` now reads, word for word as assigned:
  - EN: `No explicit exclusions (out of scope) are documented, so this check fails.`
  - AR: `لا توجد استثناءات صريحة (خارج النطاق) موثّقة؛ لذلك يفشل هذا الفحص.`
- **Chip.** `ResultChip` already maps `attention` to `status-chip--at-risk` (amber `#7A4B00` on `#FFF1D6`, 6.63:1) with an `alert` icon. That is neither green (`on-track`) nor the grey `unknown`, so I left the mapping unchanged.
- **Chip label.** The charter pre-check label for `attention` was "Needs attention" / "يحتاج إلى انتباه". I changed it to **"Not supported by data" / "لا تدعمه البيانات"**, so it reads as the direct negative of the passing label "Supported by data" / "تدعمه البيانات". This key (`define.charter.precheck.result.attention`) is used only by the charter scope-check table, so it applies to all five pre-checks there. `common.result.attention` is unchanged. This is a small addition beyond the literal assignment, made so the chip reads as non-passing. Reviewers may revert it.

**Fixtures and tests.**
- `p2fixtures.ts` `charterView` now mirrors the server rule: `exclusions_documented` is `attention` when `outOfScope` is null or blank, and `pass` otherwise. It is no longer a hard-coded `unknown`.
- New `p2.test.tsx` test, "scope pre-check: an empty Out of scope reads as failing (EN and AR)". It covers:
  - EN with `null` and with `"   "`, and AR with `null`;
  - chip `data-result="attention"`, class `status-chip--at-risk`, not `on-track` or `unknown`, with an icon;
  - the label and the new detail text, and the absence of the old "Check the documented exclusions.";
  - a documented Out of scope gives `pass`.
- e2e charter journey: version 1 is now created **without** Out of scope. The e2e asserts the `attention` chip (class `at-risk`), the localized label and the new detail, then screenshots it and runs axe. Version 2 adds Out of scope together with In scope, and the e2e asserts `pass`. G1 still completes later because v2 documents exclusions.

## Changed files

| File | Purpose |
|---|---|
| `apps/web/src/lib/methodology.ts` | New shared `gateLabel`; `gateName` delegates to it, with no code prefix |
| `apps/web/src/pages/gates/GatesPage.tsx` | Card title via `gateLabel` |
| `apps/web/src/pages/gates/GateDetailPage.tsx` | Section heading via `gateLabel` |
| `apps/web/src/i18n/en/define.json` | New exclusions `attention` detail; charter pre-check `attention` label "Not supported by data" |
| `apps/web/src/i18n/ar/define.json` | Same in Arabic |
| `apps/web/src/test/p2fixtures.ts` | Verbatim gate names with code; exclusions pre-check derived from `outOfScope` |
| `apps/web/src/lib/lib.test.ts` | Unit tests for `gateLabel` and `gateName` |
| `apps/web/src/pages/p2.test.tsx` | Gate list and detail title tests (EN/AR); exclusions failing-state test (EN/AR) |
| `apps/web/e2e/p2-journeys.spec.ts` | Verbatim gate-title assertions; empty Out of scope in v1 fails, then passes in v2; new screenshot `p2-04a-charter-no-exclusions` |
| `docs/delivery/handbacks/DG2/T-DG2-FE4-evidence/**` | e2e log, screenshots, axe summaries |

## Checks actually run

The environment was offline. Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`) was used unless stated; Node 22.22.2 is at `/opt/node22/bin`.

| Command | Result |
|---|---|
| `pnpm -r typecheck` | exit 0. The first run failed on my own test (`exact` is not a Testing Library option); fixed and re-run |
| `pnpm -r build` | exit 0 |
| `pnpm lint` (`eslint . --max-warnings=0`) | exit 0 |
| `pnpm format:check` | exit 0, "All matched files use Prettier code style!" |
| `pnpm test` on Node v24.21.0 | exit 0: `Test Files 31 passed (31) · Tests 504 passed (504)` |
| `pnpm test` on Node v22.22.2 | exit 0: `Test Files 31 passed (31) · Tests 504 passed (504)` |
| `pnpm --filter @mth/design-tokens run check:contrast` | exit 0: `PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented`, including `PASS 6.63:1 status.at-risk.fg #7A4B00 on status.at-risk.bg #FFF1D6 (status chip At risk)` |
| `E2E_PG_PORT=54471 E2E_API_PORT=3471 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_SCREENSHOT_DIR=docs/delivery/handbacks/DG2/T-DG2-FE4-evidence/screenshots apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts --project=chromium-en --project=chromium-ar --workers=1` (disposable PostgreSQL, real API) | exit 0: `42 passed (3.1m)`; full log in `T-DG2-FE4-evidence/e2e-run.log` |
| axe (`expectAccessible` in every step; summaries `screenshots/{en,ar}/axe-summary.json`, `axe-summary-p2.json`) | 0 serious and 0 critical in all four summaries; any serious or critical violation would have failed the test |

No build or test error looked like a concurrent write, so nothing was re-run for that reason.

**Important caveat on the e2e run.** It used the shared working tree, which contained the backend run's (T-DG2-BE4) **uncommitted, in-progress** changes to `apps/api/src/modules/transformations/charter.ts` and `workflows/criteria.ts`. Those changes return `attention` for a blank Out of scope. The charter e2e assertion `data-result="attention"` therefore depends on BE4's change and passes only together with it. Re-run the e2e on the integrated candidate.

### Interaction checks (in the e2e, EN and AR)
- **Gate list:** six cards, titles exactly the verbatim names, no doubled code.
- **Gate list to G1 detail:** opened by clicking the card link; the heading is the verbatim name.
- **Charter:** created with an empty Out of scope; the exclusions row shows an amber `attention` chip with the new detail.
- **Charter edit:** In scope and Out of scope saved through the edit form as v2, and the row turns `pass`.
- **Versions:** the compare diff still works, and G1 / G2 / G3 submissions and decisions still pass.

### Screenshots (visual evidence)
- Gate list: `docs/delivery/handbacks/DG2/T-DG2-FE4-evidence/screenshots/en/p2-13-gates.png`, `…/ar/p2-13-gates.png`
- Gate detail (G1): `…/en/p2-14-gate-incomplete.png`, `…/ar/p2-14-gate-incomplete.png` (also `p2-15-gate-submitted.png`)
- Charter, no exclusions (failing pre-check): `…/en/p2-04a-charter-no-exclusions.png`, `…/ar/p2-04a-charter-no-exclusions.png`
- Charter after v2 (passing): `…/en/p2-04-charter.png`, `…/ar/p2-04-charter.png`
- All other journey screenshots (P1 and P2) are in the same directories.

I inspected `en/p2-13-gates.png`, `ar/p2-14-gate-incomplete.png` and `ar/p2-04a-charter-no-exclusions.png` visually:
- the EN list shows "G1 - Case for Change" … "G6 - Sustain";
- the AR detail shows "G1 - مبررات التغيير";
- the AR charter shows an amber "⚠ لا تدعمه البيانات" chip with the new failing detail.

## Known gaps / not done
- The e2e result for F-DG2-150 depends on BE4's uncommitted backend change being in the tree. I could not verify it against a frozen integrated candidate.
- The chip label change ("Not supported by data") goes slightly beyond the literal assignment, as explained above.
- I do not close findings. Verification belongs to the reviewers.

## Merge instructions
- No migrations.
- Merge alongside T-DG2-BE4. Without the backend change, the new e2e charter assertion (`attention` for an empty Out of scope) fails, because the old API returns `unknown` for null.
- No expected conflicts. My files are disjoint from BE4 (`apps/api/**`) and AN3 (`requirements.csv`).
- The screenshot evidence is under `docs/delivery/handbacks/DG2/T-DG2-FE4-evidence/`. Copy it into `docs/delivery/test-evidence/DG2/` if the orchestrator needs it there.
