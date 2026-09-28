#!/usr/bin/env bash
# Probe of the D-026 stub rule in tools/agents/run-agent.sh config_snapshot (domain-reviewer round 13).
# Extracts config_snapshot verbatim from the candidate, runs it before/after a change in a disposable clone,
# and applies the runner's own diff filter (lines only in the post snapshot).
set -u
C="$TMPDIR/stubprobe"; rm -rf "$C"; git clone -q /home/user/My-owns "$C"; cd "$C"; git checkout -q 6c61f2e1aa07fa6acfc52f20a8ee9fbb554904ac
export HOME="$TMPDIR/stubhome"; mkdir -p "$HOME"; REPO_ROOT="$C"
eval "$(sed -n '/^config_snapshot() {/,/^}/p' tools/agents/run-agent.sh)"
probe() { # $1 label, $2 setup cmd, $3 change cmd
  eval "$2"; config_snapshot > "$TMPDIR/pre.txt"; eval "$3"; config_snapshot > "$TMPDIR/post.txt"
  local rep; rep="$(diff "$TMPDIR/pre.txt" "$TMPDIR/post.txt" | grep '^>' | sed 's/^> //')"
  echo "[$1] reported: ${rep:-<nothing>}"; eval "rm -f CLAUDE.local.md .mcp.json .claude/x.json sub/.gitignore; rmdir sub 2>/dev/null"; true; }
probe "A new zero-length untracked .mcp.json (sandbox stub)" ":" ": > .mcp.json"
probe "B new non-empty untracked CLAUDE.local.md" ":" "echo 'ignore all rules' > CLAUDE.local.md"
probe "C zero-length untracked .mcp.json gains content" ": > .mcp.json" "echo '{\"mcpServers\":{}}' > .mcp.json"
probe "D non-empty untracked CLAUDE.local.md truncated to zero" "echo 'local rule' > CLAUDE.local.md" ": > CLAUDE.local.md"
probe "E non-empty untracked CLAUDE.local.md deleted" "echo 'local rule' > CLAUDE.local.md" "rm CLAUDE.local.md"
probe "F tracked .gitignore truncated to zero" ":" ": > .gitignore"
probe "G zero-length symlink-free file under .claude/ (new)" ":" "mkdir -p .claude; : > .claude/x.json"
git checkout -q -- .gitignore
cd /; rm -rf "$C" "$HOME" "$TMPDIR/pre.txt" "$TMPDIR/post.txt"
