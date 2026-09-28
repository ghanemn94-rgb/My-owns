#!/usr/bin/env bash
# Round-11 write-guard reproduction (code-security-reviewer). Disposable: everything lives under $BASE.
#   repro-r11-guard.sh <commit> <base-dir>
# Runs each role's REAL hook command (tools/agents/settings/<role>.settings.json at <commit>) the way Claude Code does:
# sh -c, Write payload on stdin, cwd = the agent's working directory, MTH_GUARD_ROOT=<main clone> (as run-agent.sh
# exports it). rc=2 = blocked, rc=0 = allowed.
set -u
C="$1"; BASE="$2"
rm -rf "$BASE"; mkdir -p "$BASE"
git clone -q /home/user/My-owns "$BASE/main" && git -C "$BASE/main" checkout -q "$C"
git -C "$BASE/main" worktree add -q --detach "$BASE/wt" "$C"
M="$BASE/main"; W="$BASE/wt"
echo "commit=$(git -C "$M" rev-parse HEAD)  main=$M  worktree=$W"
hook() { # role cwd target [extra env...]
  local role="$1" cwd="$2" tgt="$3"; shift 3
  local cmd; cmd="$(node -e 'const c=require(process.argv[1]);process.stdout.write(c.hooks.PreToolUse[0].hooks[0].command)' "$M/tools/agents/settings/$role.settings.json")"
  local out rc
  out="$(cd "$cwd" && printf '{"tool_name":"Write","tool_input":{"file_path":"%s"}}' "$tgt" | env MTH_GUARD_ROOT="$M" "$@" sh -c "$cmd" 2>&1)"; rc=$?
  echo "rc=$rc role=$role cwd=${cwd#$BASE/} target=${tgt#$BASE/} ${*:+env[$*]} :: ${out:0:220}"
}
FH="$BASE/home"; mkdir -p "$FH/.claude"
echo "== F (F-DG0-135): malformed global git config makes 'git worktree list' fail. Expect rc=2 for EVERY path (fail closed)."
printf '[core\n  this is not valid git config\n' > "$FH/.gitconfig"
( cd "$W" && HOME="$FH" git worktree list >/dev/null 2>&1; echo "   git worktree list with malformed ~/.gitconfig: exit=$?" )
for t in tools/gates/lib/rules.mjs docs/source/playbook.md .claude/settings.local.json tools/agents/write-scopes.json apps/api/in-scope.ts; do
  hook backend-workflow-engineer "$W" "$W/$t" HOME="$FH"
done
hook backend-workflow-engineer "$W" "tools/gates/lib/rules.mjs" HOME="$FH"
hook code-security-reviewer "$W" "$W/tools/gates/lib/rules.mjs" HOME="$FH"
echo "   control: well-formed ~/.gitconfig, worktree protected path (expect 2) and in-scope path (expect 0)"
printf '[user]\n  name = x\n' > "$FH/.gitconfig"
hook backend-workflow-engineer "$W" "$W/tools/gates/lib/rules.mjs" HOME="$FH"
hook backend-workflow-engineer "$W" "$W/apps/api/in-scope.ts" HOME="$FH"
echo "== G (F-DG0-135): git absent from the hook's PATH. Expect rc=2 for every path."
TB="$BASE/bin"; mkdir -p "$TB"; for b in node sh dirname cat env; do ln -sf "$(command -v $b)" "$TB/$b"; done
hook backend-workflow-engineer "$W" "$W/tools/gates/lib/rules.mjs" PATH="$TB"
hook backend-workflow-engineer "$W" "$M/tools/gates/lib/rules.mjs" PATH="$TB"
hook backend-workflow-engineer "$W" "$W/apps/api/in-scope.ts" PATH="$TB"
echo "== G2: MTH_GUARD_ROOT pointing at a directory that is not a git repository (expect 2)"
mkdir -p "$BASE/notrepo/tools/agents" && cp "$M/tools/agents/guard-write.mjs" "$M/tools/agents/write-scopes.json" "$BASE/notrepo/tools/agents/"
( cd "$W" && printf '{"tool_input":{"file_path":"%s"}}' "$BASE/notrepo/apps/x.ts" | MTH_GUARD_ROOT="$BASE/notrepo" node "$BASE/notrepo/tools/agents/guard-write.mjs" backend-workflow-engineer; echo "   rc=$? notrepo in-scope path" )
echo "== E (F-DG0-136): user-level config outside the repository, HOME=$FH (inside /tmp). Expect rc=2 for all roles."
for role in backend-workflow-engineer transformation-analyst code-security-reviewer release-auditor; do
  for t in "$FH/.claude/settings.json" "$FH/.claude/settings.local.json" "$FH/.gitconfig" "$FH/.claude.json" "$FH/.claude/agents/x.md" "$FH/.bashrc" "$FH/.config/git/config"; do
    hook "$role" "$W" "$t" HOME="$FH"
  done
done
echo "== H: symlink inside the scratch area pointing into HOME (lexical = scratch, real = home). Expect rc=2."
mkdir -p "$BASE/scr"; ln -s "$FH/.claude" "$BASE/scr/link-to-claude"; ln -s "$FH" "$BASE/scr/link-to-home"
hook backend-workflow-engineer "$W" "$BASE/scr/link-to-claude/settings.json" HOME="$FH"
hook backend-workflow-engineer "$W" "$BASE/scr/link-to-home/.gitconfig" HOME="$FH"
hook backend-workflow-engineer "$W" "$BASE/scr/link-to-home/new-dir/x" HOME="$FH"
echo "== H2: '..' segments and trailing slash in HOME. Expect rc=2."
hook backend-workflow-engineer "$W" "$BASE/scr/../home/.claude/settings.json" HOME="$FH"
hook backend-workflow-engineer "$W" "$FH/.claude/settings.json" HOME="$FH/"
echo "== H3: HOME given as a symlink to the real home dir. Expect rc=2 for the real path."
ln -s "$FH" "$BASE/homelink"
hook backend-workflow-engineer "$W" "$FH/.claude/settings.json" HOME="$BASE/homelink"
echo "== I: non-temp paths outside the repository. Expect rc=2."
for t in /var/tmp/r11-probe.txt /dev/shm/r11-probe.txt /etc/claude-code/managed-settings.json /etc/gitconfig /usr/local/bin/git /root/.claude/settings.json; do
  hook backend-workflow-engineer "$W" "$t" HOME="$FH"
done
echo "== J: controls that must stay allowed: temp scratch, and in-scope repository files (expect rc=0)"
hook backend-workflow-engineer "$W" "$BASE/scr/notes.txt" HOME="$FH"
hook code-security-reviewer "$M" "$M/docs/delivery/test-evidence/DG0/x.log" HOME="$FH"
hook backend-workflow-engineer "$W" "$W/apps/api/x.ts" HOME="$FH"
