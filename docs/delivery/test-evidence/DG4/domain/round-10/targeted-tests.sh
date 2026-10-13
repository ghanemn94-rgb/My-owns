#!/usr/bin/env bash
# domain-reviewer DG4 round 10: targeted test files for the round-10 diff (load envelope: domain runs single files only;
# no pnpm test, no full integration, no e2e suite). Clone $TMPDIR/review-r10 at e70ac02; node_modules copied read-only
# semantics -> Vitest needs --configLoader runner (QA-A's finding).
#  1. unit-web: app.test.tsx and transformations.test.tsx, with the locale unset and with C.UTF-8.
#  2. integration: tests/qa/integration/a08-gate-controls.test.ts alone, on a disposable PostgreSQL (with-pg.sh, ports 26410+).
#  3. BE-R7 non-vacuity mutants (scratch copies of a08 in the clone only, -t "REQ-S04-008"):
#     M1 writes to docs/delivery/gates/DG3.json after the G6 approval   -> expected: the G6 test FAILS (caught);
#     M2 writes to docs/delivery/reviews/DG4/zz-mutant.json              -> expected: FAILS (caught);
#     M3 writes to docs/delivery/handbacks/zz-mutant.txt                 -> expected: PASSES (outside DELIVERY_RECORDS by design).
#     The clone's docs/delivery is restored with git checkout/clean after each mutant.
set -u
cd "$TMPDIR/review-r10"; git checkout -q e70ac02f63cd1f42487cfa4dae73f68e933da015
export PATH=/opt/nvm/versions/node/v24.21.0/bin:/opt/node22/bin:/usr/bin:/bin
echo "### node $(node -v) HEAD $(git rev-parse HEAD) load=$(cut -d' ' -f1-3 /proc/loadavg)"
echo "### [1a] unit-web, locale unset"
env -u LANG -u LANGUAGE -u LC_ALL -u LC_CTYPE npx vitest run --configLoader runner --project unit-web apps/web/src/app/app.test.tsx apps/web/src/pages/transformations/transformations.test.tsx --reporter=verbose 2>&1 | grep -vE '^\s*$'
echo "### exit=${PIPESTATUS[0]} load=$(cut -d' ' -f1-3 /proc/loadavg)"
echo "### [1b] unit-web, LANG=LC_ALL=C.UTF-8"
LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --configLoader runner --project unit-web apps/web/src/app/app.test.tsx apps/web/src/pages/transformations/transformations.test.tsx 2>&1 | tail -6
echo "### exit=${PIPESTATUS[0]} load=$(cut -d' ' -f1-3 /proc/loadavg)"
export QA_PG_PORT=26410 MTH_PORT_POOL=26411-26449
echo "### [2] integration: a08-gate-controls.test.ts alone"
bash tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration tests/qa/integration/a08-gate-controls.test.ts --reporter=verbose 2>&1 | grep -vE '^\s*$'
echo "### exit=${PIPESTATUS[0]} load=$(cut -d' ' -f1-3 /proc/loadavg)"
mutant() { # $1 name, $2 path relative to docs/delivery
  local f=tests/qa/integration/zz-dom-r10-$1.test.ts
  sed -e 's/^import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";/import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";/' \
      -e "s|^    expect(deliveryFingerprint()).toEqual(before);|    mkdirSync(join(DELIVERY, \"$2\", \"..\"), { recursive: true }); appendFileSync(join(DELIVERY, \"$2\"), \"\\\\n\"); // DOMAIN-R10 MUTANT $1\n    expect(deliveryFingerprint()).toEqual(before);|" \
      tests/qa/integration/a08-gate-controls.test.ts > $f
  echo "### [3] mutant $1 -> docs/delivery/$2; inserted lines:"; grep -n 'DOMAIN-R10 MUTANT\|appendFileSync, existsSync' $f
  bash tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $f -t "REQ-S04-008: a product G6 approval" 2>&1 | grep -E 'Test Files|Tests |✓|×|FAIL|AssertionError|toEqual|\+ |\- ' | head -20
  echo "### mutant $1 exit=${PIPESTATUS[0]}"
  rm -f $f; git checkout -q -- docs/delivery; git clean -fdq -- docs/delivery/handbacks docs/delivery/reviews docs/delivery/gates
  echo "### clone tracked status after restore: $(git status --short --untracked-files=no | wc -l) changes"
}
mutant M1-gates gates/DG3.json
mutant M2-reviews reviews/DG4/zz-mutant.json
mutant M3-handbacks handbacks/zz-mutant.txt
