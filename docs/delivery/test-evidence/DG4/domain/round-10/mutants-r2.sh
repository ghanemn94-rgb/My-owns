#!/usr/bin/env bash
# domain-reviewer DG4 round 10: BE-R7 non-vacuity mutants, run 2. Run 1 (targeted-tests.sh, section [3]) used
# -t "REQ-S04-008: a product G6 approval", which skipped the earlier tests of the same describe that take the
# transformation through G1-G5; the G6 test then failed on its precondition (422 gate.out_of_sequence), NOT on the
# fingerprint, so run 1 proves nothing either way (a reviewer probe defect, disclosed). Run 2 runs the WHOLE mutated file.
# Mutants are scratch copies in the disposable clone $TMPDIR/review-r10 (at e70ac02) only; the clone's docs/delivery is
# restored after each. Expected: control 31/31; M1 (gates/DG3.json) and M2 (reviews/) fail exactly the G6 fingerprint
# test on the toEqual(before) assertion; M3 (handbacks/) passes 31/31 (outside DELIVERY_RECORDS by design, D-138).
set -u
cd "$TMPDIR/review-r10"; git checkout -q e70ac02f63cd1f42487cfa4dae73f68e933da015
export PATH=/opt/nvm/versions/node/v24.21.0/bin:/opt/node22/bin:/usr/bin:/bin
export QA_PG_PORT=26450 MTH_PORT_POOL=26451-26489
echo "### node $(node -v) HEAD $(git rev-parse HEAD) load=$(cut -d' ' -f1-3 /proc/loadavg)"
mutant() { # $1 name, $2 path relative to docs/delivery ("" = control, no write)
  local f=tests/qa/integration/zz-dom-r10-$1.test.ts
  if [ -z "$2" ]; then cp tests/qa/integration/a08-gate-controls.test.ts $f; else
  sed -e 's/^import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";/import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";/' \
      -e "s|^    expect(deliveryFingerprint()).toEqual(before);|    mkdirSync(join(DELIVERY, \"$2\", \"..\"), { recursive: true }); appendFileSync(join(DELIVERY, \"$2\"), \"\\\\n\"); // DOMAIN-R10 MUTANT $1\n    expect(deliveryFingerprint()).toEqual(before);|" \
      tests/qa/integration/a08-gate-controls.test.ts > $f; fi
  echo "### mutant $1 -> ${2:-<control: no write>}; diff vs a08:"; diff tests/qa/integration/a08-gate-controls.test.ts $f
  bash tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $f 2>&1 \
    | grep -E 'Test Files|Tests  |×|FAIL|AssertionError|^\s+[-+] +"(gates|reviews|handbacks)/' | head -20
  echo "### mutant $1 exit=${PIPESTATUS[0]} load=$(cut -d' ' -f1-3 /proc/loadavg)"
  rm -f $f; git checkout -q -- docs/delivery; git clean -fdq -- docs/delivery/handbacks docs/delivery/reviews docs/delivery/gates
  echo "### clone tracked status after restore: $(git status --short --untracked-files=no | wc -l) changes; untracked under docs/delivery: $(git status --short docs/delivery | wc -l)"
}
mutant control ""
mutant M1-gates gates/DG3.json
mutant M2-reviews reviews/DG4/zz-mutant.json
mutant M3-handbacks handbacks/zz-mutant.txt
