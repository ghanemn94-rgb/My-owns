#!/usr/bin/env bash
# Round-5 (copied from round-4 script, round-4 path -> round-5) end-to-end write-guard probe through the real per-role hook commands (settings JSON) in a disposable worktree.
# usage: 07-guard-e2e.sh <worktree>
W="$1"; cd "$W" || exit 1
cmd() { node -e 'const s=require(process.argv[1]);console.log(s.hooks.PreToolUse[0].hooks[0].command)' "$W/tools/agents/settings/$1.settings.json"; }
IMPL=$(cmd backend-workflow-engineer); REV=$(cmd code-security-reviewer)
probe() { local c="$1" t="$2" p="$3"; printf '{"tool_name":"%s","tool_input":{"file_path":"%s","notebook_path":"%s","content":"x"}}' "$t" "$p" "$p" | bash -c "$c" >/dev/null 2>&1; echo "  $t ${p#$W/} exit=$?"; }
echo "worktree $(git rev-parse HEAD)"
echo "-- implementer (backend-workflow-engineer)"
probe "$IMPL" Write "$W/tools/.git"
probe "$IMPL" Write "$W/docs/.git"
printf 'gitdir: /nonexistent\n' > "$W/tools/.git"; printf 'gitdir: /nonexistent\n' > "$W/docs/.git"
for p in tools/gates/lib/rules.mjs tools/agents/write-scopes.json docs/delivery/stages.json docs/source/playbook.md .claude/settings.local.json .mcp.json sub/CLAUDE.md trading_agent/x.py docs/delivery/reviews/DG0/round-5/x.json; do probe "$IMPL" Write "$W/$p"; done
rm -f "$W/tools/.git" "$W/docs/.git"
probe "$IMPL" Write "$W/src/../tools/gates/lib/rules.mjs"
probe "$IMPL" Write "$W/TOOLS/GATES/lib/rules.mjs"
probe "$IMPL" MultiEdit "$W/tools/gates/lib/rules.mjs"
probe "$IMPL" NotebookEdit "$W/tools/gates/x.ipynb"
mkdir -p "$W/src"; ln -sfn ../tools/gates "$W/src/lnk"; probe "$IMPL" Write "$W/src/lnk/lib/rules.mjs"; rm -f "$W/src/lnk"
probe "$IMPL" Write "$W/src/ok.ts"
echo 'not json' | bash -c "$IMPL" >/dev/null 2>&1; echo "  garbage payload exit=$?"
echo "-- reviewer (code-security-reviewer)"
for p in docs/delivery/reviews/DG0/round-5/code-security-reviewer.json docs/delivery/test-evidence/DG0/code-security/x.log tools/gates/lib/rules.mjs src/app.ts docs/delivery/findings.json docs/delivery/stages.json docs/delivery/gates/DG0.json docs/delivery/runs/DG0/x/meta.json; do probe "$REV" Write "$W/$p"; done
echo "-- missing git binary on PATH (implementer, allowed path src/ok.ts and protected tools/gates/lib/rules.mjs)"
for p in src/ok.ts tools/gates/lib/rules.mjs; do printf '{"tool_name":"Write","tool_input":{"file_path":"%s"}}' "$W/$p" | env PATH=/nonexistent-bin:$(dirname $(command -v node)) bash -c "$IMPL" >/dev/null 2>&1; echo "  Write $p (no git) exit=$?"; done
