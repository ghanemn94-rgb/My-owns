#!/bin/bash
# F-DG7-956: the fixed check-handover test on the candidate (normal and MTH_STRICT_HANDOVER=1), then revert-to-fail:
# the pre-fix test (16b2bdd35^) as a sibling file in the disposable clone, which must fail the 4 pinned-report tests.
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-2
cd $TMPDIR/rv
export MTH_PNPM_STORE=$TMPDIR/pstore/v10
{
echo "# $(date -u +%FT%TZ) F-DG7-956 (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD))"
echo "== A. candidate test file: node --test tools/release/tests/check-handover.test.mjs"
node --test tools/release/tests/check-handover.test.mjs 2>&1 | grep -E "^not ok|^# |^ℹ|✖" ; echo "exit=${PIPESTATUS[0]}"
echo "== B. candidate test file with MTH_STRICT_HANDOVER=1"
MTH_STRICT_HANDOVER=1 node --test tools/release/tests/check-handover.test.mjs 2>&1 | grep -E "^ℹ|✖" ; echo "exit=${PIPESTATUS[0]}"
echo "== C. revert-to-fail: pre-fix test (git show 16b2bdd35^:tools/release/tests/check-handover.test.mjs) as tools/release/tests/zz-prefix-check-handover.test.mjs"
git show 16b2bdd35^:tools/release/tests/check-handover.test.mjs > tools/release/tests/zz-prefix-check-handover.test.mjs
grep -n "const REPORT" tools/release/tests/zz-prefix-check-handover.test.mjs
ls -l docs/delivery/handbacks/DG7/T-DG7-DO-I-evidence/protocol-audit-all.json
node --test tools/release/tests/zz-prefix-check-handover.test.mjs 2>&1 | grep -E "^ℹ|✖" ; echo "exit=${PIPESTATUS[0]} (expected non-zero: 4 tests pinned to the superseded DO-I report)"
rm -f tools/release/tests/zz-prefix-check-handover.test.mjs; git status --short | head
echo "== D. direct: known-limitations --check with each report"
node tools/release/known-limitations.mjs --protocol-audit docs/delivery/handbacks/DG7/T-DG7-DO-I-evidence/protocol-audit-all.json --check 2>&1 | tail -2; echo "exit=$? (DO-I report; expected 1)"
node tools/release/known-limitations.mjs --protocol-audit docs/delivery/test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-prefreeze.json --check 2>&1 | tail -2; echo "exit=$? (pre-freeze report; expected 0)"
echo "== E. check-handover with the pre-freeze report"
node tools/release/check-handover.mjs --protocol-audit docs/delivery/test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-prefreeze.json 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
echo "# end $(date -u +%FT%TZ)"
} > $E/21-f956-check-handover.log 2>&1
