#!/usr/bin/env bash
# usage: mutate.sh <name> <file-relative> <sed-expr> ; runs the A06 suite in a disposable copy
set -u
ORIG=/home/user/wt/dg5-qa-a
NAME=$1; shift
C=$TMPDIR/mut-$NAME
rm -rf "$C"; mkdir -p "$C" "$C/docs"
for d in apps packages tests; do (cd $ORIG && tar --exclude=node_modules -cf - $d) | (cd "$C" && tar -xf -); done
cp -a $ORIG/docs/api "$C/docs/api"
cp $ORIG/package.json $ORIG/vitest.config.ts $ORIG/tsconfig.base.json $ORIG/pnpm-workspace.yaml "$C/"
ln -s $ORIG/node_modules "$C/node_modules"
for n in $(cd $ORIG && find apps packages -maxdepth 2 -name node_modules -type d); do ln -s "$ORIG/$n" "$C/$n"; done
while [ $# -ge 2 ]; do
  FILE=$1; EXPR=$2; shift 2
  before=$(sha256sum "$C/$FILE" | cut -c1-12)
  sed -i "$EXPR" "$C/$FILE"
  after=$(sha256sum "$C/$FILE" | cut -c1-12)
  echo "MUTATION $NAME: $FILE sed '$EXPR' (sha $before -> $after)"
  [ "$before" = "$after" ] && { echo "MUTATION NOT APPLIED"; exit 9; }
  diff <(cd $ORIG && cat "$FILE") "$C/$FILE"
done
cd "$C"
QA_PG_PORT=23670 MTH_PORT_POOL=23671-23699 timeout 900 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa/integration/a06-configuration-change.test.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^\s+(✓|×)|→|Tests " | cut -c1-400
echo "exit=${PIPESTATUS[0]}"
cd /; rm -rf "$C"
