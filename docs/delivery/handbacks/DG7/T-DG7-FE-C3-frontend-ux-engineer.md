# Handback T-DG7-FE-C3 (frontend-ux-engineer): T-E25 spec, language isolation

- Stage DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, base `HEAD` 6d755e13c (working tree clean apart from this run's directory).
- Invocation: `DG7-T-DG7-FE-C3-frontend-ux-engineer-20261115T135112Z-d0f6d5a7`, session `d0f6d5a7-e62f-4e52-809c-491365208955`.
- Start 2026-11-15T13:51:24Z, end about 14:16Z.
- This is a test-only change. No product code, API, migration or i18n catalogue was touched.

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/web/e2e/p7-retention.spec.ts` | Isolates the two language projects from each other: a synthetic user per test and project, the language set and verified after every page load, and one edited retention class per project. |
| `docs/delivery/handbacks/DG7/T-DG7-FE-C3-frontend-ux-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-FE-C3-evidence/*` | Logs (e2e runs, typecheck, lint, openapi lint, `pnpm test`, validator) and two screenshots of the saved class form (EN, AR). |

## 2. Behaviour per requirement (REQ-S16-024, REQ-S20-022: the T-E25 axe, keyboard and 360 px checks of the Retention screens)

### Root cause (two layers)

1. **Language.** Playwright runs chromium-en and chromium-ar in parallel workers (2 workers; `fullyParallel: false` only orders tests within a file). Both projects signed in as the same seeded `dev.admin`, which has one stored `preferredLocale`.
   - The chromium-ar run's `ensureLanguage` click saves `ar` through `PUT /me/preferences`.
   - The chromium-en page's next full load, or its in-app navigation (which re-reads `GET /me`, F-DG2-570), applies that stored preference (`RequireSession`).
   - The English test then looked for "Skip to main content" on an Arabic page. The failure was at l.158, the second `skipToMain` after a `page.goto`, which matches the orchestrator's logs.
   - So the failure did not come from run order alone. It was a race on shared per-user state.
2. **Shared class record.** Once the language was isolated, both projects reached the change form for the same class `job_history` at the same time. Whichever saved second received the product's correct 409 screen ("Someone else changed this record", version 1 vs 2). This happened deterministically in chromium-en, 3 of 3 runs: `intermediate-language-fixed-shared-class-run{1,2,3}.log`.

### Fix (in the spec only)

- **Per-test synthetic users.** `isolatedUser(admin, lang, roleCode)` uses the pattern of `p5-navigation.spec.ts`:
  - The seeded `dev.admin` (ADM_ACCESS) creates a SYNTHETIC dev-issuer user `syn.retention.<role>.<lang>.<timestamp>` through the real API, with `preferredLocale` set to the project's language.
  - It grants that user only the role under test (`ADM_TECH` for the first test, `AUD` for the second) at organization scope. The reason text states that the grant approves nothing real.
  - That user drives the screens.
  - In a `finally` block, `revokeAll` revokes every grant of the user, and the API context is disposed.
  - The seeded `dev.admin` and `dev.auditor` no longer sign in to the browser in this spec. Their stored preferences are therefore never read or changed by it.
- **Language set and verified after every load.** `load()` = `page.goto` → no loading spinner → `ensureLanguage` (from `support/ui.ts`, which checks `<html lang dir>`). It is used for every full page load, including inside `open()`.
  - `signIn` already ends with `ensureLanguage`.
  - After the in-app navigation from a class link, the spec asserts `html[lang]` again.
- **One edited class per project.** `EDIT_CLASS = { en: "job_history", ar: "webhook_receipt_log" }`.
  - Both classes have the same shape in migration 0143: operational, archive-only, append-only, no `managed_by_job`.
  - Each project's If-Match therefore belongs to it alone, in any order.
  - The action stays "Keep" (`retain`). No class is enabled (§E.10).
  - The read-only auditor check still opens `job_history`.
  - No other spec references either class (grep over `apps/web/e2e`, `e2e`, `tests/qa`).
- **Unchanged:** every assertion of the original spec (axe at 1280 and 360 px, focus visibility, keyboard paths, no horizontal scroll, the 404 state, no foreign requests, the PUT count). The header comment is updated to describe the isolation.

## 3. Checks run (environment: this container, Node 24.21.0, `MTH_PNPM_OFFLINE=1`, existing `apps/web/dist` and `apps/api/dist` builds)

The spec change is test-only, so the SPA and API builds were not rebuilt.

| Command | Exit | Evidence |
|---|---|---|
| `apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p7-retention.spec.ts` (both projects, 2 workers, parallel), run 1 | 0 (4 passed) | `T-DG7-FE-C3-evidence/e2e-retention-run1.log` |
| same, run 2 | 0 (4 passed) | `e2e-retention-run2.log` |
| same, run 3 | 0 (4 passed) | `e2e-retention-run3.log` |
| `with-stack.sh bash -c '… --project chromium-ar; … --project chromium-en'` (one stack; ar first, then en) | 0 (ar 2 passed, en 2 passed) | `e2e-retention-ar-then-en.log` |
| Intermediate state (language fixed, shared class), 3 runs | 1 each (en 409 conflict) | `intermediate-language-fixed-shared-class-run{1,2,3}.log` |
| `npx tsc --noEmit -p apps/web/tsconfig.e2e.json` | 0 | (console) |
| `npx eslint apps/web/e2e/p7-retention.spec.ts` | 0 | (console) |
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm lint` | 0 | `lint.log` |
| `pnpm openapi:lint` | 0 | `openapi-lint.log` |
| `pnpm test` | 0 (3042 + 2199 + 259 passed, 2 skipped) | `pnpm-test.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `validate-dg6.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 (run after this handback was first written; it includes this file) | `prettier.log` |

- **Summary:** `runs.txt` and `checks.txt`.
- **Screenshots:** `p7-retention-class-saved-en.png` and `p7-retention-class-saved-ar.png` (from the run on one stack, ar then en). No product screen changed.

**Not applicable:** integration tests on a disposable PostgreSQL and the contract test. No API or integration test was touched, so none was run for this task.

## 4. Known gaps

- Each run leaves a small number of SYNTHETIC users behind: 2 per project per run. `with-stack.sh` deletes the whole cluster at teardown, but on a long-lived stack those users stay, with every grant revoked. Users have no delete endpoint, and `p5-navigation.spec.ts` behaves the same way.
- The same shared-seeded-user pattern (`dev.admin` signing in to the browser in both projects in parallel) exists in other specs: p2/p3/p4/p5 journeys, among others. I did not change them because they are outside this assignment. They only fail if a test loads a page after the other project has switched language. Worth a sweep if any becomes flaky.
- No `p7-pending*.ts` entry relates to this task, so none was removed.

## 5. Open questions

- Should the shared fix move into `support/ui.ts` (a helper like `isolatedUser` for every spec that signs in as a seeded user in both projects)? That would touch other owners' specs, so I left it to the orchestrator.
