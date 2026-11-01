#!/usr/bin/env bash
# qa-verifier T-DG6-QA-H: mutation M3b of e2e/a13-automation-recovery.spec.ts. M3 (mutations.sh) changed the status of
# an execution whose action RETURNED an error; in this scenario the disclosed fault makes the action THROW, so the
# execution ends in the engine's catch path and M3 was an equivalent mutant (the spec passed; reported). M3b breaks
# the path the scenario takes: on the last attempt a thrown action no longer finishes the execution `failed`. The
# spec must fail at "the failed execution". Run inside apps/web/e2e/support/with-stack.sh from the repository root;
# the product tree is never edited.
set -uo pipefail
ROOT="$(pwd)"
OUT="${QA_MUT_OUTPUT:-$TMPDIR/qa-h-mutations}"
dir="$TMPDIR/qa-h-mut-M3b"
rm -rf "$dir"
mkdir -p "$dir/apps/worker" "$OUT"
cp -r "$ROOT/apps/worker/dist" "$dir/apps/worker/dist"
cp "$ROOT/apps/worker/package.json" "$dir/apps/worker/package.json"
ln -s "$ROOT/apps/worker/node_modules" "$dir/apps/worker/node_modules"
perl -0pi -e 's/catch \(err\) \{\n        if \(isLastAttempt\(attempt\)\)\n            await finishExecution/catch (err) {\n        if (false)\n            await finishExecution/' "$dir/apps/worker/dist/automation/engine.js"
echo "--- mutant M3b (worker copy)"
diff "$ROOT/apps/worker/dist/automation/engine.js" "$dir/apps/worker/dist/automation/engine.js"
[ $? -eq 1 ] || { echo "MUTANT M3b: substitution did not apply"; exit 2; }
echo "=== M3b-thrown-failure-not-recorded start $(date -u +%FT%TZ)"
QA_WORKER_ENTRY="$dir/apps/worker/dist/main.js" npx playwright test e2e/a13-automation-recovery.spec.ts \
  --project=chromium-en --workers=1 --reporter=list --output="$OUT/M3b"
echo "=== M3b-thrown-failure-not-recorded exit=$?"
