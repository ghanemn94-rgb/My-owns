#!/usr/bin/env bash
# T-DG6-FE-Z1B: writes budget-table.txt from the loaded e2e logs. Run from the repository root.
set -u
E=docs/delivery/handbacks/DG6/T-DG6-FE-Z1-evidence; R=docs/delivery/test-evidence/DG6/qa/round-2
LOGS=$(ls $R/05*.log $R/06*.log $R/07*.log $E/run1-*-chromium-*.log $E/z1b-snapshot-*-chromium-*.log $E/z1b-root-*.log $E/z1b-demo-*.log 2>/dev/null | grep -v -- '-samples.log')
{
  echo "# F-DG6-144 budget table (T-DG6-FE-Z1 / T-DG6-FE-Z1B), generated $(date -u +%FT%TZ) by tools/budget-table.sh"
  echo "# One row per test (spec, source line of its test( call): its effective budget and where it is set (default/"
  echo "# file:N/configure:N/test:N), the worst loaded duration over ALL logs below (a timeout counts as its budget, a lower"
  echo "# bound), the number of samples, and after '|' the worst/samples/failures in T-DG6-FE-Z1's own loaded runs (run1 = the"
  echo "# interrupted first run, z1b = this continuation). '<-- UNDER 2x' marks a row whose budget is below 2x that worst or that"
  echo "# failed in any log; each such row is explained in the handback."
  echo "# logs:"; for l in $LOGS; do echo "#   $l"; done
  python3 $E/tools/durations.py $LOGS
  echo "# rows: $(python3 $E/tools/durations.py $LOGS | wc -l); on the default 30 s: $(python3 $E/tools/durations.py $LOGS | grep -c ' default ')"
} > $E/budget-table.txt
grep -c UNDER $E/budget-table.txt
