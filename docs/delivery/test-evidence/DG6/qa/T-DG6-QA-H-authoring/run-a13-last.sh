#!/usr/bin/env bash
# qa-verifier T-DG6-QA-H: the root e2e set with e2e/a13-automation-recovery.spec.ts moved LAST, on ONE stack: first
# every other root spec (a02-* excluded: demo stack) in chromium-en then chromium-ar, then A13 in chromium-en and
# chromium-ar, so A13 inherits the backlog of the whole set. Run inside apps/web/e2e/support/with-stack.sh from the
# repository root. Exit 0 only when both invocations pass.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Each part runs through run-full-monitored.sh (the queue monitor; MONLOG must be set).
mapfile -t REST < <(ls e2e/*.spec.ts | grep -v /a02- | grep -v /a13-automation-recovery.spec.ts)
echo "=== part 1: ${#REST[@]} files without A13 start $(date -u +%FT%TZ)"
OUTD="$TMPDIR/a13-last-out/rest" "$HERE/run-full-monitored.sh" "${REST[@]}"
R1=$?
echo "=== part 1 exit=$R1 $(date -u +%FT%TZ)"
echo "=== part 2: A13 last start $(date -u +%FT%TZ)"
OUTD="$TMPDIR/a13-last-out/a13" "$HERE/run-full-monitored.sh" e2e/a13-automation-recovery.spec.ts
R2=$?
echo "=== part 2 exit=$R2 $(date -u +%FT%TZ)"
[ "$R1" -eq 0 ] && [ "$R2" -eq 0 ]
