# Project agents: roster, invocation mechanism and verification

## Roster

The ten definitions live in `.claude/agents/`. The main Claude Code session is the eleventh role, **delivery-orchestrator**: it plans, delegates, integrates and reports, and never records a review verdict.

| Agent | Kind | Write scope (guard-enforced) |
|---|---|---|
| transformation-analyst | implementer (analysis) | `docs/analysis/**`, `docs/delivery/requirements.csv`, `docs/delivery/handbacks/**` |
| solution-architect | implementer | everything except the protected paths |
| frontend-ux-engineer | implementer | everything except the protected paths |
| backend-workflow-engineer | implementer | everything except the protected paths |
| kpi-benefits-engineer | implementer | everything except the protected paths |
| devops-engineer | implementer | everything except the protected paths |
| domain-reviewer | independent reviewer | `docs/delivery/reviews/**`, `docs/delivery/test-evidence/**` |
| code-security-reviewer | independent reviewer | `docs/delivery/reviews/**`, `docs/delivery/test-evidence/**` |
| qa-verifier | independent verifier | `tests/qa/**`, `e2e/**`, `docs/delivery/reviews/**`, `docs/delivery/test-evidence/**` |
| release-auditor | independent auditor | `docs/delivery/reviews/**`, `docs/delivery/gates/**`, `docs/delivery/test-evidence/**` |

The paths protected from implementers are:
- the gate rules and agent tooling: `tools/gates/**` and `tools/agents/**`;
- the sources: `docs/source/**`;
- all Claude configuration surfaces: `.claude/**`, `.mcp.json`, and `CLAUDE.md`/`CLAUDE.local.md` at any depth;
- the unrelated project: `trading_agent/**`;
- the delivery records: `docs/delivery/{reviews,gates,runs,candidates,test-evidence}/**`, `docs/delivery/stages.json` and `docs/delivery/findings.json`;
- the gate CI workflow: `.github/workflows/delivery-gates.yml`.

No role may write a `.git` path segment. The guard scopes every path from its own fixed repository root, so a planted nested `.git` can't move the root. It checks the symlink-resolved real path as well as the lexical one, and deny rules match case-insensitively (D-020, F-DG0-111). The source of truth is `tools/agents/write-scopes.json`, and the tests are `tools/agents/tests/guard.test.mjs`.

## Invocation mechanism (decision D-003)

`tools/agents/run-agent.sh --role <agent> --stage <DGx> --task <id> --assignment <file>` runs:

```
claude -p --agent <agent> --model <orchestrator model> --permission-mode auto \
       --session-id <fresh uuid> --settings tools/agents/settings/<agent>.settings.json \
       --output-format stream-json --verbose "<pointer to the assignment file>"
```

The metadata step is `tools/agents/run_meta.py`, tested in `tools/agents/tests/test_run_meta.py`. It records in `meta.json`:
- `outputs`: every file changed in the run window, path → SHA-256;
- `deleted`: files that disappeared in the window;
- `written_by_tools`: the paths the agent targeted with Write/Edit/MultiEdit/NotebookEdit;
- `tool_authored`: the paths whose final bytes equal a replay of the agent's own **successful** Write/Edit/MultiEdit calls.

The validator does not trust `tool_authored` alone. It replays the hash-bound transcript itself and compares the result with the file (D-021). It snapshots the tree before and after the run. For review roles, it auto-commits the run directory and the files the reviewer wrote (D-021). It records `docs/delivery/runs/<DGx>/<run-id>/meta.json` (role, the run's `outputs` (path → SHA-256) and `written_by_tools`, stage, task, session ID, model, assignment path and SHA-256, start commit, start and finish times, exit code, turns, models used, classifier-outage resumes, and the SHA-256 of `result.json` and `transcript.jsonl.gz`), `result.json` (the final message) and `transcript.jsonl.gz` (the full stream transcript). Run IDs include the session prefix, and directories are never reused (F-DG0-108). The arguments are validated. If a run stops only because the permission classifier returned no verdict repeatedly, the runner resumes the same session up to 6 times (D-019). The `invocation_reference` used in review records is `{kind, run_id, session_id}`. The validator refuses any review, audit or finding verification unless its run evidence is complete and hash-consistent, belongs to the same role and stage, executed exactly the cited assignment, started after the candidate froze, and ends in a successful result for the same session (D-016).

### Why not the in-session Agent tool?

Verified in P0 (raw outputs preserved in `docs/delivery/test-evidence/DG0/agent-smoke/`):

1. The running session's Agent tool registry lists only the built-in types. Project agents created during the session are **not hot-loaded**: `Agent type 'transformation-analyst' not found`. The official docs don't document hot reload.
2. `claude -p --agent <name>` **does** load the definition from `.claude/agents/`. The agent reported its role text from the definition.
3. **Frontmatter `hooks` did not execute in `--agent` main-session mode.** An out-of-scope write succeeded in smoke tests 1 and 2. The same hook supplied through `--settings` **does** execute and blocks with exit code 2 (smoke test 3 and the load checks below). The frontmatter hooks are kept for future native subagent use, but the runner always applies `--settings`.
4. `model: inherit` in a separate CLI process resolved to the CLI default (`claude-sonnet-5`), not the orchestrator's model. The runner passes `--model` explicitly, set to the orchestrator's model (`claude-opus-5-5`), so each agent really inherits it. Claude Code also invokes `claude-haiku-4-5` internally for auxiliary tasks; it is listed under models used.
5. Without `--session-id`, a nested run reported the parent session's ID. A fresh UUID per run gives every invocation a distinct, stable reference.
6. The permission mode stays `auto`, the same classifier-gated controls as the orchestrator. No permission control is weakened. When the classifier briefly returns no verdict, Bash calls are refused; agents are instructed to retry, and to report BLOCKED if they can't.

## Load and guard verification (task T-DG0-LOAD, assignment `docs/delivery/assignments/DG0/T-DG0-LOAD.md`)

Every agent was invoked through the runner as a separate process. Each one:
1. reported the start commit (`b42a4aa`);
2. quoted its role sentence;
3. attempted an out-of-scope write (`docs/source/LOAD-PROBE-<agent>.txt`), which must be BLOCKED;
4. attempted an in-scope write, which must succeed;
5. listed its tools.

| Agent | Run ID | Session ID (invocation reference) | Models used | Out-of-scope write | In-scope write | Tools reported |
|---|---|---|---|---|---|---|
| backend-workflow-engineer | `DG0-T-DG0-LOAD-backend-workflow-engineer-20260928T115301Z` | `cdc3fbb8-daf7-4fb2-9e53-755626551345` | claude-haiku-4-5-20251001, claude-opus-5-5 | BLOCKED | OK | Read, Write, Edit, Bash |
| code-security-reviewer | `DG0-T-DG0-LOAD-code-security-reviewer-20260928T115342Z` | `6a9515ef-8abd-4d4c-9a50-7223b570c44c` | claude-haiku-4-5-20251001, claude-opus-5-5 | BLOCKED | OK | Read, Bash, Write |
| devops-engineer | `DG0-T-DG0-LOAD-devops-engineer-20260928T115322Z` | `4982571d-65d3-42da-86c4-94321163254a` | claude-haiku-4-5-20251001, claude-opus-5-5 | BLOCKED | OK | Read, Write, Edit, Bash |
| domain-reviewer | `DG0-T-DG0-LOAD-domain-reviewer-20260928T115322Z` | `65579c42-4678-41fa-bda4-29dbdacff711` | claude-haiku-4-5-20251001, claude-opus-5-5 | BLOCKED | OK | Read, Bash, Write |
| frontend-ux-engineer | `DG0-T-DG0-LOAD-frontend-ux-engineer-20260928T115301Z` | `5a40f14c-d1f5-471c-bb3d-b4c72b547a75` | claude-haiku-4-5-20251001, claude-opus-5-5 | BLOCKED | OK | Read, Write, Edit, Bash |
| kpi-benefits-engineer | `DG0-T-DG0-LOAD-kpi-benefits-engineer-20260928T115322Z` | `cf191a76-946c-4282-a177-8cdf9f3c528b` | claude-haiku-4-5-20251001, claude-opus-5-5 | BLOCKED | OK | Read, Write, Edit, Bash |
| qa-verifier | `DG0-T-DG0-LOAD-qa-verifier-20260928T115342Z` | `f9a2efaa-c4c1-46fd-90b8-b03e44eae4a4` | claude-haiku-4-5-20251001, claude-opus-5-5 | BLOCKED | OK | Read, Bash, Write, Edit |
| release-auditor | `DG0-T-DG0-LOAD-release-auditor-20260928T115342Z` | `603fba96-3ee2-45e0-b7be-d4f41b5fea66` | claude-haiku-4-5-20251001, claude-opus-5-5 | BLOCKED | OK | Read, Bash, Write |
| solution-architect | `DG0-T-DG0-LOAD-solution-architect-20260928T115301Z` | `f1e238c4-5678-4212-9320-2910beacb76a` | claude-haiku-4-5-20251001, claude-opus-5-5 | BLOCKED | OK | Read, Write, Edit, Bash |
| transformation-analyst | `DG0-T-DG0-LOAD-transformation-analyst-20260928T115417Z` | `98d69e37-a344-4d50-ab2f-23a188355d19` | claude-haiku-4-5-20251001, claude-opus-5-5 | BLOCKED | OK | Read, Write, Edit, Bash |

Result: 10/10 definitions load and run as separate invocations, with 10 distinct session IDs, all on the orchestrator's model. Out-of-scope writes were blocked 10/10, in-scope writes succeeded 10/10, and no probe file exists under `docs/source/`. The in-scope probe files are under `docs/delivery/handbacks/DG0/agent-load/` and `docs/delivery/test-evidence/DG0/agent-load/`.

**Observation:** `Grep` and `Glob` are declared in the definitions but aren't exposed in `--agent` sessions of this CLI build. The agents use `grep`/`find` through Bash instead, which doesn't affect the guard. Bash writes aren't path-guarded, so the orchestrator runs `git status` after every run and investigates any write outside the assignment's permitted files.

## Concurrency

At most 4 active workers (D-004). Concurrent writers get separate git worktrees, via `--cwd <worktree>`, and explicit file ownership. Reviewers never share an invocation.
