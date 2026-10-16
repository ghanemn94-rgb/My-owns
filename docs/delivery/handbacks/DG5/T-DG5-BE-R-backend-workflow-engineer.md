# Handback T-DG5-BE-R (backend-workflow-engineer): versioned branding and the product name (p5-work-split §I.3)

- **Stage:** P5 / DG5 (BUILDING). **Task:** T-DG5-BE-R. **Requirement rows:** REQ-S01-002, REQ-S15-004 (and the B0004 report footer that REQ-PB-001 "completes with BE-N/BE-R").
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-R-backend-workflow-engineer-20261016T070331Z-ceee5209","session_id":"ceee5209-f746-432e-8c64-5465163550f6"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-R.md`, sha256 `41e62c84…6fab` (verified at start).
- **Tree:** worktree `/home/user/wt/dg5-be-r`, branch `dg5/be-r`, base `HEAD` = `b2d030f3e82c9b0c61b5f0d8256f575371446d3f`. All changes are **uncommitted**, as the assignment asks.
- **Time:** start `Fri Oct 16 07:03:44 UTC 2026`; end `Fri Oct 16 09:01:47 UTC 2026` (about 118 minutes).
- **No migration.** The `0089` tables, guards and lock 730270 are used as delivered. **No new dependency.** No business, Finance or IT approval was granted; all test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/admin/branding.ts` | The six operations + the DG1 token route (shape kept). Version-0 defaults, token merge with the ADR-0009 §3 shade derivation (injected), §11 refusals with exact texts, the publish transaction under lock class `brandingPublish`, one audit event per row, outbox `branding.published`. The DG1 comment "Read-only at DG1 …" is replaced (F-DG4-160). |
| `apps/api/src/modules/admin/branding-port.ts` (new) | `BrandingReadPort.current(db, organizationId)` and the version-0 defaults; `createBrandingReadPort(defaults)`. |
| `apps/api/src/modules/admin/index.ts` | Barrel lines for the port; module comment made true. |
| `apps/api/src/modules/admin/branding.test.ts` | DG1 tests unchanged; adds the token merge/derivation, version-0, zod-vs-contract mirrors, §11 rules, logo decoding and the db-error mapping. |
| `apps/api/src/modules/platform/db-errors.ts` | The `branding_*` lines: `mapP5BrandingError` and its one call in `mapDatabaseGuardError`. |
| `apps/api/src/server.ts` | The one existing `registerBrandingRoutes` line now passes `tokenSource.derived`, `deriveDarkerShade` and `deps` (the import line gains the two names). |
| `packages/shared/src/schemas/branding.ts` | Zod mirrors `branding`, `brandingSettings`, `brandingVersion`, `brandingVersionPage`, `brandingLogo`, the font constants and the event payload `brandingPublishedV1`. The barrel line already existed. |
| `packages/shared/src/schemas/events.ts` | **Outside my list; named lines.** One import and one `OUTBOX_EVENT_SCHEMAS` entry `"branding.published": {1: …}`. ADR-0049 §12 requires the event, and `enqueueOutboxEvent` refuses an unregistered type. |
| `apps/worker/src/queues/branding.ts`, `apps/worker/src/handlers/branding.ts` (new) + one line each in `apps/worker/src/queues/index.ts` (×2: list and event map) and `apps/worker/src/handlers/index.ts` | **Outside my list; additive.** The consumer of `branding.published`. Without a queue the relay records every branding save as a publish failure (`relay.ts`: "no queue for event type"). It acknowledges each event once (`runOnce`, consumer `branding.published`). The server keeps no branding cache to invalidate. |
| `apps/worker/src/reports/export-runner.ts` | **Outside my list; the "one wiring line" of §I.3 lands here**, because rendering is the worker's and the worker imports no API code (§6.1). `brandingAtGeneration(db, org)` (the port's query) and `provenanceFooter(db, language)` (B0004 verbatim from `playbook_block`) are read just before rendering. They are passed as `branding: {productName, primaryColour, reportHeader, reportFooter, provenance}`. |
| `packages/reporting/src/model.ts`, `layout/blocks.ts`, `pdf/index.ts`, `docx.ts`, `pptx.ts` | **BE-N's files; named, additive lines.** `RenderOptions.branding` gains optional `primaryColour`, `reportHeader`, `reportFooter` and `provenance`. `PagedDocument` gains `brandColour`, `reportHeader` and `footerLines`. PDF: a 10 pt header band in the configured primary colour (none at version 0, so no colour is invented; text stays in the ink colour so a light brand colour never hurts legibility), the header line, and under the footer rule the report footer and the provenance (≤ 2 lines each). DOCX: header paragraph, footer paragraphs. PPTX: header, footer and provenance on the closing "About this file" slide. Stale "Until slice I's branding port ships" comments are corrected. |
| `packages/reporting/src/branding-layout.test.ts` (new) | Unit test: PDF band/name/header/footer/B0004; version 0 adds no band or line; an invalid colour is ignored; DOCX footer part and PPTX slides carry the lines. |
| `apps/api/test/integration/branding/branding.test.ts` (new) | 24 integration tests against the disposable PostgreSQL (§2). |
| `apps/api/test/integration/contract/p5-exercises-be-r.ts` | Exercises all six operations (success and every reachable declared refusal), with the zod mirrors. |
| `apps/api/test/support/p5-pending-be-r.ts` | Emptied (6 → 0). |
| `docs/api/openapi.yaml` | **Proposed one-line patch (D-157 precedent, BE-S's `ETagOrZero`).** `getBrandingSettings` 200 `ETag` → `ETagOrZero`. Its own summary says `ETag "0" when never saved`, which the `ETag` pattern (`^"[1-9]…"$`) forbids. `pnpm openapi:lint` PASS (846 operations). |
| `docs/delivery/handbacks/DG5/T-DG5-BE-R-*` | This handback and its evidence logs. |

## 2. Behaviour delivered, per requirement row

### REQ-S01-002
> acceptance: "A06;A20: changing the name updates the shell header in en and ar and the next generated report header without a code change; a fresh install shows 'Mobily Transformation Hub'"

- **Fresh install.** No `branding_setting` row = version 0. `GET /api/v1/branding` returns `productNameEn` "Mobily Transformation Hub" and `productNameAr` "منصة موبايلي للتحوّل" (the shipped i18n texts), with `source: "default"`, `wordmarkProvisional: true`, `coloursProvisional: true` and #0078FF / #003B73. Test: `branding.test.ts` "version 0 …".
- **Changing the name.** `PUT /api/v1/admin/branding` publishes version n+1. The next `getBranding` returns the new name in en and ar, with no restart. Test: "render-time reads … a new name is returned in en and ar".
- **Next generated report header.** The worker's export runner reads the current branding at generation time. After the PUT, a newly generated EN PDF's header line is "Synthetic Roaming Hub", and the default name is absent. The AR PDF draws the Arabic name and no longer "موبايلي". This runs through the real `POST /exports` → `runExport` → download path. Test: "the next generated report carries the current branding …".
- **Not delivered here: the shell header in en and ar.** That is FE-G's (`pages/branding/**`, the shell), per §I.6 "Completes with FE-G". The API it reads (`GET /branding`) is delivered.

### REQ-S15-004
> acceptance: "A20: changing brand.primary in Branding Settings changes the navigation colour and the header colour of a newly generated PDF report without a code change or redeploy"

- **Tokens.** `GET /branding/tokens` merges the current version's colours into the token set: `brand.primary` = primary, `brand.deep` = secondary. It re-derives `action.primary` and `action.primary-hover` with the ADR-0009 §3 rule, from the same token source at read time. At version 0 the derived values equal `tokens.json` (#006DE9 / #0055B6). After a PUT with #00A651, `brand.primary` is #00A651 and `action.primary` = `deriveDarkerShade("#00A651", [#FFFFFF, #F5F8FC], 4.5)`, not #006DE9. `provenance` stays `provisional` (ADR-0049 §8). Tests: integration "a new primary colour changes brand.primary and the derived action shade"; unit "toBrandingTokens with a branding version".
- **PDF header colour.** A newly generated PDF has its header band filled with the configured primary colour. The content stream contains `0 0 W 10 re / 0 1 0 scn / f` for #00FF00. Version 0 has no band. Same test as above, plus `branding-layout.test.ts`.
- **Navigation colour.** It is the web shell's (FE-G). The shell derives it from `/branding/tokens`, which now changes.
- **Versions.** Every save is a new immutable version (`branding_version`, append-only; the owner's UPDATE is refused, as tested). `listBrandingVersions` returns newest first with cursor pagination; `getBrandingVersion` returns one version, 404 for a missing one and 400 for `0`.
- **Logo.** PNG only (signature, 67 B–256 KiB, strict base64, alt texts en+ar), with `keep` / `none` / `set`. `GET /branding/logo` returns `image/png` with the stored bytes (`nosniff`), or 404 `branding.logo_not_found` with the exact §11 text.
- **The §I.3 literal tests, all passing in `branding.test.ts`:**
  - `If-Match: "0"` creates version 1 (ETag `"1"`), a stale `"0"` gives 409, a missing header 428.
  - One audit event per row: `branding_version.create` on the version; `branding_setting.create` (prior null, new 1) then `branding_setting.update` (1 → 2) on the head.
  - One `branding.published {organizationId, versionNo}` event with key `branding.published:<org>:<n>`.
  - Each §11 refusal, with the exact code and English text and no version written: an SVG logo, a PNG without Arabic alt text, `#0078ff`, `#03F`, the font "Arial", a header in English only, a footer in Arabic only, "PMI certified" in the name, "DG7" in the footer. The disclaimer "Not an official PMI standard." / "ليس معيارًا رسميًا من PMI" is accepted.
  - AUD, WL and TL get 403 on all four settings operations, and nothing is written. Unauthenticated gives 401.
  - Commit-time re-authorization: the grant is revoked while the request waits, which gives 403 and no version.
  - Two concurrent saves with the same If-Match: one 200, one 409.
  - Organization isolation: org B still reads the defaults.
  - The worker routes `branding.published` to exactly one queue and acknowledges it once: a replay ×3 gives acknowledged, duplicate, duplicate, with one ledger row.
- **Colour approval.** Colours count as approved only with a `colourApprovalReference` recorded by the admin (`coloursProvisional = false`). The platform approves nothing; #0078FF stays provisional otherwise.

### REQ-PB-001 (the report-footer part, "completes with BE-N/BE-R")
- Every PDF, DOCX and PPTX the worker generates now carries the B0004 provenance statement. The worker reads it verbatim from the immutable `playbook_block` catalogue (`0092`); the Arabic is the provisional translation stored there. PDF and DOCX put it in the footer; PPTX on the closing slide.
- The configured report header and footer are printed too (M0301 "report header/footer").
- Tests: integration (EN line "Practical synthesis inspired by PMI Organizational Transformation…"; AR word "المنافع"), and `branding-layout.test.ts`.
- XLSX and CSV carry no footer (not paged; unchanged).

## 3. Checks (real exit codes; logs in `docs/delivery/handbacks/DG5/T-DG5-BE-R-evidence/`)

Environment: Node 24.21.0, offline. Harness ports 23101–23149. The host's load average was 15–21 throughout: three other W14 runs shared the machine (`uptime` lines are in the logs).

| # | Command | Exit | Result |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | **0** | `PASS gate DG4 (historical)` (`00-validate-historical-DG4-start.log`). Re-run at the end: see row 9. |
| 1 | `pnpm -r typecheck` | **0** | `01-typecheck.log`; re-run on the final tree: `01b-typecheck-final.log`, exit 0 |
| 2 | `pnpm -r build` | **0** | `02-build.log` |
| 3 | `pnpm lint` (eslint, max-warnings 0) | **0** | `03-lint.log`; final tree: `03b-lint-final.log`, exit 0 |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" (`04-prettier.log`); final tree: row 10 |
| 5 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` (`05-openapi-lint.log`) |
| 6a | `pnpm test`, locale unset, run 1 | **1** | unit-node 2128 passed / 5 failed (131 files). **One real failure, fixed:** `advisory-locks.test.ts` "no module source … spells a class number" flagged my comment in `admin/branding.ts` (it said "730270"); it now names the class `brandingPublish`. The other 4 are timeouts: `architecture.test.ts` 30 s, three `pdf/pdf.test.ts` 5 s, plus a vitest "Timeout calling onTaskUpdate" worker error. Log: `06a-unit-locale-unset-run1-failed.log`. |
| 6b | `pnpm test`, locale unset, run 2 (after the fix; full integration running in parallel) | **1** | unit-node 2124 passed / 9 failed (131 files), plus 2 vitest worker-RPC timeout errors. **All 9 are timeouts:** `architecture.test.ts` at 52.5 s (limit 30 s) and 8 `pdf/pdf.test.ts` tests at 5.1–9.9 s (limit 5 s). No assertion failed. `unit-web` and `unit-formula-nocodegen` ran too (see log). Log: `06-unit-locale-unset.log`. |
| 6c | `npx vitest run --project unit-node packages/reporting apps/api/src/architecture.test.ts apps/api/src/modules/platform/advisory-locks.test.ts apps/api/src/modules/admin` (still under load) | **1** | 211 passed / 7 failed, all timeouts of the same kind (`06b-unit-isolated-reporting-architecture.log`). The same `pdf.test.ts` passed 13/13 alone at 07:39, after my PDF band change (embed test 1154 ms). Its path passes no branding extras, so my renderer code adds only an empty-array loop there. I classify these as F-DG4-148-class load timeouts, **not verified green**: they need a re-run on an idle machine. |
| 7 | `LC_ALL=C.UTF-8 LANG=C.UTF-8 npx vitest run --project unit-node apps/api/src/modules/admin packages/reporting/src/branding-layout.test.ts apps/api/src/modules/platform/advisory-locks.test.ts` | **0** | 20/20 (`07-unit-cutf8-targeted.log`). **The full `pnpm test` under C.UTF-8 was NOT run: BLOCKED by the 2-hour time limit.** |
| 8 | `QA_PG_PORT=23110 MTH_PORT_POOL=23111-23149 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | 267 files: 266 passed, 1 failed. Tests: **2559 passed, 1 failed, 1 skipped** (2561). The only failure is the media-type pin below. The skip is BE-O's documented `it.runIf` (D-159). Against D-159's 2536 + 1 skipped, the delta is +24 (my `branding/branding.test.ts`), and the 2 560 non-skipped tests match. Log: `08-integration.log`. |
| 8a | Targeted integration runs during development (`with-pg.sh npx vitest run --project integration <paths>`, ports 23101–23149) | — | `branding/` 24/24 (last run exit 0). `branding/` + `contract/`: 103/104; the 1 failure is the media-type pin (§4). `branding/` + `reporting/exports-paged` + `reporting/exports`: 43/44 at that point; the 1 failure was my own Arabic-word assertion (teh marbuta in the test reader), since fixed and re-run green (24/24). Not kept as logs; the full run (row 8) supersedes them. |
| 9 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | **0** | `PASS gate DG4 (historical)` (`09-validate-historical-DG4-end.log`) |
| 10 | prettier check on the final tree | **0** | "All matched files use Prettier code style!" (`10-prettier-final.log`) |

**The one integration failure left by design** is `contract.test.ts` › "every route accepts exactly the request media types its operation declares": `expected [387, 386, 1] to deeply equal [386, 385, 1]`. This is the orchestrator-owned pin (§4, rule 14).

## 4. Operations routed (delta to `apps/api/test/support/p5-pending-be-r.ts`)

`P5_PENDING_BE_R`: 6 → 0. Removed and routed: `getBranding`, `getBrandingLogo`, `getBrandingSettings`, `putBrandingSettings`, `listBrandingVersions`, `getBrandingVersion`. Each is exercised in `p5-exercises-be-r.ts` through `mirrored`:
- `getBranding`: 200, 400, 401.
- `getBrandingLogo`: 200 `image/png` (set, read, removed again), 404 `branding.logo_not_found`, 400, 401.
- `getBrandingSettings`: 200, 400, 401, 403 (AUD, TL).
- `putBrandingSettings`: 200, 400 (malformed If-Match, unknown member), 401, 403 (AUD), 409, 422 `branding.colour_invalid`, 428.
- `listBrandingVersions`: 200, 400 (cursor), 401, 403.
- `getBrandingVersion`: 200, 400, 401, 403, 404.

The exercise saves the shipped values (#0078FF, the shipped names), so the shared contract world's other checks (the tokens test expects a provisional #0078FF) are unaffected.

**Pinned-count delta (contract.test.ts, the orchestrator's file, rule 14):**
- Media-type triple `[386, 385, 1]` → **`[387, 386, 1]`**: +1 `putBrandingSettings`, `application/json`. Until the orchestrator applies it, that one contract test fails (shown in the integration log, §3). That is the only failure I left by design.
- Rate-limit floor: no change. No new rate-limited route.

## 5. For the orchestrator: contract, schema and dependency needs

1. **`docs/api/openapi.yaml`, one line (applied in my tree; please accept or revert):** `getBrandingSettings` 200 `headers.ETag` → `#/components/headers/ETagOrZero`. This is the BE-S/D-157 precedent: the summary says ETag "0" before the first save. If reverted, the version-0 read through `mirrored` fails its header check.
2. **The `branding.published` event registration** (`packages/shared/src/schemas/events.ts`, two named lines) and **its worker consumer** (two new files plus three index lines). Both are outside my file list. The ADR requires the event, and a registered event with no queue is a relay failure on every save. Please confirm the ownership, or move the lines.
3. **The layout wiring is in the worker and BE-N's renderer files, not in `apps/api/src/modules/reporting/exports/layout/**`.** That path does not exist: rendering happens only in `apps/worker` (`reports.export`), and `@mth/reporting`'s layout is `packages/reporting/src/layout/**`. The worker may not import API code, so it runs the port's query itself (`brandingAtGeneration`, documented as the twin of `BrandingReadPort.current`). The renderer edits are additive optional members, and every BE-N test passes unchanged when run without load (§3).
4. **Not done, needs a contract change: the snapshot content's `brandingVersionNo`** (§I.3 "the snapshot content gains `brandingVersionNo`"). `reportDocument` (`packages/shared/src/schemas/report.ts`, KBE-C's) and OpenAPI `ReportDocument` are strict objects, so the member cannot be added without a contract and schema change in frozen files. Proposed: an optional `brandingVersionNo: integer ≥ 0`, written by `reports/snapshots.ts` at generation from `BrandingReadPort.current(...).versionNo`; the worker would then render a snapshot with exactly that version. Until then an export renders with the branding current at **export** time. A stored file never changes.
5. **No new problem code.** All §11 codes are used verbatim. Shape errors (unknown member, blank name, over-length, missing member) are 400 `validation.*`; the §11 business rules are 422.
6. **No dependency.**

## 6. User-facing texts made untrue, and what I did

- `apps/web/src/i18n/{en,ar}/admin.json` `plannedSections`: "… Form, workflow, automation and branding settings are not available yet." / "… والهوية البصرية غير متاحة بعد."
  - **Still true for the UI:** there is no Branding Settings screen until FE-G (`pages/branding/**`). I did not edit it (not my file).
  - **For FE-G:** remove "branding" from this sentence in both languages when the screen ships.
- `common.json` `provisionalHint` / `provisionalNotice` / `brandBody` stay true. No logo is shipped, the colours stay provisional until an approval reference is recorded, and `brandBody` already says the colours "can be replaced through Branding Settings".
- `nav.json` "Product name, header, footer and design tokens, as versioned settings.": now true.
- Code comments that said "Read-only at DG1" or "until BE-R ships" were corrected in the files I touched: `admin/branding.ts`, `admin/index.ts`, `export-runner.ts`, `pdf/index.ts`, `docx.ts`, `pptx.ts`, `model.ts`.

## 7. What remains

- `brandingVersionNo` in the snapshot content (§5.4): blocked on a contract and schema change.
- The shell header, the navigation colour from the tokens and the Branding Settings screen: FE-G.
- The DG0–DG7 and claim text scans over UI strings and export templates: BE-R2.
- XLSX/CSV carry no provenance footer (not paged). ADR-0045's "every file carries … the provenance footer" for those two formats is open for the owner of `xlsx/**` and `csv.ts` if wanted (the frame rows would be the place).

## 8. Merge instructions

- No migration and no ordering constraint beyond §I.5 (BE-R after BE-N, which is merged).
- **Expected conflicts:**
  - `db-errors.ts`: an additive mapper plus one call line; union.
  - `events.ts`: one import, one entry; union.
  - `apps/worker/src/{queues,handlers}/index.ts`: one line each; union.
  - `contract.test.ts`: the media-type pin, the orchestrator's.
- After the merge, set the media-type pin to the merged sum: `[387, 386, 1]` on top of D-159, plus the other W14 tasks' deltas.
