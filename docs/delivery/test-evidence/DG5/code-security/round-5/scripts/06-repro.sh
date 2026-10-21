#!/usr/bin/env bash
# code-security-reviewer DG5 r5: prior-round adversarial probes (copied unchanged from round-4/repro, sha256 in
# round-5/repro/copies.sha256) re-run on this candidate in the disposable clone, then removed. Locale unset, Node 24.
set -u
C=$TMPDIR/review-r5; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-5; R=$E/repro
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
I=$C/apps/api/test/integration
declare -A DEST=(
  [p5-aud-adm-sweep.test.ts]=$I/zz-sec-r1-p5-sweep.test.ts
  [studio-coauthor-review.test.ts]=$I/methodology/zz-sec-r1-coauthor-review.test.ts
  [studio-contributor-paths.test.ts]=$I/methodology/zz-sec-r2-contributor-paths.test.ts
  [intake-foreign-transformation.test.ts]=$I/procedures/zz-sec-r1-intake-foreign.test.ts
  [demo-portfolio-guards.r3.test.ts]=$I/environment/zz-sec-r3-demo-portfolio-guards.test.ts
  [demo-key-deliverables-guards.test.ts]=$I/environment/zz-sec-r4-demo-key-deliverables.test.ts
)
L=$E/06-repro-prior-probes.log
{ echo "## $(date -u +%FT%TZ) prior probes on candidate a18a9f05 (clone HEAD $(git -C $C rev-parse --short HEAD)); node $(node -v); locale unset; load: $(cut -d' ' -f1-3 /proc/loadavg)"
files=(); for k in "${!DEST[@]}"; do cp "$R/$k" "${DEST[$k]}"; echo "copy $k -> ${DEST[$k]#$C/} ($(sha256sum "${DEST[$k]}" | cut -c1-16))"; files+=("${DEST[$k]#$C/}"); done
cd $C
echo "\$ env -u LANG -u LC_ALL -u LC_CTYPE QA_PG_PORT=26560 MTH_PORT_POOL=26561-26599 bash tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration ${files[*]}"
env -u LANG -u LC_ALL -u LC_CTYPE QA_PG_PORT=26560 MTH_PORT_POOL=26561-26599 bash tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "${files[@]}" 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g; s/\x1b\[[0-9;]*m//g"
echo "EXIT ${PIPESTATUS[0]}"
for k in "${!DEST[@]}"; do rm -f "${DEST[$k]}"; done
echo "clone git status --short lines after removing the probes: $(git -C $C status --short | wc -l)"
echo "## end $(date -u +%FT%TZ) load: $(cut -d' ' -f1-3 /proc/loadavg)"; } > $L 2>&1
grep -E 'Test Files|^ +Tests |^EXIT|status --short|×' $L
