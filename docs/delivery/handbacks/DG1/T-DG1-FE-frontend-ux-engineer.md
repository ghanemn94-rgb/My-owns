# Handback: T-DG1-FE (frontend-ux-engineer)

- **Stage/gate:** P1 / DG1 (BUILDING). This is an engineering gate only. Nothing here grants or implies a product
  G1–G6 business approval. No real business, Finance or IT approval was given. Every demo record and user is
  **synthetic**.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-FE-frontend-ux-engineer-20260930T220536Z-3c27c066","session_id":"3c27c066-34a7-42a4-81ed-14bdb1b8d6c0"}`.
- **Assignment:** `docs/delivery/assignments/DG1/T-DG1-FE.md`, sha256
  `16afae0e64842ab3b03b3d3fbd42d3ea0846f632971cd8f068fd907f01a438c0` (checked with `sha256sum` before starting).
- **Starting revision:** HEAD `e82948f9ca989b6a8c568532bcad267a30b632f6`, which is T-DG1-BE integrated plus the R-1
  vitest fix. At the start, `git status` showed only pre-existing untracked files that are not mine: root
  dotfiles, `CLAUDE.local.md` and `docs/delivery/runs/DG1/…`.
- **State of my work:** all changes are **uncommitted** in the working tree. The orchestrator integrates them.
- **Scope check:** changes are limited to `apps/web/**` and `packages/design-tokens/**`, plus this handback. In
  `package.json` files only the `scripts` fields changed, and no dependency or lockfile was touched. The seven seeded
  token values in `tokens.json` are byte-identical: the diff only appends new keys after `color`.

## Status: COMPLETE for the assigned P1 scope, with contract notes (§5) and stated gaps (§6)

## 1. Changed files

### `packages/design-tokens`
| File | Purpose |
|---|---|
| `src/tokens.json` | **Appended** keys: `derived` holds the accessible action shades `action.primary` #006DE9 and `action.primary-hover` #0055B6, each with its rule. `semantic` holds the status, feedback, navigation, header, control-border and provisional-badge tokens; `ref` entries emit `var()`. `contrastPairs` has 50 declared fg/bg pairs plus 3 documented *prohibited* pairs. The 7 seeds are unchanged. |
| `src/contrast.ts` | WCAG 2.x luminance and contrast ratio, AA thresholds per use (text/large-text/ui), and the darker-shade derivation |
| `src/index.ts` | `resolveTokens()`, which re-derives the derived values and fails if a seed changed without regeneration, and also rejects unknown refs and cycles. Also `generateTokensCss()` (`--mth-*`), `checkContrast()` and `formatContrastReport()`. Existing exports are kept. |
| `src/cli.ts` | `check` is the contrast gate (exit 1 on any failure). `generate` writes `dist/tokens.css`. |
| `src/tokens.test.ts` | 15 unit tests: the seeds, the ADR-0009 reference ratios, derivation, refs/cycles, the gate and its negative cases, and that every non-seed token is covered by a pair |
| `package.json` | **scripts only**: `build` (tsc + generate), `generate`, `check:contrast` |
| `README.md` | usage |

### `apps/web`
| File | Purpose |
|---|---|
| `index.html`, `public/locale-boot.js` | Arabic RTL default. A same-origin classic script applies the stored language to `<html lang dir>` before first paint (CSP allows `'self'` only, so no inline script). Removed `public/.gitkeep`. |
| `vite.config.ts` | `mth-design-tokens` plugin, which serves `virtual:mth-tokens.css` from the one token source; vendor chunk split |
| `src/main.tsx` | tokens CSS, bundled Plex fonts (Arabic 400/500/600 and Latin 400/500/600), app CSS, i18n, app |
| `src/vite-env.d.ts` | types for `vite/client` and the virtual CSS module |
| `src/app/{App,router,Shell,nav,locale}.ts(x)` | providers, routes, shell (skip link, gradient header, wordmark, language switch, user box, sign-out, 14-area blue navigation, responsive toggle), locale helpers |
| `src/api/{client,queries,types}.ts` | fetch wrapper (cookies, CSRF from `/me`, If-Match, Idempotency-Key, problem+json → `ApiError`, 401 listener), TanStack Query hooks, contract types from `@mth/shared/schemas` |
| `src/auth/{session.tsx,permissions.ts}` | session gate (`/me`, 401 → sign-in with `returnTo`, profile language wins after sign-in); UI permission hints that mirror `access/rules.ts` |
| `src/components/*` | `States` (loading/empty/error/stale/conflict/no-permission + `QueryState`), `Badges` (health vs lifecycle, `Unknown`), `DataTable` (TanStack Table: aria-sort, column picker persisted per table, cursor pager), `Form` (labelled `Field`, zod payload resolver, accessible `Dialog`), `ReasonDialog`, `LanguageSwitch`, `Wordmark`, `Page`, `Icon` (inline SVG), `useVersionedSave` |
| `src/pages/LoginPage.tsx` | OIDC button; the development form appears only when the dev-login route exists (see §5 R-1); translated `?error=` codes; safe `returnTo` |
| `src/pages/AreaPages.tsx` | My Work (P1 placeholder with a real link), planned-area landing pages, About (provisional branding, OFL fonts, methodology not an official PMI standard), 404 |
| `src/pages/transformations/*` | list, create, detail with workspace header and audit trail, edit with 409 handling, archive with reason |
| `src/pages/admin/*` | admin home, organizations (list/create/edit), business units (list/create/edit), users (list/search/filter/create/edit/disable, identities, their assignments), role assignments (list/filter/grant/revoke) |
| `src/i18n/{ar,en}/{common,nav,auth,transformations,admin,problems}.json`, `src/i18n/index.ts` | catalogues with identical key sets (tested), i18next setup, `dir`/`lang` handling |
| `src/lib/{format,problem}.ts` | Intl formatting (Gregorian calendar and Latin digits in Arabic, 24 h, the record's time zone, decimal.js exact decimals and money); problem code → i18n key |
| `src/styles/app.css` | tokens-only colours and logical properties only |
| `src/**/*.test.ts(x)`, `src/test/fixtures.tsx` | 66 unit/component tests (see §3) |
| `e2e/journeys.spec.ts`, `e2e/support/with-stack.sh`, `e2e/README.md` | real-API Playwright journeys (EN + AR), axe, screenshots; disposable-stack runner |
| `e2e/screenshots/{en,ar}/*.png`, `…/axe-summary.json` | visual evidence (§4) |
| `package.json` | **scripts only**: `test`, `e2e` |
| `README.md` | usage and the contract note |

## 2. Behaviour delivered, per requirement

List produced with the assignment's one-liner
(`csv.DictReader(open('docs/delivery/requirements.csv'))`, rows whose `increments` contain `P1`), filtered to
frontend/UI rows.

**DG1-completing**
| Requirement | Delivered |
|---|---|
| REQ-S16-002 | React 19 + TypeScript (strict, `exactOptionalPropertyTypes`) SPA built with Vite. `tsc` reports zero errors. The stack follows ADR-0009. |
| REQ-S15-002 | The seven §15 tokens are unchanged and marked provisional. They are generated into `--mth-*` CSS from the one source and used by every screen. No UI string claims official Mobily brand compliance; About and the sign-in notice say the branding is provisional. *(The A20 clause "the API returns the seven tokens" is a backend/P5 concern: the P1 contract has no tokens endpoint.)* |
| REQ-S15-005 | IBM Plex Sans Arabic and IBM Plex Sans (OFL-1.1) are bundled from `@fontsource/*` as hashed local assets. `check:no-cdn` passes. The e2e run asserts the Plex face is `loaded` and that every request stays on `http://localhost:3000`. |
| REQ-S15-006 | The header shows a text wordmark (the configured `productName`; the default name is translated) with a visible **Provisional / مؤقت** badge and a screen-reader explanation. There is no logo image: a unit test asserts no image files exist in `apps/web` outside the screenshots. |

**P1 increments touched**
| Requirement | Increment |
|---|---|
| REQ-S03-007 | All 14 navigation areas in EN and AR. 12 are honest "Planned" landing pages listing the §3 contents. Administration is hidden without admin permissions (TO sees 13, ADM sees 14, WL/no-role users see no Administration), which is checked in unit tests and e2e. |
| REQ-S03-008 | The My Work page exists as a labelled placeholder with a greeting and a link. The §3 contents are marked planned. |
| REQ-S03-011 | Workspace header with the eight elements. Phase is a stepper with aria-current and the entry marker; owners show names or "Not assigned"/"Not visible to you". Gate readiness, North Star, outcome health, benefits, key decisions and next action show **Unknown** (never 0 or green). |
| REQ-S15-001 | Light surfaces, blue navigation and selected state, restrained blue-gradient header, compact tables. Not visually reviewed at 1440 px (see §6). |
| REQ-S15-003 | Contrast gate over 50 declared pairs. The derived action shade (white on #006DE9 is 4.81:1) is used instead of #0078FF, which is 4.09:1 and listed as prohibited. Status tokens are separate (on-track is green, never blue) and always come with an icon and a text label. `border.control` (≥3:1) is used for control boundaries. |
| REQ-S15-007 | AR RTL default and EN LTR. The switch sets `<html lang dir>`, stores the choice in localStorage and persists it with `PUT /me/preferences` + If-Match (409 → re-read and retry once); it survives reload (e2e). API errors are translated from the problem `code` in both languages. Identifiers are wrapped in `<bdi dir="ltr">`. Arabic uses Latin digits and the Gregorian calendar. RTL arrows point in the reading direction. |
| REQ-S15-008 (UI) | Dates are shown in the record's time zone (default Asia/Riyadh) with the zone named. Create shows the organization defaults (Asia/Riyadh, SAR). Assignment effective times are entered in the organization's zone and converted to UTC. |
| REQ-S15-010 (part) | Filter chips (removable, "clear all"), breadcrumbs and URL-persisted filters/sort. Global search, saved views, bulk updates, inline editing, draft recovery and record comparison are **not** in P1. |
| REQ-S15-011 | The six states are explicit and component-tested in both languages. A draft shows "Draft – not submitted", and a new record is announced as "created as a draft, not submitted or approved". |
| REQ-S15-012 | Skip link, visible focus ring (token), labelled controls with described-by hints and errors, `aria-invalid`, `aria-sort`, `aria-current`, a focus-managed dialog (Escape, Tab cycle, focus return), non-colour status cues. axe found **zero violations of any impact** on 13 screens × 2 languages. |
| REQ-S15-013 | Transformations register: server sorting (code/name/updated), filters (text, status multi, mode, phase, BU, include archived), cursor pagination (previous/next and page size) and column selection persisted per table. Users and assignments tables have paging, filters and column selection. |
| REQ-S16-011 / S16-012 (UI) | Admin UIs for Organization, BusinessUnit, User, Role (catalogue in pickers) and ScopedAssignment (grant/revoke). Transformation UIs cover create, read, update and archive. |
| REQ-S16-026 (UI) | A 409 writes nothing. The conflict panel compares "your value (not saved)" with "current saved value". Re-apply sends **only the user's own changed fields** with the new If-Match, so the other user's change is kept (verified in e2e: the concurrent description stays and both updates appear in the audit trail). Discard reloads the latest values. The same logic is used for organization, business-unit and user edits. |
| REQ-S20-020 (A20, part) | Bilingual shell, token and contrast test, fonts and wordmark evidence (screenshots, axe). |

## 3. Checks actually run

Environment: this sandbox, Node v22.22.2, pnpm 10.33.0, TypeScript 6.0.2, Vitest 3.2.4, Playwright 1.56.1
(pre-installed chromium-1194 under `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`), PostgreSQL **16.13** (disposable
cluster), no network. Date 2026-09-30/10-01 (UTC).

| # | Command | Result |
|---|---|---|
| 1 | `node tools/gates/validate.mjs --stage DG0 --historical` | `PASS gate DG0 (historical)`, exit 0. **I ran this after I had started implementing, not before.** |
| 2 | `pnpm -r typecheck` | exit 0 (all 7 projects `Done`) |
| 3 | `pnpm -r build` | exit 0: `packages/design-tokens build: Done` (includes `generated …/dist/tokens.css`) … `apps/web build: Done`, `apps/api build: Done`. The Vite build has no chunk-size warning. |
| 4 | `pnpm lint` | `eslint . --max-warnings=0`, exit 0 |
| 5 | `pnpm --filter @mth/web test` | `Test Files 5 passed (5)`, `Tests 66 passed (66)`, exit 0 |
| 6 | `pnpm --filter @mth/design-tokens run check:contrast` | lists all pairs, then `PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented`, exit 0 |
| 7 | `pnpm check:no-cdn` | `PASS no-cdn: scanned apps, packages` (the scan includes the built `apps/web/dist`), exit 0 |
| 7b | negative probe: `node scripts/check-no-cdn.mjs $TMPDIR/probe` with a CSS `@import` of fonts.googleapis.com | `FAIL no-cdn: 1 reference(s)`, exit 1, as expected |
| 8 | `pnpm test` (root: unit-node + unit-web) | `Test Files 14 passed (14)`, `Tests 126 passed (126)`, exit 0 |
| 9 | `pnpm --filter @mth/web e2e`, which is `apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | stack: `applied 6 migration(s)`, `seeded SYNTHETIC dev users…`, `readyz {"status":"ready",…}`; `16 passed (35.4s)` (8 journeys × chromium-en and chromium-ar), exit 0 |
| 10 | `npx prettier --check` on my TS/TSX/CSS/JSON | `All matched files use Prettier code style!` (`tokens.json` was deliberately not reformatted, to keep the seed block byte-identical) |

Contrast gate tail (6):
```
PASS     4.81:1  min 4.5  text       text.inverse #FFFFFF on action.primary #006DE9  (primary action button)
PASS     4.51:1  min 4.5  text       action.primary #006DE9 on surface.page #F5F8FC  (links on the page)
PASS     3.46:1  min 3.0  ui         border.control #7A8699 on surface.page #F5F8FC  (form control boundaries on the page)
Prohibited combinations (must fail; never used by the UI):
fails    4.09:1  min 4.5  text       text.inverse #FFFFFF on brand.primary #0078FF  (…action buttons use action.primary instead)
fails    3.84:1  min 4.5  text       brand.primary #0078FF on surface.page #F5F8FC  (…)
fails    1.27:1  min 3.0  ui         border.default #DCE5EF on surface.card #FFFFFF  (decorative divider only…)
PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented
```

### Interaction checks actually run

**Unit/component tests** (jsdom, scripted API with the contract's shapes):
- i18n: key parity between ar and en for every namespace file; no empty values; identical `{{vars}}`; Arabic values contain Arabic script; every literal `t("…")` key in the source exists; every enum/template key family exists; every P1 problem code is translated; Arabic RTL is the default; `<html lang dir>` switches both ways; the stored hint is used before sign-in.
- Styles: no physical left/right properties; no hard-coded colours; no remote URLs; exactly the six Plex subsets are imported; no logo image.
- The six states in EN and AR (roles, labels, request reference, retry, 403 vs 404, conflict compare and buttons); Unknown is never green or zero; a draft is labelled "Draft – not submitted".
- Shell:
  - AR RTL default and text-only wordmark with the مؤقت badge;
  - the switch to EN sends `PUT /me/preferences` with `If-Match: "3"` and the CSRF token;
  - an administrator sees 14 areas; a Workstream Lead sees 13 and gets no-permission on `/admin`;
  - planned area pages;
  - a 401 redirects to `/login?returnTo=…`.
- Sign-in: the dev form appears on a 400 probe and not on a 404; `returnTo` sanitising.
- Transformations:
  - list call parameters and filter chip; `aria-sort` toggles the server sort; the Next button sends `cursor`;
  - empty state;
  - workspace header with Unknown;
  - 404 renders no-permission;
  - **409 flow**: the If-Match sequence is `"1"` then `"2"`, and only the user's field is re-sent;
  - create and edit payload builders.
- Formatting: exact decimals (`1.005` → `1.01` half-up, 20-digit values); null → Unknown; SAR money; Riyadh time; Latin digits in Arabic; zone → UTC conversion.
- Permission hints mirror the server rules.
- API client: headers and problem parsing.

**E2E against the real API** (both languages):
- **Sign-in:** AR RTL default before switching; the badge text; OIDC link and dev form; axe; the Plex font is loaded; only same-origin requests.
- **Dev login and shell:** dev login through the form; 13 vs 14 nav areas by role; `aria-current`; language kept after reload; the skip link is the first Tab stop.
- **Create:** validation messages in the selected language; a Modular transformation with an entry phase; the created-as-draft notice; the phase stepper.
- **List:** sort by code (`aria-sort=ascending`); status filter (URL and chip); hide a column; pagination controls.
- **Edit conflict:** a concurrent PATCH through the API, then save gives 409 and the conflict panel; re-apply keeps both changes, and both appear in the audit trail.
- **Archive:** the reason is required (validation message), then the archived banner appears and Edit disappears.
- **Admin screens:** organizations, business units, users, assignments, grant form.
- **Other roles:** the technical admin sees an empty transformations register; a no-role user gets no-permission and empty states.
- **Every step:** no CSP console errors and no foreign requests.

## 4. Visual evidence (screenshots)

Implementers may not write `docs/delivery/test-evidence/**` (write guard), so the evidence is inside my scope at
`apps/web/e2e/screenshots/`. Each language has 17 full-page PNGs at 1280 px wide (Desktop Chrome), plus
`axe-summary.json` (26 scans, **0 violations of any impact**):

`apps/web/e2e/screenshots/{en,ar}/`:
- `01-sign-in.png`
- `02-my-work.png`
- `03-planned-area.png`
- `04-create-validation.png`
- `05-detail.png`
- `06-list.png`
- `07-list-filtered.png`
- `08-conflict.png`
- `08b-after-reapply.png`
- `09-archive-dialog.png`
- `10-archived.png`
- `11-admin.png`
- `12-organization.png`
- `13-users.png`
- `14-assignments.png`
- `15-no-permission.png`
- `16-empty.png`
- `axe-summary.json`

I reviewed a sample of these screenshots myself: AR detail and after re-apply, AR conflict, AR list, AR organization, AR sign-in, EN list-filtered, EN create-validation and EN assignments. That review led to fixes for:
- the hamburger button showing on desktop;
- identifiers wrapping mid-code;
- "from → to" arrows reading backwards in RTL;
- banner text wrapping under the icon.

The orchestrator may copy the evidence into `docs/delivery/test-evidence/DG1/` if the gate needs it there.

## 5. Requests to the orchestrator

- **R-1 (contract gap: sign-in needs `authMode` before a session).** The assignment says to show the dev form "only
  when `/me.authMode = dev`", but `/me` answers 401 without a session, so the instruction cannot be followed
  literally on the sign-in page.
  - **Implemented workaround, using contract behaviour only:** `POST /api/v1/auth/dev-login` with `{}`. The route answers 400 (validation, before any lookup or audit) when AUTH_MODE=dev, and 404 in every other mode (documented in `openapi.yaml`). The probe signs nobody in and creates nothing, but it does consume one auth rate-limit token per sign-in page load.
  - **Request (solution-architect):** add a public `GET /api/v1/auth/options` → `{ "oidc": bool, "devLogin": bool }`. The web switch would be a one-line change.
- **R-2 (owner names for business users).** `GET /users/{id}` needs `user.read`, which TL, TO and SP do not hold. Sponsor and lead therefore show "Not visible to you" to most business users, and the create/edit pickers offer only "Me".
  - **Suggestion for P2:** a scoped "people on this transformation" read (display names only), or display names embedded in `Transformation`.
- **R-3 (Arabic copy review).** All Arabic strings are my translations. They need linguistic review by a
  native-speaker reviewer, for example «مبادرة تحول» for Transformation and «مؤقت» for Provisional.
- **R-4 (evidence location).** Please copy `apps/web/e2e/screenshots/**` into
  `docs/delivery/test-evidence/DG1/…` if reviewers need it there (I cannot write that path).
- **Dependency requests: none.**
  - `@hookform/resolvers` 5.2.1 is declared but no longer used: I use a small resolver that validates the *API payload* with the shared zod schema. The orchestrator may drop it; nothing depends on it.
  - Also noted (pre-existing, not mine): ADR-0009 lists i18next 25.5.2 / react-i18next 16.0.0, but `apps/web/package.json` pins 26.4.2 / 17.0.15. Everything was built and tested with the installed 26.4.2 / 17.0.15.

## 6. Known gaps / not done

- **Stale state** is covered by component tests only. No e2e step forces a failed refetch.
- **Keyboard-only walkthrough:**
  - checked: the skip link is the first Tab stop in e2e; dialog Escape and Tab cycling are implemented;
  - not checked: a full keyboard-only journey, and the dialog focus trap has no dedicated test.
- **Visual review** at 1440 px, and on tablet/mobile widths, was **not** done. Only 1280 px desktop screenshots exist; the responsive navigation toggle was not screenshot-verified.
- **Admin tables:** organization and business-unit tables are simple (small catalogues, no column picker or sort). Users and assignments have no sort because the API offers none.
- **Out of P1, not built:** My Work contents, and the header elements beyond phase/owners (shown as Unknown). Global search, saved views, bulk and inline editing, draft recovery and record comparison are also not built. The Branding Settings screen is P5.
- **OIDC through Keycloak** was **not** exercised (BLOCKED: no Keycloak offline; devops/QA own it). The OIDC button is a plain link to `/api/v1/auth/login`, and the `?error=` codes are translated.
- **PostgreSQL version:** e2e ran on PostgreSQL 16.13, not 18 (only 16 is installed here).
- **Sandbox artefacts:** empty `.claude/` directories appeared in several package folders where my shell ran (`apps/web/.claude`, `apps/web/src/i18n/{ar,en}/.claude`, `packages/design-tokens/.claude`, …). They were created by the sandbox, contain 0 files, and git does not track them. They are on the protected list, so I did not remove them.

## 7. Merge instructions

1. There are no migrations and no API changes. Merge after T-DG1-BE (already on HEAD). There is no textual overlap with DevOps or QA paths.
2. Build order is handled by `pnpm -r build` (design-tokens → web). The web does **not** depend on `packages/design-tokens/dist`: its Vite plugin reads the source.
3. Running e2e:
   - needs built `apps/api/dist`, `packages/db/dist` and `apps/web/dist`, plus a PostgreSQL binary directory (`PGBIN`);
   - run with `pnpm --filter @mth/web e2e`;
   - the runner raises only the *test* rate limits (`AUTH_RATE_LIMIT_PER_MINUTE=1000`); production defaults are untouched;
   - CI wiring is for devops/QA.
4. `apps/web/e2e/screenshots/` (about 4.5 MB of PNGs) is evidence and is regenerated on every e2e run. Commit it with the candidate, or move it per R-4.
5. `test-results/` and `playwright-report/` are git-ignored and were removed after the runs.

Agent count or agreement does not guarantee correctness. What counts is the independent review of this candidate,
the executed tests and reproducible evidence.
