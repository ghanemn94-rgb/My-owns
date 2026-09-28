#!/usr/bin/env python3
"""Generate the per-run Claude Code settings for a project agent (called by run-agent.sh; decision D-025).

The settings combine:
  - the role's write-guard PreToolUse hook (file tools: Write/Edit/MultiEdit/NotebookEdit), and
  - an OS-level Bash sandbox (bubblewrap) whose filesystem deny list mirrors the protected paths, so shell commands
    cannot write gate rules, agent tooling, sources, delivery records, git metadata or Claude configuration.

Sandbox facts verified in this environment (docs/delivery/decisions.md D-025):
  - By default a sandboxed command may write only its working directory and /tmp; HOME and /etc are read-only.
  - denyWrite wins over allowWrite, and may name paths that do not exist yet.
  - enableWeakerNestedSandbox is required in this container (no unprivileged user namespaces).
  - Sandboxed commands have no network access here.

Usage: agent_settings.py ROLE REPO_ROOT CWD > settings.json
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# Protected for every role, relative to the repository and to each of its worktrees.
COMMON_DENY = [
    ".git", ".claude", ".mcp.json", "CLAUDE.md", "CLAUDE.local.md", ".gitignore", ".gitattributes", ".github",
    "tools/gates", "tools/agents", "tools/source", "docs/source", "trading_agent",
    "docs/delivery/reviews", "docs/delivery/gates", "docs/delivery/runs", "docs/delivery/candidates",
    "docs/delivery/assignments", "docs/delivery/findings.json", "docs/delivery/stages.json",
]

# Roles confined to specific areas: every other existing path in the repository is denied (see deny_except).
CONFINED = {
    "transformation-analyst": ["docs/analysis", "docs/delivery/requirements.csv", "docs/delivery/handbacks"],
    "domain-reviewer": ["docs/delivery/test-evidence"],
    "code-security-reviewer": ["docs/delivery/test-evidence"],
    "qa-verifier": ["docs/delivery/test-evidence", "tests/qa", "e2e"],
    "release-auditor": ["docs/delivery/test-evidence"],
}
IMPLEMENTERS = {"solution-architect", "frontend-ux-engineer", "backend-workflow-engineer", "kpi-benefits-engineer",
                "devops-engineer"}


def worktree_roots(repo_root):
    out = subprocess.run(["git", "-C", repo_root, "worktree", "list", "--porcelain"], capture_output=True, check=True,
                         text=True).stdout
    roots = [os.path.realpath(repo_root)]
    for line in out.splitlines():
        if line.startswith("worktree "):
            roots.append(os.path.realpath(line[len("worktree "):]))
    return sorted(set(roots))


def deny_except(root, keep):
    """Deny every existing entry of root except the paths leading to the kept paths (the kept subtrees stay open).

    New files can still be created at the levels on the path to a kept area; the runner's post-run scan reports
    new configuration or ignore files anywhere, and git status shows other new files."""
    denies = []
    keep_parts = [k.split("/") for k in keep]

    def walk(rel_parts):
        abs_dir = os.path.join(root, *rel_parts)
        if not os.path.isdir(abs_dir):
            return
        for name in sorted(os.listdir(abs_dir)):
            child = rel_parts + [name]
            if any(k[:len(child)] == child and len(k) == len(child) for k in keep_parts):
                continue  # a kept area: fully writable (minus COMMON_DENY)
            if any(k[:len(child)] == child for k in keep_parts):
                walk(child)  # on the path to a kept area: descend
            else:
                denies.append(os.path.join(root, *child))

    walk([])
    return denies


def build(role, repo_root, cwd):
    with open(os.path.join(HERE, "settings", f"{role}.settings.json"), encoding="utf-8") as f:
        settings = json.load(f)  # the role's guard hook (tested in tools/agents/tests/guard.test.mjs)
    roots = worktree_roots(repo_root)
    cwd_real = os.path.realpath(cwd)
    if not any(cwd_real == r or cwd_real.startswith(r + os.sep) for r in roots):
        raise SystemExit(f"agent_settings: cwd {cwd} is not inside the repository or one of its worktrees")
    deny = []
    for root in roots:
        deny += [os.path.join(root, p) for p in COMMON_DENY]
        if role in CONFINED:
            deny += deny_except(root, CONFINED[role])
        elif role not in IMPLEMENTERS:
            raise SystemExit(f"agent_settings: unknown role {role}")
    settings["sandbox"] = {
        "enabled": True,
        "failIfUnavailable": True,
        "allowUnsandboxedCommands": False,
        "autoAllowBashIfSandboxed": True,
        "enableWeakerNestedSandbox": True,
        "filesystem": {"denyWrite": sorted(set(deny))},
    }
    return settings


def main():
    role, repo_root, cwd = sys.argv[1:4]
    json.dump(build(role, repo_root, cwd), sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
