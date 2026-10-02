# Handback T-DG2-FE — P2 frontend screens (frontend-ux-engineer)

- **Stage:** DG2 (P2). **Task:** T-DG2-FE. **Assignment:** `docs/delivery/assignments/DG2/T-DG2-FE.md` (sha256 `dbccf0fc…7b232`, verified before starting).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG2-T-DG2-FE-frontend-ux-engineer-20261002T021930Z-816ace54","session_id":"816ace54-1c96-4be2-9f76-2c05846e4393"}`.
- **Base revision:** `HEAD` = `27b3bd699983083e66f3a03dd3460aef22796d0a` (branch `claude/mobily-transformation-platform-regate`). Nothing was committed: the changes are in the working tree for the orchestrator to integrate.
- **Write scope respected:** only `apps/web/**`, plus this handback. No `package.json` dependency change, no new dependency. `apps/api/**`, `apps/worker/**`, `packages/**` and `docs/**` were read only.
- **Engineering vs product gates:** the Gates screens are G1–G6 **business approvals** inside the product, and they are labelled that way. They never mention DG0–DG7. The one G1 approval recorded in the e2e journey is a **synthetic demo approval** made by a synthetic dev user (`dev.office`, given a synthetic SP grant on that one disposable transformation). It approves nothing real.

## 1. Changed files

**New pages**
| File | Purpose |
|---|---|
| `apps/web/src/pages/diagnose/DiagnosePage.tsx` | Diagnose screen. It shows the T01 grid of the 6 catalogue dimensions with H/M/L confidence and impact (SAR amount, KPI or text), Unknown when data is missing. It shows findings and outputs for each of the 6 workstreams with their key questions and typical outputs, the baselines (with Finance validation), and the value pools ("Unquantified" label, per-currency totals with "Partial: N unquantified", Finance validation). |
| `apps/web/src/pages/define/CharterPage.tsx` | Charter screen: the 14 numbered fields, the four-part thesis, and the 5 scope checks with answer, evidence and system pre-check. It has create and edit (each save makes a new version, with an optional change summary), version history with a field diff against the previous version, and the 3–5 top-outcomes warning. |
| `apps/web/src/pages/define/DefinePage.tsx` | Define screen: the North Star (one sentence, PUT, If-Match only when one already exists) and its history. The outcome tree (nested, top outcome and rank) shows the **good-outcome test for each outcome**: pass, fail or unknown per criterion, with localized reasons and a summary. It also has the T02 tree (target date required, trajectory editor, trajectory approval), KPI definitions and strategic guardrails. |
| `apps/web/src/pages/design/DesignPage.tsx` | TOM canvas: 10 boxes in source order with prompt, target design, owner and draft/ready status. A per-dimension view (REQ-S05-003) shows current and target design, owner, status, gaps, decisions, dependencies and evidence. Also the T03 gap matrix linked to T04 decisions, and the capability heatmap (current/target level 1–5, gap heat with label and icon, build/buy/partner/undecided plus a sourcing summary). |
| `apps/web/src/pages/design/JourneysSection.tsx` | Journeys and processes (current/future): a steps editor with add, remove and reorder, stable step keys, actor, hand-off, systems, controls and cycle time; pain points linked to a step and to a T01 row. |
| `apps/web/src/pages/design/WorkshopsSection.tsx` | Workshop mode: plan, edit, start and close workshops; add contributions and unresolved items; convert an unresolved item into a T04 design decision or an owned action (POST with If-Match). A count of open unresolved items is shown. |
| `apps/web/src/pages/decisions/DecisionsPage.tsx` | T04 log via `GET /api/v1/decisions?transformationId=…&kind=design`. It shows D-codes, options A/B/C (recommended and chosen marked), status (default Open), owner, due date and outcome. You can create a decision with inline options, edit or defer/cancel it, add an option (If-Match), and record the decision (owner only, as a UI hint). A read-only list of gate decisions is included. |
| `apps/web/src/pages/gates/GatesPage.tsx` | G1–G6 cards with status, live mandatory readiness, an unverified-evidence count and "Not available in this release" for G4–G6. A "Business approval" note is shown. |
| `apps/web/src/pages/gates/GateDetailPage.tsx` | One gate: decision question, evidence required, approver, phase and next phase, current submission. It shows the live readiness per criterion: completeness, the localized missing items (pointers resolved to record names with links), and evidence state, with unverified evidence listed as "Unverified: does not count", including failing good-outcome outcomes at G2. Submit uses If-Match and is shown disabled with the reason while the server's `canSubmit` is false. The approver decision has four outcomes, a mandatory rationale and comments. It also covers approver configuration, the submission history with frozen criteria and the decision, and translated 403/409/422 problems. |
| `apps/web/src/pages/evidence/EvidencePage.tsx` | Evidence register: add a file (then upload), note, external link or filename reference. Upload sends an octet-stream body, a percent-encoded `X-File-Name` and If-Match, with a 25 MB client pre-check. You can download, link to 15 P2 record types, remove a link (with a reason), review (verified/rejected plus explicit accessibility; never offered to the creator; "verified" is never offered for a filename reference) and archive. |

**Shared components and libraries**
| File | Purpose |
|---|---|
| `components/Workspace.tsx` | Transformation workspace frame: breadcrumbs, header, tab navigation (`aria-current`), and permission hints (`can`, `canAny`, `canWriteRow` for `*.contribute` on own rows). It shows a **read-only note** when the user holds none of the page's write permissions (AUD) or the transformation is archived. |
| `components/RecordForm.tsx` | Declarative create/edit form (dialog or inline). It validates against the **shared zod schema** before sending, uses an Idempotency-Key on create, and sends only changed fields with If-Match on edit. On a 409 it shows "nothing was saved", compares values and offers re-apply on the current version or discard. Server field errors appear on the matching field; 403/422 errors appear as a translated banner. |
| `components/RegisterTable.tsx` | Client-side register table: sort (`aria-sort`, missing values last), search filter, pagination and persisted column selection. |
| `components/People.tsx` | Owner pickers and names from the transformation team plus the signed-in user. A user's display name is shown when the caller can read users; otherwise the team role. |
| `components/P2Badges.tsx` | Text plus icon chips: confidence, record status ("Draft – not submitted"), Finance validation (validated/rejected/stale/unvalidated), evidence state, test result, completeness and gate status. |
| `components/Amount.tsx` | Decimal display through `@mth/shared` `formatDecimal` (Unknown for null, never 0), the "Unquantified" label, and `ValuePoolTotals` (via `totalValuePools`/`isPartialTotal`, per currency, Unknown when nothing is quantified). |
| `components/RowActions.tsx` | Archive with a mandatory reason and If-Match; a dialog for decisions that need a note (Finance validation, trajectory approval, evidence review, decide). |
| `components/Section.tsx` | Labelled page sections, an in-page "On this page" nav, and text cells. |
| `lib/methodology.ts` | Bilingual catalogue labels (source text in EN, provisional AR). |
| `lib/format.ts` | Adds `formatBusinessDate`, which formats a calendar date with no zone shift. |
| `api/types.ts`, `api/queries.ts`, `api/client.ts` | P2 response types (inferred from `@mth/shared/schemas`); P2 query hooks under one `["p2", tid]` key family, invalidated after every mutation (live gate readiness included); raw-body upload support in the client. |

**Changes to existing files**
| File | Purpose |
|---|---|
| `app/router.tsx` | New routes `/transformations/:id/{diagnose,charter,define,design,decisions,gates,gates/:gateCode,evidence}`, plus entry pages for the partial areas. |
| `app/nav.ts`, `pages/AreaPages.tsx` | Strategy and KPIs, Target Operating Model, Governance, and Evidence and Reports are now **partial**. Each area page lists the visible transformations and opens the matching workspace tab. The cross-portfolio view is still labelled Planned. |
| `pages/transformations/TransformationDetailPage.tsx`, `common.tsx` | Workspace tabs on the overview. The header now composes gate readiness (the gate of the current phase), the North Star and open design decisions from the P2 APIs (REQ-S03-011). The other elements stay Unknown. `useTransformationTarget` moved to `common.tsx` (still re-exported). |
| `styles/app.css` | Styles for the P2 layouts (logical properties and tokens only). Wide registers now scroll inside their card, and `.table-wrap` is `position: relative`: in RTL, absolutely positioned visually-hidden text had widened the page. Links in hovered rows and the selected canvas box use `brand.deep`, a declared and checked contrast pair. Long dialogs scroll. |
| `i18n/{en,ar}/{diagnose,define,design,decisions,gates,evidence,kpi}.json` (new), `i18n/index.ts` | New namespaces in EN and AR, with identical keys. |
| `i18n/{en,ar}/{common,nav,transformations,problems}.json` | Shared P2 strings; 95 P2 problem codes (gate/charter/kpi/evidence/workshop/validation…); **104 P2 audit-action labels**. Without those labels the transformation audit trail showed `gate_instance.create (action without a translation)`; the P1 journey caught this. |
| `app/app.test.tsx` | Updated for the P2 header and the partial Governance area; adds a test for a partial-area entry page. |
| `pages/p2.test.tsx`, `test/p2fixtures.ts` (new) | 30 P2 unit tests on stubbed contract-shaped responses (synthetic). |
| `e2e/p2-journeys.spec.ts`, `e2e/support/ui.ts` (new) | P2 journeys against the real stack in EN and AR, with screenshots and axe. |
| `e2e/journeys.spec.ts` | The "planned area" step now uses Risks and Actions, because Governance is partial since P2. |
| `e2e/support/with-stack.sh` | API port is configurable (`E2E_API_PORT`, exports `E2E_BASE_URL`). Accepts `QA_PG_PORT` as an alias of `E2E_PG_PORT`. Sets `EVIDENCE_STORAGE_PATH` to a private directory of the run, which is deleted at teardown. Without it, uploads returned 503 because the default `/var/lib/mth/evidence` is not writable. |

## 2. Behaviour delivered (by requirement)

| Requirement | Delivered in the UI (server re-checks everything) |
|---|---|
| REQ-PB-026 (T01), REQ-PB-023 (workstreams) | The T01 grid from the catalogue's 6 dimensions, with an edit dialog using If-Match and only changed fields. Each of the 6 workstreams shows its key questions and typical outputs, with findings (kind, T01 link, confidence, draft/confirmed status) and outputs. |
| REQ-PB-027, REQ-PB-028 | Baselines and value pools. Amounts are exact decimals via `value.ts`. An unquantified pool is labelled and never 0. Totals are per currency, show "Partial: N unquantified", and are Unknown when nothing is quantified. Finance validation, including the stale state. |
| REQ-PB-029/030/031/035 | Charter: 14 fields, thesis, the 5 scope checks with pre-checks, versions and diff, the 3–5 warning (also on Define). |
| REQ-PB-033, REQ-PB-032, **REQ-PB-036**, REQ-PB-034, REQ-PB-037 | North Star with the shared one-sentence validation. Outcome tree. **Good-outcome test for each outcome**: each criterion with pass/fail/unknown, a localized reason and a pass/not-pass summary. A failing or unknown result is never upgraded. T02 rows need a target date before anything is sent. Trajectory approval. KPI dictionary. Guardrails. |
| REQ-PB-041, REQ-S05-003, REQ-PB-039, REQ-PB-024, REQ-PB-025, REQ-PB-042, REQ-PB-043 | Canvas (10 boxes) and per-dimension view; T03 linked to T04; heatmap; journeys with steps and pain points; workshop conversion; T04 log through `kind=design`. |
| REQ-PB-016/017/018, REQ-S04-003…005, REQ-DLV-034, REQ-S13-012 | G1–G3 readiness per criterion with evidence state (unverified shown as such, including failing good-outcome outcomes at G2). Submit (If-Match). Approver decision with rationale. Translated 403 `gate.not_approver` / `gate.submitter_cannot_decide`, 409 `gate.submission_superseded`, 422 `gate_criteria_incomplete` (with the listed criteria). |
| REQ-S13-010…013 | Evidence upload, link and review, as described in §1. |
| REQ-S10-001 (FE part) | AUD sees read-only views: no enabled write control on any P2 screen, plus a read-only note. Unit-tested on all 7 screens and checked in e2e on all 7 screens in both languages. |
| REQ-S03-011 (P2 increment) | Header composed from the P2 resources (see §1). |
| REQ-S15-* (platform rules) | AR-RTL and EN-LTR for every string; status always shown as text plus icon; Unknown/Stale states; drafts labelled "Draft – not submitted"; no CDN (every e2e page asserted same-origin only); provisional wordmark unchanged. |

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, pnpm workspace at `27b3bd6` plus my working tree. BE round 2 was running at the same time on `apps/api/**`; the api build and e2e used the `apps/api` tree as it was at run time.

| Check | Command | Result |
|---|---|---|
| Historical validator | `node tools/gates/validate.mjs --historical --stage DG1` | `PASS gate DG1 (historical)`, exit 0 (run at start and at end) |
| Typecheck | `pnpm -r typecheck` | exit 0 (includes `apps/web` `tsc -p tsconfig.json && tsc -p tsconfig.e2e.json`) |
| Build | `pnpm -r build` | exit 0 (all packages; web `vite build` ✓) |
| Lint | `pnpm lint` (`eslint . --max-warnings=0`) | exit 0 |
| Format (my files) | `npx prettier --check apps/web` | "All matched files use Prettier code style!", exit 0 |
| Format (root script) | `pnpm format:check` | **exit 2, BLOCKED by the sandbox, not a formatting failure**: Prettier reported "All matched files use Prettier code style!" but could not read untracked, non-project files at the repo root (`EACCES` on `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`). These files are not in the repository and not mine. In a normal checkout this check should be re-run. |
| Web unit tests | `pnpm --filter @mth/web test` | `Test Files 9 passed (9)`, `Tests 141 passed (141)` (30 in `p2.test.tsx`; was 110 before) |
| Contrast | `pnpm --filter @mth/design-tokens run check:contrast` | `PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented`, exit 0 |
| e2e (EN + AR, real stack) | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_PG_PORT=54917 E2E_API_PORT=3917 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` (after `pnpm -r build`) | **36 passed (2.1m)**: 9 P1 + 9 P2 journeys, in both `chromium-en` and `chromium-ar`. Tail below. |
| axe (in e2e) | `@axe-core/playwright`, WCAG 2.0/2.1 A+AA, on every screenshot step | 0 serious/critical. `axe-summary-p2.json` lists **no violations of any impact** on 25 P2 pages per language. |

e2e output tail (ANSI and timings stripped):
```
{"status":"ready","checks":{"database":"ok","migrations":"ok"}}
  ✓  10 [chromium-en] › p2-journeys.spec.ts:42 › lead creates an End-to-End transformation; the workspace tabs lead to the P2 screens
  ✓  11 [chromium-en] › p2-journeys.spec.ts:83 › Diagnose: six T01 dimensions with Unknown; value pools labelled Unquantified with a partial total
  ✓  12 [chromium-en] › p2-journeys.spec.ts:168 › Charter: create, save a second version, compare versions; the 3-5 top-outcomes warning
  ✓  13 [chromium-en] › p2-journeys.spec.ts:233 › Define: North Star, the good outcome test with reasons, and a required T02 target date
  ✓  14 [chromium-en] › p2-journeys.spec.ts:317 › Design: ten canvas boxes, the per-dimension view; workshop mode converts an unresolved item into T04
  ✓  15 [chromium-en] › p2-journeys.spec.ts:399 › Evidence: note, filename reference and file upload; a link; review by another person
  ✓  16 [chromium-en] › p2-journeys.spec.ts:593 › Gates: G1 shows unverified evidence and offers no submission while incomplete; once complete it is submitted
  ✓  17 [chromium-en] › p2-journeys.spec.ts:648 › Gates: the approver's decision — 409 when the submission was superseded, then approval with a rationale
  ✓  18 [chromium-en] › p2-journeys.spec.ts:739 › read-only auditor (AUD): every P2 screen without write controls; Unknown and Unquantified rendered
  ✓  28–36 [chromium-ar] › the same nine P2 journeys (Arabic RTL)
  ✓  1–9, 19–27 › the nine P1 journeys in EN and AR (incl. F-DG1-210/F-DG1-008 audit-trail journey)
  36 passed (2.1m)
```

**Interaction checks performed in e2e:** keyboard-operable dialogs (focus in, Escape, labelled controls via `getByLabel`); real uploads (asserted `Content-Type: application/octet-stream`, `X-File-Name` = percent-encoded Arabic file name); the 409 superseded flow; phase advance to Define after approval; AUD read-only on 7 tabs; same-origin request tracking (no CDN, no CSP errors) on every page.

**Screenshots** (Playwright, full page, both languages; all at 1280px viewport width, with no horizontal overflow after the RTL fix): `apps/web/e2e/screenshots/{en,ar}/p2-01-overview.png` … `p2-17-gate-approved.png`, `p2-18-aud-{diagnose,charter,define,design,decisions,gates,evidence}.png`, plus `axe-summary-p2.json`; P1 shots `01…17` regenerated. **Note:** `apps/web/e2e/screenshots/` is gitignored (`.gitignore:22`), so these are local artefacts of this run. My write scope excludes `docs/delivery/test-evidence/**`, so I could not copy them there. They can be regenerated with the e2e command above.

## 4. Known gaps / not done

1. **Team screen (REQ-PB-012 FE part)**: not built. It is not in this assignment's screen table, but the work split §7 assigns "FE (team screen)". The team read API is used for owner pickers only.
2. **REQ-PB-003 P2 increment** (verbatim mode guidance on the create screen): not done. It is listed for FE in work split §7, but not in this assignment.
3. **Workshop participants** (add/remove): no UI. **Dependencies** and **action items** have no dedicated register screens. Dependencies appear in the canvas dimension view, and actions are created only by workshop conversion.
4. **Decision options**: editing or withdrawing an option (`PATCH /decisions/{id}/options/{optionId}`) and deciding on behalf of the owner (`onBehalfOfUserId`) are not in the UI.
5. **Methodology label editing** (ADM_METHOD, `PATCH /methodology/tom-dimensions/{code}`): no UI.
6. **Audit trail field labels for P2 events**: action names are now localized (104 labels). The **changed-field** labels of P2 records in the transformation audit trail are not; they fall back to the existing honest "field without a translation" marker. The P1 journey does not hit this.
7. **Gate approver configuration** has a UI and dialog, but no unit or e2e test exercises it. The 422 `gate_criteria_incomplete` path is unit-tested only: in the real UI, the server's `canSubmit` hides submission while criteria are incomplete, so the e2e checks the disabled button and the stated reason instead.
8. Registers are loaded whole, bounded at 20×100 rows per resource, and paginated client-side. That suits P2 volumes; large registers would need server-side paging.

## 5. Contract / schema observations (no change made; for the architect / BE)

- **Team without names:** `TeamAssignment` (`GET /transformations/{id}/scoped-assignments`) carries `userId` only. A TL or WL without `user.read` cannot see colleagues' names, so owner pickers show "Team member (role, ref. ####)". A `displayName` on the team view would fix this.
- **English-only reasons:** `Outcome.goodOutcomeTest[].reason`, `GateCriterionEvaluation.missing[].message`, `ScopeCheckPrecheck.detail` and `Warning.message` are English diagnostic text. The UI localizes from the codes (criterion code plus recorded inputs; missing-item codes plus resolved pointers; pre-check code plus result) and never shows that text. If new codes are added, the UI falls back to a generic localized message. A stable list of reason codes in the contract would help.
- **No explicit submission eligibility code:** `GateView.canSubmit` is false both for "no permission" and for "criteria incomplete". The UI derives the reason from the `gate.submit` permission hint plus readiness.
- **Evidence storage default:** `EVIDENCE_STORAGE_PATH` defaults to `/var/lib/mth/evidence`. A disposable stack must set it, or uploads answer 503 `unavailable`. Handled in `with-stack.sh`; QA/CI stacks need the same.

## 6. Merge instructions

- No migrations and no dependency changes. Only `apps/web/**` changed (plus this handback).
- Integrate after BE round 2 (`T-DG2-BE2`); no file overlaps with `apps/api/**`. Then rebuild (`pnpm -r build`) before the e2e run, because the e2e serves `apps/web/dist` from the API.
- Run the e2e on free ports: `E2E_PG_PORT`/`QA_PG_PORT` and `E2E_API_PORT`. The default API port is still 3000.
- `e2e/journeys.spec.ts` changed one step (planned-area check now uses Risks and Actions). If qa-verifier has acceptance tests that rely on `/governance` being a *planned* placeholder, those need the same change: Governance, Strategy and KPIs, Target Operating Model, and Evidence and Reports are now partial areas with an entry page.
- Expected conflicts: none by construction.
