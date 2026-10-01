# Assignment T-DG1-BE14: F-DG1-134 — module lint file scope (walk only matches .ts/.tsx) (backend-workflow-engineer)

- **Stage:** P1 / gate DG1 (round-13 repair). **Base:** current `HEAD`. `node_modules` present; run **offline**; no `pnpm install`. A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`.
- Fix **only** F-DG1-134 (Low; full text in `docs/delivery/findings.json`). Edit **only** `apps/api/src/architecture.testkit.ts` and `apps/api/src/architecture.test.ts`. Handback under `docs/delivery/handbacks/**`.

## The finding (F-DG1-134, Low, REQ-S16-003)
`walk()` (apps/api/src/architecture.testkit.ts) collects module files with `/\.(ts|tsx)$/`. A file under `src/modules/**` named `.mts` (or `.cts`, `.mjs`, `.cjs`, `.js`, `.jsx`) is therefore invisible to `moduleViolations`, so it evades **every** lint rule (1–5) AND the module-interface boundary check. With the repo's `module: NodeNext` + `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` (tsconfig.base.json), a `.mts` module file typechecks, builds to `dist` as `.mjs`, and ships — so this is a real scope hole in REQ-S16-003's "dependency-lint check fails on imports that bypass a module interface". Pre-existing since the DG1 original (not a round-12 regression). The real tree has **0** such files today (so the fix changes nothing for the current tree).

## Required fix
Broaden `walk()` to scan every buildable JS/TS module file: change the extension test to `/\.[cm]?[jt]sx?$/` (matches `.ts, .tsx, .mts, .cts, .js, .jsx, .mjs, .cjs`). The same rules (1–5 + the boundary/package checks in `fileViolations`) then apply to all of them; `scanSource` already parses with the TS parser (a superset of JS), so `.mjs/.cjs/.js` parse fine. (If you prefer the fail-closed alternative — flag any non-`.ts/.tsx` module-directory file as a violation — the broaden-and-scan approach is preferred because it actually lints the file's imports; pick broaden-and-scan unless you find a concrete reason it breaks.) Keep the `.test.ts` handling (isTest) working for the new extensions if a `.test.mts` etc. is possible (a `*.test.<ext>` is a test). Confirm the real module tree is unchanged (0 non-.ts/.tsx files, so no new violations).

Update the testkit header's file-walk description to state the lint scans all buildable module files (`.[cm]?[jt]sx?`), so no module code evades it by extension (F-DG1-134).

## Required self-check (architecture.test.ts)
Add a case proving a non-`.ts` module file is now linted: plant a module file named e.g. `zz-planted.mts` (via `fileViolations("transformations", join(MODULES_DIR,"transformations","zz-planted.mts"), source)`) whose source contains a rule-5 namespace crypto import and a deep cross-module import, and assert it yields the expected violations (previously 0). Keep the existing suite green. If feasible, also assert `walk(MODULES_DIR)` would include a planted `.mts` file (e.g. via a temp dir, or document that `fileViolations` covers it).

## Self-verification (real output, paste into the handback)
- `pnpm vitest run apps/api/src/architecture.test.ts` — green incl. the new `.mts` self-check and the real module tree (`moduleViolations` zero — no real module file is non-`.ts/.tsx`). Show the `.mts` plant giving violations (before: broaden not applied → the file is skipped; after: flagged).
- `pnpm -r typecheck`; `pnpm lint`; `pnpm exec prettier --check` the two files; `pnpm test` (Node 22) and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` (Node 24) — both green.
- `find apps/api/src/modules -type f ! -name '*.ts' ! -name '*.tsx'` — confirm empty (no non-ts/tsx module files in the real tree).

## Handback
`docs/delivery/handbacks/DG1/round-13/T-DG1-BE14-backend-workflow-engineer.md` — the exact diff and rationale, and the real vitest output (Node 22 + 24) + the find.
