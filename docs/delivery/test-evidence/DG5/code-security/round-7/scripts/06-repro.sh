#!/usr/bin/env bash
# code-security-reviewer DG5 r7: the seven round-6 probes (copied unchanged from round-6/repro) plus the new round-7 probe
# picker-cursor-scope.r7.test.ts (sha256 in round-7/repro/copies.sha256), run on this candidate in the disposable clone,
# then removed. Locale unset, Node 24. $1 = log label, $2 = port; remaining args = which probe keys (default: all).
set -u
C=$TMPDIR/review-r7; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-7; R=$E/repro
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
I=$C/apps/api/test/integration
LBL=$1; PORT=$2; shift 2
declare -A DEST=(
  [p5-aud-adm-sweep.test.ts]=$I/zz-sec-r1-p5-sweep.test.ts
  [studio-coauthor-review.test.ts]=$I/methodology/zz-sec-r1-coauthor-review.test.ts
  [studio-contributor-paths.test.ts]=$I/methodology/zz-sec-r2-contributor-paths.test.ts
  [intake-foreign-transformation.test.ts]=$I/procedures/zz-sec-r1-intake-foreign.test.ts
  [demo-portfolio-guards.r3.test.ts]=$I/environment/zz-sec-r3-demo-portfolio-guards.test.ts
  [demo-key-deliverables-guards.test.ts]=$I/environment/zz-sec-r4-demo-key-deliverables.test.ts
  [form-export-label.r6.test.ts]=$I/forms/zz-sec-r6-form-export-label.test.ts
  [picker-cursor-scope.r7.test.ts]=$I/zz-sec-r7-picker-cursor-scope.test.ts
)
KEYS=("$@"); [ ${#KEYS[@]} -gt 0 ] || KEYS=("${!DEST[@]}")
L=$E/06-repro-$LBL.log
{ echo "## $(date -u +%FT%TZ) probes on candidate 33188e9e (clone HEAD $(git -C $C rev-parse --short HEAD)); node $(node -v); locale unset; load: $(cut -d' ' -f1-3 /proc/loadavg)"
files=(); for k in "${KEYS[@]}"; do cp "$R/$k" "${DEST[$k]}"; echo "copy $k -> ${DEST[$k]#$C/} ($(sha256sum "${DEST[$k]}" | cut -c1-16))"; files+=("${DEST[$k]#$C/}"); done
cd $C
echo "\$ env -u LANG -u LC_ALL -u LC_CTYPE QA_PG_PORT=$PORT MTH_PORT_POOL=$((PORT+1))-26599 bash tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration ${files[*]}"
env -u LANG -u LC_ALL -u LC_CTYPE QA_PG_PORT=$PORT MTH_PORT_POOL=$((PORT+1))-26599 bash tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "${files[@]}" 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g; s/\x1b\[[0-9;]*m//g"
echo "EXIT ${PIPESTATUS[0]}"
for k in "${KEYS[@]}"; do rm -f "${DEST[$k]}"; done
echo "clone git status --short lines after removing the probes: $(git -C $C status --short | wc -l)"
echo "## end $(date -u +%FT%TZ) load: $(cut -d' ' -f1-3 /proc/loadavg)"; } > $L 2>&1
grep -E 'Test Files|^ +Tests |^EXIT|status --short|×|S[0-9]:' $L
