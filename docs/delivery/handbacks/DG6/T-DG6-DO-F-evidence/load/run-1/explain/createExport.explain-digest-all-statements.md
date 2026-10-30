# createExport diagnostic pass: every statement (1 user, 20 s, 7 requests)

Source: `createExport.auto-explain.all-statements.log.gz` (10572 logged plans, 808 distinct statements by their first 160 characters). auto_explain with log_analyze, log_buffers, log_timing and log_nested_statements = EXPLAIN (ANALYZE, BUFFERS) of each logged statement. The log covers every session of the database during the pass (the API's createExport requests and the worker rendering the queued exports, plus its scheduled jobs).

## Distinct statements by total time (top 25)

| # | count | total ms | max ms | statement (first 160 characters) |
| --- | --- | --- | --- | --- |
| 1 | 759 | 591.1 | 8.1 | `insert into "report_snapshot_source" ("organization_id", "transformation_id", "snapshot_id", "id", "section_key", "record_type", "record_id", "record_version", ` |
| 2 | 290 | 282.8 | 45.1 | `select "a"."id", "a"."scope_type", "a"."scope_id", "a"."organization_id", "r"."code", "r"."inherits_downward", "rp"."permission_code" from "scoped_assignment" a` |
| 3 | 50 | 239.9 | 64.5 | `NOT EXISTS ( SELECT 1 FROM audit_event a WHERE a.record_type = TG_TABLE_NAME AND a.record_id = rid AND (v IS NULL OR a.new_version = v) )` |
| 4 | 265 | 236.4 | 6.9 | `select "initiative"."id", "initiative"."code", "initiative"."planned_start", "initiative"."planned_end", "roadmap_wave"."ordinal" as "wave_ordinal" from "initia` |
| 5 | 265 | 112.2 | 6.6 | `select "id", "from_kind", "from_label", "from_initiative_id", "to_initiative_id", "needed_by", "status" from "dependency" where "transformation_id" = $1 and "st` |
| 6 | 7 | 97.3 | 41.2 | `insert into "report_snapshot" ("id", "organization_id", "transformation_id", "definition_code", "subject_type", "subject_id", "reporting_period_id", "period_lab` |
| 7 | 17 | 52.3 | 9.8 | `WITH next as ( SELECT id FROM pgboss.job_common WHERE name = 'reports.export' AND state < 'active' AND start_after < now() ORDER BY priority desc, created_on, i` |
| 8 | 80 | 43.8 | 5.2 | `update "export_job_progress" set "stage" = CASE WHEN array_position(ARRAY['queued','loading','rendering','storing','done']::text[], $1::text) > array_position(A` |
| 9 | 1 | 37.7 | 37.7 | `SELECT i.id, i.transformation_id, i.executive_owner_user_id FROM initiative i ORDER BY i.transformation_id, i.code` |
| 10 | 17 | 34.5 | 18.9 | `select "s"."id", "s"."content", "s"."status", "s"."issue_version", "s"."definition_code", "d"."label_en", "d"."label_ar", "o"."default_timezone", "t"."code" as ` |
| 11 | 1 | 30.5 | 30.5 | `insert into "saved_view" ("id", "organization_id", "owner_user_id", "list_key", "transformation_id", "name", "columns", "filters", "sort", "is_default", "create` |
| 12 | 290 | 28.8 | 0.2 | `select "s"."id", "s"."user_id", "u"."organization_id", "s"."auth_mode", "s"."idp_issuer", "s"."csrf_token_hash", "s"."last_seen_at" from "session" as "s" inner ` |
| 13 | 50 | 25.9 | 2.2 | `insert into "audit_event" ("id", "organization_id", "transformation_id", "actor_type", "actor_user_id", "on_behalf_of_user_id", "action", "record_type", "record` |
| 14 | 12 | 22.2 | 18.8 | `SELECT seq::text AS seq, record_id, age(xmin) > age($1::text::xid) AS settled FROM audit_event WHERE record_type = $2 AND seq > $3::bigint ORDER BY seq LIMIT $4` |
| 15 | 17 | 21.0 | 7.9 | `update "export_job" set "status" = $1, "storage_key" = $2, "file_name" = $3, "content_type" = $4, "file_sha256" = $5, "file_size_bytes" = $6, "finished_at" = no` |
| 16 | 783 | 19.8 | 4.1 | `SELECT 1 FROM ONLY "public"."report_snapshot" x WHERE "transformation_id" OPERATOR(pg_catalog.=) $1 AND "id" OPERATOR(pg_catalog.=) $2 FOR KEY SHARE OF x Query ` |
| 17 | 783 | 18.9 | 0.1 | `SELECT * FROM report_snapshot WHERE id = NEW.snapshot_id` |
| 18 | 792 | 14.6 | 1.1 | `SELECT t.organization_id FROM transformation t WHERE t.id = (n->>'transformation_id')::uuid` |
| 19 | 309 | 13.8 | 0.2 | `select "ancestor_id", "depth" from "business_unit_closure" where "descendant_id" = $1 order by "depth" Query Parameters: $1 = 'aee1f19b-a2c7-3486-b1d0-85c3ee72a` |
| 20 | 17 | 12.3 | 2.2 | `insert into "report_snapshot_version" ("organization_id", "transformation_id", "snapshot_id", "id", "version_kind", "reference_id", "reference_key", "version_la` |
| 21 | 7 | 11.6 | 2.9 | `insert into "export_job" ("id", "organization_id", "transformation_id", "snapshot_id", "requested_by", "format", "language", "idempotency_key", "created_by", "u` |
| 22 | 856 | 11.5 | 1.2 | `SELECT 1 FROM ONLY "public"."organization" x WHERE "id" OPERATOR(pg_catalog.=) $1 FOR KEY SHARE OF x Query Parameters: $1 = 'd044310c-e30f-34b1-91b4-8c86cfb1c8f` |
| 23 | 17 | 11.3 | 2.8 | `update "export_job" set "status" = $1, "attempt_count" = $2, "started_at" = COALESCE(started_at, now()), "version" = $3, "updated_at" = now() where "id" = $4 an` |
| 24 | 1 | 10.7 | 10.7 | `select "b"."id", "b"."code", "b"."title", "b"."version", "b"."updated_at", "b"."value_class", "b"."currency", "c"."counted", "c"."overlap_open", "m"."status" as` |
| 25 | 1 | 10.6 | 10.6 | `INSERT INTO saved_view_event (id, saved_view_id, record_version, name, visibility, columns, filters, sort, is_default, status, actor_user_id, occurred_at) VALUE` |

## Full plans: the slowest instance of the top 10 statements by total time

### 1. 8.1 ms (slowest of 759)

```
2026-10-30 08:52:37.690 UTC [6873] LOG:  duration: 8.078 ms  plan:
	Query Text: insert into "report_snapshot_source" ("organization_id", "transformation_id", "snapshot_id", "id", "section_key", "record_type", "record_id", "record_version", "record_updated_at", "approval_state", "validation_state") values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	Query Parameters: $1 = 'd044310c-e30f-34b1-91b4-8c86cfb1c8fc', $2 = 'e2b51ceb-1ff1-38e9-a507-296ec2b67e13', $3 = '01a18c02-cdc8-74db-9b3c-e46b493918de', $4 = '01a18c02-d2b1-718c-9a87-89cc336ef67f', $5 = 'register', $6 = 'dependency', $7 = '98abeb37-2f58-3f9f-964e-e5980fa3d2e1', $8 = '1', $9 = '2025 …[truncated]
	Insert on report_snapshot_source  (cost=0.00..0.01 rows=0 width=0) (actual time=1.788..1.789 rows=0 loops=1)
	  Buffers: shared hit=10
	  ->  Result  (cost=0.00..0.01 rows=1 width=228) (actual time=0.003..0.004 rows=1 loops=1)
```

### 2. 45.1 ms (slowest of 290)

```
2026-10-30 08:52:20.568 UTC [6873] LOG:  duration: 45.070 ms  plan:
	Query Text: select "a"."id", "a"."scope_type", "a"."scope_id", "a"."organization_id", "r"."code", "r"."inherits_downward", "rp"."permission_code" from "scoped_assignment" as "a" inner join "role" as "r" on "r"."id" = "a"."role_id" left join "role_permission" as "rp" on "rp"."role_id" = "r"."id" whe …[truncated]
	Query Parameters: $1 = '3e23f9e4-d64e-396c-8562-938142305301'
	Nested Loop Left Join  (cost=5.75..21.26 rows=79 width=85) (actual time=0.049..0.209 rows=192 loops=1)
	  Buffers: shared hit=123
	  ->  Hash Join  (cost=5.48..11.08 rows=2 width=83) (actual time=0.031..0.049 rows=2 loops=1)
	        Hash Cond: (a.role_id = r.id)
	        Buffers: shared hit=3
	        ->  Bitmap Heap Scan on scoped_assignment a  (cost=4.16..9.76 rows=2 width=78) (actual time=0.012..0.020 rows=2 loops=1)
	              Recheck Cond: ((user_id = '3e23f9e4-d64e-396c-8562-938142305301'::uuid) AND (revoked_at IS NULL))
	              Filter: ((effective_from <= now()) AND ((effective_to IS NULL) OR (effective_to > now())))
	              Heap Blocks: exact=1
	              Buffers: shared hit=2
	              ->  Bitmap Index Scan on scoped_assignment_active_user_idx  (cost=0.00..4.16 rows=2 width=0) (actual time=0.006..0.007 rows=2 loops=1)
	                    Index Cond: (user_id = '3e23f9e4-d64e-396c-8562-938142305301'::uuid)
	                    Buffers: shared hit=1
	        ->  Hash  (cost=1.14..1.14 rows=14 width=21) (actual time=0.012..0.013 rows=14 loops=1)
	              Buckets: 1024  Batches: 1  Memory Usage: 9kB
	              Buffers: shared hit=1
	              ->  Seq Scan on role r  (cost=0.00..1.14 rows=14 width=21) (actual time=0.004..0.007 rows=14 loops=1)
	                    Buffers: shared hit=1
	  ->  Index Only Scan using role_permission_pkey on role_permission rp  (cost=0.28..4.69 rows=40 width=34) (actual time=0.016..0.065 rows=96 loops=2)
	        Index Cond: (role_id = r.id)
	        Heap Fetches: 192
	        Buffers: shared hit=120
```

### 3. 64.5 ms (slowest of 50)

```
2026-10-30 08:52:21.483 UTC [6873] LOG:  duration: 64.510 ms  plan:
	Query Text: NOT EXISTS (
	    SELECT 1 FROM audit_event a
	    WHERE a.record_type = TG_TABLE_NAME AND a.record_id = rid AND (v IS NULL OR a.new_version = v)
	  )
	Result  (cost=5718.88..5718.89 rows=1 width=1) (actual time=64.500..64.503 rows=1 loops=1)
	  Buffers: shared hit=1123
	  InitPlan 1 (returns $0)
	    ->  Index Scan using audit_event_record_idx on audit_event a  (cost=0.42..5718.88 rows=1 width=0) (actual time=64.496..64.496 rows=1 loops=1)
	          Index Cond: (record_id = '01a18c02-92ed-7529-bc39-1757ec514688'::uuid)
	          Filter: ((record_type = 'saved_view'::name) AND (new_version = 1))
	          Buffers: shared hit=1123
```

### 4. 6.9 ms (slowest of 265)

```
2026-10-30 08:52:12.732 UTC [6873] LOG:  duration: 6.890 ms  plan:
	Query Text: select "initiative"."id", "initiative"."code", "initiative"."planned_start", "initiative"."planned_end", "roadmap_wave"."ordinal" as "wave_ordinal" from "initiative" left join "roadmap_wave" on "roadmap_wave"."id" = "initiative"."wave_id" where "initiative"."transformation_id" = $1
	Query Parameters: $1 = 'e2b51ceb-1ff1-38e9-a507-296ec2b67e13'
	Hash Left Join  (cost=68.53..1137.90 rows=484 width=35) (actual time=0.159..0.347 rows=250 loops=1)
	  Hash Cond: (initiative.wave_id = roadmap_wave.id)
	  Buffers: shared hit=41
	  ->  Bitmap Heap Scan on initiative  (cost=52.03..1120.13 rows=484 width=49) (actual time=0.051..0.194 rows=250 loops=1)
	        Recheck Cond: (transformation_id = 'e2b51ceb-1ff1-38e9-a507-296ec2b67e13'::uuid)
	        Heap Blocks: exact=22
	        Buffers: shared hit=29
	        ->  Bitmap Index Scan on initiative_status_idx  (cost=0.00..51.91 rows=484 width=0) (actual time=0.039..0.040 rows=253 loops=1)
	              Index Cond: (transformation_id = 'e2b51ceb-1ff1-38e9-a507-296ec2b67e13'::uuid)
	              Buffers: shared hit=7
	  ->  Hash  (cost=14.00..14.00 rows=200 width=18) (actual time=0.100..0.102 rows=200 loops=1)
	        Buckets: 1024  Batches: 1  Memory Usage: 18kB
	        Buffers: shared hit=12
	        ->  Seq Scan on roadmap_wave  (cost=0.00..14.00 rows=200 width=18) (actual time=0.006..0.069 rows=200 loops=1)
	              Buffers: shared hit=12
```

### 5. 6.6 ms (slowest of 265)

```
2026-10-30 08:52:16.364 UTC [6873] LOG:  duration: 6.555 ms  plan:
	Query Text: select "id", "from_kind", "from_label", "from_initiative_id", "to_initiative_id", "needed_by", "status" from "dependency" where "transformation_id" = $1 and "status" <> $2
	Query Parameters: $1 = 'e2b51ceb-1ff1-38e9-a507-296ec2b67e13', $2 = 'archived'
	Bitmap Heap Scan on dependency  (cost=5.12..25.99 rows=125 width=100) (actual time=0.024..0.094 rows=125 loops=1)
	  Recheck Cond: ((transformation_id = 'e2b51ceb-1ff1-38e9-a507-296ec2b67e13'::uuid) AND (status <> 'archived'::text))
	  Heap Blocks: exact=5
	  Buffers: shared hit=6
	  ->  Bitmap Index Scan on dependency_dimension_idx  (cost=0.00..5.08 rows=125 width=0) (actual time=0.015..0.016 rows=125 loops=1)
	        Index Cond: (transformation_id = 'e2b51ceb-1ff1-38e9-a507-296ec2b67e13'::uuid)
	        Buffers: shared hit=1
```

### 6. 41.2 ms (slowest of 7)

```
2026-10-30 08:52:36.527 UTC [6873] LOG:  duration: 41.237 ms  plan:
	Query Text: insert into "report_snapshot" ("id", "organization_id", "transformation_id", "definition_code", "subject_type", "subject_id", "reporting_period_id", "period_label", "period_start", "period_end", "parameters", "as_of", "content_schema_version", "content", "content_sha256", "methodology_v …[truncated]
	Query Parameters: $1 = '01a18c02-cdc8-74db-9b3c-e46b493918de', $2 = 'd044310c-e30f-34b1-91b4-8c86cfb1c8fc', $3 = 'e2b51ceb-1ff1-38e9-a507-296ec2b67e13', $4 = 'registers', $5 = 'transformation', $6 = 'e2b51ceb-1ff1-38e9-a507-296ec2b67e13', $7 = NULL, $8 = NULL, $9 = NULL, $10 = NULL, $11 = '{"filter …[truncated]
	Insert on report_snapshot  (cost=0.00..0.01 rows=1 width=862) (actual time=40.224..40.229 rows=1 loops=1)
	  Buffers: shared hit=150 dirtied=10 written=9
	  ->  Result  (cost=0.00..0.01 rows=1 width=862) (actual time=0.004..0.006 rows=1 loops=1)
```

### 7. 9.8 ms (slowest of 17)

```
2026-10-30 08:52:39.436 UTC [6849] LOG:  duration: 9.820 ms  plan:
	Query Text: 
	    WITH next as (
	      SELECT id 
	      FROM pgboss.job_common
	      WHERE name = 'reports.export'
	        AND state < 'active'
	        AND start_after < now()
	      ORDER BY priority desc, created_on, id
	      LIMIT 1
	      FOR UPDATE SKIP LOCKED
	    )
	    UPDATE pgboss.job_common j SET
	      state = 'active',
	      started_on = now(),
	      retry_count = CASE WHEN started_on IS NOT NULL THEN retry_count + 1 ELSE retry_count END
	    FROM next
	    WHERE name = 'reports.export' AND j.id = next.id
	    RETURNING j.id, name, data, expire_seconds as "expireInSeconds",
	  policy,
	  state,
	  priority,
	  retry_limit as "retryLimit",
	  retry_count as "retryCount",
	  retry_delay as "retryDelay",
	  retry_backoff as "retryBackoff",
	  retry_delay_max as "retryDelayMax",
	  start_after as "startAfter",
	  started_on as "startedOn",
	  singleton_key as "singletonKey",
	  singleton_on as "singletonOn",
	  deletion_seconds as "deleteAfterSeconds",
	  created_on as "createdOn",
	  completed_on as "completedOn",
	  keep_until as "keepUntil",
	  dead_letter as "deadLetter",
	  output
	Update on job_common j  (cost=232.24..240.29 rows=1 width=62) (actual time=9.809..9.814 rows=1 loops=1)
	  Buffers: shared hit=192
	  CTE next
	    ->  Limit  (cost=231.94..231.96 rows=1 width=34) (actual time=9.657..9.659 rows=1 loops=1)
	          Buffers: shared hit=183
	          ->  LockRows  (cost=231.94..237.91 rows=477 width=34) (actual time=9.655..9.656 rows=1 loops=1)
	                Buffers: shared hit=183
	                ->  Sort  (cost=231.94..233.14 rows=477 width=34) (actual time=9.628..9.628 rows=1 loops=1)
	                      Sort Key: job_common.priority DESC, job_common.created_on, job_common.id
	                      Sort Method: quicksort  Memory: 65kB
	                      Buffers: shared hit=182
	                      ->  Seq Scan on job_common  (cost=0.00..229.56 rows=477 width=34) (actual time=0.066..9.016 rows=645 loops=1)
	                            Filter: ((state < 'active'::pgboss.job_state) AND (name = 'reports.export'::text) AND (start_after < now()))
	                            Rows Removed by Filter: 1737
	                            Buffers: shared hit=182
	  ->  Nested Loop  (cost=0.28..8.33 rows=1 width=62) (actual time=9.703..9.706 rows=1 loops=1)
	        Buffers: shared hit=186
	        ->  CTE Scan on next  (cost=0.00..0.02 rows=1 width=56) (actual time=9.672..9.673 rows=1 loops=1)
	              Buffers: shared hit=183
	        ->  Index Scan using job_common_pkey on job_common j  (cost=0.28..8.30 rows=1 width=34) (actual time=0.024..0.024 rows=1 loops=1)
	              Index Cond: ((name = 'reports.export'::text) AND (id = next.id))
	              Buffers: shared hit=3
```

### 8. 5.2 ms (slowest of 80)

```
2026-10-30 08:52:11.524 UTC [6855] LOG:  duration: 5.183 ms  plan:
	Query Text: update "export_job_progress" set "stage" = CASE WHEN array_position(ARRAY['queued','loading','rendering','storing','done']::text[], $1::text) > array_position(ARRAY['queued','loading','rendering','storing','done']::text[], stage) THEN $2::text ELSE stage END, "sections_done" = GREATEST( …[truncated]
	Query Parameters: $1 = 'loading', $2 = 'loading', $3 = '0', $4 = NULL, $5 = '0', $6 = NULL, $7 = '1', $8 = '01a18bf4-0ee8-70eb-81f4-9e5377829880', $9 = 'done'
	Update on export_job_progress  (cost=0.28..8.32 rows=0 width=0) (actual time=5.181..5.181 rows=0 loops=1)
	  Buffers: shared hit=43
	  ->  Index Scan using export_job_progress_pkey on export_job_progress  (cost=0.28..8.32 rows=1 width=60) (actual time=0.059..0.066 rows=1 loops=1)
	        Index Cond: (export_job_id = '01a18bf4-0ee8-70eb-81f4-9e5377829880'::uuid)
	        Filter: (stage <> 'done'::text)
	        Buffers: shared hit=3
```

### 9. 37.7 ms (slowest of 1)

```
2026-10-30 08:52:11.620 UTC [6886] LOG:  duration: 37.734 ms  plan:
	Query Text: SELECT i.id, i.transformation_id, i.executive_owner_user_id FROM initiative i ORDER BY i.transformation_id, i.code
	Sort  (cost=1831.98..1836.82 rows=1935 width=57) (actual time=20.249..20.479 rows=1000 loops=1)
	  Sort Key: transformation_id, code
	  Sort Method: quicksort  Memory: 110kB
	  Buffers: shared hit=1707
	  ->  Seq Scan on initiative i  (cost=0.00..1726.35 rows=1935 width=57) (actual time=0.022..19.736 rows=1000 loops=1)
	        Buffers: shared hit=1707
```

### 10. 18.9 ms (slowest of 17)

```
2026-10-30 08:52:23.497 UTC [6848] LOG:  duration: 18.852 ms  plan:
	Query Text: select "s"."id", "s"."content", "s"."status", "s"."issue_version", "s"."definition_code", "d"."label_en", "d"."label_ar", "o"."default_timezone", "t"."code" as "transformation_code" from "report_snapshot" as "s" inner join "report_definition" as "d" on "d"."code" = "s"."definition_code" …[truncated]
	Query Parameters: $1 = '01a18bf4-0de3-753f-99d1-cd153e2bd643'
	Nested Loop  (cost=8.31..13.24 rows=1 width=128) (actual time=0.051..0.088 rows=1 loops=1)
	  Join Filter: (o.id = s.organization_id)
	  Buffers: shared hit=7
	  ->  Nested Loop  (cost=8.31..12.22 rows=1 width=132) (actual time=0.045..0.079 rows=1 loops=1)
	        Join Filter: (d.code = s.definition_code)
	        Rows Removed by Join Filter: 5
	        Buffers: shared hit=6
	        ->  Hash Join  (cost=8.31..10.95 rows=1 width=83) (actual time=0.038..0.071 rows=1 loops=1)
	              Hash Cond: (t.id = s.transformation_id)
	              Buffers: shared hit=5
	              ->  Seq Scan on transformation t  (cost=0.00..2.50 rows=50 width=25) (actual time=0.008..0.024 rows=50 loops=1)
	                    Buffers: shared hit=2
	              ->  Hash  (cost=8.29..8.29 rows=1 width=90) (actual time=0.021..0.023 rows=1 loops=1)
	                    Buckets: 1024  Batches: 1  Memory Usage: 9kB
	                    Buffers: shared hit=3
	                    ->  Index Scan using report_snapshot_pkey on report_snapshot s  (cost=0.28..8.29 rows=1 width=90) (actual time=0.016..0.017 rows=1 loops=1)
	                          Index Cond: (id = '01a18bf4-0de3-753f-99d1-cd153e2bd643'::uuid)
	                          Buffers: shared hit=3
	        ->  Seq Scan on report_definition d  (cost=0.00..1.12 rows=12 width=60) (actual time=0.004..0.004 rows=6 loops=1)
	              Buffers: shared hit=1
	  ->  Seq Scan on organization o  (cost=0.00..1.01 rows=1 width=28) (actual time=0.005..0.006 rows=1 loops=1)
	        Buffers: shared hit=1
```

