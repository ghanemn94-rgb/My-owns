# DG1 round 3: code-security-reviewer narrative

- **Task:** T-DG1-REV-SEC-R3
- **Candidate:** `sha256:18e150714d29fa67aeaf28e817bb500d2db6191c88cde3ea680b3a64c8056f5b`, 394 files. The manifest's source_commit is `40dbd24`; I reviewed at HEAD `4f312cc`, which has the same candidate ID.
- **Verdict:** **PASS.** No regression. One new Low, non-mandatory finding.

## Scope confirmation
I diffed the round-2 manifest (`e6979e12111aeb14`) against the round-3 manifest (`18e150714d29fa67`) on path, sha256 and mode. Exactly one entry changed: `apps/web/e2e/journeys.spec.ts`. No entries were added or removed. So the following are byte-identical to what I verified in round 2:
- BU hierarchy guard and migration 0009;
- destination authz;
- rate-limit keying;
- gate and agent tooling;
- CI config.

## Diff review (F-DG1-232, test-only)
- The new `expectShellReadyForKeyboard()` waits for the shell to remount after reload. It checks the wordmark, the nav, `aria-current=page` on My Work and the main `h1`. It then polls until the document has focus and no element is focused. It clicks nothing, so the sequential-focus start point is unchanged.
- No assertion is weakened. The skip-link `toBeFocused` stays, and a stricter `Enter` → `main#main` `toBeFocused` assertion is added. `main#main` has `tabIndex={-1}` in `Shell.tsx:99`, so it can take focus.
- Preconditions hold: the reload happens on My Work (lines 185–190), and `Locator` is already imported.
- There are no secrets, URLs or dangerous APIs in the added lines. ESLint covers the file and reports 0 problems.

## Checks (all real runs; logs in `docs/delivery/test-evidence/DG1/code-security/round-3/`)
| Check | Result |
|---|---|
| `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `openapi:lint`, `check:no-cdn`, `format:check` | All PASS, exit 0 |
| `pnpm test` on Node 22.22.2 / 24.21.0 | 326/326 on each |
| Integration on disposable PG 16.13, two fresh clusters on random ports | 209/209 twice, including `bu-hierarchy-guard.test.ts` (migration 0009 applied by `migrate()`) |
| Gate and agent tests / deploy-script tests | 105/105 / 59/59 |
| install-sandbox (offline, writable store copy) | 13/14. The only failure is AC-1 (effect), which needs a live registry. That is documented residual D-057, not BLOCKED. |
| SBOM `--check`; `validate --historical --stage DG0` | OK; PASS |
| ci.yml ×3 | Byte-identical (`8b5b1106…`) and unchanged since round 2. Live CI is documented residual D-058. |
| Ad-hoc typecheck of the e2e spec (disposable tsconfig) | 0 errors |

## New finding
**F-DG1-147 (Low, not mandatory, REQ-DLV-033).** `apps/web/e2e/**` and `playwright.config.ts` are outside every typecheck target. `apps/web/tsconfig.json` includes only `src`, `test`, `vite.config.ts` and `vitest.config.ts`, and there is no root or e2e tsconfig. Playwright transpiles without type-checking, so a type error in a spec would pass every static gate and the CI typecheck job.

This is a pre-existing coverage gap, not a regression. The current spec type-checks cleanly when I check it ad hoc. Suggested fix: add `apps/web/e2e/tsconfig.json` (ES2023 + DOM, types node) and wire it into `pnpm -r typecheck`. I proposed the ID in the code-security range; the orchestrator may renumber it.

## Notes
- My first install-sandbox run gave 8/14 because the default pnpm store sits under read-only HOME. That was setup, not a defect. I reran with `npm_config_store_dir` pointing at a scratch copy of the store, the same way round 2 did.
- I removed the disposable clone and store copy at the end of the run.
