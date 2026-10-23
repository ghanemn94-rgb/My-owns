#!/usr/bin/env bash
# qa-verifier DG5 round 1: disk guard for the shared 4 GB scratch volume. Playwright keeps every context's raw trace
# recording under <output>/.playwright-artifacts-N/traces until the worker exits (trace: retain-on-failure). Recordings
# untouched for 15 min belong to closed contexts of finished tests (no test here runs longer than 600 s), so they are
# deleted. A failing test's retained trace is copied to its own test-results folder at test end, which is not touched.
# Runs until $TMPDIR/prune.stop exists; logs each pass to $E/06-prune-traces.log.
E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-1
while [ ! -f $TMPDIR/prune.stop ]; do
  n=$(find $TMPDIR/pw-*/.playwright-artifacts-*/traces -type f -mmin +15 2>/dev/null | wc -l)
  find $TMPDIR/pw-*/.playwright-artifacts-*/traces -type f -mmin +15 -delete 2>/dev/null
  echo "$(date -u +%T) pruned=$n free=$(df -h $TMPDIR | tail -1 | awk '{print $4}')" >> $E/06-prune-traces.log
  sleep 120
done
