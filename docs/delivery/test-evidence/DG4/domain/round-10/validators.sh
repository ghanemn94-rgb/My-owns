#!/usr/bin/env bash
# domain-reviewer DG4 round 10: validators in the clone at the freeze commit 01a801e (= source e70ac02 + assignments,
# manifest, stages.json) and on the repository working tree (HEAD 01a801e).
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:/usr/bin:/bin
v() { echo "### [$1] node tools/gates/validate.mjs ${*:2}  ($(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg))"; node tools/gates/validate.mjs "${@:2}" 2>&1 | tail -15; echo "### exit=${PIPESTATUS[0]}"; }
cd "$TMPDIR/review-r10"; git checkout -q 01a801e5fe03683a4ba8f33e42af3d9e03f2ba40; echo "### clone HEAD $(git rev-parse HEAD)"
for a in "--historical --stage DG3" "--historical --stage DG2" "--historical --stage DG1" "--register DG4" "--pipeline"; do v clone $a; done
git checkout -q e70ac02f63cd1f42487cfa4dae73f68e933da015
cd /home/user/My-owns; echo "### repo HEAD $(git rev-parse HEAD)"
for a in "--historical --stage DG3" "--register DG4" "--pipeline"; do v worktree $a; done
