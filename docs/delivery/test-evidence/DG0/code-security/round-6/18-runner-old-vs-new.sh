#!/usr/bin/env bash
# code-security round 6: parameterised copy of 08-runner-e2e.sh (COMMIT=<rev>, MODES="..."; extra mode lockfail = a held .git/index.lock so the auto-commit fails).
# (fake-claude-r6.py) in a disposable clone of a059b55. usage: 08-runner-e2e.sh <evidence-dir>
set -u
EV="$(cd "$1" && pwd)"; COMMIT="${COMMIT:-a059b55}"; C=/tmp/dg0-sec-run6-$COMMIT; BIN=/tmp/dg0-sec-run6-bin-$COMMIT
rm -rf "$C" "$BIN"; git clone -q --no-local /home/user/My-owns "$C"; git -C "$C" checkout -q --detach "$COMMIT"
git -C "$C" config user.email r@example.invalid; git -C "$C" config user.name sandbox
mkdir -p "$BIN" "$C/docs/delivery/reviews/DG0/round-9"; ln -s "$EV/fake-claude-r6.py" "$BIN/claude"
printf 'seed\n' > "$C/docs/delivery/reviews/DG0/round-9/xy.md"; git -C "$C" add -A; git -C "$C" commit -qm "sandbox fixture"
echo "# clone $C @ $(git -C "$C" rev-parse HEAD) ($COMMIT + 1 sandbox fixture commit); stub: $EV/fake-claude-r6.py"
REC=docs/delivery/reviews/DG0/round-9/code-security-reviewer.json
for mode in ${MODES:-honest denied glob edit shelledit space editonly strmsg outage multiedit symlink exit3}; do
  echo "== FAKE_MODE=$mode"
  rm -f "$C/$REC"
  fm=$mode; fe=0; [[ $mode == exit3 ]] && { fm=honest; fe=3; }
  printf 'assignment\n' > "$C/docs/delivery/assignments/sbx-$mode.md"; git -C "$C" add "docs/delivery/assignments/sbx-$mode.md"; git -C "$C" commit -qm "assignment $mode"
  [[ $mode == lockfail ]] && { fm=honest; touch "$C/.git/index.lock"; }
  (cd "$C" && PATH="$BIN:$PATH" FAKE_MODE=$fm FAKE_EXIT=$fe FAKE_REC=$REC MTH_RESUME_PAUSE_SECONDS=0 \
     tools/agents/run-agent.sh --role code-security-reviewer --stage DG0 --task "T-SBX-$mode" --assignment "docs/delivery/assignments/sbx-$mode.md")
  echo "runner exit=$?"; rm -f "$C/.git/index.lock"
  run=$(ls -td "$C"/docs/delivery/runs/DG0/*"T-SBX-$mode-"* | head -1)
  python3 - "$run/meta.json" <<'PY'
import json,sys
try: m=json.load(open(sys.argv[1]))
except Exception as e: print("meta.json:", e); sys.exit()
for k in ("exit_code","is_error","subtype","classifier_outage_resumes","outputs","written_by_tools","tool_authored"): print(f"{k}=", m.get(k))
print("session ids consistent:", m["invocation_reference"]["session_id"]==m.get("result_session_id"))
PY
  ls -a "$run" | tr '\n' ' '; echo
  echo "last commit:"; git -C "$C" log -1 --format='  %s' --name-status | sed 's/^/  /'
  echo "status after:"; git -C "$C" status --porcelain | sed 's/^/  /'
  git -C "$C" stash -q -u 2>/dev/null; git -C "$C" stash drop -q 2>/dev/null
done
echo "== argument validation"
for a in "--stage DG9" "--stage DG0;id" "--task ../../x" "--role ../x" "--model x;id" "--assignment /etc/passwd"; do
  set -- --role code-security-reviewer --stage DG0 --task T --assignment docs/delivery/assignments/sbx-honest.md
  [[ $mode == lockfail ]] && { fm=honest; touch "$C/.git/index.lock"; }
  (cd "$C" && PATH="$BIN:$PATH" tools/agents/run-agent.sh "$@" ${a%% *} "${a#* }" >/dev/null 2>&1); echo "  $a -> exit=$?"
done

# NOTE (reviewer): the sed that added the lockfail mode also inserted its line into the argument-validation loop (line 37), where $mode is still "lockfail",
# so a stale .git/index.lock was present during those six calls. They are rejected before any git write (exit 64/66), so the result is unaffected; 08-runner-e2e.log has the same six cases without the lock.
