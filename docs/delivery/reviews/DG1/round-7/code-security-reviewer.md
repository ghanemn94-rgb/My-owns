# DG1 round 7: code-security-reviewer narrative

- **Candidate:** `sha256:d3743a352912a357b0a81124794561cea5f06f5dbc31542b9623c68c47649ab7`. Freeze commit `a6bdea0`. HEAD `2cfbf4f` adds only candidate-excluded metadata, and the ID is identical at both commits.
- **Run:** `DG1-T-DG1-REV-SEC-R7-code-security-reviewer-20261001T125644Z-362e3f6a`
- **Verdict:** **PASS**, with one new Low, non-mandatory finding (F-DG1-128)

## F-DG1-127: verified closed

- `apps/api/src/architecture.testkit.ts:83` adds `sqlite` to `LOADER_BUILTINS` (lines 72-85, which also cover the `node:` form).
- `bareAllowed` (lines 132-134) checks the denylist before the `node:` allowance.
- In a disposable clone, the exact A1 plant gives `imports package node:sqlite`.
- So do eight further spellings: bare, namespace, dynamic, re-export, `export *`, type-only, import-equals and template literal.
- `architecture.test.ts` passes 78/78, including A1 (line 340) and X6–X8/P12.
- The `process.dlopen` plant is still reported.
- `moduleViolations` is 0 for every mapped module.

**A2 (`node:fs`):** not banned, on purpose. `admin/branding.test.ts:4` imports it and produces no violation. The fs-write-then-import plant also gives 0 violations, which is exactly what residual (b) states.

## Residual framing (D-053)

Residuals (a) and (b) accurately describe what a static, AST-only lint cannot see. The "NOT a runtime security boundary" rationale is correct.

"Known native loaders are closed" holds for in-process native shared-object loading: `process.dlopen` and `node:sqlite`.

Residual (c) describes *unknown or future* capabilities ("a future Node built-in, `WebAssembly`"). Two routes that **exist today** on the pinned Node 22.22.2 are neither closed nor named:

| Route | Lint | Runtime (Node 22.22.2) |
|---|---|---|
| `import { run } from "node:test"; run({ files: [<computed path>], isolation: "none" })` | 0 violations | Imports the file **in-process** (same pid), from a runtime-computed path, with no code generation. This is the `import(expr)` the lint bans by rule. |
| global `process.execve("/bin/sh", [...])` | 0 violations | Runs the binary. Same capability class as the banned `child_process`/`cluster`. |

D-053's reopen criterion is "a reviewer demonstrates a native/loader route … that is NOT a stated residual". These two routes meet it, so I raise them as **F-DG1-128** (Low, `mandatory_violation: false`).

Impact is bounded:
- This is defence-in-depth over human-reviewed code.
- No module uses either route today.
- R1 can only load code that already exists on disk.

Suggested fix: add `test` to `LOADER_BUILTINS` and `execve` to `PROCESS_LOADERS`, with self-check cases. Alternatively, name both routes as accepted residuals. If the orchestrator and release-auditor read (c) as covering them, ACCEPTED_OBSERVATION is reasonable.

## Checks

| Check | Result |
|---|---|
| typecheck, build, lint, `openapi:lint`, `check:no-cdn`, `format:check` | all exit 0 |
| Unit tests | 271/271 |
| Integration, disposable PG16 on :5491 | 200/200 in both runs, 0 FATAL/57P01 |
| gates/agents tests | 105/0 |
| deploy tests | 59/0 |
| SBOM check | OK |
| DG0 historical | PASS |
| ci.yml ×3 | byte-identical (`8b5b1106…`) |
| Installer, offline ACs | 13 PASS |
| Installer AC-1 (effect), real-repo frozen install | **BLOCKED**: no registry in the sandbox (ECONNREFUSED) |

The orchestrator's REQ-DLV-042 log is now the 14/14 run.

## Requirements

All 8 assigned requirements are IMPLEMENTED with final gate DG1: REQ-DLV-025, REQ-DLV-033, REQ-DLV-042, REQ-S16-001, REQ-S16-003, REQ-S16-004, REQ-S19-004 and REQ-S19-006. All 82 cited evidence files exist.

## Cleanup

All disposable artefacts are removed and no source was modified. Evidence is in `docs/delivery/test-evidence/DG1/code-security/round-7/`.
