# DG6 load run 1 (first run, draft report; T-DG6-DO-F)

> **Engineering measurements on the stated sandbox host, not Mobily production capacity.** The targets (p95 of ordinary
> reads and updates ≤ 2 s, key dashboards ≤ 4 s) are M0398's provisional engineering targets, not verified Mobily
> capacity requirements. Final production scale, availability and recovery objectives must be agreed with Mobily IT
> (REQ-S20-029 notes). One host running everything is not a high-availability deployment. The dataset and every
> user are synthetic. Nothing here is a G1–G6 business approval or a DG0–DG7 gate decision.

## 1. Results per class (steady state; milliseconds; nearest-rank)

| Class | Target p95 | rep-1 p95 | rep-2 p95 | rep-3 p95 | Highest p95 | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Ordinary read | 2 s | 745.8 | 658.2 | 681.2 | 745.8 | within target |
| Ordinary update | 2 s | 1007.4 | 918.0 | 980.3 | 1007.4 | within target |
| Search | 2 s | 748.2 | 634.1 | 707.2 | 748.2 | within target |
| Key dashboard | 4 s | 1185.3 | 1097.6 | 1191.2 | 1191.2 | within target |
| Export start | 2 s | 2688.1 | 2257.2 | 2453.3 | 2688.1 | MISS |
| Ordinary read incl. search | 2 s | 745.9 | 655.8 | 687.4 | 745.9 | within target |

Per repetition (p50 / p95 / p99 / max in ms; count; errors; 409 conflicts):

| Class | Repetition | p50 | p95 | p99 | max | count | errors | conflicts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ordinary read | rep-1 | 77.7 | 745.8 | 1655.2 | 5923.6 | 13313 | 0 | 0 |
| Ordinary read | rep-2 | 80.4 | 658.2 | 1334.9 | 3512.7 | 13338 | 0 | 0 |
| Ordinary read | rep-3 | 85.5 | 681.2 | 1501.2 | 3477.8 | 13359 | 0 | 0 |
| Ordinary update | rep-1 | 185.9 | 1007.4 | 1775.1 | 3517.7 | 3699 | 0 | 0 |
| Ordinary update | rep-2 | 193.8 | 918.0 | 1412.8 | 2396.8 | 3795 | 0 | 0 |
| Ordinary update | rep-3 | 211.7 | 980.3 | 1590.3 | 2800.7 | 3632 | 0 | 0 |
| Search | rep-1 | 93.2 | 748.2 | 1663.6 | 2813.7 | 2166 | 0 | 0 |
| Search | rep-2 | 99.9 | 634.1 | 1177.9 | 1919.2 | 2129 | 0 | 0 |
| Search | rep-3 | 101.7 | 707.2 | 1434.7 | 2601.4 | 2179 | 0 | 0 |
| Key dashboard | rep-1 | 241.4 | 1185.3 | 1903.1 | 3714.5 | 6690 | 0 | 0 |
| Key dashboard | rep-2 | 249.2 | 1097.6 | 1606.7 | 2452.4 | 6688 | 0 | 0 |
| Key dashboard | rep-3 | 264.7 | 1191.2 | 1761.1 | 2544.5 | 6643 | 0 | 0 |
| Export start | rep-1 | 612.8 | 2688.1 | 3440.9 | 5139.1 | 525 | 0 | 0 |
| Export start | rep-2 | 681.5 | 2257.2 | 4362.2 | 8349.6 | 474 | 0 | 0 |
| Export start | rep-3 | 624.4 | 2453.3 | 4193.3 | 6593.8 | 484 | 0 | 0 |
| Ordinary read incl. search | rep-1 | 80.4 | 745.9 | 1656.7 | 5923.6 | 15479 | 0 | 0 |
| Ordinary read incl. search | rep-2 | 82.7 | 655.8 | 1324.9 | 3512.7 | 15467 | 0 | 0 |
| Ordinary read incl. search | rep-3 | 87.8 | 687.4 | 1494.1 | 3477.8 | 15538 | 0 | 0 |

## 2. Misses against the targets (each a Medium, non-mandatory finding candidate; ADR-0058 §1, D-195 Q9)

- **Export start**: highest p95 2688.1 ms against 2 s.

## 3. Per operation (steady state; ms)

| Operation | Class | rep-1 p95 (n, err) | rep-2 p95 (n, err) | rep-3 p95 (n, err) |
| --- | --- | --- | --- | --- |
| `createExport` | export | 2688.1 (525, 0) | 2257.2 (474, 0) | 2453.3 (484, 0) |
| `getExecutiveOverview` | dashboard | 1286.9 (1675, 0) | 1195.5 (1656, 0) | 1268.2 (1665, 0) |
| `getFinanceDashboard` | dashboard | 1297.2 (1741, 0) | 1222.7 (1663, 0) | 1307.5 (1670, 0) |
| `getInitiative` | read | 1290.1 (1515, 0) | 1112.4 (1482, 0) | 1148.3 (1468, 0) |
| `getMe` | read | 551.7 (1493, 0) | 459.8 (1494, 0) | 519.3 (1460, 0) |
| `getMyNavigation` | read | 346.7 (1454, 0) | 331.9 (1467, 0) | 317.9 (1462, 0) |
| `getMyWork` | dashboard | 802.1 (1623, 0) | 814.9 (1674, 0) | 838.8 (1662, 0) |
| `getTransformation` | read | 675.1 (1483, 0) | 507.5 (1475, 0) | 660.6 (1568, 0) |
| `getTransformationDashboard` | dashboard | 1177.6 (1651, 0) | 1100.9 (1695, 0) | 1193.4 (1646, 0) |
| `listFormRecordVersions` | read | 852.9 (1511, 0) | 644.0 (1449, 0) | 662.9 (1492, 0) |
| `listInitiatives` | read | 1502.5 (1412, 0) | 1203.6 (1515, 0) | 1281.4 (1457, 0) |
| `listMyWorkItems` | read | 424.7 (1521, 0) | 428.0 (1465, 0) | 439.0 (1405, 0) |
| `listSavedViews` | read | 421.9 (1481, 0) | 423.9 (1488, 0) | 433.5 (1493, 0) |
| `listTransformations` | read | 482.6 (1443, 0) | 385.6 (1503, 0) | 387.8 (1554, 0) |
| `putSavedView` | update | 945.6 (2396, 0) | 839.6 (2468, 0) | 940.2 (2361, 0) |
| `searchRecords` | search | 748.2 (2166, 0) | 634.1 (2129, 0) | 707.2 (2179, 0) |
| `updateFormDraft` | update | 968.7 (680, 0) | 879.1 (647, 0) | 925.2 (666, 0) |
| `updateInitiative` | update | 1197.6 (623, 0) | 1038.3 (680, 0) | 1160.9 (605, 0) |

Operations of the ADR-0058 §3 mix with no steady-state sample (**not measured**, never 0; the reason is in the run notes): `getWorkstreamDashboard`.

Non-success responses (repetition, operation, HTTP status; 0 = network failure): 

- none

## Run notes (disclosures)

- **Status: draft report of the FIRST run (T-DG6-DO-F, §H/G.8).** It is not the final load report: BE-S (fixes named here) and DO-G (the final run on the frozen tree) follow. The workload, dataset and infrastructure were not changed after the run to turn a miss into a pass (ADR-0058 §1, p6-plan R4).
- **The host was heavily oversubscribed.** The 1-minute load average was 15.5–21.0 on 4 logical CPUs during every repetition (table in §6). Other agents' builds and test suites ran on the same host throughout; their CPU use is inside these figures, together with the harness's own client-side CPU. The figures are therefore pessimistic for this code on this hardware, and they are not comparable with any production sizing.
- **Generator patch (disclosed).** `deploy/load/generate.mjs` at sha256 `7470ea74…` derives ids as `md5(key)::uuid`, which have no RFC 9562 version or variant bits. The API's UUID validation refuses them (`400 validation.invalid_format "Invalid UUID"`; `smoke-diagnosis-invalid-uuid.txt`), so about 88 % of initiatives and most transformations could not be addressed through the API. The dataset of this run was generated by a copy of the generator with the minimal patch `generate-rfc-uuid.patch` (sha256 of the patched copy `6b2a9007…`): the same md5 with the version-3 and variant bits set. The tree file was **not** changed (DO-E's file); adopting the patch is for the orchestrator. Generation: exit 0, 384.9 s, marker counts = planned counts, 100,000 audit events, 0 non-RFC ids in `initiative`, `transformation` and `audit_event`, 154 MB.
- **Smoke requests before the run.** Two short harness smokes (repetitions 91 and 92; about 1,300 requests, not measured, results discarded) and the worker's indexing ran on the generated database before `capture-infra`, so the database held 100,894 audit events (not 100,000) when run-1 started; each repetition adds its own update events. Saved views `LOAD view u{n} r91`/`r92` and their drafts and exports from the smokes remain in the database.
- **Not measured: `getWorkstreamDashboard`.** The `default` profile of the generator writes no `workstream` row (0 rows), so no user has a workstream to read. The operation is in ADR-0058 §3's mix but has no sample; it is reported as not measured, never as 0 or a pass. The other four dashboards are measured. A generator change (workstreams) is a DO-E/orchestrator decision.
- **Class draw.** Users whose roles hold no operation of a class leave that class out of their own draw: 5 AUD users (no update, no export), 50 users without a saved view or draft target (AUD has no `saved_view.manage`; `createFormDraft` T05 refused 403 for 50 users) and 50 users with an initiative partition (holders of `initiative.edit`). The achieved shares are within 1 point of the ADR shares (§5 table).
- **Search index.** The generator's requested `search.reindex` completed before the run (driver output); the index then held 400 benefits, 500 decisions, 1,000 deliverables, 500 dependencies, 1,000 evidence notes, 1,000 initiatives, 500 KPI definitions, 1,500 RAID entries and 50 transformations. The scheduled `search.index_feed` (every minute) ran during the repetitions, as in production.
- **Export start miss (the only class miss).** `createExport` of a live selection builds its report snapshot inside the request (ADR-0046), so its latency includes the snapshot assembly. The EXPLAIN diagnostic pass (`explain/`, unmeasured, run after the three repetitions with `auto_explain` `log_analyze`, `log_buffers`, `log_nested_statements`, then reset) found **no single statement over 100 ms** with 5 concurrent exporters (`createExport.auto-explain-over-100ms.log` holds only the pass markers). With every statement logged (1 user, 7 requests: 144–2,642 ms each), the cost is in statement volume: `report_snapshot_source` is inserted row by row (759 inserts for 7 exports, 591 ms in total), the scoped-assignment permission query runs about 41 times per request (290 calls), the deferred `p2_audit_required` check (the T-DG6-DO-E candidate: `record_type = TG_TABLE_NAME`, type `name`) costs up to 64.5 ms per call, and the roadmap assembler reads initiatives and dependencies once per row (265 calls each). Digest with the full plans: `explain/createExport.explain-digest-all-statements.md`; full log: `explain/createExport.auto-explain.all-statements.log.gz`.
- **Disclosed harness errors, superseded.** The first diagnostic pass ran its API on port 25682 while the minted sessions record `APP_BASE_URL` on 25681, so all 146 requests got `403 csrf` (`explain/invalid-first-diagnostic-pass-csrf-403.txt`); it was repeated on 25681. The first smoke (on the unpatched dataset) also lacked `organizationId` on two dashboards and the browser `Origin` header on writes; both were fixed in the harness before run-1. None of these affected the three measured repetitions, which had 0 errors.

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
  "generated_at": "2026-10-30T07:58:07.395532+00:00",
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
  "audit_events": 100894,
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
- Warm-up 120 s (excluded), steady state 600 s per repetition; 3 repetition(s), each on a freshly started API and worker over the same database.
- Think time 1000–3000 ms (integer, uniform, seeded per user and repetition). Measured from just before `fetch` to the end of the body, integer microseconds.
- Class draw by share; a class with no operation the user may perform (for example updates for an AUD user) is left out of that user's draw. Achieved shares of steady-state requests:

| Class | Planned % | Achieved % | Requests |
| --- | --- | --- | --- |
| read | 50 | 50.6 | 40010 |
| update | 15 | 14.1 | 11126 |
| search | 8 | 8.2 | 6474 |
| dashboard | 25 | 25.3 | 20021 |
| export | 2 | 1.9 | 1483 |

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

- CPU: Intel(R) Xeon(R) Processor @ 2.80GHz; 4 logical CPUs (availableParallelism 4).
- Memory: MemTotal:       16477352 kB; MemAvailable:   10958052 kB; SwapTotal:             0 kB.
- Kernel 6.18.44-fc-v185; Node v24.21.0.
- PostgreSQL: PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit; database size 166 MB.
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
| port | 25650 |  | command line |
| shared_buffers | 16384 | 8kB | configuration file |
| unix_socket_directories |  |  | command line |

Disk as reported by the OS (`df -kP`):

```
Filesystem     1024-blocks     Used Available Capacity Mounted on
/dev/vda         264212084 28445444  11908568      71% /home/user/wt/dg6-do-f
Filesystem     1024-blocks     Used Available Capacity Mounted on
/dev/vda         264212084 28445500  11908512      71% /var/tmp/mth-run.VSSg8t/claude-0
```

Machine load average (1 min), sampled every 5 s during each repetition:

| Repetition | Started | Ended | Samples | min | mean | max |
| --- | --- | --- | --- | --- | --- | --- |
| rep-1 | 2026-10-30T08:09:29.404Z | 2026-10-30T08:21:32.234Z | 146 | 15.50 | 17.54 | 19.59 |
| rep-2 | 2026-10-30T08:22:20.464Z | 2026-10-30T08:34:23.487Z | 146 | 15.73 | 18.30 | 19.82 |
| rep-3 | 2026-10-30T08:35:19.879Z | 2026-10-30T08:47:23.443Z | 146 | 16.09 | 18.72 | 21.04 |

**The load harness, the API, the worker and PostgreSQL share ONE sandbox host, so every figure includes client-side CPU contention. This is not Mobily production infrastructure, and a single-host run is not evidence of high availability or production capacity.**

