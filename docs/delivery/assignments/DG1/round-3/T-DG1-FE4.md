# Assignment T-DG1-FE4: frontend round-3 repairs (frontend-ux-engineer)

- **Stage:** P1 / gate DG1 (round-3 repair). **Base revision:** current `HEAD` (≥ `45d0297`). Dedicated git worktree; `node_modules` present; run **offline**; no `pnpm install`.
- Fix **only** the two findings below (full text in `docs/delivery/findings.json`). Write ONLY `apps/web/**` (including `apps/web/e2e/**`, which is yours).

## Findings

### F-DG1-208 (High, mandatory) — the Arabic e2e journeys are red: an unanchored nav locator is now ambiguous
The round-2 glossary repair (F-DG1-003) made an Arabic nav label a substring of another, so `apps/web/e2e/journeys.spec.ts` (around line 138) — `nav.getByRole('link', { name: new RegExp(escape(tr(lang,'nav.areas…'))) })` — matches **two** links in Arabic and Playwright fails strict-mode; 6 AR journeys never run. The **product is correct** (qa confirmed: anchoring that regex gives 20/20 EN+AR); the defect is the spec's loose locator. **Fix:** anchor the name regex to an exact match (`new RegExp('^' + escape(tr(lang,'…')) + '$')`) for that nav locator **and any other `getByRole`/`getByText` name-regex in the spec that could match a localized substring** (audit the whole spec so the suite is robust to the glossary terms, not just the one line). Do not change product strings. **Prove it:** run the full e2e suite in BOTH projects and show 0 failures, 0 did-not-run, in EN and AR.

### F-DG1-005 / F-DG1-008 (Low) — the derived-assignment audit entry is not localized
After the F-DG1-106 fix, creating a transformation as a BU-scoped Lead adds a new "assignment created" audit entry. In the audit trail's "Changes" column it shows a **raw action code, raw field names and raw IDs/JSON** in both Arabic and English (the F-DG1-005 localization did not cover this new action). **Fix:** extend the audit-change localization (`apps/web/src/lib/auditChanges.ts` + i18n catalogues) so this action and its fields render as localized labels in AR and EN, with the same safe, clearly-marked fallback for anything not yet translated. Add/extend a unit test (AR + EN) covering the derived-assignment audit entry.

## Self-verification (offline)
`pnpm --filter @mth/web typecheck`, `build`, `pnpm lint`, `pnpm check:no-cdn`, `pnpm test` (web); and the **full e2e suite** via `e2e/support/qa-stack.sh` (pre-installed Chromium at `/opt/pw-browsers`, never `playwright install`; `QA_E2E_PG_PORT=5461` to avoid contention; `--workers=1`) in EN and AR — record the real output showing all journeys pass. RTL(ar)/LTR(en) correct. Anything you cannot run is BLOCKED.

## Handback
`docs/delivery/handbacks/DG1/round-3/T-DG1-FE4-frontend-ux-engineer.md` — per finding: the fix, the e2e run output (EN+AR, 0 failures), the audit-label test; changed files; anything BLOCKED.
