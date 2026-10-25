#!/usr/bin/env bash
# qa-verifier DG5 round 3: disk guard for the shared shared scratch volume. Playwright keeps every context's raw trace
# recording under <output>/.playwright-artifacts-N/traces until the worker exits (trace: retain-on-failure). Recordings
# untouched for PRUNE_MIN (default 15) min belong to closed contexts of finished tests (no test here runs longer than 600 s), so they are
# deleted. A failing test's retained trace is copied to its own test-results folder at test end, which is not touched.
# Runs until $TMPDIR/prune.stop exists; logs each pass to $E/06-prune-traces.log.
E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3
while [ ! -f $TMPDIR/prune.stop ]; do
  # PRUNE_BELOW_KB (optional): prune only while the free space is below this many KiB (added after the 00:54Z
  # incident, see RUN-NOTES.md: a 6-minute age could also remove trace resources shared with a running test).
  if [ -n "${PRUNE_BELOW_KB:-}" ] && [ "$(df -k --output=avail $TMPDIR | tail -1)" -ge "$PRUNE_BELOW_KB" ]; then
    echo "$(date -u +%T) skipped (free=$(df -h $TMPDIR | tail -1 | awk '{print $4}'))" >> $E/06-prune-traces.log; sleep 120; continue; fi
  n=$(find $TMPDIR/pw-*/.playwright-artifacts-*/traces -type f -mmin +${PRUNE_MIN:-15} 2>/dev/null | wc -l)
  find $TMPDIR/pw-*/.playwright-artifacts-*/traces -type f -mmin +${PRUNE_MIN:-15} -delete 2>/dev/null
  echo "$(date -u +%T) pruned=$n free=$(df -h $TMPDIR | tail -1 | awk '{print $4}')" >> $E/06-prune-traces.log
  sleep 120
done
