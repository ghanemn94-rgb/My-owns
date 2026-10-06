# Handback T-DG2-FE6: blank-text rule in the hand-written P2 forms (frontend-ux-engineer)

- **Stage:** P2 / DG2 (FIXING), round 4. Branch `claude/mobily-transformation-platform-regate`.
- **Base:** `HEAD` = `f5df4a2825dc04e0aa3232accb453eee87c00e75`, checked with `git rev-parse HEAD`. FE5, BE6 and BE7 were already integrated. The tree was clean apart from sandbox-masked untracked dotfiles. Changes are left uncommitted for the orchestrator.
- **Assignment:** `docs/delivery/assignments/DG2/round-4/T-DG2-FE6.md`, sha256 `67cc2c19…19c54c` (verified with `sha256sum`).
- **Invocation:** `DG2-T-DG2-FE6-frontend-ux-engineer-20261006T065330Z-b4ae57b3`, session `b4ae57b3-3705-49d4-921b-472f866d634b`.
- **Finding class:** F-DG2-210 (D-063). I authored the fixes, so I close no finding.
- **Not touched:** `packages/shared/**`, `apps/api/**`, ADRs, `tools/**`, `.claude/**`, `docs/source/**`, reviews, gate records, and the deliberate trimming in P1 `admin/**` and `transformations/**`.
- **Product gates:** G1-G6 are business approvals inside the product. The e2e G1 submission and the attempted decision are synthetic test data by synthetic dev users. They approve nothing real and imply nothing about DG0-DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/components/Form.tsx` | One shared rule for hand-written forms: `isBlankText(v)` is `v !== "" && !hasText(v)`, using the shared `hasText` from `@mth/shared/schemas`, plus `BLANK_CODE` and the hook `useFocusFirstInvalid(ref)`, which focuses the first `[aria-invalid="true"]` after errors render. `Dialog` takes an optional `dialogRef` (a callback ref, so the mount-only focus effect is unchanged). |
| `apps/web/src/pages/gates/GateDetailPage.tsx` | **SubmitDialog:** blank-note check; `""` means no `submissionNote`; visible text is sent verbatim; a server 400 on `/submissionNote` goes to the field. **DecideDialog:** blank check on rationale and comments, merged with shared-schema errors; rationale and comments are sent verbatim and `""` comments are omitted; server 400 errors on `/outcome`, `/rationale` and `/comments` go to their fields. The outcome radios get `aria-invalid` when invalid. Focus goes to the first invalid control in both dialogs. |
| `apps/web/src/pages/design/JourneysSection.tsx` | **StepsEditor:** per-field inline errors replace the single banner. They are keyed `<step key>/<field>`, so they follow a moved step. Each control is a `Field` (label, `aria-invalid`, `aria-describedby`). The blank check covers `name`, `actor`, `handoffTo`, the cycle time, and the systems/controls lists (the whole value, or any comma-separated item such as `"‏"`). Free text is sent verbatim, `""` becomes `null`, and an empty name stays "required". Shared-schema and server 400 errors on `/steps/<i>/<field>` go to their fields; other errors stay in the banner. |
| `apps/web/src/components/RowActions.tsx` | **NoteDecisionDialog** (Finance validation, trajectory approval, evidence review, decision outcome): a blank note gives `validation__blank`; `""` keeps "required" or optional; the note is sent verbatim with no `trim()`. New `notePointer` prop (default `/note`) maps a server 400 on that pointer to the field. Radios get `aria-invalid`. Focus goes to the first invalid control. |
| `apps/web/src/pages/decisions/DecisionsPage.tsx` | Passes `notePointer="/outcomeText"` to the decide dialog. |
| `apps/web/src/components/ReasonDialog.tsx` | Blank check before the shared `reasonRequest`. Whitespace-only or invisible-only text gives `validation__blank`, not "too short". The reason is sent as typed (the server's `reason` schema trims it). A server 400 with a field error on `/reason` is shown **on the field**, with no generic banner. Focus goes to the field. This dialog is also used by P1 transformation archive and assignment revoke. |
| `apps/web/src/pages/define/DefinePage.tsx` | **Sweep find, North Star form:** explicit blank check and focus to the field; a server 400 on `/statement` goes to the field. Before, the shared schema already refused blank input but didn't move focus. |
| `apps/web/src/pages/p2-blank-forms.test.tsx` | **New:** 48 component tests (24 in EN and 24 in AR), listed in §2. |
| `apps/web/e2e/p2-blank-text.spec.ts` | Four new real-stack tests (§2), with axe in every state. |
| `docs/delivery/handbacks/DG2/T-DG2-FE6-evidence/*` | Check logs, the axe summaries and two screenshots (640 KB in total). |

## 2. Behaviour delivered (F-DG2-210 / D-063, one rule for every P2 form)

The rule for every free-text input in these forms:
- **`""`** keeps its old meaning. An optional field is omitted, or sent as `null` for journey step `actor`/`handoffTo`/cycle time. A required field shows the old message: "This field is required." for the note and step name; "This value is too short or too small." for the gate rationale and the reason (both have min 3).
- **Non-empty with no visible content** (whitespace, U+200F, U+2060 and so on) gets all of the following, and **no request is sent**:
  - the inline `problems.validation__blank` message (EN: "Enter some text; spaces alone are not a value."; AR: "أدخِل نصاً؛ المسافات وحدها ليست قيمة.");
  - `aria-invalid="true"` and `aria-describedby` pointing at the message;
  - focus on the first invalid control.
- **Visible text is sent verbatim.** Exceptions:
  - The journey **cycle time** is a decimal, not free text, so only its outer spaces are dropped. That matches the `decimal` kind in RecordForm. A whitespace-only cycle time is now a blank error rather than a silent `null`.
  - **Systems/controls** are comma-separated lists, so the commas and the spaces around each item are list syntax.

**Sweep** of `pages/{diagnose,define,design,decisions,gates,evidence,team}/**` and `components/**`, using a grep for `trim()`, `<input>` and `<textarea>`:
- All remaining free-text inputs are now RecordForm (FE5), one of the forms above, or the North Star form (fixed).
- `RegisterTable`'s search box and `DataTable` checkboxes are not record fields.
- `RecordForm`'s decimal/integer/trajectory `trim()` is number parsing. `DecisionsPage:293` filters display options.

**P1 admin/transformation forms:** their trimming is left alone, as the assignment says. Mapping check:
- `OrganizationsPage`, `UsersPage` (create and edit), `AssignmentsPage`, `TransformationCreatePage` and `TransformationEditPage` already map each server `fieldErrors[].code` onto the field through `fieldErrorMessage`. A 400 `validation.blank` at `/name`, `/displayName` or `/reason` therefore shows as the localized field message. No change was needed.
- The test covers `/name` on transformation edit in EN and AR.
- P1 *archive/revoke reasons* go through `ReasonDialog`, which now shows `/reason` on the field.

### Component tests (`p2-blank-forms.test.tsx`; each case runs in EN and AR)

All requests are asserted on the mocked `fetch` (`requests`, non-GET).

| Form | Cases |
|---|---|
| Gate submission note | whitespace → message, `aria-invalid`, describedby, focus, no POST; `"‏"` → the same; visible `"  Synthetic: نص مرئي‏  "` sent verbatim; `""` → body `{}` |
| Gate decision | whitespace, `"‏"` and `"‏‏‏⁠"` rationale → blank, no POST; whitespace or invisible comments with a valid rationale → blank on comments, focus on comments, the rationale stays valid, no POST; `""` rationale → "too short", no POST; visible rationale verbatim with no `comments` key; a server 400 on `/rationale` → field message, no alert banner |
| Journey step editor | whitespace or invisible actor → blank, no PATCH; blank name + handoff + cycle time + systems item → each field invalid, focus on the first (name), no PATCH; `""` name → "required" with focus; visible name and handoff verbatim, emptied actor → `null` |
| NoteDecisionDialog (Finance validation of a baseline) | whitespace or invisible note → blank, no POST; `""` → "required"; visible note verbatim |
| ReasonDialog (archive a baseline) | whitespace or `"‏‏‏⁠"` → blank, nothing archived; server 400 `/reason` `validation.blank` → **field** message and **no** `role=alert` banner; `""` → "too short"; visible reason verbatim |
| North Star | whitespace or invisible statement → blank, focus, no PUT |
| P1 transformation edit | server 400 `/name` `validation.blank` → localized field message via describedby, `aria-invalid` |

### e2e on the real stack (`p2-blank-text.spec.ts`, chromium-en and chromium-ar)

There are four new serial tests after the FE5 ones. They use the same synthetic transformation.

1. **Gate G1 submission.**
   - G1 is first completed through the API with synthetic records. The API reports `canSubmit` true and `latestSubmissionNo` 0.
   - A whitespace note (`"   \n\t "`) shows the message, `aria-invalid`, the accessible description and focus. axe runs, and **no mutating request** is sent.
   - The API then shows the gate status and version unchanged, `latestSubmissionNo` 0 and `currentSubmission` null.
   - The visible note `"  Synthetic: G1 submission note  "` is then submitted and stored **verbatim**.
2. **Gate G1 decision.**
   - `dev.office` receives a synthetic SP grant on this transformation only, chooses Approve and types the rationale `"     \n   "`.
   - Result: the message, focus and an axe scan, with no mutation sent. The gate status and version are unchanged, submission #1 is still `pending`, and `GET …/submissions/1` has `decision: null`. Nothing is approved.
3. **Journey steps.** A journey is created through the API. A whitespace actor in "Edit steps" shows the message and focus, axe runs, and no mutation is sent. The journey version is unchanged and the actor is still `"Synthetic agent"`.
4. **ReasonDialog.** Archiving the synthetic value pool with reason `"‏‏‏‏"` shows the message, focus and no alert banner. axe runs, no mutation is sent, and the pool's status and version are unchanged.

**Screenshots** (full page; I looked at both):
- `docs/delivery/handbacks/DG2/T-DG2-FE6-evidence/ar-p2-blank-06-gate-rationale.png`: the AR (RTL) decision dialog. "موافقة" is selected, the المبرر field has a red border and focus ring, and the inline message "أدخِل نصاً؛ المسافات وحدها ليست قيمة." shows with its alert icon.
- `docs/delivery/handbacks/DG2/T-DG2-FE6-evidence/en-p2-blank-07-journey-actor.png`: the EN step editor. The Actor field is focused and invalid, with "Enter some text; spaces alone are not a value." below it; the other fields are unchanged.

## 3. Checks actually run

Environment: offline sandbox, Node v24.21.0 unless stated otherwise. Logs are in `docs/delivery/handbacks/DG2/T-DG2-FE6-evidence/`.

| Command | Result |
|---|---|
| `pnpm -r typecheck` | **exit 0** (`typecheck.log`) |
| `pnpm -r build` | **exit 0**: "apps/api build: Done" (`build.log`) |
| `pnpm lint` (`eslint . --max-warnings=0`) | **exit 0** (`lint.log`) |
| `pnpm format:check` | **exit 2**. Output: "All matched files use Prettier code style!". The only errors are EACCES on the 12 sandbox-masked untracked paths `.bash_profile .bashrc .gitconfig .gitmodules .idea .mcp.json .profile .ripgreprc .vscode .zprofile .zshrc CLAUDE.local.md` (`format-check.log`) |
| `pnpm exec prettier --check . --ignore-path .prettierignore --ignore-path <those 12>` | **exit 0**: "All matched files use Prettier code style!" (`format-check-ignore-path.log`) |
| `pnpm test` on Node v22.22.2 (`PATH=/opt/node22/bin:$PATH`; `pnpm exec node --version` gives v22.22.2) | **exit 0**: `Test Files 32 passed (32)`, `Tests 616 passed (616)` (`unit-node22.log`). FE5 reported 568; this run adds the 48 new tests. |
| `pnpm test` on Node v24.21.0 | **exit 0**: `Test Files 32 passed (32)`, `Tests 616 passed (616)` (`unit-node24.log`) |
| `pnpm --filter @mth/design-tokens run check:contrast` | **exit 0**: "PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented" (`contrast.log`). No token was changed. |
| `E2E_PG_PORT=54529 E2E_API_PORT=3529 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_SCREENSHOT_DIR=$TMPDIR/shots-all apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts apps/web/e2e/p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1` | **exit 0**: `58 passed (3.6m)` (`e2e-run.log`). Disposable PostgreSQL with 19 migrations and the synthetic seed; pre-installed Chromium; `playwright install` was not run. |
| axe for that run (`axe-all-summary.txt`) | P1: 17 scans per language. P2: 49 per language. p2-blank: 8 per language. **0 violations of any impact, so 0 serious/critical** in EN and AR. |
| The same with only `p2-blank-text.spec.ts` (ports 54528/3528) | **exit 0**: `16 passed (36.8s)` (`e2e-blank-only.log`; axe `axe-summary-p2-blank-{en,ar}.json`, all 0) |
| **Regression, component level.** The `HEAD` versions of the 7 changed source files were swapped in, then `npx vitest run src/pages/p2-blank-forms.test.tsx` was run. | `Tests 42 failed / 6 passed (48)` (`regression-component-old-code.log`). The 6 that pass on the old code are expected baselines:<br>• invisible-only submission note (EN, AR): `trim()` keeps U+200F, so the shared schema already refused it, though without focus checks failing;<br>• invisible-only archive reason (EN, AR): already refused by BE7's schema;<br>• P1 `/name` mapping (EN, AR): already correct.<br>Sources were restored afterwards and `git diff --stat` re-checked. |
| **Regression, e2e level.** The same 7 old files were swapped in, `apps/web` was rebuilt, and `p2-blank-text.spec.ts` was run on ports 54530/3530. | **exit 1**: `2 failed, 8 passed` (`regression-e2e-old-code.log`). The new "Gate G1 submission" test fails at `toHaveAttribute("aria-invalid")` in EN and AR. The spec is serial, so the 3 later new tests per language did not run on the old build; their old-code failure is shown only at component level. The 4 FE5 tests pass as before. Afterwards I restored the sources and rebuilt `apps/web` (exit 0); the 58-test run above came before this check. |
| `node tools/gates/validate.mjs --historical --stage DG1` | **exit 0**: `PASS gate DG1 (historical)` (`validate-dg1-historical.log`) |

## 4. Known gaps / not done

- **Serial e2e regression is partial** (see §3). On the old build only the first new e2e state was observed to fail, because of serial mode. The old-code failure of the other three is shown by the component tests.
- **Message wording.** `validation__blank` says "spaces" but also covers invisible-only input. The wording is unchanged, as in FE5.
- **Journey step errors that aren't about a field**, such as a duplicate step key, still appear in the dialog banner. They are not tied to a control.
- **The P1 server-mapping test** covers `/name` on transformation edit only. The `displayName` and assignment `reason` mappings use the identical code path; I checked them by reading the code, not with a separate test.
- **The ReasonDialog now sends the reason as typed rather than pre-trimmed.** The shared `reason` schema trims on the server, so the stored value is the same as before.

## 5. Merge instructions

- No migrations, no API or OpenAPI change, no shared-package change, no token change.
- The new unit test file is `apps/web/src/pages/p2-blank-forms.test.tsx`, picked up by the existing vitest config.
- The e2e spec is extended in place. Its new tests depend on the earlier tests in the same serial file (the transformation and the charter), not on `p2-journeys.spec.ts`.
- `Dialog`'s new optional `dialogRef` prop is backward compatible.
- `playwright-report/` and `test-results/` from the runs are git-ignored.
- I expect no conflicts; no other agent ran at the same time.
