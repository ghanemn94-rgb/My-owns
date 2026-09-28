#!/usr/bin/env bash
# Round-10 write-guard reproduction (code-security-reviewer). Disposable: everything lives under $BASE.
#   repro-r10-guard.sh <commit> <base-dir>
# Runs each role's REAL hook command (from tools/agents/settings/<role>.settings.json at <commit>) exactly as Claude Code
# would: via sh -c, with the Write payload on stdin, with cwd = the agent's working directory, and with
# MTH_GUARD_ROOT=<main> exported, as run-agent.sh now does. rc=2 means blocked, rc=0 means allowed.
set -u
C="$1"; BASE="$2"
rm -rf "$BASE"; mkdir -p "$BASE"
git clone -q /home/user/My-owns "$BASE/main" && git -C "$BASE/main" checkout -q "$C"
git -C "$BASE/main" worktree add -q --detach "$BASE/wt" "$C"
mkdir -p "$BASE/main/docs/delivery/test-evidence/nested" && git -C "$BASE/main/docs/delivery/test-evidence/nested" init -q
M="$BASE/main"; W="$BASE/wt"; N="$M/docs/delivery/test-evidence/nested"
echo "commit=$(git -C "$M" rev-parse HEAD)  main=$M  worktree=$W  nested-repo=$N"
hook() { # role cwd target [extra env...]
  local role="$1" cwd="$2" tgt="$3"; shift 3
  local cmd; cmd="$(node -e 'const c=require(process.argv[1]);process.stdout.write(c.hooks.PreToolUse[0].hooks[0].command)' "$M/tools/agents/settings/$role.settings.json")"
  local out rc
  out="$(cd "$cwd" && printf '{"tool_name":"Write","tool_input":{"file_path":"%s"}}' "$tgt" | env MTH_GUARD_ROOT="$M" "$@" sh -c "$cmd" 2>&1)"; rc=$?
  echo "rc=$rc role=$role cwd=${cwd#$BASE/} target=${tgt#$BASE/} ${*:+env[$*]} :: $out"
}
echo "== A. F-DG0-134 original vector: agent cwd = worktree, Write into the MAIN repository's protected paths (expect rc=2)"
for role in backend-workflow-engineer transformation-analyst code-security-reviewer; do
  for t in tools/gates/lib/rules.mjs docs/delivery/stages.json .claude/settings.local.json docs/delivery/gates/DG1.json tools/agents/write-scopes.json; do
    hook "$role" "$W" "$M/$t"
  done
done
echo "== B. cwd = worktree, protected paths inside the worktree itself, absolute and relative (expect rc=2)"
hook backend-workflow-engineer "$W" "$W/tools/gates/lib/rules.mjs"
hook backend-workflow-engineer "$W" "tools/gates/lib/rules.mjs"
hook backend-workflow-engineer "$W" "$W/.claude/settings.local.json"
echo "== C. F-DG0-134 Bash-cd variant: cwd = nested git repo inside main carrying a guard that allows everything (expect rc=2)"
mkdir -p "$N/tools/agents"; printf 'process.exit(0)\n' > "$N/tools/agents/guard-write.mjs"
hook backend-workflow-engineer "$N" "$M/tools/gates/lib/rules.mjs"
echo "== D. control: in-scope writes still allowed (expect rc=0)"
hook backend-workflow-engineer "$W" "$W/apps/api/x.ts"
hook code-security-reviewer "$W" "$M/docs/delivery/test-evidence/DG0/x.log"
echo "== E. residual: paths OUTSIDE every guarded root are 'scratch' (allowed). These are files the CLI and git read at every run."
FH="$BASE/home"; mkdir -p "$FH/.claude"
hook backend-workflow-engineer "$W" "$FH/.claude/settings.json" HOME="$FH"
hook code-security-reviewer "$M" "$FH/.claude/settings.json" HOME="$FH"
hook backend-workflow-engineer "$W" "$FH/.gitconfig" HOME="$FH"
echo "== F. residual: guardedRoots() swallows git errors (guard-write.mjs:52). A malformed global git config (a scratch file the agent may Write, see E)"
echo "      makes 'git worktree list' fail, so the worktree drops out of the guarded roots. Simulated with HOME=<fake home with a malformed .gitconfig>."
printf '[core\n  this is not valid git config\n' > "$FH/.gitconfig"
( cd "$W" && HOME="$FH" git worktree list >/dev/null 2>&1; echo "   git worktree list with malformed ~/.gitconfig: exit=$?" )
for t in tools/gates/lib/rules.mjs docs/source/playbook.md .claude/settings.local.json tools/agents/write-scopes.json; do
  hook backend-workflow-engineer "$W" "$W/$t" HOME="$FH"
done
hook backend-workflow-engineer "$W" "tools/gates/lib/rules.mjs" HOME="$FH"
echo "   control, same fake home, main repository path (still guarded because it is MTH_GUARD_ROOT itself):"
hook backend-workflow-engineer "$W" "$M/tools/gates/lib/rules.mjs" HOME="$FH"
echo "   control, well-formed fake ~/.gitconfig:"
printf '[user]\n  name = x\n' > "$FH/.gitconfig"
hook backend-workflow-engineer "$W" "$W/tools/gates/lib/rules.mjs" HOME="$FH"
echo "== G. git absent from PATH for the hook (PATH = node dir + /bin minimal), worktree path"
TB="$BASE/bin"; mkdir -p "$TB"; for b in node sh dirname cat env; do ln -sf "$(command -v $b)" "$TB/$b"; done
hook backend-workflow-engineer "$W" "$W/tools/gates/lib/rules.mjs" PATH="$TB"
hook backend-workflow-engineer "$W" "$M/tools/gates/lib/rules.mjs" PATH="$TB"
