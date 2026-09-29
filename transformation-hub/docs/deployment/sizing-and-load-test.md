# Sizing assumptions and load-test plan

**No capacity guarantee is made here.** The master prompt (§16, §20) requires sizing assumptions, bottlenecks and a
load-test plan. It forbids inventing a configuration that is guaranteed to cover all of Mobily's usage. A test that
passes on a small machine does not establish enterprise capacity.

## Starting assumptions (to be confirmed by Mobily)

| Dimension | Assumption | Source |
|---|---|---|
| Named users | 100–500 (PMO, committee, workstream owners, finance/legal, a few external partners) | ADR-0004 ("tens–hundreds of users"). **To be confirmed** |
| Peak concurrent users | 10–20 % of named users; committee-pack and deadline spikes | Assumption |
| Projects | 2–20 active (DC carve-out, JV, other transformations) | Assumption |
| Records per large project | ~50k (tasks, RAID, evidence links, decisions, audit rows grow faster) | Assumption |
| Documents | 10k–100k versions, typical 1–25 MB (upload limit `HUB_MAX_UPLOAD_MB`=25) | Assumption |
| Audit events | Grows with every mutation. Proposal: plan 5–20 M rows over 3 years | Assumption |

## Starting footprint (chart defaults — a starting point, not a guarantee)

| Component | Replicas | Requests / limits |
|---|---|---|
| api | 2 (HPA optional 2–6) | 250m / 1 CPU, 384Mi / 1Gi |
| worker | 1 (can scale; claims use `SKIP LOCKED`) | 200m / 1 CPU, 384Mi / 1Gi |
| web | 2 | 100m / 1 CPU, 256Mi / 768Mi |
| api-chromium (optional) | as api | add ~500Mi per concurrent PDF render, plus `/dev/shm` 256Mi |
| PostgreSQL | Mobily platform (HA per DBA standard) | Proposal: 4 vCPU / 16 GiB, SSD, connection budget ≥ (api+worker replicas) × 20 + admin headroom |
| Object storage | Mobily S3-compatible service | Capacity = documents × versions × growth; versioning overhead |

## Known and expected bottlenecks

| # | Bottleneck | Why | Mitigation |
|---|---|---|---|
| B-1 | Audit insert serialisation | One advisory lock per organization for the hash chain (ADR-0014) | Measure mutation throughput; asynchronous sealing is the documented alternative |
| B-2 | One transaction per request with RLS context | Long requests hold connections | Pool sizing; statement and idle-transaction timeouts (configured) |
| B-3 | Report and PDF rendering | Chromium CPU and memory | Separate worker capacity; queue concurrency; render limits |
| B-4 | Full-text retrieval with in-SQL ACL | `ts_rank` on large chunk tables | GIN index (present); measure with a realistic document corpus |
| B-5 | Rate limiter is per replica, in process | Limits multiply with replicas | Ingress/gateway limiter (ADR-0017) |
| B-6 | Infrastructure table growth (`job`, `outbox_event`) | No retention job yet | Archive policy ([operations.md](operations.md)) |
| B-7 | Import parsing (Excel) | CPU/memory in the worker | Size and row caps (C-16); run in the worker |

## Measured so far (build environment only)

| Measurement | Result | Caveat |
|---|---|---|
| Backup of 201,020 rows (284 MB DB) + 52.8 MB objects | 14.69 s (pg_dump 13.50 s) | Same-host PostgreSQL, local disk, 4 vCPU. Synthetic volume |
| Restore of the same to a verified state | 8.26 s | Same caveats ([restore-drill-results.md](restore-drill-results.md)) |
| `next build` of the web app | 38 s | Build host only |

No request-level load test has been executed.

## Load-test plan (to run in a Mobily test environment sized like production)

**Tooling:** k6 or Gatling from inside the network, against a **test** environment. Never against production and
never with real data. Use synthetic data generated through the API: the Demo seed approach, scaled.

**Datasets** (each run states which one it used):

| Dataset | Projects | Tasks/RAID/decisions per project | Documents | Audit rows | Users |
|---|---|---|---|---|---|
| S | 3 | 5k | 2k | 200k | 100 |
| M | 10 | 25k | 20k | 2M | 300 |
| L | 25 | 50k | 100k | 10M | 800 |

**Workloads:**

1. **Browse/read mix:** 70 % list/detail/dashboard, 20 % search, 10 % report views. Ramp to peak concurrency and hold for 30 min.
2. **Mutation mix:** task updates, RAID, decision submit, votes, evidence links. It exercises the audit chain lock (B-1). Target mutations per second rising in steps.
3. **Committee-pack spike:** N concurrent XLSX/DOCX/PPTX/PDF exports from snapshots (B-3).
4. **Upload burst:** 25 MB uploads through the quarantine → scan → index pipeline.
5. **Worker soak:** 24 h with schedules, outbox dispatch and retries. Check lease expiry, dead letters and memory.
6. **Failure drills under load:** kill an api pod and a worker pod; fail over the DB. Measure error rate and recovery. There must be no duplicate deliveries (AT-20).

**Proposed response-time goals** (to be agreed; spec §20):

- p95 < 500 ms for ordinary reads;
- p95 < 1 s for mutations;
- search p95 < 1.5 s;
- export job < 60 s for a standard committee pack;
- error rate < 0.1 % at the agreed peak.

**Record per run:** dataset, workload, replica counts and resources, DB size and configuration, p50/p95/p99, errors,
CPU/memory, DB connections and locks, and queue depth. Store the results under `docs/deployment/load-tests/`. Adjust
the footprint above only from measured results.
