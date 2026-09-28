# DG0 round 2: code-security review (T-DG0-REV-SEC-R2)

- **Candidate:** `sha256:d47b51caa83c28b068da75895b530e9b59d12b7ddb3356bf4aa1d71ad23c76c3`, source commit `83860be3`.
  - HEAD at review time was `eaef1d0f`, a metadata-only commit after the freeze. The recomputed ID matches (C01).
- **Verdict: FAIL**

## Scope and method
I read the full source of:
- `tools/gates/**`;
- `tools/agents/**`;
- `tools/source/merge_register.py`;
- `.github/workflows/delivery-gates.yml`;
- `.claude/agents/*.md` frontmatter.

I also read the diff since the round-1 candidate `26642c72`. All code ran in disposable worktrees (`/tmp/dg0-sec-r2` at the candidate, `/tmp/dg0-sec-r1old` at round 1) or in scratch repositories.

My reproduction `docs/delivery/test-evidence/DG0/code-security/round-2/repro-r2.test.mjs` works as follows:
- It reuses the candidate's own valid-gate fixture verbatim and applies one mutation per attack.
- It runs against both commits, so fixes are shown differentially: every "FIXED" test fails on `26642c72` and passes on `83860be3`.

## Round-1 findings (my own)
| ID | Result | Status after | Why |
|---|---|---|---|
| F-DG0-101 | FAIL | OPEN | The stated vectors are fixed: relabel, drop and downgrade. Deleting a **whole earlier round** (the record, its sidecar and the findings.json entry) still passes the current, historical and pipeline checks, even while `stages.json` lists the round (N2). |
| F-DG0-102 | FAIL | OPEN | Reviews and audits are now bound to their run. **Finding verifications are not**: `rules.mjs:417` passes `binding = null`. A pre-freeze LOAD-check run closes a High finding (N1a). D-016 claims otherwise. |
| F-DG0-103 | PASS | CLOSED_VERIFIED | Symlinks are hashed by target, and gitlinks are refused. |
| F-DG0-104 | PASS | CLOSED_VERIFIED | The spec is pinned to APPROVED_SPEC and to the stage's spec. |
| F-DG0-105 | PASS | CLOSED_VERIFIED | The real-path check, the case-insensitive deny and the config surfaces are all protected. The new vector is F-DG0-111. |
| F-DG0-106 | PASS | CLOSED_VERIFIED | `repoFile()` requires a regular in-repo file, and `tests[]` needs at least one item. |
| F-DG0-107 | PASS | CLOSED_VERIFIED | Both the parser and `merge_register.py` reject ragged or malformed rows. |
| F-DG0-108 | PASS | CLOSED_VERIFIED | Arguments are validated, and `mkdir` without `-p` means evidence can't be overwritten. No injection found. |
| F-DG0-109 | PASS | CLOSED_VERIFIED | The actions are pinned by SHA, and `git ls-remote` confirms v7.0.1 and v7.0.0. |

## New findings
| ID | Sev | Mandatory | Summary |
|---|---|---|---|
| F-DG0-110 | High | yes | The validator trusts the `verification` object in orchestrator-written findings.json. It never reads the reviewer's `<role>.verifications.json`, so a reviewer's FAIL/OPEN verification can be overridden by a PASS in findings.json (N1b). Verification evidence paths and `fix_revision` are unchecked (N1c). |
| F-DG0-111 | Medium | no | `guard-write.mjs` takes the nearest `.git` ancestor as the repo root. An implementer with `allow: **` can Write `tools/.git`, `docs/.git` or `.github/.git`, and after that gate rules, scopes, `stages.json`, sources and the workflow can all be written (N3, confirmed through the hook entry point). The planted file doesn't appear in `git status`. Content edits still show and change the candidate, which is why this is Medium rather than High. |
| F-DG0-112 | Low | no | The canonical hash line omits the entry type and the git mode. A file containing `symlink:<t>` collides with a symlink to `<t>`, and chmod changes are invisible. I'd accept this as an observation. |
| F-DG0-113 | Low | no | CRLF checkouts (`core.autocrlf`) change the current-mode candidate ID, and there's no `.gitattributes`. It fails closed. I'd accept this as an observation. |
| F-DG0-114 | Low | no | Documentation drift: D-016 (verification binding), D-019 ("3" resumes vs 6 in the runner) and `agents.md:20` (stale protected list). |

## Sound, as checked
- **Runner:** argument validation, quoting and permission mode `auto` are correct, the model is passed explicitly, the session is a UUID and the exit code propagates.
- **Hook:** it fails closed on a missing guard, a missing `node`, no repository and a bad payload. All ten settings files pass their own role, with matcher `Write|Edit|NotebookEdit|MultiEdit`.
- **CI:** `contents: read`, `fetch-depth: 0`, SHA-pinned actions and no secrets.
- **Other:** no credentials or personal data were found in any tracked file, and the source extraction is reproducible. The candidate's own tests pass 31/31.
- **Disclosed policy gap:** Bash is not path-guarded for any role. This is disclosed in `agent-protocol.md:75`, D-009 and D-020, and the `git status` check after each run is the compensating control.

The candidate's register rows for REQ-DLV-013, -016, -017 and -026 claim controls that N1 and N2 bypass, and REQ-DLV-007 claims one that N3 bypasses. PASS is therefore not possible until F-DG0-101, F-DG0-102 and F-DG0-110 are fixed, and F-DG0-111 is fixed or explicitly dispositioned.
