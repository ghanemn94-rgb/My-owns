# DG1 round 4: code-security-reviewer narrative

Candidate `sha256:3b76021be348356f…fb1` (commit `016433d`). Run `DG1-T-DG1-REV-SEC-R4-code-security-reviewer-20261001T102915Z-c98f572b`.

**Verdict: PASS.** All eight assigned fixes are verified. Three new findings were raised, none Critical, High or mandatory.

## Assigned fixes (all CLOSED_VERIFIED)
- **F-DG1-118 / 113 / 114 (installer copy-back): fixed.**
  - What changed: copy-back destinations now come from the real, read-only tree (`find -print0`). Each destination is `<member>/node_modules`, and a symlinked source is skipped.
  - Round-3 repro, re-run unchanged: all 8 planted control-path files are absent, and the victim directory outside the root is intact.
  - New round-4 repro (`repro-copyback-escape-r4.sh`) covers:
    - a forged `tools/gates/package.json` member;
    - a newline-named member;
    - an `h\n..` path;
    - a member `node_modules` swapped for a symlink to outside;
    - a hard link (EXDEV);
    - a direct write (EROFS).

    None reached the real root. Only `pnpm-lock.yaml` is new, and everything outside the root is byte-identical.
- **F-DG1-009: fixed.** Three fresh PG 16.13 clusters on port 5491, each 200/200 with exit 0, no 57P01 and a12 green. A mutation that removes the wait in `dropScratchDatabase` makes `scratch-drop.test.ts` fail. The 40-round race case on its own did not trip under that mutation; the leaked-client case does.
- **F-DG1-121: fixed** for the reported aliased forms. A real planted file makes `architecture.test.ts` fail.
- **F-DG1-120 / 107: fixed.** The `with:` inputs are allow-listed. 14 probe runs (13 distinct mutations plus a re-run of the duplicate-key case for its error text) all exit 1, and 46/46 self-tests pass.
- **F-DG1-119: fixed.** `format:check` is green.

## New findings
| ID | Sev | Mandatory | Where | Scenario |
|---|---|---|---|---|
| F-DG1-122 | Medium | no | `tools/deps/tests/install-sandbox.test.sh:139` (also `:124`) | Running the required acceptance test in a repo deletes pre-existing `CLAUDE.local.md`, `.mcp.json`, `apps/api/CLAUDE.md` and `.vscode/`. Reproduced. This was the unrepaired "Secondary" of F-DG1-118. |
| F-DG1-123 | Low | no | `tools/deps/install-sandbox.sh:150-155`, `:153` | `cp` errors are swallowed (unconditional `exit 0`). The member set is "any on-disk `package.json` at depth ≤4", not the `pnpm-workspace.yaml` globs. The two sets are identical today. This is a static finding only; my dynamic attempt was stopped earlier by pnpm. |
| F-DG1-124 | Low | no | `apps/api/src/architecture.testkit.ts` (~187, ~233) | `f["constr"+"uctor"]` and similar constructed keys evade the lint. A real plant leaves `architecture.test.ts` green, and Node performs the dynamic import. |

## BLOCKED (environment, not product)
The reviewer sandbox has no npm registry access, and the host store copy lacks some tarballs. Two checks are therefore BLOCKED, each with compensating evidence:
- **Installer AC-1 (effect).** Compensated by AC-2/AC-9.
- **Full `create`/`frozen` of the candidate tree.** Compensated by a positive `create` → `frozen` on a member workspace (`18-…log`).

The other checks used `node_modules` copied from the host install. Its `.pnpm/lock.yaml` is byte-identical to the candidate's `pnpm-lock.yaml`.

## Residual noted, no finding
A symlink inside the root `node_modules` is copied back as a symlink, not followed. This is inherent to installing package content.
