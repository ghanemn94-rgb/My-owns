# DG1 round 5: code-security-reviewer

- **Verdict: PASS**
- **Candidate:** `sha256:24eb377939d83b7036e992e647f390b91e030cd6aa18b805b74dea900d50b08e`
- **Freeze commit:** `5f83a336`
- **Run:** `DG1-T-DG1-REV-SEC-R5-code-security-reviewer-20261001T112622Z-42264c87`
- **Record:** `code-security-reviewer.json`; sidecars `.verifications.json`, `.findings.json`
- **Evidence:** `docs/delivery/test-evidence/DG1/code-security/round-5/`

## Identity and independence
HEAD was `d3fcb89`, one commit after the freeze commit `5f83a336`. That commit adds only candidate-excluded metadata: the assignments, the manifest, `stages.json` and QA test evidence. The candidate ID I recomputed matched in the real repo (`--diff matches=true`) and in a disposable clone at `5f83a336`.

I authored none of the reviewed implementation. I reported F-DG1-122, F-DG1-123 and F-DG1-124 in round 4, and verifying them falls to me as the originating reviewer. I read no other reviewer's round-5 record.

## Verified fixes (all → CLOSED_VERIFIED)
| Finding | Re-test | Result |
|---|---|---|
| F-DG1-122 (Medium) | AC-8 snapshots the probe paths that already exist (`install-sandbox.test.sh:135-137`) and removes only a path that is newly created (`:146-148`). I planted `.vscode/tasks.json`, `.vscode/settings.json`, `CLAUDE.local.md`, `.mcp.json` and `apps/api/CLAUDE.md`, then ran the suite. | All five survive byte-identical and AC-8 passes. Mutation control: an unsandboxed wrapper makes AC-8 FAIL, and only the new paths are removed. |
| F-DG1-123 (Low) | Ran the unchanged installer on scratch workspaces: a stray `tools/x/package.json`, a glob match without a `package.json`, `create` and `frozen`, and `cp`/`rm` fault injection. | Non-members are not copied back and members are populated. A failed copy or rm exits 1 with "copy-back failed". |
| F-DG1-124 (Low) | Ran `f["constr"+"uctor"]`, `Reflect.get(fn,"constructor")` and `Reflect.get(fn,"constr".concat("uctor"))` through `fileViolations()`, and also as real files in `src/modules/access/`. | All are violations, and as real files they make `architecture.test.ts` fail. The real module tree passes 74/74. Integration (200/200 twice) covers the refactors. |
| F-DG1-204 (Low) | `node licenses/generate-sbom.mjs --check` | OK, exit 0, lockfile sha `f199a0e1…` |
| F-DG1-205 (Low) | sha256 and `cmp` of the three `ci.yml` copies | Identical (`8b5b1106…`); check-ci-needs OK |

## New findings (proposed IDs; the orchestrator may renumber)
- **F-DG1-125 (Low, not mandatory, REQ-S16-003).** Rule 3 of the module lint misses the native loaders when `process` is reached through an import of `node:process`.
  - **Where:** `architecture.testkit.ts:290` matches `.binding`, `._linkedBinding` and `.dlopen` only on the identifier `process`. `node:process` is not in `LOADER_BUILTINS`, and `binding`/`dlopen` are not in `BANNED_PRIMITIVES`.
  - **Scenario:** a module file containing `import proc from "node:process"; proc.dlopen(m, p)`, or `import { binding } from "node:process"`, gives 0 violations, and `architecture.test.ts` stays green at 74/74.
  - **Runtime (Node 22.22.2):** the default export is `process` itself, `binding('natives')` exposes the built-in sources, and `dlopen` attempts a native load.
  - **Why only Low:** neither primitive is a JS module loader, and the lint is a static architecture check, not a runtime security boundary.
  - **Fix:** ban the names, or treat a `node:process` import as the runtime root, or ban the specifier in `src/modules`.
- **F-DG1-126 (Low, not mandatory, REQ-DLV-042).** The copy-back member resolver in `install-sandbox.sh:154-168` misreads `pnpm-workspace.yaml`.
  - **What it does:** it applies its regex to every YAML list item in the file, not only the `packages:` sequence, and it ignores `!` exclusions, because `fs.globSync` has no negation.
  - **Scenario:** with `"!apps/legacy"` plus a `publicHoistPattern: ["tools/x"]` item, both directories become destinations, and node_modules planted there by dependency code is copied back. pnpm itself excludes `apps/legacy`.
  - **Why only Low:** the committed YAML has only `apps/*` and `packages/*`, so this is latent hardening, not a current escape.

## Observations (no finding)
- **AC-8 with a broken sandbox.** If the sandbox were already broken, AC-8's probe `echo x > apps/api/CLAUDE.md` would overwrite a pre-existing file. The test would then report FAIL. The probe could skip paths that already exist.
- **Lint covers `.ts`/`.tsx` only.** A `.mjs`/`.js` file in `src/modules` is not scanned. Production runs only the `tsc` output (no `allowJs`), so such a file would not ship, and importing it would fail loudly.

## Checks
| Check | Result |
|---|---|
| typecheck, build, lint, `openapi:lint`, `no-cdn`, `format:check` | exit 0 |
| Unit tests | 267/267 |
| Integration (fresh PostgreSQL 16, port 5497) | 200/200 twice |
| Gate and agent tooling | 105/105 |
| Deploy scripts | 59/59 |
| SBOM `--check` | OK |
| DG0 historical | PASS |
| Installer suite | 12/13 |

In the installer suite, AC-1 (effect) is **BLOCKED**: the reviewer sandbox has no registry access. Its property passes in an offline equivalent with the unchanged wrapper. The orchestrator's committed 13/13 log exists at `docs/delivery/test-evidence/DG1/orchestrator/install-sandbox-acceptance.log`.

All 82 evidence paths cited by the eight assigned requirements exist.
