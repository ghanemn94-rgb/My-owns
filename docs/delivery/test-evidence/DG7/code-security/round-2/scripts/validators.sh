#!/bin/bash
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-2
cd /home/user/My-owns
{
echo "# $(date -u +%FT%TZ) validators on the live repository (read-only), HEAD $(git rev-parse --short=9 HEAD), Node $(node -v)"
for s in DG6 DG5 DG4 DG3 DG2 DG1; do echo "== validate.mjs --historical --stage $s"; node tools/gates/validate.mjs --historical --stage $s 2>&1 | tail -3; echo "exit=${PIPESTATUS[0]}"; done
echo "== validate.mjs --pipeline"; node tools/gates/validate.mjs --pipeline 2>&1 | tail -3; echo "exit=${PIPESTATUS[0]}"
echo "# end $(date -u +%FT%TZ)"
} > $E/40-validators.log 2>&1
