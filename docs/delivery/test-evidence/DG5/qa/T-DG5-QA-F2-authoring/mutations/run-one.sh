#!/usr/bin/env bash
# run-one.sh <id>: make a disposable clone, apply ONE mutation (or the fix probe), run the targeted test, log to
# <evidence>/mutations/<id>.log, then delete the clone. Never touches the source tree.
set -uo pipefail
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
HERE="$(cd "$(dirname "$0")" && pwd)"; id=$1; C=$TMPDIR/mutf2/$id; LOG="$HERE/$id.log"
"$HERE/make-clone.sh" "$id" >/dev/null || { echo "$id clone failed"; exit 9; }
# The probe registers the missing relay schema where the relay looks it up (apps/worker/src/relay.ts; packages/* of the
# clone are not loaded, because pnpm's node_modules links resolve @mth/shared to the source tree's package).
probe() {
  sed -i 's/^import { outboxPayloadSchema, truncateText, type OutboxEnvelope } from "@mth\/shared\/schemas";$/import { dependencySlippedV1, outboxPayloadSchema as registered, truncateText, type OutboxEnvelope } from "@mth\/shared\/schemas"; \/\/ PROBE\nconst outboxPayloadSchema = (t: string, v: number) => registered(t, v) ?? (t === "dependency.slipped" \&\& v === 1 ? dependencySlippedV1 : null); \/\/ PROBE: the missing relay schema registered/' "$C/apps/worker/src/relay.ts"
}
case $id in
  p1) probe
      F=tests/qa/integration/a13-dependency-slip-rule-b.test.ts; P="" ;;
  m1) probe
      sed -i 's/      if (!codesByOwner.has(owner)) owners.push(owner);/      owners.push(owner); \/\/ MUTATION M1a: one per affected initiative/' "$C/apps/worker/src/handlers/portfolio.ts"
      sed -i 's/        dedupeKey: `dependency_slip:${slip.id}:${userId}`,/        dedupeKey: `dependency_slip:${slip.id}:${userId}:${Date.now()}:${Math.random()}`, \/\/ MUTATION M1b/' "$C/apps/worker/src/handlers/portfolio.ts"
      F=tests/qa/integration/a13-dependency-slip-rule-b.test.ts; P="" ;;
  m2) sed -i 's/              forecastFinishAfter: predecessorFinish(i, afterSet),/              forecastFinishAfter: ((d) => (d === null ? null : new Date(Date.parse(`${d}T00:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10)))(predecessorFinish(i, beforeSet)), \/\/ MUTATION M2: every dependent moves by the slip/' "$C/apps/api/src/modules/portfolio/slip-events.ts"
      F=tests/qa/integration/a13-dependency-slip-rule-b.test.ts; P="" ;;
  m3) sed -i 's/^    key = parsed.data;$/    key = `${parsed.data.slice(0, 100)}-${Date.now()}`; \/\/ MUTATION M3: the request key is not remembered/' "$C/apps/api/src/modules/reporting/exports/jobs.ts"
      F=tests/qa/integration/a13-jobs-rerun.test.ts; P="Idempotency-Key" ;;
  m4) sed -i 's/      dedupeKey: dayNinetyTaskKey(test.id, userId),/      dedupeKey: `${dayNinetyTaskKey(test.id, userId)}:${Date.now()}`, \/\/ MUTATION M4/' "$C/apps/worker/src/handlers/launch.ts"
      F=tests/qa/integration/a13-jobs-rerun.test.ts; P="Day-90" ;;
  m5) sed -i 's/^  "governance.blocker_escalation_scan": "starter.blocker_red",$/  "governance.blocker_escalation_scan": "starter.decision_sla", \/\/ MUTATION M5: the starter is not run on its trigger/' "$C/apps/worker/src/automation/starters.ts"
      F=tests/qa/integration/a13-starters-run.test.ts; P="starter.blocker_red" ;;
esac
{ echo "== $id applied (diff of the disposable clone):"; git -C "$C" diff --stat; git -C "$C" diff -U0 -- apps packages | grep '^[+-][^+-]'; echo "== test: $F ${P:+-t \"$P\"}"; } > "$LOG"
( cd "$C" && QA_PG_PORT=23670 MTH_PORT_POOL=23671-23699 timeout 900 tests/qa/support/with-pg.sh \
    npx vitest run --configLoader runner --project integration "$F" ${P:+-t "$P"} ) >> "$LOG" 2>&1
rc=$?
echo "$id exit=$rc" | tee -a "$LOG"
rm -rf "$C"
