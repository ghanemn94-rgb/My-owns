# qa-verifier DG5 round 5: probe screenshots and measurements

Every probe's JSON measurements are kept in full (r5-*.json, r3-diag-diagnose.json, r3-reg.json, r4-*.json, r5-kbd.json).
Screenshots were pruned to save repository space (536 -> 38 PNG files). Kept:
- probe-r5forms-rev2-unset: every 390 px screenshot (F-DG5-146 surfaces and R5-TITLE), en and ar;
- probe-r3diag-unset: the F-DG5-144 reproduction screenshots (390 px and 200 %), en and ar;
- probe-r4reflow-unset: the 390 px screenshots (Diagnose with every workstream filled, 409 banner on page and in a dialog);
- probe-r3regions-run2-cutf8: the Diagnose screen at 390 px, en and ar.
The deleted screenshots are of the same screens in the other runs and sizes; their numbers are in the JSON files and logs.
Product-suite screenshots stayed in scratch ($TMPDIR/shots, D-162); only their axe summaries are aggregated (../05-axe-summaries.txt).
