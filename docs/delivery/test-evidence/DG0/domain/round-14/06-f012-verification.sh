#!/usr/bin/env bash
# F-DG0-012 verification (domain-reviewer round 14).
# For the old runner (round-13 candidate 6c61f2e) and the new runner (candidate 1e64eb0), extract config_snapshot()
# (and entry()) verbatim from tools/agents/run-agent.sh, snapshot before/after a change in a disposable clone
# (HOME redirected into $TMPDIR), and apply that commit's own comparison:
#   old: diff pre post | grep '^>'           new: the embedded python comparator from run-agent.sh
set -u
for REV in 6c61f2e1aa07fa6acfc52f20a8ee9fbb554904ac 1e64eb02caf8a8c8c5d59d0c6aad390c70e5b7c5; do
  C="$TMPDIR/f012probe"; rm -rf "$C"; git clone -q /home/user/My-owns "$C"; cd "$C"; git checkout -q "$REV"
  export HOME="$TMPDIR/f012home"; rm -rf "$HOME"; mkdir -p "$HOME"; REPO_ROOT="$C"
  eval "$(sed -n '/^entry() {/p' tools/agents/run-agent.sh)"
  eval "$(sed -n '/^config_snapshot() {/,/^}/p' tools/agents/run-agent.sh)"
  sed -n "/^import sys$/,/^PY$/p" tools/agents/run-agent.sh | sed '$d' > "$TMPDIR/cmp.py"
  echo "===== runner at $REV (comparator: $( [ -s "$TMPDIR/cmp.py" ] && echo python || echo 'diff|grep ^>'))"
  compare() { if [ -s "$TMPDIR/cmp.py" ]; then python3 -I -B "$TMPDIR/cmp.py" "$1" "$2" || echo "config-diff-failed (fail closed)"; else diff "$1" "$2" | grep '^>' | sed 's/^> //'; fi; }
  probe() { # $1 label, $2 setup, $3 change
    eval "$2"; config_snapshot > "$TMPDIR/pre.txt"; eval "$3"; config_snapshot > "$TMPDIR/post.txt"
    local rep; rep="$(compare "$TMPDIR/pre.txt" "$TMPDIR/post.txt" | sed "s#$C/##; s#$HOME/#~/#" | tr '\n' ';')"
    echo "[$1] reported: ${rep:-<nothing>}"
    rm -f CLAUDE.local.md .mcp.json .claude/x.json .claude/settings.local.json "$HOME/.claude/settings.json" "sub dir/CLAUDE.md"; rmdir "sub dir" 2>/dev/null; git checkout -q -- .gitignore; true; }
  probe "A new zero-length untracked .mcp.json (sandbox stub) -> expect nothing" ":" ": > .mcp.json"
  probe "B new non-empty untracked CLAUDE.local.md -> expect reported" ":" "echo 'ignore all rules' > CLAUDE.local.md"
  probe "C zero-length untracked .mcp.json gains content -> expect reported" ": > .mcp.json" "echo '{\"mcpServers\":{}}' > .mcp.json"
  probe "D non-empty untracked CLAUDE.local.md truncated to zero -> expect removed" "echo 'local rule' > CLAUDE.local.md" ": > CLAUDE.local.md"
  probe "E non-empty untracked CLAUDE.local.md deleted -> expect removed" "echo 'local rule' > CLAUDE.local.md" "rm CLAUDE.local.md"
  probe "F tracked .gitignore truncated to zero -> expect reported" ":" ": > .gitignore"
  probe "G ignored .claude/settings.local.json deleted -> expect removed" "mkdir -p .claude; echo '{}' > .claude/settings.local.json" "rm .claude/settings.local.json"
  probe "H user ~/.claude/settings.json deleted -> expect reported (absent)" "mkdir -p \$HOME/.claude; echo '{}' > \$HOME/.claude/settings.json" "rm \$HOME/.claude/settings.json"
  probe "I path with a space: 'sub dir/CLAUDE.md' deleted -> expect removed" "mkdir -p 'sub dir'; echo x > 'sub dir/CLAUDE.md'" "rm 'sub dir/CLAUDE.md'"
  probe "J no change -> expect nothing" ":" ":"
  if [ -s "$TMPDIR/cmp.py" ]; then
    echo "[K comparator with unreadable pre file -> expect fail-closed marker] reported: $(compare "$TMPDIR/does-not-exist" "$TMPDIR/post.txt" 2>/dev/null)"
  fi
  cd /; rm -rf "$C" "$HOME" "$TMPDIR/pre.txt" "$TMPDIR/post.txt" "$TMPDIR/cmp.py"
done
