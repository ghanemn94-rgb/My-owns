# Handback T-DG2-FE8: one alert per distinct form error (frontend-ux-engineer)

- **Stage:** DG2 (FIXING), round-9 repair. **Finding:** F-DG2-340 (Low, REQ-PB-029, not mandatory).
- **Invocation:** `DG2-T-DG2-FE8-frontend-ux-engineer-20261006T201433Z-0f7ad0d7`, session `0f7ad0d7-0b91-4f1f-a0a7-4237c19f75a7`.
- **Base:** `a7b84d89160f303358b8ac31f4e9c84d5d9b3449`, which is HEAD with T-DG2-BE14 already integrated. Branch `claude/mobily-transformation-platform-regate`. The changes are uncommitted in the working tree for the orchestrator to integrate.
- **Assignment:** `docs/delivery/assignments/DG2/round-9/T-DG2-FE8.md`. I verified sha256 `7ae6ceb3…43c408f3` before starting.
- **Not touched:** `packages/shared/**`, `apps/api/**`, `docs/api/openapi.yaml`, `tools/**`, `.claude/**`, `docs/source/**`, reviews and gate records. No migration.
- **No approvals:** I granted no business, Finance or IT approval. Product gates G1–G6 are unrelated to DG0–DG7. All test data is synthetic.

## Changed files

| File | Purpose |
|---|---|
| `apps/web/src/lib/problem.ts` | New `distinctFormMessages(banner, others)`. It returns the form-level messages the banner doesn't already say, without repeats and in their original order. |
| `apps/web/src/components/RecordForm.tsx` | `RecordFields` computes the banner message once. The `data-state="form-errors"` region lists only `distinctFormMessages(banner, unmapped)` and is not rendered when that list is empty. Field-pointer errors are unchanged. |
| `apps/web/src/pages/design/JourneysSection.tsx` | Sweep fix in the step editor: a client message identical to the server banner still on screen is not rendered as a second alert. |
| `apps/web/src/components/RecordForm.alerts.test.tsx` | **New** component tests: EN and AR × dialog and inline-with-sections (the charter layout) × 4 cases, 16 tests in total. |
| `apps/web/src/lib/lib.test.ts` | Unit test for `distinctFormMessages`. |
| `apps/web/e2e/p2-blank-text.spec.ts` | New real-stack test, "Charter create: a form-level validation problem (invalid UTF-8 body) is said once, in one live region". It includes a screenshot and axe. |
| `docs/delivery/handbacks/DG2/T-DG2-FE8-evidence/*` | Check logs and two screenshots. |

## The fix (F-DG2-340, REQ-PB-029)

**Root cause.** For a `validation` problem whose first field error has pointer `""`:
- `errorMessage()` returns that field error's localized message for the banner (`data-state="error"`).
- `useRecordForm` also pushes the same message into `unmapped`, because pointer `""` maps to no field.
- `RecordFields` rendered both, as two adjacent `role="alert"` regions.

**Fix.** Deduplication happens at render time, by localized message. Equal codes always give equal messages.
- The banner keeps its region.
- The `form-errors` region shows only messages the banner doesn't already say, each once.
- A genuinely different second message is kept in its own region.
- Field-pointer errors still attach to their field through `aria-invalid` and `aria-describedby`.
- The banner then shows the generic `problems.validation`, so field text and banner text never collide.

Because the deduplication happens at render time, it also covers a stale banner from an earlier attempt next to a fresh client-side `unmapped` message such as `validation__empty_update`.

Resulting live regions:

| Case | Live regions |
|---|---|
| `[{pointer:"", code:"validation.json"}]` | 1 (banner) |
| The same code twice | 1 |
| `validation.json` + `validation.content_type`, both pointer `""` | 2: banner + `form-errors`, each message once |
| `/name` `validation.too_big` | 1 (generic banner); the field message is on the field only |

## Sweep (every form or dialog with a banner plus field or other-error output)

| Form | Banner and list both possible? | Duplicate? | Action |
|---|---|---|---|
| `RecordForm` (`RecordDialog`, `InlineRecordForm`) | yes | **yes**, the reported defect | fixed |
| Charter form (`InlineRecordForm` with sections; `RecordFields fields=[]` renders the alerts) | yes | **yes**, the same code path | fixed by the same change; covered by the "inline-sections" component tests and the e2e test |
| `JourneysSection` `StepsEditor` | yes: a stale `serverError` banner stays while a new client `error` banner shows | only if the two texts coincide (not reproduced on the real stack) | guarded: an identical client message is not rendered again |
| `GateDetailPage` submit dialog | no: the note field error **or** the banner (`setError`), never both | no | none |
| `GateDetailPage` decision dialog | no: field errors **or** `GateProblem` | no | none |
| `GateProblem` (`gate_criteria_incomplete` list) | list and banner in **one** region | no: the list uses `gates.missingItems.*` texts, which differ from the banner | none |
| `RowActions` dialog | no: the note error **or** the banner | no | none |
| `ReasonDialog` | no: the `/reason` field error **or** the banner | no | none |
| `DefinePage` North Star, KPI activation | no: the field **or** the banner; the activation reason is in the same region with a different text | no | none |
| P1 admin forms (`OrganizationsPage` ×4, `UsersPage` ×2, `AssignmentsPage`), P1 `TransformationCreatePage` / `TransformationEditPage` | banner plus field messages only. Pointer-`""` errors are not mapped to any field, and field messages are not live regions | no | none |

## Checks actually run

The evidence directory is `docs/delivery/handbacks/DG2/T-DG2-FE8-evidence/`, and every log name below is relative to it. Each check ran under `env -u LANG -u LC_ALL` (prefix `unset-`) **and** `LANG=C.UTF-8` (prefix `cutf8-`).

| Check | Result |
|---|---|
| `pnpm -r typecheck` (Node 24.21.0) | exit 0 in both (`*-typecheck.log`) |
| `pnpm -r build` | exit 0 in both (`*-build.log`) |
| `pnpm lint` | exit 0 in both (`*-lint.log`) |
| `pnpm format:check` | exit 2 in both. The **only** errors are EACCES on 12 sandbox-masked untracked paths (`.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`). It still reports "All matched files use Prettier code style!" (`*-format-check.log`). |
| `prettier --check .` with the default ignore files plus a temporary root ignore file listing those 12 paths (removed afterwards) | exit 0 in both: "All matched files use Prettier code style!" (`*-format-check-ignore-path.log`) |
| `pnpm test`, Node 24.21.0 | `Test Files 40 passed (40) / Tests 718 passed (718)`, exit 0 in both (`*-test-node24.log`) |
| `pnpm test`, Node 22.22.2 | `Test Files 40 passed (40) / Tests 718 passed (718)`, exit 0 in both (`*-test-node22.log`) |
| `pnpm --filter @mth/design-tokens run check:contrast` | `PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented`, exit 0 in both (`*-contrast.log`) |
| Web e2e: `E2E_PG_PORT=2454x E2E_API_PORT=354x PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_SCREENSHOT_DIR=$TMPDIR/shots-<mode> apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts apps/web/e2e/p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1` | **60 passed (3.9m)**, exit 0 in both (`unset-e2e.log`, `cutf8-e2e.log`). This includes the new test in chromium-en and chromium-ar. Real API and disposable PostgreSQL, ports below 32768, pre-installed Chromium; `playwright install` was not run. |
| Axe (all axe summaries of both runs, both languages) | 0 violations of any impact, so 0 serious and 0 critical. This includes `p2-blank-charter-form-level-problem` (`axe-summary.log`). |
| `node tools/gates/validate.mjs --historical --stage DG1` | `PASS gate DG1 (historical)`, exit 0 in both (`*-validate-historical-DG1.log`) |

### Negative controls (the new tests fail on the old code)

- **Component tests.** `RecordForm.tsx` was reverted to HEAD and `vitest run src/components/RecordForm.alerts.test.tsx` was run: **12 failed, 4 passed**.
  - The 12 failures are all pointer-`""`, same-code-twice and two-distinct cases, in EN and AR, in both layouts.
  - The 4 passes are the field-pointer cases. They guard behaviour that was already correct.
  - Log: `negative-control-component.log`.
- **e2e.** `RecordForm.tsx` was reverted to HEAD, the web app rebuilt, and `-g 'setup|form-level'` run.
  - The new test **failed in chromium-en and chromium-ar**: `toHaveCount(1)` received **2** alerts with the message.
  - Log: `negative-control-e2e.log`.
- **Restore.** I then restored the fix, rebuilt with `pnpm -r build`, and re-ran the same selection: 4 passed, exit 0 (`post-restore-e2e.log`). `git diff` confirms the fixed file is back in place.

### Screenshots (from the `LANG=C.UTF-8` run)

- `docs/delivery/handbacks/DG2/T-DG2-FE8-evidence/en-p2-blank-09-charter-form-level-problem.png`: English LTR. One banner, "The request was not valid JSON.", above the Create charter button.
- `docs/delivery/handbacks/DG2/T-DG2-FE8-evidence/ar-p2-blank-09-charter-form-level-problem.png`: Arabic RTL. One banner, "الطلب ليس بصيغة JSON صالحة.".

### What the e2e test asserts (real stack)

- **Request.** The browser's POST `/charter` body is rewritten with a `0xFF` byte. Only the request body is changed, and the server is real.
- **Server answer.** The server answers 400 `validation` with `errors == [{pointer:"", code:"validation.json"}]`.
- **One alert.** Exactly one `role="alert"` contains `problems.validation__json`, and no `form-errors` region is rendered.
- **One occurrence.** The message appears exactly once in the page's text.
- **Nothing saved.** The charter GET is still 404.
- **No foreign requests.**
- **Axe** passes in that state.

## Known gaps / not done

- **JourneysSection guard has no dedicated component test.** The equal-text case in `StepsEditor` could not be produced through the current schema and server without contrived data. Its logic is the same message-equality rule as `distinctFormMessages`, which has a unit test.
- **Format check is BLOCKED for 12 paths.** `pnpm format:check` without the ignore variant exits 2 only because of the sandbox-masked dotfiles listed above. This is an environment limitation, not a formatting finding.
- I did not commit. Screenshots under `apps/web/e2e/screenshots/` were not refreshed; this run's screenshots were written to `$TMPDIR`, and the two cited ones were copied into the evidence directory.

## Merge instructions

- Integrate the working-tree changes listed above. There is no migration and no API or contract change.
- Conflicts are possible only in `apps/web/e2e/p2-blank-text.spec.ts`, where the test is appended at the end, and in `apps/web/src/lib/lib.test.ts`, where a `describe` is appended.
