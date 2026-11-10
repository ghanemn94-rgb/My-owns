# DG6 final load run (T-DG6-DO-G, frozen tree)

> **Engineering measurements on the stated sandbox host, not Mobily production capacity.** The targets (p95 of ordinary
> reads and updates ≤ 2 s, key dashboards ≤ 4 s) are M0398's provisional engineering targets, not verified Mobily
> capacity requirements. Final production scale, availability and recovery objectives must be agreed with Mobily IT
> (REQ-S20-029 notes). One host running everything is not a high-availability deployment. The dataset and every
> user are synthetic. Nothing here is a G1–G6 business approval or a DG0–DG7 gate decision.

## 1. Results per class (steady state; milliseconds; nearest-rank)

| Class | Target p95 | rep-1 p95 | rep-2 p95 | rep-3 p95 | Highest p95 | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Ordinary read | 2 s | 19.3 | 21.5 | 22.9 | 22.9 | within target |
| Ordinary update | 2 s | 30.0 | 33.5 | 34.9 | 34.9 | within target |
| Search | 2 s | 17.5 | 19.3 | 20.5 | 20.5 | within target |
| Key dashboard | 4 s | 41.9 | 46.4 | 50.3 | 50.3 | within target |
| Export start | 2 s | 86.0 | 92.4 | 108.5 | 108.5 | within target |
| Ordinary read incl. search | 2 s | 19.1 | 21.1 | 22.5 | 22.5 | within target |

Per repetition (p50 / p95 / p99 / max in ms; count; errors; 409 conflicts):

| Class | Repetition | p50 | p95 | p99 | max | count | errors | conflicts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ordinary read | rep-1 | 6.2 | 19.3 | 36.9 | 709.9 | 15073 | 0 | 0 |
| Ordinary read | rep-2 | 6.9 | 21.5 | 35.3 | 185.8 | 14989 | 0 | 0 |
| Ordinary read | rep-3 | 7.2 | 22.9 | 42.6 | 302.5 | 15013 | 0 | 0 |
| Ordinary update | rep-1 | 14.5 | 30.0 | 58.2 | 430.0 | 4191 | 0 | 0 |
| Ordinary update | rep-2 | 16.5 | 33.5 | 49.0 | 122.4 | 4254 | 0 | 0 |
| Ordinary update | rep-3 | 17.0 | 34.9 | 59.7 | 362.3 | 4134 | 0 | 0 |
| Search | rep-1 | 9.0 | 17.5 | 29.8 | 215.3 | 2442 | 0 | 0 |
| Search | rep-2 | 9.9 | 19.3 | 31.9 | 127.3 | 2400 | 0 | 0 |
| Search | rep-3 | 10.2 | 20.5 | 34.4 | 271.9 | 2446 | 0 | 0 |
| Key dashboard | rep-1 | 21.8 | 41.9 | 73.0 | 947.0 | 7495 | 0 | 0 |
| Key dashboard | rep-2 | 25.4 | 46.4 | 71.2 | 236.7 | 7489 | 0 | 0 |
| Key dashboard | rep-3 | 26.4 | 50.3 | 72.9 | 434.9 | 7510 | 0 | 0 |
| Export start | rep-1 | 46.2 | 86.0 | 132.4 | 1010.2 | 585 | 0 | 0 |
| Export start | rep-2 | 52.8 | 92.4 | 192.1 | 400.5 | 537 | 0 | 0 |
| Export start | rep-3 | 54.1 | 108.5 | 250.9 | 374.7 | 571 | 0 | 0 |
| Ordinary read incl. search | rep-1 | 6.9 | 19.1 | 36.3 | 709.9 | 17515 | 0 | 0 |
| Ordinary read incl. search | rep-2 | 7.7 | 21.1 | 35.1 | 185.8 | 17389 | 0 | 0 |
| Ordinary read incl. search | rep-3 | 8.0 | 22.5 | 41.8 | 302.5 | 17459 | 0 | 0 |

## 2. Misses against the targets (each a Medium, non-mandatory finding candidate; ADR-0058 §1, D-195 Q9)

None of the five ADR-0058 §3 classes missed its target in any repetition.

## 3. Per operation (steady state; ms)

| Operation | Class | rep-1 p95 (n, err) | rep-2 p95 (n, err) | rep-3 p95 (n, err) |
| --- | --- | --- | --- | --- |
| `createExport` | export | 86.0 (585, 0) | 92.4 (537, 0) | 108.5 (571, 0) |
| `getExecutiveOverview` | dashboard | 41.9 (1880, 0) | 46.3 (1846, 0) | 51.7 (1847, 0) |
| `getFinanceDashboard` | dashboard | 42.9 (1959, 0) | 48.7 (1866, 0) | 51.0 (1894, 0) |
| `getInitiative` | read | 24.5 (1697, 0) | 25.8 (1663, 0) | 28.3 (1633, 0) |
| `getMe` | read | 14.0 (1678, 0) | 14.2 (1678, 0) | 15.4 (1643, 0) |
| `getMyNavigation` | read | 9.1 (1665, 0) | 9.4 (1667, 0) | 10.9 (1635, 0) |
| `getMyWork` | dashboard | 41.2 (1835, 0) | 47.9 (1880, 0) | 51.8 (1907, 0) |
| `getTransformation` | read | 13.5 (1698, 0) | 14.1 (1685, 0) | 16.5 (1760, 0) |
| `getTransformationDashboard` | dashboard | 40.9 (1821, 0) | 43.0 (1897, 0) | 46.3 (1862, 0) |
| `listFormRecordVersions` | read | 17.0 (1682, 0) | 17.4 (1629, 0) | 18.8 (1694, 0) |
| `listInitiatives` | read | 31.1 (1626, 0) | 33.3 (1687, 0) | 38.7 (1634, 0) |
| `listMyWorkItems` | read | 10.6 (1719, 0) | 11.5 (1636, 0) | 11.9 (1573, 0) |
| `listSavedViews` | read | 12.0 (1664, 0) | 13.0 (1662, 0) | 13.0 (1693, 0) |
| `listTransformations` | read | 11.4 (1644, 0) | 12.2 (1682, 0) | 12.7 (1748, 0) |
| `putSavedView` | update | 25.6 (2700, 0) | 28.0 (2747, 0) | 30.6 (2680, 0) |
| `searchRecords` | search | 17.5 (2442, 0) | 19.3 (2400, 0) | 20.5 (2446, 0) |
| `updateFormDraft` | update | 29.9 (771, 0) | 31.6 (744, 0) | 34.9 (763, 0) |
| `updateInitiative` | update | 40.1 (720, 0) | 42.9 (763, 0) | 46.9 (691, 0) |

Operations of the ADR-0058 §3 mix with no steady-state sample (**not measured**, never 0; the reason is in the run notes): `getWorkstreamDashboard`.

Non-success responses (repetition, operation, HTTP status; 0 = network failure): 

- none

## Run notes (disclosures)

- **Status: the FINAL load report of DG6 (T-DG6-DO-G, p6-work-split §H/G.10).** It was measured on the integrated tree at `87ae4e863` with no uncommitted product file (driver output), after BE-S's fixes (`0120_p6_audit_required_index_use.sql`, the batched snapshot INSERTs). The workload, dataset, rate limits and infrastructure settings are those of run-1: the same patched generator copy (sha256 `6b2a9007…`) and the same `sessions.mjs` (`7b860ee0…`). `workload.mjs` (`34734caa…`) and `report.mjs` (`32f89b4a…`) are the tree's versions, i.e. run-1's (`c138c217…`, `35bb1dc7…`) plus DO-F's disclosed post-run edits (`T-DG6-DO-F-evidence/load/run-1/{workload,report}-changes-after-run.diff`): formatting, the `--only` diagnostic option (not used in a measured repetition) and report presentation; DO-FB showed the current `report.mjs` regenerates run-1's report byte for byte from its samples. Nothing was tuned after a run (ADR-0058 §1, p6-plan R4). This report decides nothing about the DG6 engineering gate, and nothing in it is a G1–G6 business approval.
- **Result: no class missed its target in any repetition**, so this run raises no p95 finding. Run-1's only miss (export start, p95 2,688.1 ms) is not repeated: the export-start class's highest p95 here is 108.5 ms.
- **Beside the first run (ADR-0058 §1: "a re-run after a fix (BE-S) is reported beside the first run").** Highest p95 of 3 repetitions, ms:

  | Class (target) | Run-1 (DO-F, before BE-S) | Final (this run) |
  | --- | --- | --- |
  | Ordinary read (2 s) | 745.8 | 22.9 |
  | Ordinary update (2 s) | 1,007.4 | 34.9 |
  | Search (2 s) | 748.2 | 20.5 |
  | Key dashboard (4 s) | 1,191.2 | 50.3 |
  | Export start (2 s) | 2,688.1 (MISS) | 108.5 |
  | Ordinary read incl. search (2 s) | 745.9 | 22.5 |

  **This is not a controlled A/B, and the drop must not be read as the effect of BE-S's fixes alone.** Two things differ between the runs: the code (BE-S's two fixes, and every other P6 merge since run-1), and the host. Run-1 ran with a 1-minute load average of 15.5–21.0 on 4 CPUs, because other agents' builds and test suites shared the host. This run ran at 1.33–4.72 (§6 table), because no other agent was running and none of my own checks ran during the three repetitions. Every class fell by a similar factor (about 20–35×), including classes BE-S did not touch, which points to host contention as the main cause. BE-S's own controlled A/B on one database (`T-DG6-BE-S-evidence/export-proof-comparison.md`) is the evidence for the fixes themselves.
- **Same host type, same settings as run-1.** Both runs used the disposable cluster of `tests/qa/support/with-pg.sh` (PostgreSQL 16, `fsync=off`, `shared_buffers` 128 MB, `max_connections` 200; §6 table). `fsync=off` makes commits cheaper than on a durable production server; it is a test-cluster setting, never a production one, and it is stated here so that no reader takes these figures as production write latency.
- **Generator patch (disclosed, as in run-1 and BE-S).** `deploy/load/generate.mjs` in the tree (sha256 `7470ea74…`) still derives ids without the RFC 9562 version and variant bits, which the API refuses (DO-F `smoke-diagnosis-invalid-uuid.txt`); no orchestrator decision on DO-F's `generate-rfc-uuid.patch` exists at `87ae4e863`. The dataset was generated by the same patched scratch copy (sha256 `6b2a9007…`) as run-1 and BE-S. Generation: exit 0, 27.3 s (run-1: 384.9 s before BE-S's 0120), marker counts equal to the planned counts, 100,000 audit events, 0 non-RFC initiative ids, no `deployment_environment` row, 154 MB.
- **No smoke requests.** Unlike run-1, nothing ran against the generated database before `capture-infra` except the generator's requested `search.reindex` (completed; every type idle), so the dataset held exactly 100,000 audit events at capture.
- **Not measured: `getWorkstreamDashboard`.** As in run-1, the `default` profile writes no `workstream` row, so the operation has no sample; it is reported as not measured, never 0 or a pass. No orchestrator decision on DO-F §5 item 3 exists at `87ae4e863`. The other four dashboards are measured.
- **Class draw.** Unchanged from run-1: 5 AUD users draw no update or export, users without a saved view or draft target leave those operations out. The achieved shares are within 1 point of the ADR shares (§5 table).
- **Errors.** 0 error samples and 0 409 conflicts in every repetition; 0 error-level lines in the API and worker logs of each repetition (driver output).
- **Independent check of the figures.** Every class p95 of every repetition was recomputed from the raw `samples.csv.gz` with `awk` and `sort -n` (not `report.mjs`): 15 of 15 equal (`../final-p95-recompute.txt`).
- **Export backlog left by the workload (disclosed).** The three repetitions accepted 2,019 `createExport` jobs (warm-up and steady state; 202 each), but the worker, stopped after each repetition as in run-1, handled 1,099 of them during the repetitions. The export-start class measures only the 202 (ADR-0058 §3), so this does not touch the figures above; it does matter for the export proof (next item).
- **The export proof (ADR-0058 §7, REQ-S20-030)** ran twice; both runs are kept and reported, neither is discarded (`export-proof.json`, `export-proof-idle-queue.json`, `../export-proof-summary.txt`, handback §2):
  1. `driver.sh`, right after the repetitions (00:22Z, 1-minute load average 2.4): its 66 jobs queued behind about 920 harness jobs. Part A's 16 starts were measured on a quiet host (all 202, max 548 ms), and the access checks hold on all 16, but 2 jobs were still queued at the proof's 900 s poll timeout, so part A took about 30 minutes. By then the sessions of 48 part-B users had passed the product's 30-minute idle timeout (`SESSION_IDLE_MINUTES` default 30): 48 × 401. That run is a harness artifact for part B and for completion, not a product result.
  2. `proof-idle-queue-driver.sh`, on a freshly generated database with an idle queue (BE-S's protocol), measured while my own integration and unit test runs loaded the host (1-minute load average 11.8 at the start, 19.1 at the end): every assertion holds except 24 of 50 simultaneous part-B starts above 2 s (p50 1,998 ms, max 2,265 ms) and the LOAD-T20 witness gap (dataset). Its start latencies are therefore contended by this task's own checks and are stated as such.

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
  "generated_at": "2026-10-30T23:44:30.47654+00:00",
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
- Warm-up 120 s (excluded), steady state 600 s per repetition; 3 repetition(s), each on a freshly started API and worker over the same database.
- Think time 1000–3000 ms (integer, uniform, seeded per user and repetition). Measured from just before `fetch` to the end of the body, integer microseconds.
- Class draw by share; a class with no operation the user may perform (for example updates for an AUD user) is left out of that user's draw. Achieved shares of steady-state requests:

| Class | Planned % | Achieved % | Requests |
| --- | --- | --- | --- |
| read | 50 | 50.6 | 45075 |
| update | 15 | 14.1 | 12579 |
| search | 8 | 8.2 | 7288 |
| dashboard | 25 | 25.2 | 22494 |
| export | 2 | 1.9 | 1693 |

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
- Memory: MemTotal:       16477352 kB; MemAvailable:   13646560 kB; SwapTotal:             0 kB.
- Kernel 6.18.44-fc-v185; Node v24.21.0.
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
| port | 26800 |  | command line |
| shared_buffers | 16384 | 8kB | configuration file |
| unix_socket_directories |  |  | command line |

Disk as reported by the OS (`df -kP`):

```
Filesystem     1024-blocks     Used Available Capacity Mounted on
/dev/vda         264212084 25790416  14563596      64% /home/user/wt/dg6-do-g
Filesystem     1024-blocks     Used Available Capacity Mounted on
/dev/vda         264212084 25790416  14563596      64% /var/tmp/mth-run.aBebSg/claude-0
```

Machine load average (1 min), sampled every 5 s during each repetition:

| Repetition | Started | Ended | Samples | min | mean | max |
| --- | --- | --- | --- | --- | --- | --- |
| rep-1 | 2026-10-30T23:45:27.072Z | 2026-10-30T23:57:29.605Z | 146 | 1.39 | 2.60 | 3.72 |
| rep-2 | 2026-10-30T23:57:45.196Z | 2026-10-31T00:09:47.706Z | 146 | 1.33 | 2.71 | 4.72 |
| rep-3 | 2026-10-31T00:10:05.990Z | 2026-10-31T00:22:08.788Z | 146 | 1.73 | 2.66 | 4.18 |

**The load harness, the API, the worker and PostgreSQL share ONE sandbox host, so every figure includes client-side CPU contention. This is not Mobily production infrastructure, and a single-host run is not evidence of high availability or production capacity.**

