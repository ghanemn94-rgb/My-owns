# DG1 round 15: code-security-reviewer

**Verdict: PASS.** This review covers candidate `sha256:76d8b3049d22d414a4c036bd3dd1af6e0c3609baedb096e2d2ecf4180bf07846` (freeze commit `f27b5a6f`). Task: T-DG1-REV-SEC-R15; session `32298593`.

## Candidate identity
At the start, HEAD was `c7edc14`. That is the freeze commit plus round-15 assignments, the manifest and `stages.json`, all of which are candidate-excluded. The recomputed ID matches in the real repo and in a full disposable clone at `f27b5a6f`. Since round 14 (`985d0fa`), the only source changes are:
- `apps/api/src/architecture.testkit.ts`
- `apps/api/src/architecture.test.ts`
- `vitest.config.ts`

During the run, HEAD moved to `5d5e8a2`, the domain reviewer's auto-commit. I looked only at its directory names, and the ID is unchanged.

## F-DG1-136: CLOSED_VERIFIED (I raised it)
- `vitest.config.ts:52` sets `hookTimeout: 30_000` for the whole integration project. That covers all six files with the same `afterAll` pattern.
- **Effect probe.** A throwaway integration file has an `afterAll` that takes 12 s.
  - With the frozen config it passes.
  - With the `hookTimeout` line removed (control) it fails with `Hook timed out in 10000ms`.
- **Full integration runs** on disposable PostgreSQL 16.13 (port 5491) all pass 200/200 with exit 0:

  | Run | Node | Time | `access-derived-race` |
  |---|---|---|---|
  | 1 | 22 | 33 s | < 1 s |
  | 2 | 22 | 32 s | < 1 s |
  | 3 | 24 | 31 s | < 1 s |

## F-DG1-217: CLOSED_VERIFIED for its reported scope (raised by qa-verifier)
`declarationSyntaxErrors()` (`architecture.testkit.ts:455`) builds a no-emit, one-file program. It uses `noLib`/`noResolve`, a host that serves only the in-memory source, and a no-op `writeFile`. It reads only the syntactic diagnostics.

Re-proof on Node 22 and 24, for each of `.d.ts`, `.d.mts` and `.d.cts`:
- A clean file gives `[]` and does not throw.
- A deep `import type` of `../access/policy.ts` is still flagged.
- A syntax error produces named `unparseable source: Type expected. (line 1)` diagnostics, not `Debug Failure`.
- Evasion rules still apply.
- A planted directory is walked and nothing is written.
- `architecture.test.ts` passes 130/130, and the real tree has zero `moduleViolations`.

## New finding F-DG1-137 (Low, non-mandatory, REQ-S16-003)
`DECLARATION_FILE = /\.d\.[cm]?ts$/` (`:445`) is narrower than `ts.isDeclarationFileName()`. That function also accepts arbitrary-extension names: `x.d.css.ts`, `x.d.json.ts`, `x.d.ts.ts`.
- `walk()` collects those names, and `fileViolations` still throws `Debug Failure. Output generation failed`.
- A planted `modules/transformations/zz-r15.d.css.ts` turns `architecture.test.ts` red with the same opaque error. The lint fails closed, so nothing gets through.
- `tsc` emits nothing for such a file, so no runtime code can ship.
- **Fix:** use `ts.isDeclarationFileName(fileName)` in `syntaxErrors()` and add a self-check.

## Checks
These all pass:
- **Node 22:** build, typecheck, lint, `openapi:lint`, `check:no-cdn`, `format:check`
- **Unit tests:** 323/323 on both Node 22 and Node 24
- **Tooling tests:** gates/agents 105/105; deploy scripts 59/59
- **Install sandbox:** 13 of the 14 AC-1..AC-10 cases pass. The one failure is AC-1 (effect), which needs the registry.
- **Offline sandboxed frozen install:** passes.
- **Other:** SBOM `--check` OK; DG0 historical validation PASS; the three ci.yml copies are byte-identical, and `check-ci-needs` reports OK.

**BLOCKED:** the AC-1 effect check and the real-repo online install. Neither can run because the npm registry is unreachable (no network).

## Requirements
All 8 assigned rows are IMPLEMENTED, have `final_gate=DG1` and point only to evidence files that exist:
- REQ-DLV-025, REQ-DLV-033, REQ-DLV-042
- REQ-S16-001, REQ-S16-003, REQ-S16-004
- REQ-S19-004, REQ-S19-006

No Critical, High or mandatory violation is open. This is an engineering review only; it grants no business, Finance or IT approval.
