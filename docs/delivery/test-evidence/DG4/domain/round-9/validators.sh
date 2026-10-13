#!/usr/bin/env bash
# domain-reviewer DG4 round 9: validators in the clone (at the freeze commit 01ad2e1 = source f2ae717 + assignments/manifest/stages.json) and on the repo working tree.
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:/usr/bin:/bin
v() { echo "### [$1] node tools/gates/validate.mjs ${*:2}"; node tools/gates/validate.mjs "${@:2}" 2>&1 | tail -15; echo "### exit=${PIPESTATUS[0]}"; }
cd "$TMPDIR/review-r9"; git checkout -q 01ad2e185962ebec0bbf541503c09ae4075eeec6; echo "### clone HEAD $(git rev-parse HEAD)"
for a in "--historical --stage DG3" "--historical --stage DG2" "--historical --stage DG1" "--register DG4" "--pipeline"; do v clone $a; done
git checkout -q f2ae7170630456a772e1ceac90ab6d96b68e3f5c
cd /home/user/My-owns; echo "### repo HEAD $(git rev-parse HEAD)"
for a in "--historical --stage DG3" "--register DG4" "--pipeline"; do v worktree $a; done
