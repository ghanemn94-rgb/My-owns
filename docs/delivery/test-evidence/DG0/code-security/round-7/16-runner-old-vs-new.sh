#!/usr/bin/env bash
# code-security round 7: runner old-vs-new for F-DG0-108/119/120 (COMMIT=<rev>). Stub fake-claude-r7.py accepts both the old argv prompt
# and the new stream-json stdin prompt. Prints meta outputs/tool_authored and the auto-commit's file list.
set -u
EV="$(cd "$1" && pwd)"; COMMIT="${COMMIT:?}"; C=/tmp/dg0-sec-run7-$COMMIT; BIN=/tmp/dg0-sec-run7-bin-$COMMIT
rm -rf "$C" "$BIN"; git clone -q --no-local /home/user/My-owns "$C"; git -C "$C" checkout -q --detach "$COMMIT"
git -C "$C" config user.email r@example.invalid; git -C "$C" config user.name sandbox
mkdir -p "$BIN" "$C/docs/delivery/reviews/DG0/round-9"; ln -s "$EV/fake-claude-r7.py" "$BIN/claude"
printf 'seed\n' > "$C/docs/delivery/reviews/DG0/round-9/xy.md"; git -C "$C" add -A; git -C "$C" commit -qm "sandbox fixture"
echo "# clone $C @ $(git -C "$C" rev-parse HEAD) ($COMMIT + 1 sandbox fixture commit)"
REC=docs/delivery/reviews/DG0/round-9/code-security-reviewer.json
for mode in glob denied shelledit lockfail; do
  echo "== FAKE_MODE=$mode"
  rm -f "$C/$REC"; fm=$mode
  A="docs/delivery/assignments/sbx-$mode.md"; printf 'assignment\n' > "$C/$A"; git -C "$C" add "$A"; git -C "$C" commit -qm "assignment $mode"
  [[ $mode == lockfail ]] && { fm=honest; touch "$C/.git/index.lock"; }
  (cd "$C" && PATH="$BIN:$PATH" FAKE_MODE=$fm FAKE_REC=$REC MTH_RESUME_PAUSE_SECONDS=0 \
     tools/agents/run-agent.sh --role code-security-reviewer --stage DG0 --task "T-SBX-$mode" --assignment "$A" >/dev/null 2>"$C/.err")
  echo "  runner exit=$?  stderr tail: $(tail -1 "$C/.err" | cut -c1-140)"; rm -f "$C/.git/index.lock" "$C/.err"
  run=$(ls -td "$C"/docs/delivery/runs/DG0/*"T-SBX-$mode-"* | head -1)
  python3 -c 'import json,sys;m=json.load(open(sys.argv[1]));print("  outputs=",sorted(m.get("outputs",{})));print("  tool_authored=",sorted(m.get("tool_authored",{})) if "tool_authored" in m else "(field absent)")' "$run/meta.json"
  echo "  last commit files (excluding the run dir):"; git -C "$C" log -1 --format= --name-status | grep -v "docs/delivery/runs/" | sed 's/^/    /'
  git -C "$C" stash -q -u 2>/dev/null; git -C "$C" stash drop -q 2>/dev/null
done
echo "== argument validation"
for a in "--stage DG0;id" "--task ../../x" "--role ../x"; do
  (cd "$C" && PATH="$BIN:$PATH" FAKE_MODE=honest FAKE_REC=$REC tools/agents/run-agent.sh --role code-security-reviewer --stage DG0 --task T --assignment docs/delivery/assignments/sbx-glob.md ${a%% *} "${a#* }" >/dev/null 2>&1); echo "  $a -> exit=$?"
done
echo "  run dirs created with ';' or '..' in name: $(find "$C/docs/delivery/runs" -maxdepth 2 \( -name '*;*' -o -name '*..*' \) 2>/dev/null | wc -l)"
