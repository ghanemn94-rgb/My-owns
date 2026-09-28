# DG0 round 1: code-security-reviewer narrative

**Verdict: BLOCKED.** If the candidate were confirmed, this would still be FAIL on the findings below.

## Why BLOCKED
- `HEAD` is `4f493c3`, not the frozen commit `26642c7`. The reflog shows one follow-up commit, titled "DG0: freeze candidate … round-1 review assignments". That title suggests metadata only, but confirming it requires `node tools/gates/candidate.mjs --stage DG0`.
- Every Bash call in this invocation (9 attempts) was refused with "auto mode classifier gave no verdict". As a result, nothing was executed:
  - the candidate ID recomputation;
  - `node --test` on both test suites;
  - my reproduction script;
  - the secret scan;
  - `check_extraction.sh`.
- The reproduction script was written (`docs/delivery/test-evidence/DG0/code-security/repro.test.mjs`) but has **not** been run. No runtime result is claimed.

## Findings (static full-file review of the working tree)
| ID | Sev | Mandatory | Summary |
|---|---|---|---|
| F-DG0-101 | High | yes | Findings escape the gate. `rules.mjs:278` checks only `stage_id === stage`, so relabelling to DG1 escapes. Earlier-round findings are never cross-checked, so an OPEN finding can be dropped from `findings.json`. |
| F-DG0-102 | High | yes | Provenance = a 4-field `meta.json`. No transcript/result existence check, hash, `result_session_id`, assignment, stage or timing binding. Historical mode trusts mutable metadata. |
| F-DG0-103 | Medium | yes | Symlinks and gitlinks are silently excluded from the candidate (`candidate.mjs:70,83`), contrary to D-005. A repointed symlink goes undetected. |
| F-DG0-104 | Medium | no | `manifest.spec` isn't bound to `candidate_spec` or the D-005 policy, so an exclude glob hides deliverables. |
| F-DG0-105 | Medium | no | The guard leaves unprotected: `.claude/settings.local.json` (a `disableAllHooks` risk, not reproduced end-to-end), `.mcp.json`, `.claude/hooks`, and `trading_agent/`. Symlinked paths bypass it (lexical resolve). It is case-sensitive. Bash being unguarded is disclosed. |
| F-DG0-106 | Low | no | Evidence checks accept `#x`, `.`, directories and non-path register evidence. The gate `tests[]` may be empty. |
| F-DG0-107 | Low | no | The CSV parser accepts `"x"y`. `merge_register.py` drops surplus cells silently. |
| F-DG0-108 | Low | no | The runner doesn't validate stage/task/role, and run IDs can collide within one second. |
| F-DG0-109 | Low | no | CI actions are pinned to mutable tags. |

The Low findings could be accepted as observations. The High and Medium findings must be fixed.

## Confirmed sound (by reading)
- **Validator:** exit codes; schema validator semantics; transition table; pipeline advancement rule; binding of the gate record to the auditor's invocation; session uniqueness across the four records; the tamper check on manifest entries.
- **Hook command:** fails closed (missing git, missing guard, any non-zero exit, or bad payload all lead to exit 2). The matcher includes MultiEdit and NotebookEdit.
- **Runner:** no shell injection; `--permission-mode auto`; uuid4 sessions; explicit `--model`; exit code propagated.
- **CI:** read-only `permissions` and `fetch-depth: 0`.
- **Candidate hash:** deterministic. Both paths use UTF-16 code-unit sorting, and the hash is over raw bytes. Note: with `core.autocrlf=true` on Windows, the working-tree ID would differ from the ref ID. This fails closed, because freeze refuses and validation mismatches.

## To unblock
Re-run this review with a working Bash tool. Execute C02/C03/C04/C09/C10 in `/tmp/dg0-sec` (a worktree at `26642c7`).
