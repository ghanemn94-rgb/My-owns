#!/usr/bin/env bash
# qa-verifier T-DG6-QA-H: mutation M1b of e2e/a13-automation-recovery.spec.ts. M1 (mutations.sh) breaks the two
# application layers of "no duplicate on retry" (the `done` result is ignored, the work item's dedupe key is not
# stable); the database's third layer (partial UNIQUE automation_action_result_effect_once_key) then refuses the second
# `done` and the retry never resolves. M1b removes that layer as well, in the DISPOSABLE database of this stack only,
# so the retry succeeds WITH a duplicate task: the spec must fail at "after the retry: one task and one reminder".
# Run inside apps/web/e2e/support/with-stack.sh from the repository root; the product tree is never edited.
set -uo pipefail
ROOT="$(pwd)"
OUT="${QA_MUT_OUTPUT:-$TMPDIR/qa-h-mutations}"
dir="$TMPDIR/qa-h-mut-M1b"
rm -rf "$dir"
mkdir -p "$dir/apps/worker" "$OUT"
cp -r "$ROOT/apps/worker/dist" "$dir/apps/worker/dist"
cp "$ROOT/apps/worker/package.json" "$dir/apps/worker/package.json"
ln -s "$ROOT/apps/worker/node_modules" "$dir/apps/worker/node_modules"
perl -0pi -e 's/if \(done !== undefined\)/if (false)/' "$dir/apps/worker/dist/automation/engine.js"
perl -0pi -e 's/dedupeKey: `\$\{planned\.idempotencyKey\}:\$\{userId\}`/dedupeKey: `\${planned.idempotencyKey}:\${userId}:\${Date.now()}`/' \
  "$dir/apps/worker/dist/automation/actions/items.js"
echo "--- mutant M1b (worker copy)"
diff "$ROOT/apps/worker/dist/automation/engine.js" "$dir/apps/worker/dist/automation/engine.js"
diff "$ROOT/apps/worker/dist/automation/actions/items.js" "$dir/apps/worker/dist/automation/actions/items.js"
U="${DATABASE_OWNER_URL%%\?*}"
echo "--- mutant M1b (disposable database): DROP INDEX automation_action_result_effect_once_key"
PGOPTIONS="-c role=mth_owner" psql "$U" -X -v ON_ERROR_STOP=1 -c "DROP INDEX automation_action_result_effect_once_key"
echo "=== M1b-duplicate-on-retry-no-db-backstop start $(date -u +%FT%TZ)"
QA_WORKER_ENTRY="$dir/apps/worker/dist/main.js" npx playwright test e2e/a13-automation-recovery.spec.ts \
  --project=chromium-en --workers=1 --reporter=list --output="$OUT/M1b"
echo "=== M1b-duplicate-on-retry-no-db-backstop exit=$?"
PGOPTIONS="-c role=mth_owner" psql "$U" -X -qAt -c \
  "SELECT 'tasks per action key', regexp_replace(dedupe_key, ':[0-9]+$', ''), count(*) FROM work_item WHERE dedupe_key LIKE 'automation:qa_a13_e2e_%' GROUP BY 2 ORDER BY 2" || true
