#!/usr/bin/env bash
# code-security-reviewer DG4 round 3: honesty scan of every harness log (DG2 round-10 audit condition 1): per log the
# Vitest totals, failed (×) and skipped (↓) test lines, hook timeouts, and error-looking lines, so each one is disclosed.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-3
for f in "$@"; do
  l=$EV/$f
  echo "== $f  $(tail -1 $l)"
  grep -aE '^\s+(Test Files|Tests)\s' $l | sed 's/^/   /'
  echo "   failed-lines: $(grep -acE '^\s*(×|✗)' $l)  skipped-lines: $(grep -acE '^\s*↓' $l)  hook-timeouts: $(grep -aci 'hook timed out' $l)  FAIL-lines: $(grep -acE '^\s*FAIL\s' $l)"
  grep -aE '^\s*(×|✗|↓)' $l | head -10 | sed 's/^/   ! /'
  echo "   error-like lines (ERR!, Unhandled, Error: outside passing tests; first 8):"
  grep -anE 'ERR!|Unhandled|^Error:|^\s*Error:|ELIFECYCLE|Command failed' $l | head -8 | cut -c1-220 | sed 's/^/     /'
done
