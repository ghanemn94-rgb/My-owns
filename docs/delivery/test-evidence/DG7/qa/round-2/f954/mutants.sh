#!/bin/bash
# qa-verifier DG7 round 2: revert-to-fail for F-DG7-954 on a disposable copy ($TMPDIR/mut) of the candidate tree.
# M0 control (routes.ts byte-equal to the candidate), M1 the A26 drill defect (both gates business_unit.read),
# M2 only the route-level permission downgraded, M3 only requireAction downgraded. Each: organizations.test.ts only.
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
EV=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-2/f954
M=$TMPDIR/mut; F=apps/api/src/modules/organization/routes.ts
cd $M
cp $F $TMPDIR/routes.orig
run() { echo "===== $1 ($(date -u))"; sha256sum $F; git -C $TMPDIR/rv diff --no-index --stat $TMPDIR/rv/$F $M/$F; QA_PG_PORT=$2 MTH_PORT_POOL=32590-32599 /home/user/My-owns/tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/organizations.test.ts 2>&1 | grep -v "^npm warn" | tail -40; echo "EXIT ${PIPESTATUS[0]} $1"; }
run M0-control 32580
patch -s -p1 < $EV/a26-defect.patch; run M1-both-read 32581; cp $TMPDIR/routes.orig $F
python3 - $F route <<'PY'
import sys;p,mode=sys.argv[1],sys.argv[2];s=open(p).read()
a='"/api/v1/business-units/:businessUnitId",\n    { config: { access: { permission: "business_unit.manage" } } },'
b='await requireAction(tx, principal, "business_unit.manage", target);'
if mode=="route": assert s.count(a)==1; s=s.replace(a,a.replace("manage","read"))
else: assert s.count(b)>=1; i=s.index(a); j=s.index(b,i); s=s[:j]+b.replace("manage","read")+s[j+len(b):]
open(p,"w").write(s)
PY
run M2-route-only 32582; cp $TMPDIR/routes.orig $F
python3 - $F action <<'PY'
import sys;p,mode=sys.argv[1],sys.argv[2];s=open(p).read()
a='"/api/v1/business-units/:businessUnitId",\n    { config: { access: { permission: "business_unit.manage" } } },'
b='await requireAction(tx, principal, "business_unit.manage", target);'
i=s.index(a); j=s.index(b,i); s=s[:j]+b.replace("manage","read")+s[j+len(b):]
open(p,"w").write(s)
PY
run M3-requireAction-only 32583; cp $TMPDIR/routes.orig $F
echo "===== restored"; cmp $F $TMPDIR/rv/$F && echo "routes.ts byte-equal to candidate"
