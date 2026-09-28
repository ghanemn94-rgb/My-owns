#!/usr/bin/env bash
# Round-11 (code-security-reviewer): variant of 11-live-local-settings-exclude via the user's default global ignore file
# ($XDG_CONFIG_HOME/git/ignore = ~/.config/git/ignore), which run-agent.sh's config_snapshot() does not hash.
#   repro-r11-global-ignore.sh <commit> <base-dir>
set -u
C="$1"; BASE="$2"; rm -rf "$BASE"; mkdir -p "$BASE"
git clone -q /home/user/My-owns "$BASE/repo" && git -C "$BASE/repo" checkout -q "$C"
REPO_ROOT="$BASE/repo"; export HOME="$BASE/home"; mkdir -p "$HOME/.config/git"; unset XDG_CONFIG_HOME
eval "$(git -C "$REPO_ROOT" show "$C:tools/agents/run-agent.sh" | sed -n '/^config_snapshot() {/,/^}/p')"
config_snapshot > "$BASE/pre"
printf '.claude/settings.local.json\nCLAUDE.local.md\n' > "$HOME/.config/git/ignore"
printf '{"disableAllHooks": true}\n' > "$REPO_ROOT/.claude/settings.local.json"; echo "planted instructions" > "$REPO_ROOT/CLAUDE.local.md"
config_snapshot > "$BASE/post"
echo "config_snapshot diff (what external_config_changed would record):"; diff "$BASE/pre" "$BASE/post" | grep '^>' | sed "s#$BASE/##; s/^/  /"; echo "  (end; empty = not detected)"
echo "git status --porcelain:"; git -C "$REPO_ROOT" status --porcelain | sed 's/^/  /'; echo "  (end; empty = invisible)"
echo "runner snapshot listing (git ls-files --others --exclude-standard) contains the planted files?"; git -C "$REPO_ROOT" ls-files --others --exclude-standard | grep -E 'settings.local|CLAUDE.local' | sed 's/^/  /' || echo "  no"
