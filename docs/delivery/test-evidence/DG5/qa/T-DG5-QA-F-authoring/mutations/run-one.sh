#!/usr/bin/env bash
# run-one.sh <m2|m3|m4|m5>: make a sparse disposable clone, apply ONE mutation, run the targeted test, log to logs/<id>.log
set -uo pipefail
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
M=$TMPDIR/mut; OUT=$M/logs; id=$1; C=$M/$id
"$M/make-clone.sh" "$id" >/dev/null || { echo "$id clone failed"; exit 9; }
case $id in
  m2) sed -i 's/    if (done !== undefined) return { outcome: "already" as const, errorCode: null };/    void done; \/\/ MUTATION M2a/' "$C/apps/worker/src/automation/engine.ts"
      sed -i 's/      dedupeKey: `${planned.idempotencyKey}:${userId}`,/      dedupeKey: `${planned.idempotencyKey}:${userId}:${Date.now()}`, \/\/ MUTATION M2b/' "$C/apps/worker/src/automation/actions/items.ts"
      F=tests/qa/integration/a13-durable-automation.test.ts; P="an admin retries it" ;;
  m3) sed -i 's/  if (actions?.some((a) => HUMAN_ONLY.has(a.type))) throw humanOnlyRefusal();/  void actions; \/\/ MUTATION M3/' "$C/apps/api/src/modules/automation/human-only.ts"
      F=tests/qa/integration/a13-durable-automation.test.ts; P="every human-only action type" ;;
  m4) sed -i 's/    lastSuccessAt: isoOrNull(row.last_success_at === null ? null : new Date(row.last_success_at)),/    lastSuccessAt: null, \/\/ MUTATION M4/' "$C/apps/api/src/modules/jobs/operations.ts"
      F=tests/qa/integration/a22-operational-readiness.test.ts; P="after a run" ;;
  m5) sed -i 's/    if (mthEnv === "production")$/    if (mthEnv === "MUTATION-M5-never")/' "$C/packages/db/dist/demo/guard.js"
      F=tests/qa/integration/a22-operational-readiness.test.ts; P="demo seed command exits" ;;
esac
{ echo "== mutation $id applied:"; grep -rn "MUTATION" "$C/apps/worker/src/automation" "$C/apps/api/src/modules/automation/human-only.ts" "$C/apps/api/src/modules/jobs/operations.ts" "$C/packages/db/dist/demo/guard.js" 2>/dev/null; echo "== test: $F -t \"$P\""; } > "$OUT/$id.log"
( cd "$C" && QA_PG_PORT=23720 MTH_PORT_POOL=23721-23749 timeout 900 tests/qa/support/with-pg.sh \
    npx vitest run --configLoader runner --project integration "$F" -t "$P" ) >> "$OUT/$id.log" 2>&1
echo "$id exit=$?" | tee -a "$OUT/$id.log"
