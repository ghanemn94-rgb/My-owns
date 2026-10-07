#!/usr/bin/env bash
# code-security-reviewer DG2 round-14: API regression. Runs the round-12 probes UNCHANGED (zz-sec-r12-probe Q1/Q1b..Q6b,
# sha 71cbe705; zz-sec-r12-oidc-probe Q7, sha db10609c) and the round-13 probe UNCHANGED (zz-sec-r13-probe, sha 8ae4840f:
# commit-time auth, startup sweep, shutdown with a stuck handler) in the disposable probe clone $TMPDIR/r14p (HEAD d99de98 =
# candidate 9f3ca298 + the probe files), each on Node 22 (LANG unset) and Node 24 (LANG=C.UTF-8), each on its own
# disposable PostgreSQL 16 cluster (ports 30081-30086).
EV=/home/user/My-owns/docs/delivery/test-evidence/DG2/code-security/round-14
cd $TMPDIR/r14p
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
one() { # name nodepath port lang probe
  local name=$1 np=$2 port=$3 lang=$4 probe=$5
  ( if [ "$lang" = unset ]; then unset LANG LC_ALL LC_CTYPE; else unset LC_ALL LC_CTYPE; export LANG=$lang; fi
    { echo "# command: with-pg.sh $port pnpm vitest run --project integration apps/api/test/integration/$probe"
      echo "# clone HEAD $(git rev-parse HEAD) (candidate 9f3ca298 = source ea9051b + metadata); node $(PATH=$np:$PATH node --version); LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>}; probe sha256 $(sha256sum apps/api/test/integration/$probe | cut -c1-16); started $(date -u +%FT%TZ)"; } > $EV/$name.log
    PATH=$np:$PATH $TMPDIR/bin/with-pg.sh $port pnpm vitest run --project integration apps/api/test/integration/$probe >> $EV/$name.log 2>&1; rc=$?
    echo "# exit_status: $rc finished $(date -u +%FT%TZ)" >> $EV/$name.log; echo "$name $rc" >> $EV/probe-summary.txt )
}
: > $EV/probe-summary.txt
one probe-r12-node22-lang-unset $N22 30081 unset zz-sec-r12-probe.test.ts
one probe-r12-node24-lang-c-utf8 $N24 30082 C.UTF-8 zz-sec-r12-probe.test.ts
one probe-r12-oidc-node22-lang-unset $N22 30083 unset zz-sec-r12-oidc-probe.test.ts
one probe-r12-oidc-node24-lang-c-utf8 $N24 30084 C.UTF-8 zz-sec-r12-oidc-probe.test.ts
one probe-r13-node22-lang-unset $N22 30085 unset zz-sec-r13-probe.test.ts
one probe-r13-node24-lang-c-utf8 $N24 30086 C.UTF-8 zz-sec-r13-probe.test.ts
echo DONE >> $EV/probe-summary.txt
