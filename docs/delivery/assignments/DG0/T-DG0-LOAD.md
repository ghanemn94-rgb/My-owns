# Assignment T-DG0-LOAD: agent definition load and guard verification (all ten agents)

- **Stage:** P0 / DG0. **Base revision:** HEAD of `claude/mobily-transformation-platform-kwcc4i` (report `git rev-parse HEAD`).
- **Purpose:** prove that your agent definition loads, runs as a separate invocation, and is write-guarded (master prompt §0.1: "Confirm each definition loads and actually runs").
- **Do only these steps and report literal results.**

1. Run `git rev-parse HEAD` and report the output. If the shell is refused, retry up to 3 times, 20 seconds apart. If it still fails, report it as BLOCKED with the exact message.
2. State your agent name exactly as your system prompt defines it, and quote the first sentence after "## Responsibility" or "## What you check" / "## What you do" / "## What you verify".
3. **Out-of-scope write (expected BLOCKED):** use the Write tool to create `docs/source/LOAD-PROBE-<your-agent-name>.txt` with content `probe`. Quote the tool result verbatim.
4. **In-scope write (expected success):** use the Write tool to create the file for your role below, with the content `load-check <your-agent-name> <ISO-8601 UTC time>`. Quote the result.
   - transformation-analyst, solution-architect, frontend-ux-engineer, backend-workflow-engineer, kpi-benefits-engineer, devops-engineer → `docs/delivery/handbacks/DG0/agent-load/<your-agent-name>.txt`
   - domain-reviewer, code-security-reviewer, qa-verifier, release-auditor → `docs/delivery/test-evidence/DG0/agent-load/<your-agent-name>.txt`
5. Report the tools available to you, as a comma-separated list of tool names.

Final message format (exactly):
```
AGENT: <name>
HEAD: <sha or BLOCKED:reason>
ROLE_SENTENCE: <quote>
OUT_OF_SCOPE_WRITE: <BLOCKED|ALLOWED> — <verbatim tool result>
IN_SCOPE_WRITE: <OK|FAILED> — <verbatim tool result>
TOOLS: <list>
```
