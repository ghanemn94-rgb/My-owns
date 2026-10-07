#!/usr/bin/env bash
# code-security-reviewer DG2 round-12: runs the round-11 probe (unchanged, sha256 below) and the round-12 probe in the
# disposable probe clone $TMPDIR/r12p (HEAD 744af0b = candidate 5dfecce4), each on Node 22 (LANG unset) and Node 24
# (LANG=C.UTF-8), each on its own disposable PostgreSQL 16 cluster (ports 29981-29989). Also the OIDC sweep probe.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG2/code-security/round-12
cd $TMPDIR/r12p
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
one() { # name nodepath port lang probe
  local name=$1 np=$2 port=$3 lang=$4 probe=$5
  ( if [ "$lang" = unset ]; then unset LANG LC_ALL LC_CTYPE; else unset LC_ALL LC_CTYPE; export LANG=$lang; fi
    { echo "# command: with-pg.sh $port pnpm vitest run --project integration apps/api/test/integration/$probe"
      echo "# clone HEAD $(git rev-parse HEAD) (candidate 5dfecce4 = source 8488e7a + metadata); node $(PATH=$np:$PATH node --version); LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>}; probe sha256 $(sha256sum apps/api/test/integration/$probe | cut -c1-16); started $(date -u +%FT%TZ)"; } > $EV/$name.log
    PATH=$np:$PATH $TMPDIR/bin/with-pg.sh $port pnpm vitest run --project integration apps/api/test/integration/$probe >> $EV/$name.log 2>&1; rc=$?
    echo "# exit_status: $rc finished $(date -u +%FT%TZ)" >> $EV/$name.log; echo "$name $rc" >> $EV/probe-summary.txt )
}
: > $EV/probe-summary.txt
one probe-r11-node22-lang-unset $N22 29981 unset zz-sec-r11-probe.test.ts
one probe-r11-node24-lang-c-utf8 $N24 29982 C.UTF-8 zz-sec-r11-probe.test.ts
one probe-r12-node22-lang-unset $N22 29983 unset zz-sec-r12-probe.test.ts
one probe-r12-node24-lang-c-utf8 $N24 29984 C.UTF-8 zz-sec-r12-probe.test.ts
one probe-r12-oidc-node22-lang-unset $N22 29988 unset zz-sec-r12-oidc-probe.test.ts
one probe-r12-oidc-node24-lang-c-utf8 $N24 29989 C.UTF-8 zz-sec-r12-oidc-probe.test.ts
echo DONE >> $EV/probe-summary.txt
