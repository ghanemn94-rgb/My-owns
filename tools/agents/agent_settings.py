#!/usr/bin/env python3
"""Generate the per-run Claude Code settings for a project agent (called by run-agent.sh; decision D-025).

The settings combine:
  - the role's write-guard PreToolUse hook (file tools: Write/Edit/MultiEdit/NotebookEdit), and
  - an OS-level Bash sandbox (bubblewrap) whose filesystem deny list mirrors the protected paths, so shell commands
    cannot write gate rules, agent tooling, sources, delivery records, git metadata or Claude configuration.

Sandbox facts verified in this environment (docs/delivery/decisions.md D-025, D-028):
  - By default a sandboxed command may write only its working directory and a scratch directory under $TMPDIR (Claude
    Code uses $TMPDIR/claude-0); /tmp itself, /var/tmp, HOME and /etc are read-only. run-agent.sh gives every run its
    own private TMPDIR, so concurrently running agents cannot write each other's scratch (F-DG0-144).
  - denyWrite wins over allowWrite, and may name paths that do not exist yet.
  - enableWeakerNestedSandbox is required in this container (no unprivileged user namespaces).
  - Sandboxed commands have no network access here.
  - A deny path that does not exist inside the CLI's writable areas (its working directory included) needs a mount
    placeholder, which bubblewrap must create in the real directory. For confined roles the whole agent process runs
    in a process sandbox whose repository is read-only outside the role's areas (agent_sandbox.py, D-030), so a
    placeholder can only be created at the top level (a throwaway tmpfs there). Every other missing deny path has a
    read-only parent and cannot be created anyway, so it is left out of the list.

Usage: agent_settings.py ROLE REPO_ROOT CWD STAGE > settings.json
"""
import json
import os
import re
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

# Each reviewer's own evidence directory within a stage: docs/delivery/test-evidence/<stage>/<key> (F-DG0-144).
EVIDENCE_KEYS = {"domain-reviewer": "domain", "code-security-reviewer": "code-security", "qa-verifier": "qa",
                 "release-auditor": "audit"}

# Roles confined to specific areas: every other existing path in the repository is denied (see deny_except).
# "{evidence}" stands for the role's own evidence directory in the run's stage.
CONFINED = {
    "transformation-analyst": ["docs/analysis", "docs/delivery/requirements.csv", "docs/delivery/handbacks"],
    "domain-reviewer": ["{evidence}"],
    "code-security-reviewer": ["{evidence}"],
    "qa-verifier": ["{evidence}", "tests/qa", "e2e"],
    "release-auditor": ["{evidence}"],
}
IMPLEMENTERS = {"solution-architect", "frontend-ux-engineer", "backend-workflow-engineer", "kpi-benefits-engineer",
                "devops-engineer"}


def writable_areas(role, stage):
    """The paths, relative to the working tree's root, that a confined role may write (read-write in both sandboxes)."""
    own = f"docs/delivery/test-evidence/{stage}/{EVIDENCE_KEYS[role]}" if role in EVIDENCE_KEYS else None
    return [own if k == "{evidence}" else k for k in CONFINED[role]]


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


def creatable_in_process_sandbox(path, roots, cwd, areas):
    """False for a missing path that a confined role's process sandbox already makes uncreatable (see the header)."""
    if os.path.lexists(path):
        return True
    root = max((r for r in roots if cwd == r or cwd.startswith(r + os.sep)), key=len)
    if os.path.dirname(path) == root:
        return True  # top level: the process sandbox's tmpfs skeleton
    return any(path.startswith(os.path.join(root, a) + os.sep) for a in areas)


def build(role, repo_root, cwd, stage=None):
    if role not in CONFINED and role not in IMPLEMENTERS:
        raise SystemExit(f"agent_settings: unknown role {role}")
    if not re.fullmatch(r"DG[0-7]", stage or ""):
        raise SystemExit(f"agent_settings: a stage DG0-DG7 is required (got {stage!r})")
    with open(os.path.join(HERE, "settings", f"{role}.settings.json"), encoding="utf-8") as f:
        settings = json.load(f)  # the role's guard hook (tested in tools/agents/tests/guard.test.mjs)
    roots = worktree_roots(repo_root)
    cwd_real = os.path.realpath(cwd)
    if not any(cwd_real == r or cwd_real.startswith(r + os.sep) for r in roots):
        raise SystemExit(f"agent_settings: cwd {cwd} is not inside the repository or one of its worktrees")
    evidence = f"docs/delivery/test-evidence/{stage}"
    own = f"{evidence}/{EVIDENCE_KEYS[role]}" if role in EVIDENCE_KEYS else None
    deny = []
    for root in roots:
        deny += [os.path.join(root, p) for p in COMMON_DENY]
        if role in CONFINED:
            deny += deny_except(root, writable_areas(role, stage))
        # No role may write another reviewer's evidence, even where that directory does not exist yet (F-DG0-144);
        # roles without evidence of their own may write none.
        if own:
            deny += [os.path.join(root, evidence, k) for r, k in EVIDENCE_KEYS.items() if r != role]
        else:
            deny.append(os.path.join(root, "docs/delivery/test-evidence"))
    if role in CONFINED:
        deny = [p for p in deny if creatable_in_process_sandbox(p, roots, cwd_real, writable_areas(role, stage))]
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
    role, repo_root, cwd, stage = sys.argv[1:5]
    json.dump(build(role, repo_root, cwd, stage), sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
