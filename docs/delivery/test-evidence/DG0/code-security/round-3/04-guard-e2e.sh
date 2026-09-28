#!/usr/bin/env bash
# End-to-end write-guard probe through the real per-role hook command (settings JSON), run inside a disposable worktree.
# usage: 04-guard-e2e.sh <worktree>
W="$1"; cd "$W" || exit 1
CMD=$(node -e 'const s=require(process.argv[1]);console.log(s.hooks.PreToolUse[0].hooks[0].command)' "$W/tools/agents/settings/backend-workflow-engineer.settings.json")
probe() { printf '{"tool_name":"Write","tool_input":{"file_path":"%s","content":"x"}}' "$1" | bash -c "$CMD" 2>&1; echo "  -> $1 exit=$?"; }
echo "worktree $(git rev-parse HEAD)"
probe "$W/tools/.git"
probe "$W/docs/.git"
mkdir -p "$W/tools/.git.planted" && rmdir "$W/tools/.git.planted"
printf 'gitdir: /nonexistent\n' > "$W/tools/.git"   # planted via Bash (as an implementer could, unguarded)
printf 'gitdir: /nonexistent\n' > "$W/docs/.git"
probe "$W/tools/gates/lib/rules.mjs"
probe "$W/tools/agents/write-scopes.json"
probe "$W/docs/delivery/stages.json"
probe "$W/docs/source/playbook.md"
probe "$W/src/ok.ts"
# NotebookEdit / MultiEdit payload shapes
printf '{"tool_name":"NotebookEdit","tool_input":{"notebook_path":"%s"}}' "$W/tools/gates/x.ipynb" | bash -c "$CMD" 2>&1; echo "  -> NotebookEdit tools/gates/x.ipynb exit=$?"
printf '{"tool_name":"MultiEdit","tool_input":{"file_path":"%s","edits":[]}}' "$W/.claude/settings.local.json" | bash -c "$CMD" 2>&1; echo "  -> MultiEdit .claude/settings.local.json exit=$?"
# garbage payload fails safe
echo 'not json' | bash -c "$CMD" 2>&1; echo "  -> garbage payload exit=$?"
rm -f "$W/tools/.git" "$W/docs/.git"
