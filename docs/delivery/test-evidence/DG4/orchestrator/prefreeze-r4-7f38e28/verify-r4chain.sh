#!/bin/bash
# Pre-freeze verification for DG4 round 4 on 7f38e28, no agent running: e2e (unset, C.UTF-8), root acceptance specs, then the tree checks.
/tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg4/verify-e2e.sh /tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg4/prefreeze-r4-7f38e28 24500 7f38e28
cd /home/user/wt/verify; export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
{ echo "e2e-cutf8 start $(date -u +%T) load $(cut -d' ' -f1 /proc/loadavg)"
LANG=C.UTF-8 LC_ALL=C.UTF-8 QA_PG_PORT=24550 E2E_API_PORT=24551 MTH_PORT_POOL=24552-24590 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1 > /tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg4/prefreeze-r4-7f38e28/e2e-cutf8.log 2>&1; echo "e2e-cutf8 $?"
env -u LANG -u LC_ALL -u LC_CTYPE QA_PG_PORT=24550 E2E_API_PORT=24551 MTH_PORT_POOL=24552-24590 apps/web/e2e/support/with-stack.sh npx playwright test $(ls e2e/*.spec.ts) --workers=1 > /tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg4/prefreeze-r4-7f38e28/e2e-root.log 2>&1; echo "e2e-root $?"
echo "e2e end $(date -u +%T) load $(cut -d' ' -f1 /proc/loadavg)"; } > /tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg4/prefreeze-r4-7f38e28/extra-summary.txt 2>&1
/tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg4/verify-tree.sh /tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg4/prefreeze-r4-7f38e28 24500 0 7f38e28
cd /home/user/wt/verify; { pnpm check:no-cdn > /tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg4/prefreeze-r4-7f38e28/no-cdn.log 2>&1; echo "no-cdn $?"; } >> /tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg4/prefreeze-r4-7f38e28/summary.txt
touch /tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg4/prefreeze-r4-7f38e28/ALLDONE
