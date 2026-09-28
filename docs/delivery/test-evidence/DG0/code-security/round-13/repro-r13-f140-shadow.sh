#!/usr/bin/env bash
# F-DG0-140 re-verification (code-security-reviewer, DG0 round 13). Disposable clone only.
# A stub 'claude' (emulating a sandboxed agent that may create NEW files in the repository root and in the agent cwd)
# plants stdlib-shadowing modules; we then check whether any runner helper imported them (i.e. ran outside the sandbox).
#   usage: repro-r13-f140-shadow.sh <commit> [<src-repo>]
set -uo pipefail
COMMIT="${1:?commit}"; SRC="${2:-/home/user/My-owns}"
W="$(mktemp -d "${TMPDIR:-/tmp}/r13-shadow.XXXX")"; C="$W/clone"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=t GIT_COMMITTER_NAME=t GIT_AUTHOR_EMAIL=t@e.invalid GIT_COMMITTER_EMAIL=t@e.invalid
git clone -q "$SRC" "$C" && git -C "$C" checkout -q "$COMMIT"
echo "clone at $(git -C "$C" rev-parse HEAD)"
mkdir -p "$C/docs/delivery/assignments/DG0" && echo "probe assignment" > "$C/docs/delivery/assignments/DG0/probe.md"
git -C "$C" add -A && git -C "$C" commit -qm probe-assignment
MARK="$W/marks"; mkdir -p "$MARK"
mkdir -p "$W/bin"; cat > "$W/bin/claude" <<STUB
#!/usr/bin/env bash
sid=""; while [ \$# -gt 0 ]; do [ "\$1" = "--session-id" ] && sid="\$2"; shift; done
for m in json uuid hashlib subprocess os sys sitecustomize usercustomize encodings site; do
  cat > "\$PWD/\$m.py" <<PAY
import sys as _s
open("$MARK/imported-\$m", "a").write("argv=%r\\n" % (_s.argv[:1],))
PAY
done
mkdir -p "\$PWD/encodings"; cp "\$PWD/encodings.py" "\$PWD/encodings/__init__.py"
# PYTHONSTARTUP-style / .pth attempts in the repo root (not on sys.path unless cwd is)
echo "import sys; open('$MARK/imported-pth','a').write('pth')" > "\$PWD/zz.pth"
echo "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"\$sid\"}"
echo "{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"session_id\":\"\$sid\",\"result\":\"done\"}"
STUB
chmod +x "$W/bin/claude"
( cd "$C" && PATH="$W/bin:$PATH" ./tools/agents/run-agent.sh --role code-security-reviewer --stage DG0 --task T-SHADOW \
    --assignment docs/delivery/assignments/DG0/probe.md ) >"$W/runner.out" 2>&1; echo "runner exit: $?"
tail -n 5 "$W/runner.out" | sed 's/^/  runner: /'
echo "== marker files (each = a shadow module imported by an UNSANDBOXED runner helper):"
ls "$MARK" 2>/dev/null | sed 's/^/  /'; for f in "$MARK"/*; do [ -f "$f" ] && sed "s|^|  $(basename "$f"): |" "$f"; done
n=$(ls "$MARK" | wc -l); echo "RESULT: $n shadow imports"
# Also the runner invoked with --cwd pointing at an agent-writable subdirectory
rm -f "$MARK"/*; rm -rf "$C"/docs/delivery/runs/DG0/*
mkdir -p "$C/docs/delivery/test-evidence"
( cd "$C" && PATH="$W/bin:$PATH" ./tools/agents/run-agent.sh --role code-security-reviewer --stage DG0 --task T-SHADOW2 \
    --assignment docs/delivery/assignments/DG0/probe.md --cwd docs/delivery/test-evidence ) >"$W/runner2.out" 2>&1; echo "runner(--cwd subdir) exit: $?"
n=$(ls "$MARK" | wc -l); echo "RESULT(--cwd subdir): $n shadow imports"; ls "$MARK" | sed 's/^/  /'
rm -rf "$W"
