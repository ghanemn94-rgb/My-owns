#!/usr/bin/env bash
# qa-verifier T-DG6-QA-H: isolates the second mechanism behind the A13 order dependence, on a FRESH stack.
#  1. with NO worker running, dev.lead creates 12 synthetic transformations (12 transformation.created events wait in
#     the outbox, as the earlier root specs leave them);
#  2. the A13 spec AS IT WAS AT HEAD (copied from `git show HEAD:...` to a temporary e2e/ file, removed afterwards)
#     runs in chromium-en: its worker relays the 12 events, its rule goes live with the disclosed fault while they are
#     still being evaluated;
#  3. the database shows whether the spec's rule acted on the 12 OLDER events (tasks for their trigger keys) and how
#     many automation.evaluate jobs then failed / were retried with the synthetic fault.
# Run inside apps/web/e2e/support/with-stack.sh from the repository root. Synthetic data only.
set -uo pipefail
U="${DATABASE_OWNER_URL%%\?*}"
sql() { PGOPTIONS="-c role=mth_owner" psql "$U" -X -qAt -F' | ' -c "$1"; }
node --input-type=module -e '
const base = process.env.E2E_BASE_URL;
const login = await fetch(`${base}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ username: "dev.lead" }) });
const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const me = await (await fetch(`${base}/api/v1/me`, { headers: { cookie } })).json();
for (let i = 1; i <= 12; i++) {
  const r = await fetch(`${base}/api/v1/transformations`, { method: "POST", headers: { cookie, origin: base, "content-type": "application/json", "x-csrf-token": me.csrfToken },
    body: JSON.stringify({ businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic QA-H older event ${i}`, mode: "end_to_end" }) });
  if (r.status !== 201) { console.error("create", i, r.status, await r.text()); process.exit(1); }
}
console.log("created 12 synthetic transformations with no worker running");
'
sql "SELECT 'outbox before the spec: unpublished transformation.created', count(*) FROM outbox_event WHERE event_type = 'transformation.created' AND published_at IS NULL"
TMP_SPEC=e2e/zz-qa-h-head-a13.spec.ts
git show HEAD:e2e/a13-automation-recovery.spec.ts > "$TMP_SPEC"
trap 'rm -f "$TMP_SPEC"' EXIT
npx playwright test "$TMP_SPEC" --project=chromium-en --workers=1 --reporter=list --output="$TMPDIR/exp-out"
echo "=== HEAD A13 spec exit=$?"
rm -f "$TMP_SPEC"
sql "SELECT 'rule tasks by trigger', CASE WHEN e.idempotency_key IS NULL THEN 'other' WHEN t.name LIKE 'Synthetic QA-H older event%' THEN 'OLDER event (created before the rule)' ELSE 'the spec''s own events' END, count(*)
       FROM work_item w
       LEFT JOIN outbox_event e ON w.dedupe_key LIKE 'automation:%:' || e.idempotency_key || ':1:%' AND e.event_type = 'transformation.created'
       LEFT JOIN transformation t ON t.id = e.aggregate_id
      WHERE w.dedupe_key LIKE 'automation:qa_a13_e2e_%' GROUP BY 2 ORDER BY 2"
sql "SELECT 'evaluate jobs that met the synthetic fault', state, count(*) FROM pgboss.job WHERE name = 'automation.evaluate' AND output::text LIKE '%qa-a13 synthetic transient fault%' GROUP BY 2 ORDER BY 2"
sql "SELECT 'rule executions by status', status, count(*) FROM automation_execution x JOIN automation_rule r ON r.id = x.automation_rule_id WHERE r.code LIKE 'qa_a13_e2e_%' GROUP BY 2 ORDER BY 2"
