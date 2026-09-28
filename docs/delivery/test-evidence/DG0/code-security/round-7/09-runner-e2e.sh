#!/usr/bin/env bash
# code-security round 7: end-to-end run of the candidate's tools/agents/run-agent.sh with a stub `claude` (fake-claude-r7.py,
# stream-json stdin + replay) in a disposable clone of e11b5f0; each run is then checked with the candidate's own checkInvocation.
# usage: 09-runner-e2e.sh <evidence-dir>
set -u
EV="$(cd "$1" && pwd)"; C=/tmp/dg0-sec-run7; BIN=/tmp/dg0-sec-run7-bin
rm -rf "$C" "$BIN"; git clone -q --no-local /home/user/My-owns "$C"; git -C "$C" checkout -q --detach e11b5f08dfa8b6cbe8716964e3412e17697234aa
git -C "$C" config user.email r@example.invalid; git -C "$C" config user.name sandbox
mkdir -p "$BIN" "$C/docs/delivery/reviews/DG0/round-9"; ln -s "$EV/fake-claude-r7.py" "$BIN/claude"
printf 'seed\n' > "$C/docs/delivery/reviews/DG0/round-9/xy.md"; git -C "$C" add -A; git -C "$C" commit -qm "sandbox fixture"
echo "# clone $C @ $(git -C "$C" rev-parse HEAD) (e11b5f0 + 1 sandbox fixture commit); stub: $EV/fake-claude-r7.py"
REC=docs/delivery/reviews/DG0/round-9/code-security-reviewer.json
for mode in honest denied edit shelledit multiedit glob space outage exit3; do
  echo "== FAKE_MODE=$mode"
  rm -f "$C/$REC"
  fm=$mode; fe=0; [[ $mode == exit3 ]] && { fm=honest; fe=3; }
  A="docs/delivery/assignments/sbx-$mode.md"
  printf 'assignment\n' > "$C/$A"; git -C "$C" add "$A"; git -C "$C" commit -qm "assignment $mode"
  (cd "$C" && PATH="$BIN:$PATH" FAKE_MODE=$fm FAKE_EXIT=$fe FAKE_REC=$REC MTH_RESUME_PAUSE_SECONDS=0 \
     tools/agents/run-agent.sh --role code-security-reviewer --stage DG0 --task "T-SBX-$mode" --assignment "$A")
  echo "runner exit=$?"
  run=$(ls -td "$C"/docs/delivery/runs/DG0/*"T-SBX-$mode-"* | head -1)
  python3 - "$run/meta.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
for k in ("exit_code","is_error","classifier_outage_resumes","written_by_tools","tool_authored"): print(f"  {k}=", m.get(k))
PY
  (cd "$C" && node --input-type=module -e '
    import { checkInvocation } from "./tools/gates/lib/rules.mjs";
    import { readFileSync } from "node:fs";
    const [run, rec, a] = process.argv.slice(1);
    const m = JSON.parse(readFileSync(run + "/meta.json", "utf8"));
    const e1 = []; checkInvocation(".", "DG0", m.invocation_reference, "code-security-reviewer", e1, "run");
    const e2 = []; checkInvocation(".", "DG0", m.invocation_reference, "code-security-reviewer", e2, "run", { assignment: a, outputs: [rec] });
    console.log("  checkInvocation(no binding):", JSON.stringify(e1));
    console.log("  checkInvocation(assignment+output binding):", JSON.stringify(e2));
  ' "$run" "$REC" "$A")
  echo "  transcript replayed prompts: $(gzip -dc "$run/transcript.jsonl.gz" | grep -c '"isReplay": true')"
  echo "  last commit: $(git -C "$C" log -1 --format='%s' | cut -c1-90)"
  git -C "$C" stash -q -u 2>/dev/null; git -C "$C" stash drop -q 2>/dev/null
done
echo "== argument validation / injection"
for a in "--stage DG9" "--stage DG0;id" "--task ../../x" "--task \$(id)" "--role ../x" "--model x;id" "--assignment /etc/passwd"; do
  set -- --role code-security-reviewer --stage DG0 --task T --assignment docs/delivery/assignments/sbx-honest.md
  (cd "$C" && PATH="$BIN:$PATH" tools/agents/run-agent.sh "$@" ${a%% *} "${a#* }" >/dev/null 2>&1); echo "  $a -> exit=$?"
done
echo "== assignment path with shell/JSON metacharacters is passed as data (prompt JSON-encoded by python argv)"
Q='docs/delivery/assignments/q"$(touch PWNED)`id`.md'
printf 'x\n' > "$C/$Q"; git -C "$C" add -A; git -C "$C" commit -qm q
(cd "$C" && PATH="$BIN:$PATH" FAKE_MODE=honest FAKE_REC=$REC MTH_RESUME_PAUSE_SECONDS=0 tools/agents/run-agent.sh --role code-security-reviewer --stage DG0 --task T-SBX-q --assignment "$Q" >/dev/null 2>&1); echo "  runner exit=$?; PWNED created: $( [ -e "$C/PWNED" ] && echo YES || echo no )"
run=$(ls -td "$C"/docs/delivery/runs/DG0/*"T-SBX-q-"* | head -1); gzip -dc "$run/transcript.jsonl.gz" | python3 -c 'import sys,json;[print("  replayed prompt contains literal path:", "q\"$(touch PWNED)`id`.md" in json.loads(l)["message"]["content"]) for l in sys.stdin if "isReplay" in l]'
echo "== session ids unique across runs: $(ls "$C"/docs/delivery/runs/DG0 | grep SBX | sed 's/.*-//' | sort | uniq -d | wc -l) duplicates among $(ls "$C"/docs/delivery/runs/DG0 | grep -c SBX) runs"
