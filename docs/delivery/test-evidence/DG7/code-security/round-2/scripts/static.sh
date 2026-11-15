#!/bin/bash
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-2
cd $TMPDIR/rv
hdr() { echo "# $(date -u +%FT%TZ) $1 (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), load $(cut -d' ' -f1-3 /proc/loadavg))"; }
{ hdr "pnpm -r typecheck"; pnpm -r typecheck 2>&1 | tail -30; echo "exit=${PIPESTATUS[0]}"; } > $E/04-typecheck.log
{ hdr "pnpm lint"; pnpm lint 2>&1 | tail -30; echo "exit=${PIPESTATUS[0]}"; } > $E/05-lint.log
{ hdr "pnpm openapi:lint"; pnpm openapi:lint 2>&1 | tail -20; echo "exit=${PIPESTATUS[0]}"; } > $E/06-openapi-lint.log
{ hdr "pnpm check:no-cdn"; pnpm check:no-cdn 2>&1 | tail -20; echo "exit=${PIPESTATUS[0]}"; } > $E/07-no-cdn.log
{ hdr "pnpm test (unit projects)"; pnpm test 2>&1 | grep -v "^ *✓" | tail -60; echo "exit=${PIPESTATUS[0]}"; } > $E/08-unit.log
echo STATIC-DONE >> $E/08-unit.log
