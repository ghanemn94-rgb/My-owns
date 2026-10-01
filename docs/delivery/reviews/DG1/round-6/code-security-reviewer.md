# DG1 round 6 — code-security-reviewer narrative

**Candidate:** `sha256:a7b46fbc29db6bb855495593e43f2e859305dea9d6c403fe86f73619d9fb210d` (freeze commit `0026a7b`).
**Run:** `DG1-T-DG1-REV-SEC-R6-code-security-reviewer-20261001T121845Z-e71de159`
**Verdict:** **PASS**

## Identity
At start, HEAD was `f03a9fa`, a child of `0026a7b` that adds only candidate-excluded metadata (assignments, manifest, stages.json). The recomputed ID matched in the real repo and in a disposable clone at `0026a7b`. During the run, HEAD advanced to `24fac7c`. That commit is the runner's auto-commit of the domain-reviewer run. The ID is unchanged, and I did not open that record. I read no other round-6 reviewer record.

## F-DG1-125: CLOSED_VERIFIED
`architecture.testkit.ts:58-70` now puts `process` in `LOADER_BUILTINS`, in both the bare and the `node:` form. `bareAllowed()` checks that set before the `node:` allowance. Rule 3 (`PROCESS_LOADERS`, line 91, and the `root === "process"` check at 305-306) is unchanged.

I planted the following forms; each is now a specifier violation (28/28):
- default, named, namespace and import-equals imports
- dynamic `import()`
- re-export, type-only, with-attributes and side-effect imports
- the bare `process` specifier

The global forms (P12 and the others) are still caught by rule 3, and `process.env` stays legal.

I also planted real files in `src/modules/access`. Each fails the candidate's `architecture.test.ts` (baseline 77/77). Under the round-5 testkit the same plant goes unreported.

## F-DG1-126: CLOSED_VERIFIED
The copy-back members now come from `pnpm -r ls --depth -1 --json`, run on the real tree. The stream parser merges concatenated arrays. A path outside the root, an unparseable list or a failed resolve each fail the install.

- **Installer suite:** 13/14, with AC-9 and AC-10 PASS. AC-1 (effect) needs the registry and is BLOCKED.
- **Independent probe:** a workspace with a `!` exclusion, `publicHoistPattern`, `ignoredBuiltDependencies` and a directory without a `package.json`. Only the root, `apps/web` and `packages/real` received node_modules.
- **Fail-closed shim probe:** confirms all three refusal paths plus stream merging.
- **Real-repo `frozen` install:** BLOCKED (registry unreachable). It failed closed, leaving no partial node_modules.

## Observations (not findings)
- `install-sandbox.sh:180` skips a single array that fails to parse, and fails only if every array fails. This can only drop a member, never add a destination.

## New finding
- **F-DG1-127 (Low, not mandatory, REQ-S16-003):** two loader routes outside `LOADER_BUILTINS` pass the module lint.
  - `node:sqlite` `DatabaseSync.loadExtension` is a real dlopen; I confirmed it at runtime.
  - Code written with `node:fs` and then loaded with a literal same-module `import()` runs `child_process` at runtime.
  - No module uses either today. The lint is a static boundary aid, not a runtime security boundary.
  - Suggested fix: ban `sqlite`, and either restrict `fs` writes in module source or document the residual.

## Checks
All of these passed in a disposable clone:
- typecheck, build, lint, openapi:lint, no-cdn and format
- unit tests: 270/270
- integration on fresh PG16 (port 5491): 200/200, twice, with 0 FATAL/57P01 lines in the server log
- gates/agents tests: 105/105
- deploy tests: 59/59
- SBOM check
- DG0 `--historical`
- the three `ci.yml` copies are identical, and `check-ci-needs` reports OK

All 8 assigned requirements are IMPLEMENTED with `final_gate` DG1, and every evidence path exists.
