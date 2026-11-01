#!/usr/bin/env bash
# qa-verifier T-DG6-QA-H: mutation checks of e2e/a13-automation-recovery.spec.ts (A13 / REQ-S12-002 / REQ-S20-013).
# Each mutant is a COPY of the built worker (apps/worker/dist) under $TMPDIR with ONE deliberate defect; the product
# tree is never edited. The spec's worker is pointed at the copy with QA_WORKER_ENTRY (e2e/support/a13-a22-stack.ts).
# Run inside apps/web/e2e/support/with-stack.sh, from the repository root. Every mutant must make the spec FAIL at
# the named assertion; the control (no QA_WORKER_ENTRY) must PASS. Prints "=== <name> exit=<n>" per run.
set -uo pipefail
ROOT="$(pwd)"
OUT="${QA_MUT_OUTPUT:-$TMPDIR/qa-h-mutations}"
mkdir -p "$OUT"

mutant() { # name file perl-substitution
  local name="$1" file="$2" expr="$3" dir="$TMPDIR/qa-h-mut-$1"
  rm -rf "$dir"
  mkdir -p "$dir/apps/worker"
  cp -r "$ROOT/apps/worker/dist" "$dir/apps/worker/dist"
  cp "$ROOT/apps/worker/package.json" "$dir/apps/worker/package.json"
  ln -s "$ROOT/apps/worker/node_modules" "$dir/apps/worker/node_modules"
  local before after
  before="$(sha256sum "$dir/apps/worker/dist/$file" | cut -d' ' -f1)"
  perl -0pi -e "$expr" "$dir/apps/worker/dist/$file"
  after="$(sha256sum "$dir/apps/worker/dist/$file" | cut -d' ' -f1)"
  if [ "$before" = "$after" ]; then
    echo "MUTANT $name: substitution did not apply to $file" >&2
    return 1
  fi
  echo "--- mutant $name: $file" >&2
  diff "$ROOT/apps/worker/dist/$file" "$dir/apps/worker/dist/$file" >&2 || true
  echo "$dir/apps/worker/dist/main.js"
}

run() { # name [entry]
  local name="$1" entry="${2:-}"
  echo "=== $name start $(date -u +%FT%TZ)"
  if [ -n "$entry" ]; then
    QA_WORKER_ENTRY="$entry" npx playwright test e2e/a13-automation-recovery.spec.ts --project=chromium-en --workers=1 \
      --reporter=list --output="$OUT/$name"
  else
    npx playwright test e2e/a13-automation-recovery.spec.ts --project=chromium-en --workers=1 --reporter=list \
      --output="$OUT/$name"
  fi
  echo "=== $name exit=$?"
}

# M1 duplicate on retry: the resumed execution re-runs the action already done (its `done` result is ignored) and
#    the work item's dedupe key is no longer stable. Expected: "after the retry: one task and one reminder" fails.
E=$(mutant M1-duplicate-on-retry automation/engine.js 's/if \(done !== undefined\)/if (false)/' | tail -1) &&
  perl -0pi -e 's/dedupeKey: `\$\{planned\.idempotencyKey\}:\$\{userId\}`/dedupeKey: `\${planned.idempotencyKey}:\${userId}:\${Date.now()}`/' \
    "$(dirname "$E")/automation/actions/items.js" &&
  diff "$ROOT/apps/worker/dist/automation/actions/items.js" "$(dirname "$E")/automation/actions/items.js";
  [ $? -eq 1 ] && run M1-duplicate-on-retry "$E"
# M2 no evaluator: the worker never consumes automation.evaluate (the reported symptom). Expected: "this spec's
#    transformation.created event to be relayed and evaluated" times out with the job `created`.
E=$(mutant M2-no-evaluator worker.js 's/for \(const h of handlers\) \{/for (const h of handlers.filter((x) => x.queue !== "automation.evaluate")) {/' | tail -1) &&
  run M2-no-evaluator "$E"
# M3 failure hidden: an execution whose action failed finishes `succeeded`. Expected: "the failed execution" times out.
E=$(mutant M3-failure-hidden automation/engine.js 's/status: firstError === null \? "succeeded" : "failed",/status: "succeeded",/' | tail -1) &&
  run M3-failure-hidden "$E"
# M4 retry inert: the retry dispatcher treats every request as stale. Expected: "the retried entry resolved" times out.
E=$(mutant M4-retry-inert worker.js 's/if \(failure === undefined \|\| failure\.status !== "retrying"/if (true || failure === undefined || failure.status !== "retrying"/' | tail -1) &&
  run M4-retry-inert "$E"
# M5 partial work lost: the create_task action writes no task. Expected: "partial failure: the task is written, the
#    reminder is not" fails (tasks 0).
E=$(mutant M5-task-not-written automation/actions/items.js 's/for \(const userId of recipients\) \{/for (const userId of []) {/' | tail -1) &&
  run M5-task-not-written "$E"
# Control: the built production worker. Expected: PASS.
run control
