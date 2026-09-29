#!/usr/bin/env python3
"""Confine a whole project-agent process in bubblewrap (called by run-agent.sh; decision D-030, finding F-DG0-145).

The write guard (guard-write.mjs) checks a file-tool path and the CLI performs the write afterwards, so the agent's own
shell can swap a symlink in between (check-then-use). This sandbox makes the kernel enforce the role's scope for
everything the agent process does, its file tools included. The guard and the Claude Code Bash sandbox (D-025) stay as
defence in depth.

Inside the sandbox:
  - The root filesystem is read-only. /tmp and /var/tmp are private tmpfs mounts, so no other run's scratch is
    reachable. Only this run's own private TMPDIR is bound in, read-write.
  - HOME is read-only, except a private per-run session directory bound at ~/.claude/projects.
  - Every repository root and worktree is read-only, except the role's own areas:
      * Confined roles (reviewers, the auditor, the analyst): the working tree's root is a throwaway tmpfs "skeleton"
        whose top-level entries are the real ones, bound read-only. The Claude Code Bash sandbox creates its mount
        placeholders there; anything else written there vanishes with the sandbox. The role's directories (its
        evidence directory; QA's tests/qa and e2e; the analyst's docs/analysis and handbacks) are bound read-write.
        Review records, the gate record and the analyst's register are written in a private staging directory bound
        over docs/delivery/reviews/<stage>, docs/delivery/gates or docs/delivery (see staged_areas). The CLI's Edit
        writes a temporary file next to its target and renames it, so a single-file bind cannot work. After the run,
        only the role's own files are copied back; everything else is discarded and reported.
      * Implementers: the working tree is read-write, with every existing protected path bound read-only on top.
  - The process keeps only CAP_SETFCAP, in the bounding set too. The Claude Code Bash sandbox needs it to map uid 0
    into its own user namespace. no_new_privs is set, the PID and IPC namespaces are private, and the network is
    shared, because the CLI must reach the API (agent shells have no network, D-025).

Usage:
  agent_sandbox.py prepare ROLE REPO_ROOT CWD STAGE RUN_TMP STATE_DIR CLAUDE_BIN
      Writes STATE_DIR/plan.json and fills the staging copies.
  agent_sandbox.py args STATE_DIR
      Prints the bwrap arguments, NUL-separated, ending with the capability wrapper and "--".
  agent_sandbox.py finish STATE_DIR OUT
      Copies the accepted staged files back, writes OUT/sandbox.json and exits 3 if anything was discarded.
"""
import hashlib
import json
import os
import re
import shutil
import stat
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # tools/agents is protected from every agent (D-026)
import agent_settings  # noqa: E402

SCHEMA = "mth-process-sandbox-v1"
REVIEW_ROLES = {"domain-reviewer", "code-security-reviewer", "qa-verifier", "release-auditor"}
# The environment's process API cgroup: the CLI registers the processes it spawns there, so its Bash tool fails
# without write access. Bound only when it exists; the agent's shell and file tools cannot reach it (D-030).
CGROUP_API = "/sys/fs/cgroup/memory/process_api"


def staged_areas(role, stage):
    """[(relative directory, regex of accepted relative paths, may an existing file be replaced, copied entries)].

    Copied entries: None copies the whole directory into the staging directory; a list copies only those top-level
    files, and every other entry of the real directory is bound read-only into the staging directory."""
    areas = []
    if role in REVIEW_ROLES:
        # Review records are write-once: only new files named <role>.* directly in a round directory (D-021).
        areas.append((f"docs/delivery/reviews/{stage}", rf"round-[0-9]+/{re.escape(role)}\.[^/]+", False, None))
    if role == "release-auditor":
        areas.append(("docs/delivery/gates", rf"{re.escape(stage)}\.json", True, None))
    if role == "transformation-analyst":
        areas.append(("docs/delivery", r"requirements\.csv", True, ["requirements.csv"]))
    return areas


def sha256_of(path):
    """SHA-256 of a regular file (not followed if it is a symlink), or None if there is none."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        return None
    with os.fdopen(fd, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest() if stat.S_ISREG(os.fstat(f.fileno()).st_mode) else None


def worktree_root(cwd, roots):
    cwd = os.path.realpath(cwd)
    inside = [r for r in roots if cwd == r or cwd.startswith(r + os.sep)]
    if not inside:
        raise SystemExit(f"agent_sandbox: cwd {cwd} is not inside the repository or one of its worktrees")
    return max(inside, key=len)


def plan(role, repo_root, cwd, stage, run_tmp, state_dir, claude_bin, home=None):
    if role not in agent_settings.CONFINED and role not in agent_settings.IMPLEMENTERS:
        raise SystemExit(f"agent_sandbox: unknown role {role}")
    if not re.fullmatch(r"DG[0-7]", stage or ""):
        raise SystemExit(f"agent_sandbox: a stage DG0-DG7 is required (got {stage!r})")
    home = os.path.realpath(home or os.path.expanduser("~"))
    roots = agent_settings.worktree_roots(repo_root)
    root = worktree_root(cwd, roots)
    confined = role in agent_settings.CONFINED
    areas = agent_settings.writable_areas(role, stage) if confined else []
    for rel in areas:
        if not os.path.lexists(os.path.join(root, rel)):
            raise SystemExit(f"agent_sandbox: writable area {rel} does not exist (the runner creates it first)")
    staged = []
    for rel, accept, replace, copied in staged_areas(role, stage):
        real = os.path.join(root, rel)
        if not os.path.isdir(real) or os.path.islink(real):
            raise SystemExit(f"agent_sandbox: staged area {rel} is not a directory (the runner creates it first)")
        bound = [] if copied is None else sorted(n for n in os.listdir(real) if n not in copied)
        staged.append({"rel": rel, "real": real, "staging": os.path.join(state_dir, "staging", str(len(staged))),
                       "accept": accept, "replace": replace, "copied": copied, "bound": bound, "baseline": {}})
    # A writable area inside a staged directory is bound over it (its staging copy is only a mount point); a copied
    # file is not bound at all: it lives in the staging directory.
    copied_paths = {f"{s['rel']}/{c}" for s in staged for c in (s["copied"] or [])}
    binds = [a for a in areas if a not in copied_paths]
    # Implementers: every existing path of the Bash sandbox's deny list inside the writable tree stays read-only.
    protected = []
    if not confined:
        deny = agent_settings.build(role, repo_root, cwd, stage)["sandbox"]["filesystem"]["denyWrite"]
        protected = sorted({p for p in deny if p.startswith(root + os.sep) and os.path.lexists(p)})
    return {"schema": SCHEMA, "role": role, "stage": stage, "root": root, "cwd": os.path.realpath(cwd), "roots": roots,
            "confined": confined,
            "skeleton": sorted(os.listdir(root)) if confined else None, "areas": areas, "binds": binds,
            "staged": staged,
            "protected": protected, "run_tmp": os.path.realpath(run_tmp), "home": home,
            "sessions": os.path.join(state_dir, "projects"), "claude_bin": os.path.realpath(claude_bin),
            "cgroup_api": CGROUP_API if os.path.isdir(CGROUP_API) else None}


def bwrap_args(p):
    # A fresh procfs for the current (host) PID namespace, with /proc/sys read-only so a confined process cannot change
    # kernel tunables (D-030 hardening; round-16 code-security verifies it). run-agent invokes bwrap with the host's full privileges, so mounting the procfs and
    # binding /proc/sys read-only both happen before the capability drop below.
    #
    # The sandbox deliberately does NOT create a PID or IPC namespace. The Claude Code Bash sandbox nested inside it
    # creates its own PID namespace, and a reviewer's own bwrap (the pre-freeze, the sandbox tests) nests inside THAT.
    # A private procfs two PID namespaces up cannot serve that innermost bwrap: it can neither mount a fresh procfs
    # (denied) nor read its children's namespace files (they carry the inner namespace's PID numbering, absent from the
    # outer procfs). Keeping this sandbox transparent to the PID namespace reproduces the round-15 topology, in which a
    # reviewer's bwrap works. It does not weaken write confinement (the read-only binds and the capability drop do
    # that, F-DG0-145); it only means the agent shares the host PID/IPC namespaces, disclosed in the threat model.
    a = ["--die-with-parent", "--new-session", "--setenv", "MTH_PROCESS_SANDBOX", "1",
         "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--ro-bind", "/proc/sys", "/proc/sys",
         "--tmpfs", "/tmp", "--tmpfs", "/var/tmp"]
    # Repositories and a HOME under /tmp or /var/tmp (tests, the live probe) stay visible, read-only.
    for r in p["roots"] + ([p["home"]] if p["home"] != "/" else []):
        a += ["--ro-bind", r, r]
    a += ["--ro-bind", p["claude_bin"], p["claude_bin"]]
    root = p["root"]
    if p["confined"]:
        a += ["--tmpfs", root]
        for name in p["skeleton"]:
            src = os.path.join(root, name)
            if os.path.islink(src):
                a += ["--symlink", os.readlink(src), src]
            elif os.path.lexists(src):
                a += ["--ro-bind", src, src]
        # Staged directories first, then the real entries bound read-only inside them, then the writable areas.
        for s in p["staged"]:
            a += ["--bind", s["staging"], s["real"]]
            for name in s["bound"]:
                src = os.path.join(s["real"], name)
                a += ["--symlink", os.readlink(src), src] if os.path.islink(src) else ["--ro-bind", src, src]
        for rel in p["binds"]:
            a += ["--bind", os.path.join(root, rel), os.path.join(root, rel)]
    else:
        a += ["--bind", root, root]
        for path in p["protected"]:
            a += ["--ro-bind", path, path]
    a += ["--bind", p["run_tmp"], p["run_tmp"], "--bind", p["sessions"], os.path.join(p["home"], ".claude", "projects")]
    if p["cgroup_api"]:
        a += ["--bind", p["cgroup_api"], p["cgroup_api"]]
    a += ["--chdir", p["cwd"], "--cap-drop", "ALL", "--cap-add", "CAP_SETFCAP", "--cap-add", "CAP_SETPCAP", "--",
          "setpriv", "--bounding-set", "-all,+setfcap", "--inh-caps", "-all,+setfcap", "--ambient-caps", "-all,+setfcap",
          "--"]
    return a


def prepare(argv):
    role, repo_root, cwd, stage, run_tmp, state_dir, claude_bin = argv
    p = plan(role, repo_root, cwd, stage, run_tmp, state_dir, claude_bin)
    os.makedirs(p["sessions"], mode=0o700)
    home_projects = os.path.join(p["home"], ".claude", "projects")
    os.makedirs(home_projects, exist_ok=True)  # the bind needs its mount point
    for s in p["staged"]:
        if s["copied"] is None:
            shutil.copytree(s["real"], s["staging"], symlinks=True)
        else:
            os.makedirs(s["staging"])
            for name in s["copied"]:
                src = os.path.join(s["real"], name)
                if os.path.lexists(src):
                    shutil.copy2(src, os.path.join(s["staging"], name), follow_symlinks=False)
        # The files that may be replaced are compared with the real tree before being copied back (concurrent change).
        for rel, (kind, data) in regular_files(s["staging"]).items():
            if kind == "file" and s["replace"] and re.fullmatch(s["accept"], rel):
                s["baseline"][rel] = hashlib.sha256(data).hexdigest()
    with open(os.path.join(state_dir, "plan.json"), "w", encoding="utf-8") as f:
        json.dump(p, f, indent=1)


def regular_files(top, skip=()):
    """Relative path -> ("file", bytes) for regular files, (kind, None) for anything else, under top (no following).

    Top-level entries named in skip (read-only mount points of real entries) are not visited."""
    out = {}
    for dirpath, dirnames, filenames in os.walk(top):
        if dirpath == top:
            dirnames[:] = [d for d in dirnames if d not in skip]
            filenames = [f for f in filenames if f not in skip]
        for name in filenames + [d for d in dirnames if os.path.islink(os.path.join(dirpath, d))]:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, top)
            st = os.lstat(full)
            if stat.S_ISREG(st.st_mode):
                fd = os.open(full, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(fd, "rb") as f:
                    out[rel] = ("file", f.read())
            else:
                out[rel] = ("symlink" if stat.S_ISLNK(st.st_mode) else "special", None)
    return out


def finish(argv):
    state_dir, out_dir = argv
    with open(os.path.join(state_dir, "plan.json"), encoding="utf-8") as f:
        p = json.load(f)
    accepted, discarded = [], []
    for s in p["staged"]:
        skip = set(s["bound"])
        before, after = regular_files(s["real"], skip), regular_files(s["staging"], skip)
        if s["copied"] is not None:
            before = {k: v for k, v in before.items() if k in s["copied"]}  # only copies were staged
        for rel in sorted(set(before) | set(after)):
            path = f"{s['rel']}/{rel}"
            if rel not in after:
                discarded.append(f"{path}: removed in the sandbox (kept)")
                continue
            if after[rel] == before.get(rel):
                continue
            kind, data = after[rel]
            if kind != "file":
                discarded.append(f"{path}: {kind} (not copied)")
            elif not re.fullmatch(s["accept"], rel):
                discarded.append(f"{path}: outside the role's scope (not copied)")
            elif rel in before and not s["replace"]:
                discarded.append(f"{path}: existing file changed; review files are write-once (not copied)")
            elif s["replace"] and sha256_of(os.path.join(s["real"], rel)) != s["baseline"].get(rel):
                discarded.append(f"{path}: changed outside the sandbox during the run (not copied)")
            else:
                dest = os.path.join(s["real"], rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                flags = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | (os.O_TRUNC if rel in before else os.O_EXCL)
                fd = os.open(dest, flags, 0o644)
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
                accepted.append(path)
    summary = {"schema": p["schema"], "role": p["role"], "root": p["root"], "confined": p["confined"],
               "read_only_root": True, "private_tmp": ["/tmp", "/var/tmp"], "procfs": "fresh", "procsys_readonly": True,
               "run_tmp": p["run_tmp"],
               "writable_areas": p["binds"] if p["confined"] else ["."],
               "read_only_within_writable": [os.path.relpath(x, p["root"]) for x in p["protected"]],
               "staged": [{"area": s["rel"], "accept": s["accept"], "replace": s["replace"], "copied": s["copied"]}
                          for s in p["staged"]],
               "private_sessions": True, "cgroup_api": p["cgroup_api"],
               "capabilities": ["CAP_SETFCAP"], "no_new_privs": True, "unshare": [],
               "copied_back": accepted, "discarded": discarded}
    with open(os.path.join(out_dir, "sandbox.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=1)
        f.write("\n")
    for line in discarded:
        print(f"agent_sandbox: discarded {line}", file=sys.stderr)
    return 3 if discarded else 0


def main():
    cmd, argv = sys.argv[1], sys.argv[2:]
    if cmd == "prepare":
        prepare(argv)
    elif cmd == "args":
        with open(os.path.join(argv[0], "plan.json"), encoding="utf-8") as f:
            sys.stdout.write("\0".join(bwrap_args(json.load(f))) + "\0")
    elif cmd == "finish":
        sys.exit(finish(argv))
    else:
        raise SystemExit(f"agent_sandbox: unknown command {cmd}")


if __name__ == "__main__":
    main()
