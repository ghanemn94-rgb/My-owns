#!/bin/bash
# T-DG6-BE-X3B setter sweep: every exported function named set*, install* or register* under apps/*/src/modules and
# apps/worker/src, with its CALL SITES (`name(` outside an import/export line) in product sources. Test files excluded.
cd "$1"
echo "# T-DG6-BE-X3B setter sweep, run $(date -u +%FT%TZ) on the working tree (product sources only; *.test.ts excluded)"
echo "# pattern: export [async] function (set|install|register)* under apps/*/src/modules and apps/worker/src"
echo "# columns: name | defining file | call sites file:line outside the defining file (import/export lines excluded)"
grep -rEn --include=*.ts -o "export (async )?function (set|install|register)[A-Za-z0-9_]*" apps/*/src/modules apps/worker/src | grep -v "\.test\.ts:" |
while IFS= read -r m; do
  f=${m%%:*}; name=$(echo "$m" | sed -E 's/.*function //')
  calls=$(grep -rnE --include=*.ts "(^|[^A-Za-z0-9_])$name\\(" apps/*/src | grep -v "\.test\.ts:" | grep -v "^$f:" | grep -vE "^[^:]+:[0-9]+:\s*(import|export) " | grep -vE "function $name\b" | cut -d: -f1,2 | tr '\n' ' ')
  if [ -z "$calls" ]; then own=$(grep -cE "(^|[^A-Za-z0-9_])$name\(" "$f"); own=$((own-1)); calls="NONE outside its file (calls in own file: $own)"; fi
  echo "$name | $f | $calls"
done
