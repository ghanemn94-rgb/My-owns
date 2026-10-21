# DG5 round 5: code-security source review notes (code-security-reviewer, T-DG5-REV-SEC-R5)

Candidate sha256:a18a9f054f3e0ee48510750785112067cec3e1af336cd988a63e1f9254cd3a9c (2189 files), source 0c88d5e, freeze 2ec59c7.
Diffs read: `git diff fb9c221..0c88d5e` (the round-5 repair delta) in full for product and tooling files, and the P5 diff
`git diff e70ac02..0c88d5e` (871 product files, migrations 0062-0097) for the targeted areas below. Line numbers are at 0c88d5e.

## Round-5 delta (fb9c221..0c88d5e)
- Product: apps/web only (T-DG5-FE-Z1B/Z1C, F-DG5-146). `git diff -w` of FormFramework.tsx, FormSchemaPage.tsx and
  ExportDialog.tsx is a wrapper swap (`div.table-scroll` -> `TableScrollRegion`) plus comments; app.css adds
  `grid-template-columns: minmax(0, 1fr)` on `.dialog`/`.dialog__body` and `flex-wrap` on `.dialog__footer`. No data
  flow, no request, no authorization or rendering-sink change (no dangerouslySetInnerHTML, href or eval added).
- Tooling: tools/agents/agent_settings.py:144 adds `"allowNestedUserNamespaces": True` (D-176). Judged in the D-176 section below.

## D-176 judgement (allowNestedUserNamespaces)
- The key only changes the INNER Claude Code Bash sandbox (it removes bwrap `--disable-userns`, the 2.1.304 default).
  The OUTER process sandbox (tools/agents/agent_sandbox.py) is unchanged: `--ro-bind / /` plus read-only binds of every
  repository root, `--cap-drop ALL` then `setpriv --bounding-set -all,+setfcap` (agent_sandbox.py:187-188), no_new_privs,
  and the per-run scope-only Landlock domain (landlock_exec.py; D-033).
- A user namespace created inside it inherits the parent's mounts as LOCKED copies: its full in-namespace CapEff cannot
  remount read-write, unmount or write a read-only bind. Proven in THIS environment (with nested user namespaces now
  enabled in my own Bash sandbox) by the project's own test, run in the clone against a throwaway fixture:
  process-sandbox.test.mjs "D-030: only CAP_SETFCAP remains, and neither the process nor a nested user namespace can
  unlock the read-only binds" PASS, and the whole suite 10/10 (07-*.log, 07b-*.log), including the symlink race (0 landed,
  kernel refusals 20-30 per scenario) and the F-DG0-152 Landlock cross-run test (viaProcRoot/viaProcCwd refused).
- My own direct probe (unshare -Urm + remount of read-only paths) and a read-only mountinfo/capability observation were
  both REFUSED by this session's safety classifier ("Containment Escape"). I did not retry or work around them; the
  project test above is the substitute evidence and exercises the same primitive on a fixture.
- Precision note (not a finding): the D-176 comment says confinement rests on "read-only binds and Landlock". Landlock
  here handles no filesystem access (handled_access_fs = 0); it confines writes only on the cross-run /proc/<peer>/root
  path (ptrace scoping). Same-run write confinement rests on the read-only binds, mount locking and the capability
  bounding set. Both layers hold with the setting.
- Residual (disclosed, not a write-confinement regression): user namespaces widen the reachable kernel attack surface
  for code run in the agent shell; this is the pre-2.1.304 state D-030 was verified under. No unit test pins the key;
  dropping it fails closed (harnesses cannot start PostgreSQL), so that is not a security gap.
- Verdict: write confinement still holds. Not a weakening of the gate tooling.

## Targeted P5 source checks (no defect found)
- Export download/get/cancel: apps/api/src/modules/reporting/exports/jobs.ts:177 `ownJob` filters `requested_by = caller`
  and re-checks transformation.read (404 otherwise); download :463; cancel :486 reloads grants (refreshPrincipal), locks
  730264, If-Match, one audit event. Create :346 re-authorizes at commit time; UNIQUE (requested_by, idempotency_key)
  (0081:43) with ON CONFLICT DO NOTHING + replay. Store keys are server-built `exports/<org>/<job>-a<attempt>.<ext>`
  (packages/reporting/src/storage.ts:55; apps/worker/src/reports/export-runner.ts:335, :346 earlier-attempt cleanup),
  `..` and non-`exports/` keys refused; Content-Disposition sanitized to [A-Za-z0-9_.-]; nosniff; private, no-store.
- Formula injection: packages/reporting/src/injection.ts:13 (= + - @ TAB CR) applied to every text cell in CSV
  (csv.ts:40) and XLSX (inline string + quotePrefix; formulas only from the fixed SUM template); decimal cells are
  regex-validated canonical decimals (packages/shared/src/schemas/report.ts:150), so a "-" number cannot carry a payload.
  The forms CSV export applies the same rule (apps/api/src/modules/forms/export.ts:91).
- Automation: dry run evaluates in a READ ONLY transaction that always rolls back (automation/dry-run.ts:271, :223) and
  writes only the append-only dry-run row after commit-time re-authorization (:286). Human-only codes cannot be
  registered (automation/registry.ts:71). Worker authorization decideActionAuthorization (apps/worker/src/automation/
  identity.ts:60): scope first, service identity limited to its service_permission_codes, initiating user re-checked.
  launch_procedure (required permission procedure.launch) is not registered, so it is not selectable.
  Exactly once: automation_execution_once_key (0074:408), automation_action_result_effect_once_key (0074:477).
- Relay: an unregistered type fails publish (no schema/queue) up to maxPublishAttempts and is then skipped
  (apps/worker/src/relay.ts:61, :121): bounded delay, never a permanent stall; registry at
  packages/shared/src/schemas/events.ts:176 (guarded by automation/outbox-registry.test.ts).
- Forms bulk edit: every item locked by id order and bound to the path transformation (forms/bulk.ts:236 ->
  forms/drafts.ts:103 `r.transformation_id = ...`), all-or-nothing, each item through the register's own updater.
- Procedures: authorizeStepWrite (procedures/steps.ts:502) tries the organization scope then T for an adopted step, with
  reloaded grants and the step-actor rule; 0096 permits exactly one transition (0096:59) and keeps the constraint name.
- 0094: the two row guards are disabled only for the backfill statement inside the migration's own transaction
  (0094:27-28, re-enabled :39-40); only the new column changes.
- Access/demo: self-grant refused (access/assignments.ts:110); seed-demo refused in production (demo/guard.ts:98);
  dev-issuer binding only with AUTH_MODE=dev and NODE_ENV != production (demo/guard.ts:129).
- Module graph: no import of workflows/admin from reporting, and no API import from the worker (matches are comments).
- Contract: 846 operationIds in docs/api/openapi.yaml; all 47 exported p5-pending lists empty (08-*.log).
- Secrets/CDN/eval scan of added lines (11-scans.log): only synthetic test values; no runtime external host.
