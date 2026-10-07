#!/usr/bin/env bash
# code-security-reviewer DG2 round-15: web probes in the disposable probe clone $TMPDIR/r15p (HEAD 9236a9f = candidate
# 3f01c610 + the probe files copied into apps/web/src/auth/). The round-14 probe zz-sec-r14-web-probe.test.tsx is run
# UNCHANGED (sha256 2b64ba54...); the round-15 class probe zz-sec-r15-web-probe.test.tsx is new. Each on Node 22 (LANG
# unset) and Node 24 (LANG=C.UTF-8). unit-web project (jsdom), the product's own fixtures, SYNTHETIC data.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG2/code-security/round-15
cd $TMPDIR/r15p
cp $EV/../round-14/probes/zz-sec-r14-web-probe.test.tsx $EV/probes/zz-sec-r15-web-probe.test.tsx apps/web/src/auth/
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
one() { # name nodepath lang probe
  local name=$1 np=$2 lang=$3 probe=$4
  ( if [ "$lang" = unset ]; then unset LANG LC_ALL LC_CTYPE; else unset LC_ALL LC_CTYPE; export LANG=$lang; fi
    { echo "# command: pnpm vitest run --project unit-web apps/web/src/auth/$probe"
      echo "# clone HEAD $(git rev-parse HEAD) (candidate 3f01c610 = source ed80b23 + metadata); node $(PATH=$np:$PATH node --version); LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>}; probe sha256 $(sha256sum apps/web/src/auth/$probe | cut -c1-16); started $(date -u +%FT%TZ)"; } > $EV/$name.log
    PATH=$np:$PATH pnpm vitest run --project unit-web apps/web/src/auth/$probe >> $EV/$name.log 2>&1; rc=$?
    echo "# exit_status: $rc finished $(date -u +%FT%TZ)" >> $EV/$name.log; echo "$name $rc" >> $EV/probe-summary.txt )
}
: > $EV/probe-summary.txt
one probe-r14-web-node22-lang-unset $N22 unset zz-sec-r14-web-probe.test.tsx
one probe-r14-web-node24-lang-c-utf8 $N24 C.UTF-8 zz-sec-r14-web-probe.test.tsx
one probe-r15-web-node22-lang-unset $N22 unset zz-sec-r15-web-probe.test.tsx
one probe-r15-web-node24-lang-c-utf8 $N24 C.UTF-8 zz-sec-r15-web-probe.test.tsx
echo DONE >> $EV/probe-summary.txt
