# W14 merged-tree verification (`d72976c`) and the "Define → G2" A/B (D-111)

- `summary.txt` gives the exit code of each step of `verify-tree.sh`. The run used the dedicated tree `/home/user/wt/verify` at detached `d72976c`.
- `e2e-unset-run1-under-load.log`: 230 passed, 4 failed. Each failure is a 30 s test timeout. Four agents were running at the time, with a load average of 14–17.
- `e2e-specs-rerun.log`: the three failing specs re-run: 46 passed, 2 failed ("Define → G2" in both languages).
- `ab-g2/ab.log`: the A/B. `97e16dd` and `d72976c` were built alternately in the dedicated tree, and `apps/web/e2e/p2-journeys.spec.ts` was run alone in chromium-en (`ab-g2/ab.sh`).
- `ab-g2/ab-run1-invalid.log`: a first attempt, kept but not used. It ran the one serial test with `-g` and no preceding steps, so the journey started with an empty transformation id. The test was therefore not measured.
