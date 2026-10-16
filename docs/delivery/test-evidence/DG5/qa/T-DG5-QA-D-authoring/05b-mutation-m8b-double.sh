#!/usr/bin/env bash
# qa-verifier T-DG5-QA-D, mutant M8b (disposable copy only, MUT_DIR): REQ-PB-091 "submission without three actions is
# rejected" with BOTH the API check and the database guard (0086 health_assessment_guard, '<> 3' -> '< 0') disabled.
set -uo pipefail
M="${MUT_DIR:?}"; cd "$M"; export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
A=apps/api/src/modules/health/assessments.ts; D=$(ls packages/db/migrations/0086_*.sql)
cp "$A" "$A.orig"; cp "$D" "$D.orig"
sed -i 's/if (actions.n !== HEALTH_CHECK_ACTIONS_REQUIRED) throw ACTIONS_REQUIRED();/void ACTIONS_REQUIRED;/' "$A"
sed -i 's/WHERE x.assessment_id = NEW.id) <> 3 THEN/WHERE x.assessment_id = NEW.id) < 0 THEN/' "$D"
diff "$A.orig" "$A"; diff "$D.orig" "$D"
QA_PG_PORT=23750 MTH_PORT_POOL=23751-23769 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner \
  --project integration tests/qa/integration/a16-health-check.test.ts > "$M/mut-M8b.log" 2>&1
rc=$?
grep -E "^\s+× |→ |Tests |Error" "$M/mut-M8b.log" | head -20
if [ $rc -ne 0 ]; then echo "MUTANT M8b: KILLED (vitest exit $rc)"; else echo "MUTANT M8b: SURVIVED (vitest exit 0)"; fi
mv "$A.orig" "$A"; mv "$D.orig" "$D"
