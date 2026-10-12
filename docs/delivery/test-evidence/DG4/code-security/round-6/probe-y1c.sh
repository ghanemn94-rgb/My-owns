#!/usr/bin/env bash
# code-security-reviewer DG4 round 6 (T-DG4-REV-SEC-R6): verification of F-DG4-106 on candidate f966fe57 (source 1e0dc5d).
# Runs in the disposable probe clone $TMPDIR/probe (0e499f2) ONLY; every file change below is made there and reverted.
# Part A: the round-5 probe probes/sec-dg4-r5-y1c-timing.append.tsx (UNCHANGED, sha256 in the log) appended to the NEW
#   session-bound.test.tsx, with every hold used in round 5 (detail, summary, audit, decisions, /me, POST) at 2200 ms and
#   additionally 4500 ms. Expected after the fix: /me after POST == 2 in every case (Date.now is controlled for the file).
# Part B: mutation checks. apps/web/src/api/client.ts is mutated in the probe clone so the product sends a /me it must not
#   (M1: the window is ignored, every page GET revalidates; M2: no single-flight / window restart, so concurrent GETs after the
#   window each revalidate; M3: never revalidate after the window). Expected: the session-bound Y1c tests FAIL for M1 and M2
#   (an extra /me) and the window-crossing Y1c case FAILS for M3 (missing revalidation). Unmutated: PASS.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-6
cd $TMPDIR/probe || exit 2; export PATH=${NODEBIN:-/opt/node22/bin}:$PATH
SPEC=apps/web/src/auth/session-bound.test.tsx; PR=$EV/probes/sec-dg4-r5-y1c-timing.append.tsx
echo "# probe clone $(git rev-parse HEAD), node $(node -v), load $(cut -d' ' -f1-3 /proc/loadavg), $(date -u +%FT%TZ)"
echo "# spec sha256 $(sha256sum $SPEC | cut -c1-16) (candidate copy), probe sha256 $(sha256sum $PR | cut -c1-16)"
echo "### Part A: round-5 probe appended to the new spec"
cp $SPEC $TMPDIR/spec.orig; cat $PR >> $SPEC
for ms in 2200 4500; do for h in 'GET .*/transformations/[^/]+$' 'GET .*/summary' 'GET .*/audit' 'GET .*/decisions' 'GET .*/me$' 'POST .*'; do
  echo "## Y1C_HOLD='$h' Y1C_HOLD_MS=$ms"
  Y1C_HOLD="$h" Y1C_HOLD_MS=$ms pnpm exec vitest run --project unit-web $SPEC -t 'SEC-DG4-R5' 2>&1 | grep -aE 'SEC-R5 Y1c|✓|×|Tests |AssertionError' ; echo "# exit_status: ${PIPESTATUS[0]}"
done; done
cp $TMPDIR/spec.orig $SPEC
echo "### Part B: mutations of apps/web/src/api/client.ts (probe clone only)"
C=apps/web/src/api/client.ts; cp $C $TMPDIR/client.orig
mut() { echo "## $1"; cp $TMPDIR/client.orig $C; [ -n "$2" ] && { python3 -c "import sys;p=sys.argv[1];s=open(p).read();a,b=sys.argv[2],sys.argv[3];assert a in s,('pattern not found',a);open(p,'w').write(s.replace(a,b,1))" $C "$2" "$3" || return; }
  git diff --stat -- $C | tail -1
  pnpm exec vitest run --project unit-web $SPEC -t 'Y1c' 2>&1 | grep -aE '✓|×|Tests |AssertionError' | head -20; echo "# exit_status: ${PIPESTATUS[0]}"; }
mut "M0 unmutated" "" ""
mut "M1 window ignored (every page GET revalidates)" "Date.now() - lastMeAt >= SESSION_RECHECK_MS" "Date.now() - lastMeAt >= 0"
mut "M2 no single-flight and no window restart" "  if (pendingCheck) return pendingCheck;
  lastMeAt = Date.now(); // bounded" "  // mutated
  // bounded"
mut "M3 never revalidates after the window" "return sessionPhase === \"active\" && checkRunners.size > 0 && Date.now()" "return false && sessionPhase === \"active\" && checkRunners.size > 0 && Date.now()"
cp $TMPDIR/client.orig $C
echo "# git status after probe: '$(git status --porcelain)'"
