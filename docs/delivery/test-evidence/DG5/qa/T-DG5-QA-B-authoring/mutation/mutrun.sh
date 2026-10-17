#!/usr/bin/env bash
# usage: mutrun.sh <name> <file> <python-literal-old> <python-literal-new>   (empty name+file = baseline)
set -u
M="$TMPDIR/mut"; ORIG="$1"; NAME="$2"; FILE="$3"; OLD="$4"; NEW="$5"
LOG="$TMPDIR/mut-$NAME.log"
if [ -n "$FILE" ]; then
  python3 - "$M/$FILE" "$OLD" "$NEW" <<'PY'
import sys
p,a,b=sys.argv[1:4]
s=open(p).read()
assert s.count(a)==1, ("mutation anchor count", s.count(a))
open(p,'w').write(s.replace(a,b))
PY
  [ $? -eq 0 ] || { echo "ANCHOR FAILED"; exit 9; }
  echo "mutant $NAME: $FILE" > "$LOG"; diff <(cd "$ORIG" && cat "$FILE") "$M/$FILE" >> "$LOG"
else
  echo "baseline (unmutated copy)" > "$LOG"
fi
cd "$M"
QA_PG_PORT=23600 MTH_PORT_POOL=23601-23619 timeout 900 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration tests/qa/integration/a07-historical-integrity.test.ts >> "$LOG" 2>&1
echo "exit=$?" >> "$LOG"
[ -n "$FILE" ] && cp "$ORIG/$FILE" "$M/$FILE"
grep -E "^\s+(✓|×) " "$LOG" | sed -E 's/^\s+//' | cut -c1-200
grep -E "Tests |exit=" "$LOG"
