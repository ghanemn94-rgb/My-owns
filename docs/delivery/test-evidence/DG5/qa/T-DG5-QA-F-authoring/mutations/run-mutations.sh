#!/usr/bin/env bash
# Mutation checks for T-DG5-QA-F: each mutation in its own disposable clone ($TMPDIR/mut/<id>), never in the tree.
set -uo pipefail
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
M=$TMPDIR/mut; OUT=$M/logs; mkdir -p "$OUT"
run() { # id file pattern
  local id=$1 file=$2 pat=$3
  ( cd "$M/$id" && QA_PG_PORT=23720 MTH_PORT_POOL=23721-23749 timeout 900 tests/qa/support/with-pg.sh \
      npx vitest run --configLoader runner --project integration "$file" -t "$pat" ) > "$OUT/$id.log" 2>&1
  echo "$id exit=$?" | tee -a "$OUT/summary.txt"
}
mk() { "$M/make-clone.sh" "$1" >/dev/null; }
: > "$OUT/summary.txt"
# M1 REQ-S12-020: the rule-execution failure is recorded on the FIRST attempt instead of the last.
mk m1; sed -i 's/a !== undefined \&\& a.retryCount >= a.retryLimit;/a !== undefined \&\& a.retryCount >= 0; \/\/ MUTATION M1/' "$M/m1/apps/worker/src/automation/engine.ts"
grep -c "MUTATION M1" "$M/m1/apps/worker/src/automation/engine.ts" >> "$OUT/summary.txt"
run m1 tests/qa/integration/a13-durable-automation.test.ts "bounded retries"
# M2 REQ-S12-002/021: completed actions are repeated on retry, with a fresh effect key (exactly-once layers 2 and 3 off).
mk m2; sed -i 's/    if (done !== undefined) return { outcome: "already" as const, errorCode: null };/    void done; \/\/ MUTATION M2a/' "$M/m2/apps/worker/src/automation/engine.ts"
sed -i 's/      dedupeKey: `${planned.idempotencyKey}:${userId}`,/      dedupeKey: `${planned.idempotencyKey}:${userId}:${Date.now()}`, \/\/ MUTATION M2b/' "$M/m2/apps/worker/src/automation/actions/items.ts"
grep -c "MUTATION M2" "$M/m2/apps/worker/src/automation/engine.ts" "$M/m2/apps/worker/src/automation/actions/items.ts" >> "$OUT/summary.txt"
run m2 tests/qa/integration/a13-durable-automation.test.ts "an admin retries it"
# M3 REQ-S12-026: the API no longer refuses human-only action types.
mk m3; sed -i 's/  if (actions?.some((a) => HUMAN_ONLY.has(a.type))) throw humanOnlyRefusal();/  void actions; \/\/ MUTATION M3/' "$M/m3/apps/api/src/modules/automation/human-only.ts"
grep -c "MUTATION M3" "$M/m3/apps/api/src/modules/automation/human-only.ts" >> "$OUT/summary.txt"
run m3 tests/qa/integration/a13-durable-automation.test.ts "every human-only action type"
# M4 REQ-S12-022: the jobs view never shows a last success.
mk m4; sed -i 's/    lastSuccessAt: isoOrNull(row.last_success_at === null ? null : new Date(row.last_success_at)),/    lastSuccessAt: null, \/\/ MUTATION M4/' "$M/m4/apps/api/src/modules/jobs/operations.ts"
grep -c "MUTATION M4" "$M/m4/apps/api/src/modules/jobs/operations.ts" >> "$OUT/summary.txt"
run m4 tests/qa/integration/a22-operational-readiness.test.ts "after a run"
# M5 REQ-S18-003: the BUILT CLI no longer refuses seed-demo in production mode.
mk m5; sed -i 's/    if (mthEnv === "production")$/    if (mthEnv === "MUTATION-M5-never")/' "$M/m5/packages/db/dist/demo/guard.js"
grep -c "MUTATION-M5" "$M/m5/packages/db/dist/demo/guard.js" >> "$OUT/summary.txt"
run m5 tests/qa/integration/a22-operational-readiness.test.ts "demo seed command exits"
