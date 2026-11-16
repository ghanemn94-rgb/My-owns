# Automation operations guide

This guide is for the Mobily IT operators and technical administrators who run the platform's background jobs. It
explains what each job does, when it runs, under which service identity it runs, what happens when it fails and how to
recover. The Arabic summary is [automation-operations.ar-summary.md](automation-operations.ar-summary.md). This English
guide is the complete text.

Jobs never approve anything. No job decides a product gate (G1–G6), a business decision or a Finance validation. A
timer can escalate an overdue item to a person, but it never approves it. The product gates G1–G6 are business
approvals inside the product. They are unrelated to the engineering delivery gates DG0–DG7, and no job reads or writes
a delivery-gate record.

Accepting this handover is a decision of Mobily IT, made outside the platform. This package is engineering evidence,
not that acceptance.

## 1. How jobs run {#how-jobs-run}

- **One worker process type.** The worker (`apps/worker`, Compose service `worker`) runs every job. Its queues are
  pg-boss queues inside the platform's own PostgreSQL database. There is no separate message broker, and the worker
  needs no outbound network access for its jobs.
- **Two ways a job starts.**
  - **Events.** The API writes an event to the transactional outbox in the same transaction as the business change.
    After the commit, the worker's outbox relay sends one job to each queue that consumes the event type.
  - **Schedules.** Each scheduled job has a `job_schedule` row (cron expression and time zone, default `Asia/Riyadh`).
    The worker registers the schedules at start and again whenever an administrator changes one.
- **Exactly once.** Every job is idempotent. A replayed job finds its idempotency record or its advisory lock and
  writes nothing new. A retry never repeats an effect that has already completed.
- **Throughput settings.** `WORKER_JOB_BATCH_SIZE` (default 8) and the related worker variables of `.env.example`
  control how many jobs a worker fetches and runs at once. Several worker processes can run against one database.
- **A service identity per job** (ADR-0053). Each job runs as `job:<queue>`, with the narrowest set of **read**
  permissions it needs (the "Service identity" column below). A service identity can never hold a configure, business
  approval or Finance validation permission: the database refuses it. An administrator can narrow a job's grant, or
  restore it, in Administration > Service identities (`service_identity.configure`, `ADM_TECH`). An administrator can
  never widen it beyond the declaration.

## 2. The job table {#job-table}

The table below is generated from the worker's own registry by `tools/release/automation-jobs.mjs`. It lists every job
the worker registers and nothing else. Do not edit it by hand. After a code change, run
`node tools/release/automation-jobs.mjs --write`. `--check` fails when the table and the code differ (test T-H6).

How to read the columns:

- **Job (queue):** the pg-boss queue name. It is also the job code in Administration > Jobs.
- **Domain:** the handler file that owns the job (`apps/worker/src/handlers/<domain>`). `platform` means the worker
  registers the job itself (`apps/worker/src/worker.ts`).
- **Service identity:** the identity code and its declared permissions, as seeded by the migrations.
- **Trigger and default schedule:** the cron expression and time zone of the seeded `job_schedule` row, with its
  shipped state, and the outbox events the job consumes. A schedule can be changed after installation (section 3).
- **Retries:** the pg-boss retry policy of the queue (ADR-0008).
- **After the last attempt fails:** where the failure is recorded (section 4).
- **Recovery:** what an operator can do (sections 3 and 4).

<!-- generated:automation-jobs begin -->

50 registered jobs: 45 domain handlers (`DOMAIN_HANDLERS`) and 5 platform handlers (`worker.ts`). 23 have a `job_schedule` row, and 1 of those ships disabled.

| Job (queue) | Domain | Service identity (declared permissions) | Trigger and default schedule | Retries | After the last attempt fails | Recovery |
| --- | --- | --- | --- | --- | --- | --- |
| `adoption.indicator_evaluated` | adoption | `job:adoption.indicator_evaluated` (`transformation.read`, `user.read`) | event `kpi.deviation_evaluated` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `approval.escalation_scan` | approvals | `job:approval.escalation_scan` (`transformation.read`, `access.read`) | schedule `*/15 * * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `automation.evaluate` | automation | `job:automation.evaluate` (`transformation.read`, `automation.read`) | events `adoption.check_failed`, `benefit.evidence_submitted`, `benefit.variance_evaluated`, `blocker_status.recorded`, `connector.run_failed`, `control_check.failed`, `data.stale`, `dependency.slipped`, `gate.decided`, `gate.submitted`, `kpi.actual_accepted`, `kpi.deviation_evaluated`, `kpi.threshold_changed`, `kpi.trajectory_approved`, `kpi.values_recalculated`, `kpi.version_activated`, `procedure_step.activated`, `transformation.created` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `automation.failure_retry` | platform | `job:automation.failure_retry` (`automation.read`, `job.read`) | event `automation_failure.retry_requested` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `automation.job_failed` | automation | `job:automation.job_failed` (`job.read`) | event `job.failed` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `automation.tick_daily` | automation | `job:automation.tick_daily` (`transformation.read`, `automation.read`) | schedule `20 0 * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `automation.tick_hourly` | automation | `job:automation.tick_hourly` (`transformation.read`, `automation.read`) | schedule `7 * * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `benefits.finance_queue` | benefits | `job:benefits.finance_queue` (`transformation.read`, `access.read`) | event `benefit.evidence_submitted` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `benefits.recalculate_pending` | benefits | `job:benefits.recalculate_pending` (`transformation.read`; sensitive: aggregate_only) | event `kpi.values_recalculated` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `benefits.value_decided` | benefits | `job:benefits.value_decided` (`transformation.read`; sensitive: aggregate_only) | events `benefit.value_rejected`, `benefit.value_validated` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `branding.published` | branding | `job:branding.published` (`organization.read`) | event `branding.published` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `delegation.expiry_sweep` | access | `job:delegation.expiry_sweep` (`access.read`) | schedule `*/15 * * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `demo.reset` | demo | `job:demo.reset` (`organization.read`, `transformation.read`) | event `demo.reset_requested` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `gate.condition_escalation_scan` | gates | `job:gate.condition_escalation_scan` (`transformation.read`, `access.read`) | schedule `0 1 * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `gate.exception_expiry_scan` | gates | `job:gate.exception_expiry_scan` (`transformation.read`) | schedule `30 0 * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `gates.decided` | gates | `job:gates.decided` (`transformation.read`) | event `gate.decided` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `gates.submitted` | gates | `job:gates.submitted` (`transformation.read`, `access.read`) | event `gate.submitted` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `governance.blocker_escalation` | escalations | `job:governance.blocker_escalation` (`transformation.read`, `access.read`) | event `blocker_status.recorded` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `governance.blocker_escalation_scan` | escalations | `job:governance.blocker_escalation_scan` (`transformation.read`, `access.read`) | schedule `45 0 * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `governance.decision_sla_scan` | escalations | `job:governance.decision_sla_scan` (`transformation.read`, `access.read`) | schedule `40 0 * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `governance.meeting_cutoff_scan` | meetings | `job:governance.meeting_cutoff_scan` (`transformation.read`, `access.read`) | schedule `30 0 * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `governance.meeting_series_generate` | meetings | `job:governance.meeting_series_generate` (`transformation.read`) | schedule `35 0 * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `integrations.connector_exception` | integrations | `job:integrations.connector_exception` (no permission) | events `connector.run_failed`, `connector.run_recovered` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `integrations.connector_run` | integrations | `job:integrations.connector_run` (`connector.read`) | schedule `* * * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `job_schedule.updated` | platform | `job:job_schedule.updated` (`job.read`) | event `job_schedule.updated` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | `ops.failed` only (not captured in the failure queue) | schedules are re-registered at every worker start |
| `jobs.run_now` | platform | `job:jobs.run_now` (`job.read`) | event `job.run_requested` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `kpi.freshness_scan` | operations | `job:kpi.freshness_scan` (`transformation.read`, `operations.read`) | schedule `25 * * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `kpi.recalculate` | kpi | `job:kpi.recalculate` (`transformation.read`) | events `kpi.actual_accepted`, `kpi.threshold_changed`, `kpi.trajectory_approved`, `kpi.version_activated`, `kpi_restatement.approved` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `kpi.reporting_period_open` | kpi | `job:kpi.reporting_period_open` (`transformation.read`) | schedule `5 0 * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `launch.day_ninety_tests` | launch | `job:launch.day_ninety_tests` (`transformation.read`) | schedule `50 0 * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `maintenance.purge_expired` | platform | `job:maintenance.purge_expired` (no permission) | pg-boss schedule `*/15 * * * *` (worker start; not a job_schedule row) | retry limit 2 (up to 3 attempts), delay 60 s, fixed | `ops.failed` only (not captured in the failure queue) | the next scheduled run |
| `notification.digest` | digests | `job:notification.digest` (`user.read`) | schedule `*/15 * * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `notifications.delivery_sweep` | notifications | `job:notifications.delivery_sweep` (`transformation.read`, `user.read`, `access.read`, `operations.read`) | schedule `* * * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `notifications.fanout` | notifications | `job:notifications.fanout` (`transformation.read`, `user.read`, `access.read`, `operations.read`) | event `inbox_notification.created` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `operations.exception_alerts` | operations | `job:operations.exception_alerts` (`operations.read`, `access.read`) | schedule `* * * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `operations.exception_raise` | operations | `job:operations.exception_raise` (`transformation.read`, `operations.read`) | event `data.stale` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `portfolio.dependency_slip` | portfolio | `job:portfolio.dependency_slip` (`transformation.read`) | event `dependency.slipped` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `raid.corrective_adoption` | raid | `job:raid.corrective_adoption` (`transformation.read`, `user.read`) | event `adoption.check_failed` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `raid.corrective_benefit` | raid | `job:raid.corrective_benefit` (`transformation.read`, `user.read`) | event `benefit.variance_evaluated` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `raid.corrective_control` | raid | `job:raid.corrective_control` (`transformation.read`, `user.read`) | event `control_check.failed` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `raid.corrective_kpi` | raid | `job:raid.corrective_kpi` (`transformation.read`, `user.read`) | event `kpi.deviation_evaluated` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `reports.export` | reports | `job:reports.export` (`transformation.read`) | event `export_job.requested` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `reports.owner_update_tasks` | reports | `job:reports.owner_update_tasks` (`transformation.read`) | schedule `40 0 * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `retention.archive` | retention | `job:retention.archive` (`retention.read`) | schedule `0 2 * * 1` (Asia/Riyadh), **disabled**; event `retention_run.requested` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `search.index_feed` | search | `job:search.index_feed` (`transformation.read`) | schedule `* * * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `search.reindex` | search | `job:search.reindex` (`transformation.read`) | schedule `30 2 * * 0` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `sustainment.control_check_scan` | sustainment | `job:sustainment.control_check_scan` (`transformation.read`) | schedule `25 0 * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `sustainment.review_scan` | sustainment | `job:sustainment.review_scan` (`transformation.read`) | schedule `20 0 * * *` (Asia/Riyadh), enabled | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`); `runJobNow` when enabled (`job.repair`) |
| `transfer.export` | transfer | `job:transfer.export` (no permission) | event `migration_export.requested` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |
| `transformation.created` | platform | `job:transformation.created` (`transformation.read`, `access.read`, `methodology.read`) | event `transformation.created` | retry limit 5 (up to 6 attempts), delay 10 s, exponential backoff | failure queue (`operational_failure`), event `job.failed` → `automation.job_failed`, exception `job_failed`; then `ops.failed` | retry from the failure queue (`retryAutomationFailure`, `job.repair`) |

<!-- generated:automation-jobs end -->

## 3. Schedules and "run now" {#schedules}

- **Where:** Administration > Jobs lists every schedule (`listJobSchedules`, `job.read`). Administration > Jobs >
  Operations shows each job's recent runs (`listJobOperations`, `getJobOperation`).
- **Change a schedule:** enable, disable or reschedule a job with `updateJobSchedule`
  (`PATCH /api/v1/admin/job-schedules/{jobCode}`, `job.configure`, `ADM_TECH` by default). The request needs the
  schedule's current version (`If-Match`). An invalid cron expression or an unknown time zone is refused (422
  `job.cron_invalid`, `job.timezone_unknown`). Every change is recorded in the audit trail. The worker re-registers the
  schedules from the `job_schedule.updated` event, and again at every start.
- **Run now:** `runJobNow` (`POST /api/v1/admin/jobs/{jobCode}/run`, `job.repair`, `ADM_TECH`) sends one run of a
  scheduled job at once (at most one per minute). The run is recorded like a scheduled one. A disabled schedule is
  refused (422 `job.schedule_disabled`).
- **Time zone and working days.** Schedules use their own time zone (default `Asia/Riyadh`). Jobs that count working
  days use the configurable business calendar (Administration > Calendar), never elapsed days and never a hard-coded
  holiday list.

## 4. The failure queue {#failure-queue}

When the **last** attempt of a job fails (after the retries of its queue policy), the worker records the failure in one
transaction:

1. one row in the failure queue (`operational_failure`), with the queue, the job data, the attempts and the error code;
2. the outbox event `job.failed`, which the queue `automation.job_failed` consumes (starter rule 16,
   `starter.job_failed`, records it as an automation execution);
3. an operational exception of class `job_failed` for the job (section 5), which alerts the people who can act on it.

The job then also reaches the pg-boss dead-letter queue `ops.failed`, as before.

**Two platform jobs are not captured in the failure queue:** `maintenance.purge_expired` and `job_schedule.updated`.
Their failures reach `ops.failed` only. The purge runs again at its next 15-minute slot. The schedules are registered
again at every worker start. The table above shows this in the "After the last attempt fails" column.

**What an operator does** (Administration > Automation > Failures; `listAutomationFailures`, `getAutomationFailure`):

- **Retry** (`retryAutomationFailure`, `If-Match`): the job is sent again to its original queue with its original data
  and idempotency key, so effects that already completed are not repeated. Failed jobs need `job.repair` (`ADM_TECH`).
  Failed automation rule executions need `automation.repair` (`ADM_TECH`, `ADM_METHOD`). One failure can be retried at
  most 20 times (422 `automation_failure.retry_limit`).
- **Dismiss** (`dismissAutomationFailure`, `If-Match`) with a reason, when the failure needs no retry (for example the
  record it named was withdrawn). Same permissions as retry.
- Every retry and dismissal is recorded in the audit trail. Readers: `job.read` for jobs, `automation.read` for rule
  executions.

**Service-identity failures.** A job whose identity row is missing, or whose grant was narrowed below what it needs,
fails with `service_identity.missing` or `service_identity.out_of_scope`. Restore the grant in Administration > Service
identities, then retry the failure. In this release, these failures are still retried under the queue policy before
they reach the failure queue (ADR-0053 §1, "Shipped status"). Retrying them does not help until the grant is restored.

## 5. Operational exceptions and alerts {#exceptions}

- **Where:** Administration > Operations (`listOperationalExceptions`, `operations.read`: `ADM_TECH`, `TO`, `KDS`,
  `TD`, `AUD`).
- **Classes:** `job_failed` (a job's last attempt failed), `connector_run_failed`, `connector_unreachable`,
  `connector_credentials_rejected` (connector runs), `data_stale` (a KPI's last accepted data became stale; the job
  `kpi.freshness_scan`), and `heartbeat_missed` (section 6). There is at most one active exception per source and class.
  A repeat failure increments its occurrence count.
- **Alerts:** the job `operations.exception_alerts` runs every minute. For each newly opened exception it writes one log
  line at level `error` with `alert: true` and `alertCode` set to the class, and sends one in-app notification to each
  holder of `operations.acknowledge`. A recurrence does not alert again. Forward the `alert: true` log lines to IT's
  monitoring. The platform does not page anyone itself.
- **Acknowledge and resolve:** `acknowledgeOperationalException` and `resolveOperationalException`
  (`operations.acknowledge`: `ADM_TECH`, `KDS`), each with `If-Match` and an audit event. A manual resolution needs a
  note. An exception is resolved automatically (`recovered`) when its source succeeds again. Acknowledging an
  operational exception is an operations action. It approves nothing.

## 6. Reading the worker heartbeat {#heartbeat}

- Each worker process writes a heartbeat every `WORKER_HEARTBEAT_SECONDS` seconds (default 30, allowed 1–30).
- The status (`getWorkerHeartbeat`, `GET /api/v1/admin/operations/heartbeat`; the card on Administration > Operations;
  the worker line of Administration > Deployment status) is:
  - **alive:** the newest beat is at most 90 seconds old;
  - **stale:** the newest beat is older than 90 seconds;
  - **unknown:** no beat has ever been written (for example a worker that never started).
- Stale and unknown are never shown as alive or green.
- **The heartbeat watch.** Each API process checks every 60 seconds. When a beat exists and is older than 90 seconds,
  it opens the exception `worker:worker:heartbeat_missed` (class `heartbeat_missed`) and writes its own `error` alert
  log line, because the worker that would send the alert is down. When beats resume, the exception is resolved as
  `recovered`. A worker that has never beaten shows unknown and raises no exception.
- **Readiness.** `/readyz` reports the worker but does not depend on it: an API whose worker is down stays in the load
  balancer, and the heartbeat and its exception make the problem visible.
- **First steps when the worker is stale:** check that the worker container or process is running; read its JSON log
  lines on standard output for the last error; check that it reaches the database (its `DATABASE_URL`); restart it.
  Events written while it was down stay in the outbox and are relayed when it is back. A scheduled slot that passed
  while it was down is not guaranteed to be replayed: use "run now" (section 3) when a run is needed before the next
  slot. Failed jobs wait in the failure queue (section 4).

## 7. The retention job {#retention-job}

`retention.archive` (ADR-0067) archives and, where configured, deletes **operational** records that are past a
retention period agreed with Mobily IT.

- **Shipped state.** Its weekly schedule (`0 2 * * 1`, `Asia/Riyadh`) ships **disabled**. Every retention class ships
  with the action "retain" and no period, shown as "Not set (IT to agree)" and never as 0. A fresh installation
  archives and deletes nothing.
- **Service identity:** `job:retention.archive` (`retention.read` only). It writes only through the run it was given and
  the database's purge function.
- **What can never be archived or deleted:** business records (evidence included), the audit trail, report snapshots,
  the system catalogue, the search index and the retention and backup history. The database refuses it. Only five
  operational tables can be configured: `job_run`, `webhook_receipt`, `processed_message`, `worker_heartbeat` and the
  read items of `inbox_notification`.
- **Enabling it, in this order:**
  1. Agree the period of each class with Mobily IT, outside the platform.
  2. Set the class's action, period and IT reference text in Administration > Retention (`updateRetentionClass`,
     `retention.configure`, `ADM_TECH`, `If-Match`). The IT reference is a reference, not an approval by the platform.
     Archiving read inbox items or heartbeat rows changes what users see: an archived read notification can no longer
     be marked unread, and a deleted one leaves the inbox.
  3. Request a **dry run** first (`createRetentionDryRun`, `POST /api/v1/admin/retention/dry-runs`, `retention.run`,
     `ADM_TECH`). It records what it would archive or delete (`listRetentionRunActions`) and changes nothing else.
  4. Review the dry run. Then request a run (`createRetentionRun`), or enable the weekly schedule (section 3).
- **One run at a time.** A second request while a run is queued or running is refused (422 `retention.run_in_progress`).
  A class change and a run start take the same advisory lock, so a run never sees a class change half-way.
- **Output.** Archive sets are written to the evidence store under `retention/<runId>/` (`manifest.json` and one NDJSON
  file per table) before any record is marked. Each archived, deleted or skipped record has one audit event. Archived
  records are listed in Administration > Retention > Archived (`listRetentionArchivedRecords`).
- **Known limitations (this release):**
  - a worker crash during a run leaves the run `running`, and no API operation ends it, so later runs and class
    changes are refused until an operator ends that run in the database (T-DG7-BE-G handback, gap 2);
  - the periods are placeholders until IT agrees them;
  - pg-boss keeps its own completed-job history under its own settings, which is not a retention class;
  - the batch size (500 rows per transaction) is a design value, not measured at scale.

## 8. The transfer export job {#transfer-export}

`transfer.export` (ADR-0064) writes a whole-installation migration package for a transfer to another environment.

- **Started by a person, never by a schedule.** A technical administrator requests an export with a reason in
  Administration > Data export (`createMigrationExport`, `migration.export`, `ADM_TECH`). The request writes the
  `migration_export.requested` event, and the job consumes it.
- **Service identity:** `job:transfer.export`, with no permission code. The start is gated by `migration.export`, every
  export is audited, and no API operation returns row data.
- **Output.** The job writes the package (one file per table, the manifest, the attachment manifest and the evidence
  bytes) into the evidence store under the export's own prefix, exactly once per export. IT copies the package to the
  target. The package never leaves through the API. Follow the status with `getMigrationExport`.
- **Known limitations (this release):** evidence held in S3-compatible object storage is not exported yet. An export
  that meets such evidence fails and names the object; it never skips it. The export's scale has not been measured
  beyond test data.

## 9. Sources {#sources}

- Job registry: `apps/worker/src/handlers/index.ts`, `apps/worker/src/worker.ts`; queue policy:
  `apps/worker/src/queues/**`; service identities: `apps/worker/src/kit.ts` (`JOB_SERVICE_IDENTITIES`).
- Seeded schedules: the `job_schedule` rows of `packages/db/migrations/`.
- Decisions: ADR-0008 (worker and queues), ADR-0043 (automation engine and failure queue), ADR-0053 (service
  identities, exceptions, heartbeat), ADR-0064 (migration export), ADR-0067 (retention).
- The role defaults named here are the platform's configurable starting point
  ([role-matrix.md](role-matrix.md)), not a Mobily-approved access policy.
