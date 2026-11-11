# qa-verifier DG6 clean re-gate R6 re-measurement (PROVISIONAL, shared loaded host)

> **Engineering measurements on the stated sandbox host, not Mobily production capacity.** The targets (p95 of ordinary
> reads and updates ≤ 2 s, key dashboards ≤ 4 s) are M0398's provisional engineering targets, not verified Mobily
> capacity requirements. Final production scale, availability and recovery objectives must be agreed with Mobily IT
> (REQ-S20-029 notes). One host running everything is not a high-availability deployment. The dataset and every
> user are synthetic. Nothing here is a G1–G6 business approval or a DG0–DG7 gate decision.

## 1. Results per class (steady state; milliseconds; nearest-rank)

| Class | Target p95 | rep-1 p95 | Highest p95 | Result |
| --- | --- | --- | --- | --- |
| Ordinary read | 2 s | 15.7 | 15.7 | within target |
| Ordinary update | 2 s | 25.5 | 25.5 | within target |
| Search | 2 s | 14.3 | 14.3 | within target |
| Key dashboard | 4 s | 34.6 | 34.6 | within target |
| Export start | 2 s | 30.4 | 30.4 | within target |
| Ordinary read incl. search | 2 s | 15.5 | 15.5 | within target |

Per repetition (p50 / p95 / p99 / max in ms; count; errors; 409 conflicts):

| Class | Repetition | p50 | p95 | p99 | max | count | errors | conflicts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ordinary read | rep-1 | 5.4 | 15.7 | 26.6 | 59.3 | 7550 | 0 | 0 |
| Ordinary update | rep-1 | 12.4 | 25.5 | 36.0 | 99.8 | 2082 | 0 | 0 |
| Search | rep-1 | 7.6 | 14.3 | 25.6 | 56.0 | 1216 | 0 | 0 |
| Key dashboard | rep-1 | 17.7 | 34.6 | 47.4 | 137.8 | 3771 | 0 | 0 |
| Export start | rep-1 | 16.0 | 30.4 | 44.2 | 57.6 | 312 | 0 | 0 |
| Ordinary read incl. search | rep-1 | 6.1 | 15.5 | 26.6 | 59.3 | 8766 | 0 | 0 |

## 2. Misses against the targets (each a Medium, non-mandatory finding candidate; ADR-0058 §1, D-195 Q9)

None of the five ADR-0058 §3 classes missed its target in any repetition.

## 3. Per operation (steady state; ms)

| Operation | Class | rep-1 p95 (n, err) |
| --- | --- | --- |
| `createExport` | export | 30.4 (312, 0) |
| `getExecutiveOverview` | dashboard | 35.9 (924, 0) |
| `getFinanceDashboard` | dashboard | 35.1 (992, 0) |
| `getInitiative` | read | 19.4 (857, 0) |
| `getMe` | read | 11.8 (859, 0) |
| `getMyNavigation` | read | 7.4 (819, 0) |
| `getMyWork` | dashboard | 31.3 (907, 0) |
| `getTransformation` | read | 9.4 (869, 0) |
| `getTransformationDashboard` | dashboard | 33.6 (948, 0) |
| `listFormRecordVersions` | read | 16.0 (840, 0) |
| `listInitiatives` | read | 25.3 (783, 0) |
| `listMyWorkItems` | read | 8.1 (867, 0) |
| `listSavedViews` | read | 10.1 (847, 0) |
| `listTransformations` | read | 10.0 (809, 0) |
| `putSavedView` | update | 21.2 (1346, 0) |
| `searchRecords` | search | 14.3 (1216, 0) |
| `updateFormDraft` | update | 27.2 (380, 0) |
| `updateInitiative` | update | 31.4 (356, 0) |

Operations of the ADR-0058 §3 mix with no steady-state sample (**not measured**, never 0; the reason is in the run notes): `getWorkstreamDashboard`.

Non-success responses (repetition, operation, HTTP status; 0 = network failure): 

- none

## 4. The dataset

Profile `default` of `deploy/load/generate.mjs` (ADR-0058 §2). The marker row:

```json
{
  "users": 120,
  "singleton": true,
  "initiatives": 1000,
  "kpi_actuals": 10000,
  "random_seed": 20261027,
  "audit_events": 100000,
  "dataset_code": "mth_load_v1",
  "generated_at": "2026-11-11T17:25:55.632214+00:00",
  "transformations": 50,
  "generator_version": "1.0.0"
}
```

Counts at capture (before the repetitions; the run's own updates add audit events):

```json
{
  "transformations": 50,
  "initiatives": 1000,
  "kpi_actuals": 10000,
  "audit_events": 100000,
  "users": 120
}
```

Search index state at capture:

```
benefit: idle
business_case: idle
change_request: idle
decision: idle
deliverable: idle
dependency: idle
evidence: idle
initiative: idle
kpi_definition: idle
lesson: idle
raid_entry: idle
transformation: idle
```

## 5. The workload (ADR-0058 §3, §6)

- `deploy/load/workload.mjs` version 1.0.0; 100 concurrent virtual users, each with its own minted session (`deploy/load/sessions.mjs`); seed 20261027.
- Warm-up 60 s (excluded), steady state 300 s per repetition; 1 repetition(s), each on a freshly started API and worker over the same database.
- Think time 1000–3000 ms (integer, uniform, seeded per user and repetition). Measured from just before `fetch` to the end of the body, integer microseconds.
- Class draw by share; a class with no operation the user may perform (for example updates for an AUD user) is left out of that user's draw. Achieved shares of steady-state requests:

| Class | Planned % | Achieved % | Requests |
| --- | --- | --- | --- |
| read | 50 | 50.6 | 7550 |
| update | 15 | 13.9 | 2082 |
| search | 8 | 8.1 | 1216 |
| dashboard | 25 | 25.3 | 3771 |
| export | 2 | 2.1 | 312 |

Request templates:

| Operation | Class | Method | Path | Body |
| --- | --- | --- | --- | --- |
| `getMe` | read | GET | `/api/v1/me` | — |
| `getMyNavigation` | read | GET | `/api/v1/me/navigation` | — |
| `listTransformations` | read | GET | `/api/v1/transformations?sort={code|-code|updatedAt|-updatedAt}` | — |
| `getTransformation` | read | GET | `/api/v1/transformations/{transformationId}` | — |
| `listInitiatives` | read | GET | `/api/v1/initiatives?transformationId={t}&limit=50 + one of: sort={code|-code|name|-name|plannedEnd|-plannedEnd|updatedAt|-updatedAt} / q={term} / executiveOwnerUserId={u}; then &cursor={nextCursor} on the next call of the same user while the page has one` | — |
| `getInitiative` | read | GET | `/api/v1/initiatives/{initiativeId}` | — |
| `listFormRecordVersions` | read | GET | `/api/v1/transformations/{t}/form-records/T05/{initiativeId}/versions` | — |
| `listMyWorkItems` | read | GET | `/api/v1/me/work-items` | — |
| `listSavedViews` | read | GET | `/api/v1/saved-views?listKey=initiatives` | — |
| `updateInitiative` | update | PATCH | `/api/v1/initiatives/{own partitioned initiativeId}` | `{"risksSummary":"LOAD risks summary r{rep} u{user} n{k}"} with If-Match: {ETag} and X-CSRF-Token` |
| `putSavedView` | update | PUT | `/api/v1/saved-views/{own savedViewId}` | `{"name":"LOAD view u{user} r{rep}","columns":["code","name"(,"plannedEnd")],"filters":{},"sort":[{"key":"code","direction":"asc|desc"}],"isDefault":false} with If-Match` |
| `updateFormDraft` | update | PUT | `/api/v1/transformations/{t}/form-drafts/{own draftId}` | `{"payload":{"name":"LOAD draft u{user} n{k}"}} with If-Match` |
| `searchRecords` | search | GET | `/api/v1/search?q={term, en or ar}&limit=20` | — |
| `getExecutiveOverview` | dashboard | GET | `/api/v1/overview?organizationId={org}` | — |
| `getTransformationDashboard` | dashboard | GET | `/api/v1/transformations/{t}/dashboard` | — |
| `getWorkstreamDashboard` | dashboard | GET | `/api/v1/transformations/{t}/workstreams/{workstreamId}/dashboard` | — |
| `getFinanceDashboard` | dashboard | GET | `/api/v1/dashboards/finance?organizationId={org}` | — |
| `getMyWork` | dashboard | GET | `/api/v1/me/work` | — |
| `createExport` | export | POST | `/api/v1/exports` | `{"format":"csv","language":"en","report":{"definitionCode":"registers","subjectId":"{t}","parameters":{"register":"raid|benefits|kpis|decisions|dependencies"}}} with Idempotency-Key` |

## 6. The infrastructure (measured at the run; ADR-0058 §5)

- CPU: Intel(R) Xeon(R) Processor @ 2.10GHz; 4 logical CPUs (availableParallelism 4).
- Memory: MemTotal:       16472084 kB; MemAvailable:   13679128 kB; SwapTotal:             0 kB.
- Kernel 6.18.44-fc-v378; Node v24.21.0.
- PostgreSQL: PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit; database size 163 MB.
- Processes: API 1 process(es), database pool max 20; worker 1 process(es), pool max 5.

PostgreSQL settings not at their default (`SELECT name, setting FROM pg_settings WHERE source NOT IN ('default', 'override')`):

| name | setting | unit | source |
| --- | --- | --- | --- |
| DateStyle | ISO, MDY |  | configuration file |
| TimeZone | Etc/UTC |  | configuration file |
| application_name | mth-load report (infrastructure) |  | client |
| client_encoding | UTF8 |  | client |
| default_text_search_config | pg_catalog.english |  | configuration file |
| dynamic_shared_memory_type | posix |  | configuration file |
| fsync | off |  | command line |
| lc_messages | C |  | configuration file |
| lc_monetary | C |  | configuration file |
| lc_numeric | C |  | configuration file |
| lc_time | C |  | configuration file |
| listen_addresses | 127.0.0.1 |  | command line |
| log_timezone | Etc/UTC |  | configuration file |
| max_connections | 200 |  | command line |
| max_wal_size | 1024 | MB | configuration file |
| min_wal_size | 80 | MB | configuration file |
| port | 32581 |  | command line |
| shared_buffers | 16384 | 8kB | configuration file |
| unix_socket_directories |  |  | command line |

Disk as reported by the OS (`df -kP`):

```
Filesystem     1024-blocks     Used Available Capacity Mounted on
/dev/vda         264212084 37979696   2374316      95% $TMPDIR
Filesystem     1024-blocks     Used Available Capacity Mounted on
/dev/vda         264212084 37979696   2374316      95% $TMPDIR
```

Machine load average (1 min), sampled every 5 s during each repetition:

| Repetition | Started | Ended | Samples | min | mean | max |
| --- | --- | --- | --- | --- | --- | --- |
| rep-1 | 2026-11-11T17:26:47.221Z | 2026-11-11T17:32:50.056Z | 74 | 2.61 | 3.48 | 4.43 |

**The load harness, the API, the worker and PostgreSQL share ONE sandbox host, so every figure includes client-side CPU contention. This is not Mobily production infrastructure, and a single-host run is not evidence of high availability or production capacity.**

