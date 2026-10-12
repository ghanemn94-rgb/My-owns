#!/usr/bin/env bash
# code-security-reviewer DG4 round 6: follow-up mutation M4 to probe-y1c.sh (M2 survived). M4 removes ALL three window
# restarts and the single flight in apps/web/src/api/client.ts (probe clone only): startSessionCheck's single flight and
# lastMeAt stamp, the sessionProbe stamp in apiRequest, and the /me answer stamp at line ~150. Reverted afterwards.
cd $TMPDIR/probe || exit 2; export PATH=/opt/node22/bin:$PATH
C=apps/web/src/api/client.ts; SPEC=apps/web/src/auth/session-bound.test.tsx; cp $C $TMPDIR/client.orig
python3 - $C <<'PY'
import sys;p=sys.argv[1];s=open(p).read()
for a,b in [("  if (pendingCheck) return pendingCheck;\n  lastMeAt = Date.now(); // bounded","  // M4\n  // bounded"),
            ("  if (options.sessionProbe) {\n    lastMeAt = Date.now();\n  } else","  if (options.sessionProbe) {\n    // M4\n  } else"),
            ("  lastMeAt = Date.now(); // F-DG2-570: the identity was just confirmed","  // M4 F-DG2-570")]:
    assert a in s,a; s=s.replace(a,b,1)
open(p,'w').write(s)
PY
echo "## M4 no window restart at all, no single flight"; git diff --stat -- $C | tail -1
pnpm exec vitest run --project unit-web $SPEC -t 'Y1c' 2>&1 | grep -aE '✓|×|Tests |AssertionError|expected' | head -20; echo "# exit_status: ${PIPESTATUS[0]}"
cp $TMPDIR/client.orig $C; echo "# git status after probe: '$(git status --porcelain)'"
