#!/usr/bin/env bash
# qa-verifier r7 (T-DG5-REV-QA-R7C): copy every axe-summary*.json that the full-suite runs write into $TMPDIR/shots/<run>/<lang>/
# to the evidence dir (axe/<run>/<lang>/) every 20 s, because run-e2e.sh deletes the full-suite screenshot dir after
# the run (disk is tight). Stops at $TMPDIR/axe-keeper.stop or after $1 seconds.
E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-7; END=$(( $(date +%s) + ${1:-7000} ))
while [ ! -f $TMPDIR/axe-keeper.stop ] && [ $(date +%s) -lt $END ]; do
  for f in $TMPDIR/shots/*/*/axe-summary*.json; do [ -f "$f" ] || continue
    rel=${f#$TMPDIR/shots/}; mkdir -p "$E/axe/$(dirname $rel)"; cp -u "$f" "$E/axe/$rel"; done
  sleep 20
done
