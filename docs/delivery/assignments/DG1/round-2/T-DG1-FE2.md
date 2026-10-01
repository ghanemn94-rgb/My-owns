# Assignment T-DG1-FE2: frontend round-2 repairs (frontend-ux-engineer)

- **Stage:** P1 / gate DG1 (round-2 repair). **Base revision:** current `HEAD` of branch `claude/mobily-transformation-platform-kwcc4i` (≥ `c433078`). You run in a dedicated git worktree; `node_modules` is present, so `pnpm` runs **offline**. Do **not** run `pnpm install`; dependency changes go in your handback.
- Fix **only** the findings below; do not widen scope. Read `docs/delivery/findings.json` for full text.

## Scope — write ONLY within your areas (p1-work-split §3)
`apps/web/**` (incl. `src/i18n/{ar,en}/**`, components, screens), and `packages/design-tokens/**` only if a token/label change is required (it is not expected here). Do **not** touch `apps/api/**`, `packages/{shared,db,config}/**`, `deploy/**`, `.github/**`, `docs/**` (except your handback), `tools/**`, `docs/api/openapi.yaml`, or `pnpm-lock.yaml`.

## Findings to fix

### Medium
- **F-DG1-003 — Arabic UI domain terms deviate from the approved DG0 glossary and conflate "Transformation" with "Initiative".** Locate the approved glossary (`docs/analysis/**` — the DG0 glossary deliverable; grep for the Arabic term table) and bring the Arabic (and, where wrong, the English) strings in `apps/web/src/i18n/ar/**` (and `en/**`) into line with it. In particular, **do not** render "Transformation" and "Initiative" with the same Arabic term — use the glossary's distinct terms for each concept consistently across every screen, label, breadcrumb and heading. Add/extend a unit test over the i18n catalogues that asserts the key domain terms match the glossary and that Transformation ≠ Initiative term. Cite the glossary source in your handback.

### Low
- **F-DG1-004 — a Transformation/BU Lead with a business-unit grant creates a transformation but is immediately shown "Not found".** This pairs with the backend fix **F-DG1-106** (the API will stop returning 404 to the legitimate creator). On the frontend: after a successful create, navigate to / show the created record (don't land on a dead "Not found") for a user who is entitled to see it; and when the API *does* legitimately return 404/403 (truly out of scope), show the correct localized message, not a confusing one. Add a component/e2e-level check if feasible; if the full flow needs the live API+DB stack (which the reviewers run authoritatively), verify the component logic with a mocked API response and note it.

- **F-DG1-005 — the audit-trail "Changes" column shows raw field keys and enum codes, not localized labels, in Arabic and English.** Map field keys and enum codes to localized labels (reuse the i18n catalogues; add the missing keys) so the audit trail reads in human terms in both languages. For any key/enum not yet translated, show a safe, clearly-marked fallback (never a blank or a misleading value). Cover the mapping with a unit test (AR + EN).

## Self-verification (offline, in your worktree)
- `pnpm --filter @mth/web typecheck`, `pnpm --filter @mth/web build`, `pnpm lint` (max-warnings=0), `pnpm check:no-cdn`, and the design-token contrast check if you touched tokens — all green.
- `pnpm test` web unit/component suites green, including your new i18n/glossary and audit-label tests, and `axe` clean where it already runs.
- You need **not** start the full e2e stack (the reviewers run it authoritatively on the frozen candidate); verify component logic with mocked data where the live stack is required, and mark anything you cannot run as **BLOCKED** (never a silent pass). Avoid starting the API/DB stack so you do not contend with other workers.
- RTL for Arabic and LTR for English must hold for every string you touch (CLAUDE.md).

## Handback
`docs/delivery/handbacks/DG1/round-2/T-DG1-FE2-frontend-ux-engineer.md` — per finding: the fix, the glossary source cited, the tests added (and that they fail on the old strings), real output. List changed files, dependency requests, and anything BLOCKED.
