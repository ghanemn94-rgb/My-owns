#!/usr/bin/env bash
# code-security-reviewer DG4 round 7: static scans in the disposable clone $TMPDIR/probe2 (ea5e262; product tree == dab4562).
# diff-scan.sh (D0-D17), the commit-time re-check scanner commit-scan6.py (unchanged from round 5, used in round 6) over the P4 file list,
# the API module graph (module-cycles.mjs), web import cycles (web-cycles.mjs), and worker isolation.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-7; R5=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-6
cd $TMPDIR/probe2 || exit 2; export PATH=/opt/node22/bin:$PATH; H=$(git rev-parse HEAD)
bash $EV/diff-scan.sh > $EV/diff-scan.log 2>&1
git diff --name-only d3e6fe6..dab4562 -- apps packages > $EV/p4-source-files.txt
{ echo "# python3 commit-scan6.py p4-source-files.txt (scanner unchanged from round 5, used in round 6; file list = git diff --name-only d3e6fe6..dab4562 -- apps packages) in \$TMPDIR/probe2 at $H"; python3 $EV/probes/commit-scan6.py $EV/p4-source-files.txt; echo "# exit_status: $?"; } > $EV/commit-time-scan.log 2>&1
{ echo "# diff of the residual list against round 6 (expected empty: the round-6 repairs touch only apps/worker and packages/config, outside the API route scan)"; diff <(grep -E '^\s+apps/' $R5/commit-time-scan.log) <(grep -E '^\s+apps/' $EV/commit-time-scan.log); echo "# diff exit_status: $?"; } > $EV/commit-time-scan-vs-r6.log
{ echo "# node module-cycles.mjs \$TMPDIR/probe2 at $H"; node $EV/probes/module-cycles.mjs $TMPDIR/probe2; echo "# exit_status: $?"; } > $EV/api-module-graph.log 2>&1
{ echo "# node web-cycles.mjs \$TMPDIR/probe2 at $H"; node $EV/probes/web-cycles.mjs $TMPDIR/probe2; echo "# exit_status: $?"; } > $EV/web-cycles.log 2>&1
{ echo "# worker import isolation at $H: import/require lines in apps/worker/src naming apps/api or @mth/api (expected none)"; echo "# matches: $(grep -rnE "(from|require\()\s*['\"](@mth/api|[./]*apps/api|(\.\./)+api/)" apps/worker/src | wc -l)"; grep -rnE "(from|require\()\s*['\"](@mth/api|[./]*apps/api|(\.\./)+api/)" apps/worker/src; echo "# worker package.json deps:"; node -e "const p=require('./apps/worker/package.json');console.log(Object.keys({...p.dependencies,...p.devDependencies}).join(' '))"; } > $EV/worker-isolation.log 2>&1
echo "# git status after scans: '$(git status --porcelain)'" >> $EV/diff-scan.log
