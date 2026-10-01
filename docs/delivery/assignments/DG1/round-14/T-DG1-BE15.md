# Assignment T-DG1-BE15: F-DG1-135 — align the lint's test classification with the build exclusion (backend-workflow-engineer)

- **Stage:** P1 / gate DG1 (round-14 repair). **Base:** current `HEAD`. `node_modules` present; run **offline**; no `pnpm install`. A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`.
- Fix **only** F-DG1-135 (Low; full text in `docs/delivery/findings.json`). Edit **only** `apps/api/src/architecture.testkit.ts` and `apps/api/src/architecture.test.ts`. Handback under `docs/delivery/handbacks/**`.

## The finding (F-DG1-135, Low, REQ-S16-003)
The round-13 F-DG1-134 fix set `TEST_FILE = /\.test\.[cm]?[jt]sx?$/`, and `isTest = TEST_FILE.test(file)` grants test-only boundary allowances (importing the composition-root `modules.ts`/`architecture.testkit.ts`, and importing `vitest`). But the build (`apps/api/tsconfig.build.json` `exclude`) only drops `src/**/*.test.ts`, `*.test.tsx`, `*.testkit.ts`, and vitest (`vitest.config.ts`) collects only `apps/api/src/**/*.test.ts`. So a module file named `*.test.mts`/`.test.cts`/`.test.js`/`.test.mjs`/`.test.cjs`/`.test.jsx` is **never run as a test**, **is compiled into `dist`**, yet currently gets **test-only exemptions** from the module-boundary check. Introduced by F-DG1-134 (the pinned test at `architecture.test.ts` asserts the wide behaviour); not a regression (such files were not scanned at all before).

## Required fix
**Narrow the lint's test classification to match what the build actually treats as a test.** Set `TEST_FILE = /\.test\.tsx?$/` (only `.test.ts` and `.test.tsx` — exactly the extensions `tsconfig.build.json` excludes; `.test.tsx` is build-excluded so it never ships even if vitest-unit-node does not run it). Keep `walk()` / `CODE_FILE` broad (every buildable file is still **scanned**). The effect: a `*.test.mts` (or any non-`.ts/.tsx` test-looking file) is now treated as a **non-test** module file — it gets the **full** boundary rules (no `modules.ts`/`testkit`/`vitest` exemption) and is scanned, which is correct because it ships in `dist` and is not run as a test. Real `.test.ts` module suites keep their exemptions. Update the testkit header note (file scope / test classification) to state that test allowances apply only to `.test.ts`/`.test.tsx` (the build-excluded test extensions), while `walk()` still scans all buildable files.

## Required self-check update (architecture.test.ts)
Update the pinned case (around `architecture.test.ts:763`, which currently asserts a `.test.mts` is treated as a test): assert instead that a module file `zz.test.mts` importing `../../modules.ts` (or `vitest`) is now a **violation** (full boundary rules, no test exemption), while a real `zz.test.ts` importing `../../modules.ts` / `vitest` stays **allowed** (test exemption). Keep the rest of the suite green.

## Self-verification (real output, paste into the handback)
- `pnpm vitest run apps/api/src/architecture.test.ts` — green incl. the updated classification case and the real module tree (`moduleViolations` zero; all real test files are `.test.ts`).
- `pnpm -r typecheck`; `pnpm lint`; `pnpm exec prettier --check` the two files; `pnpm test` (Node 22) and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` (Node 24) — both green.
- Confirm every real module test file is `.test.ts` (so narrowing changes nothing for the real tree): `find apps/api/src/modules -name '*.test.*' ! -name '*.test.ts'` is empty.

## Handback
`docs/delivery/handbacks/DG1/round-14/T-DG1-BE15-backend-workflow-engineer.md` — the exact diff and rationale, and the real vitest output (Node 22 + 24) + the find.
