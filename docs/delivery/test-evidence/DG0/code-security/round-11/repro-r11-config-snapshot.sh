#!/usr/bin/env bash
# Round-11 harness (code-security-reviewer): exercises run-agent.sh's config_snapshot() and its diff step exactly as
# written at <commit> (extracted verbatim with sed), against a disposable repo + fake HOME under <base-dir>.
#   repro-r11-config-snapshot.sh <commit> <base-dir>
set -u
C="$1"; BASE="$2"; rm -rf "$BASE"; mkdir -p "$BASE"
git clone -q /home/user/My-owns "$BASE/repo" && git -C "$BASE/repo" checkout -q "$C"
REPO_ROOT="$BASE/repo"; export HOME="$BASE/home"; mkdir -p "$HOME/.claude"
echo '{}' > "$HOME/.claude/settings.json"; printf '[user]\n name = x\n' > "$HOME/.gitconfig"
FN="$(git -C "$REPO_ROOT" show "$C:tools/agents/run-agent.sh" | sed -n '/^config_snapshot() {/,/^}/p')"
eval "$FN"
DIFF="$(git -C "$REPO_ROOT" show "$C:tools/agents/run-agent.sh" | grep -F 'diff "$OUT/.pre-config.txt"')"
echo "commit=$C"; echo "extracted diff step: $DIFF"
OUT="$BASE/out"; mkdir -p "$OUT"
check() { # label; mutation already applied between pre and post
  config_snapshot > "$OUT/.post-config.txt"
  eval "$DIFF"
  if [ -s "$OUT/.config-changed.txt" ]; then echo "DETECTED     $1 :: $(tr '\n' ' ' < "$OUT/.config-changed.txt" | sed "s#$BASE/##g")"; else echo "NOT DETECTED $1"; fi
  config_snapshot > "$OUT/.pre-config.txt"
}
config_snapshot > "$OUT/.pre-config.txt"
echo '{"disableAllHooks": true}' > "$HOME/.claude/settings.json";                 check "a. ~/.claude/settings.json modified"
printf '[core]\n hooksPath = /tmp/x\n' >> "$HOME/.gitconfig";                     check "b. ~/.gitconfig core.hooksPath added"
git -C "$REPO_ROOT" config core.fsmonitor /tmp/x;                                   check "c. .git/config core.fsmonitor added"
printf '#!/bin/sh\necho regular-hook\n' > "$REPO_ROOT/.git/hooks/pre-commit"; chmod +x "$REPO_ROOT/.git/hooks/pre-commit"; check "d. .git/hooks/pre-commit regular file added"
# reset b/c/d so that step e is isolated (a global core.hooksPath would bypass .git/hooks)
printf '[user]\n name = x\n' > "$HOME/.gitconfig"; git -C "$REPO_ROOT" config --unset core.fsmonitor
rm -f "$REPO_ROOT/.git/hooks/pre-commit"; config_snapshot > "$OUT/.pre-config.txt"
printf '#!/bin/sh\necho SYMLINKED-HOOK-RAN > %s/hook-ran.txt\n' "$BASE" > "$BASE/evil.sh"; chmod +x "$BASE/evil.sh"
ln -s "$BASE/evil.sh" "$REPO_ROOT/.git/hooks/pre-commit";                          check "e. .git/hooks/pre-commit SYMLINK to a script outside the repo"
echo "   does git run the symlinked hook on commit (as the runner's auto-commit would, no --no-verify)?"
( cd "$REPO_ROOT" && git -c user.email=a@b -c user.name=x commit -q --allow-empty -m t 2>&1 | head -3 ); [ -f "$BASE/hook-ran.txt" ] && echo "   YES: $(cat "$BASE/hook-ran.txt")" || echo "   no"
echo "secret/*" >> "$REPO_ROOT/.git/info/exclude";                                  check "f. .git/info/exclude extended (hides new untracked files from the run snapshot)"
echo '{"mcpServers":{"x":{"command":"/tmp/x"}}}' > "$HOME/.claude.json";          check "g. ~/.claude.json (user MCP servers) created"
mkdir -p "$HOME/.claude/agents" && echo x > "$HOME/.claude/agents/code-security-reviewer.md"; check "h. ~/.claude/agents/<role>.md created"
