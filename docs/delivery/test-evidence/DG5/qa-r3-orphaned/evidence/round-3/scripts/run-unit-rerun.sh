#!/usr/bin/env bash
# qa-verifier DG5 r3: the unit files that failed in the full runs (load timeouts), re-run alone, each configuration.
set -u
C=$TMPDIR/rev; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3
cd $C
for n in node22 node24; do for m in unset cutf8; do
  if [ "$n" = node22 ]; then P=/opt/node22/bin; else P=/opt/nvm/versions/node/v24.21.0/bin; fi
  if [ "$m" = unset ]; then ENVP=(env -u LANG -u LC_ALL -u LC_CTYPE PATH=$P:$PATH); else ENVP=(env LANG=C.UTF-8 LC_ALL=C.UTF-8 PATH=$P:$PATH); fi
  L=$E/02b-unit-rerun-$n-$m.log
  { echo "\$ ${ENVP[*]%%PATH=*} npx vitest run --project unit-node apps/api/src/architecture.test.ts  (node $("${ENVP[@]}" node -v), $(date -u +%FT%TZ)) load $(cut -d' ' -f1-3 /proc/loadavg)"
    "${ENVP[@]}" npx vitest run --project unit-node apps/api/src/architecture.test.ts 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"; echo "EXIT ${PIPESTATUS[0]}"
    echo "\$ ${ENVP[*]%%PATH=*} npx vitest run --project unit-web apps/web/src/pages/p2-blank-forms.test.tsx apps/web/src/pages/gates/g1-agreements.test.tsx  ($(date -u +%FT%TZ)) load $(cut -d' ' -f1-3 /proc/loadavg)"
    "${ENVP[@]}" npx vitest run --project unit-web apps/web/src/pages/p2-blank-forms.test.tsx apps/web/src/pages/gates/g1-agreements.test.tsx 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"; echo "EXIT ${PIPESTATUS[0]}"; } > $L 2>&1
  echo "$n $m: $(sed 's/\x1b\[[0-9;]*m//g' $L | grep -E 'Tests |^EXIT|architecture.test.ts \(' | tr '\n' ' ')"
done; done
