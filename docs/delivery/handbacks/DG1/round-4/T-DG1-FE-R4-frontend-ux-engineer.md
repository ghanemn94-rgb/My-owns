# Handback T-DG1-FE-R4 — F-DG1-147 (frontend-ux-engineer)

- **Stage:** DG1 clean re-gate, round-4 repair. Branch `claude/mobily-transformation-platform-regate`.
- **Base:** `HEAD` = `17a6d0f0999b51cafee4b674ab2d7c97cf683cbf`. The working tree was clean for tracked files at the start.
- **Invocation:** run `DG1-T-DG1-FE-R4-frontend-ux-engineer-20261001T230710Z-ac575465`, session `ac575465-90c0-432d-b702-07f3af2421de`.
- **Assignment:** `docs/delivery/assignments/DG1/round-4/T-DG1-FE-R4.md`. Its sha256 was verified as `7683ce24…0553a4`.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/tsconfig.e2e.json` (new, sha256 `a8f9c7db…80326`) | A dedicated type-check target for `apps/web/e2e/**/*.ts` and the root `playwright.config.ts`. It extends `tsconfig.base.json`, so `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and the other strict options stay as they are. It uses the `node` types and the DOM lib, because `page.evaluate` callbacks run in the browser. It is isolated from `tsconfig.json`: no `vite/client`, no React JSX settings and no Vitest globals. `rootDir: "../.."` lets the root config sit inside the program. `noEmit` is set. |
| `apps/web/package.json` | `typecheck` now runs `tsc -p tsconfig.json && tsc -p tsconfig.e2e.json`. Because the gate and CI typecheck (`pnpm typecheck` → `pnpm -r typecheck`, `.github/workflows/ci.yml:64`) runs this script, it now covers the e2e specs and the Playwright config. |

The diff to `apps/web/package.json`:

```diff
-    "typecheck": "tsc -p tsconfig.json",
+    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.e2e.json",
```

I used no `@ts-nocheck` and did not loosen `strict`. I made no product runtime change and did not modify `apps/web/e2e/journeys.spec.ts` or `playwright.config.ts`. `build` is unchanged, so `vite build` does not depend on Playwright types.

## 2. Behaviour delivered

- **F-DG1-147 / REQ-DLV-033:** the single gate command `pnpm -r typecheck` now type-checks `apps/web/e2e/journeys.spec.ts` and every future `apps/web/e2e/**/*.ts`, plus the root `playwright.config.ts`.
  - The new target found **no real type errors** in the existing spec or the config, so nothing needed fixing. This matches the reviewer's ad-hoc result in `docs/delivery/test-evidence/DG1/code-security/round-3/e2e-spec-typecheck.log`.
- **Out of scope:** the root `e2e/**` (qa-verifier's acceptance suites, e.g. `e2e/a20-bilingual-shell.spec.ts`) is owned by qa-verifier per the comment in `playwright.config.ts`. The assignment names only `apps/web/e2e/**` and `playwright.config.ts`, so that directory is still not type-checked. See §4.

## 3. Checks actually run

Environment: Linux sandbox, offline, existing `node_modules`, TypeScript 6.0.2, pnpm 10.33.0.

**3.1 File list of the new target (Node 24.21.0)**

```
$ node_modules/.bin/tsc -p apps/web/tsconfig.e2e.json --listFilesOnly | grep -v node_modules
/home/user/My-owns/apps/web/e2e/journeys.spec.ts
/home/user/My-owns/playwright.config.ts
$ node_modules/.bin/tsc -p apps/web/tsconfig.e2e.json ; echo exit=$?
exit=0
```

**3.2 Fail-then-pass proof (Node 24.21.0)**

I appended a deliberate error, `const _f147Probe: number = "not a number";`, and later restored the files from a backup. `git status` afterwards shows only the two intended files changed.

- (a) Error in the e2e spec, run through the package script:
  ```
  $ pnpm --filter @mth/web typecheck
  > tsc -p tsconfig.json && tsc -p tsconfig.e2e.json
  e2e/journeys.spec.ts(474,7): error TS2322: Type 'string' is not assignable to type 'number'.
   ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @mth/web@0.1.0 typecheck: `tsc -p tsconfig.json && tsc -p tsconfig.e2e.json`
  exit=2
  ```
- (b) The same error, run through the gate command:
  ```
  $ pnpm -r typecheck
  apps/web typecheck: e2e/journeys.spec.ts(474,7): error TS2322: Type 'string' is not assignable to type 'number'.
  apps/web typecheck: Failed
  exit=2
  ```
- (c) Error in the root `playwright.config.ts`:
  ```
  $ pnpm --filter @mth/web typecheck
  ../../playwright.config.ts(32,7): error TS2322: Type 'string' is not assignable to type 'number'.
  exit=2
  ```
- (d) After removing the probes, on Node v24.21.0:
  ```
  $ pnpm -r typecheck
  apps/web typecheck$ tsc -p tsconfig.json && tsc -p tsconfig.e2e.json
  apps/web typecheck: Done
  ... packages/design-tokens, shared, config, db, apps/api, apps/worker: Done
  exit=0
  ```

**3.3 Node 22 (`/opt/node22/bin`, v22.22.2)**

```
$ pnpm -r typecheck                                                   -> exit=0 (apps/web runs both tsconfigs)
$ pnpm lint   (eslint . --max-warnings=0)                             -> exit=0
$ pnpm exec prettier --check apps/web/package.json apps/web/tsconfig.e2e.json
  All matched files use Prettier code style!                           -> exit=0
$ pnpm test
  Test Files  21 passed (21)
       Tests  326 passed (326)                                         -> exit=0
$ pnpm -r build                                                       -> exit=0
$ E2E_SCREENSHOT_DIR=$TMPDIR/shots apps/web/e2e/support/with-stack.sh \
    npx playwright test apps/web/e2e --workers=1 --reporter=list --output=$TMPDIR/test-results
  (real disposable PostgreSQL + migrate + seed-dev SYNTHETIC users + API on :3000)
  ✓ 1-9   [chromium-en] all 9 journeys
  ✓ 10-18 [chromium-ar] all 9 journeys
  18 passed (42.2s)                                                    -> exit=0
```

I sent the screenshots to `$TMPDIR`, so the committed `apps/web/e2e/screenshots/**` are untouched. This change has no visible UI effect, so there are no new screenshots to hand back.

## 4. Known gaps / not done

- **Root `e2e/**` is not covered.** The root qa-verifier acceptance specs (`e2e/**`) are still outside every typecheck target. They are qa-verifier-owned and outside this assignment's scope. If the orchestrator wants them covered, qa-verifier or the owner can add `"../../e2e/**/*.ts"` to `apps/web/tsconfig.e2e.json`'s `include`, or add a sibling target.
- **No test-evidence directory.** Writing a log directory under `docs/delivery/test-evidence/DG1/` was refused by the sandbox ("Read-only file system"). The real command output is pasted above instead.

## 5. Merge instructions

There are no migrations or ordering constraints. Two files changed (one new). I don't expect conflicts. CI needs nothing new: `@playwright/test` and `@types/node` are already root devDependencies that `pnpm install` resolves before `pnpm typecheck`.
