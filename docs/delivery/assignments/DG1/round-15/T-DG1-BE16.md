# Assignment T-DG1-BE16: F-DG1-136 (integration hookTimeout) + F-DG1-217 (lint .d.ts crash) (backend-workflow-engineer)

- **Stage:** P1 / gate DG1 (round-15 repair). **Base:** current `HEAD`. `node_modules` present; run **offline**; no `pnpm install`. A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`.
- Fix **only** F-DG1-136 and F-DG1-217 (both Low; full text in `docs/delivery/findings.json`). Edit **only**: `vitest.config.ts` (root), `apps/api/src/architecture.testkit.ts`, `apps/api/src/architecture.test.ts` (and, only if your chosen F-DG1-217 approach needs it, keep edits to the lint files). Do **not** change product/runtime code, API, other apps/packages, `tools/**`, `docs/source/**`, reviews or gate records. Handback under `docs/delivery/handbacks/**`.

## F-DG1-136 (Low, REQ-S19-004): integration teardown can exceed the default hookTimeout
`apps/api/test/integration/access-derived-race.test.ts` `afterAll` runs DDL + `api.close()` + `dropScratchDatabase()`, and that helper (`packages/db/test/global-setup.ts`) has its OWN up-to-10s wait budget for other backends to disconnect. The integration project in `vitest.config.ts` raises only `testTimeout` (30_000); `hookTimeout` is unset, so the hook gets vitest's default 10_000 ms — under a contended/slow runner the teardown exceeds it and turns a 200/200 run red (observed once in round 14).
**Fix:** in `vitest.config.ts`, set the integration project's `hookTimeout` to **30_000** (matching `testTimeout`), so a teardown allowed to wait up to 10s internally runs under a comfortably larger hook budget. (Do not lower `dropScratchDatabase`'s internal budget; do not weaken the test.) Add a short comment citing F-DG1-136.

## F-DG1-217 (Low, REQ-S16-003): the lint crashes on a declaration-file name
`walk()` now matches `CODE_FILE = /\.[cm]?[jt]sx?$/`, so a module `.d.ts`/`.d.mts`/`.d.cts` is scanned; `fileViolations` → `syntaxErrors()` calls `ts.transpileModule(source, { fileName })`, which throws `Debug Failure. Output generation failed` for a declaration-file name → `moduleViolations()` throws and `architecture.test.ts` errors instead of reporting a diagnostic. Fail-closed, latent (0 `.d.ts` module files today), pre-existing since the syntaxErrors introduction.
**Fix (preferred — keep coverage):** make `syntaxErrors()` declaration-file-safe. For a declaration file (`/\.d\.[cm]?ts$/`), obtain syntactic diagnostics WITHOUT emit — e.g. use the parse diagnostics of `ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKindOf(fileName))` (its `parseDiagnostics`), or guard `transpileModule` so a `.d.ts` is parsed, not emitted — so a `.d.ts` is still scanned (its type imports are still boundary-checked by `scanSource`) and a genuine syntax error still surfaces as a named lint diagnostic, never an internal compiler assertion. (The simpler alternative — skip declaration files in `walk()` with an explicit comment — is acceptable ONLY if you also note that `.d.ts` type imports are then unchecked; prefer the scan-safely approach to avoid a coverage gap.) A violation/syntax error must surface as a named diagnostic.

## Required self-checks (architecture.test.ts)
- F-DG1-217: assert `fileViolations("transformations", <dir>/zz.d.ts, "export declare const x: number;")` returns **cleanly** (no throw) — and that a `.d.ts` with a deep cross-module **type** import is flagged by the boundary check (if you keep scanning them), or is skipped-by-design (if you skip). Also assert a `.d.ts` with a real syntax error yields a named `unparseable source` diagnostic, not a thrown Debug Failure. Pin the chosen behaviour.
- Keep the whole architecture suite green.

## Self-verification (real output, paste into the handback)
- `pnpm vitest run apps/api/src/architecture.test.ts` — green incl. the new `.d.ts` self-check; `moduleViolations` does not throw for any module.
- Integration under a disposable PostgreSQL (use `tests/qa/support/with-pg.sh` or the repo helper, unique port): run the integration suite and confirm `access-derived-race.test.ts`'s `afterAll` completes within the raised hookTimeout (no "Hook timed out"); 200/200.
- `pnpm -r typecheck`; `pnpm lint`; `pnpm exec prettier --check` the edited files; `pnpm test` (Node 22) and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` (Node 24) — both green.

## Handback
`docs/delivery/handbacks/DG1/round-15/T-DG1-BE16-backend-workflow-engineer.md` — the exact diffs and rationale, the real vitest output (architecture + integration + Node 22/24), and the `.d.ts` no-throw proof.
