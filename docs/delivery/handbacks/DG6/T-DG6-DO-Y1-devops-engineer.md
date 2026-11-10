# Handback T-DG6-DO-Y1 (devops-engineer): DG6 round-1 repair of the load-dataset generator (F-DG6-101 / F-DG6-142)

- **Stage:** DG6, FIXING after review round 1. Assignment `docs/delivery/assignments/DG6/T-DG6-DO-Y1.md` (sha256
  `c5ea3ea6…403e277`, verified).
- **Invocation:** `DG6-T-DG6-DO-Y1-devops-engineer-20261101T210553Z-3c9cffc4`, session
  `3c9cffc4-cecd-4c48-a51e-cd590afa0bce`.
- **Tree:** worktree `/home/user/wt/dg6-do-y1`, branch `dg6/do-y1`, base `HEAD` `eb75a6aa6`. All changes are left
  **uncommitted**.
- **Time:** started `Sun Nov 1 21:07:36 UTC 2026`; the end time is at the bottom.
- **Engineering only.** Nothing here is a G1–G6 business approval, and nothing here decides DG6 or DG7. The load
  dataset is synthetic.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and
  exited 0, run before any edit.

## 1. Per finding: cause, fix, test, result

### F-DG6-101 (domain-reviewer) and F-DG6-142 (qa-verifier): Medium, one defect

**Reproduced first, on this branch.** I ran the domain reviewer's probe
(`docs/delivery/test-evidence/DG6/domain/round-1/probes/uuidprobe.mjs.txt`, copied to `$TMPDIR` as `.mjs`) against
`generate.mjs` at HEAD (sha256 `7470ea74…`) with apps/api's zod 4.6.7:

```text
{"nonRfc":865,"rejectedByZodUuid":865,"of":1000}
```

This is the reviewer's figure exactly (`T-DG6-DO-Y1-evidence/domain-probe.log`).

**Cause.** `loadId` laid the md5 of `dataset:seed:kind:n` out as `8-4-4-4-12` hex without setting the RFC 9562 version
nibble or the variant bits. The API's `z.uuid()` refuses such strings, so the API answered 400 `Invalid UUID` for most
records. The same applies to the version-step audit ids, which `generate.mjs` derives in SQL as `md5(…)::uuid`. Every
measured DG6 load run (DO-F run-1, BE-S, DO-G, DO-H) used an out-of-tree scratch copy patched with DO-F's
`generate-rfc-uuid.patch` (sha256 `6b2a9007…`).

**Fix.** I applied DO-F's `docs/delivery/handbacks/DG6/T-DG6-DO-F-evidence/generate-rfc-uuid.patch` to
`deploy/load/generate.mjs` **unchanged**. The fix has two parts:

- `rfcUuidFromMd5Hex` keeps the md5 bits, sets the version nibble to `3` (name-based, MD5), and sets the two variant
  bits to `10`. `loadId` uses it.
- The SQL that writes the version-step audit ids applies the same bits.

**The shipped file is now byte-identical to the copy that was measured.**

- `sha256sum deploy/load/generate.mjs` gives `6b2a9007e47b49640a497a356239cea1b79b5a0081a12c5e88dbf7f405bdff8a`.
- That is the sha256 recorded in the DO-G and DO-H driver outputs, in BE-S's `load-driver-output.txt` and in DO-F's
  `generate-patched-default.txt`.
- The changed lines are exactly the patch's hunks (checked with `diff`; the diff is in `generate.mjs.diff`).

So with `--profile default` and seed `20261027`, it writes the same dataset that the DO-G/DO-H figures were measured on.
This is a property of identical bytes, not a new measurement. Three ids from that run's evidence are also pinned in the
new test:

| Id                                             | Value                                  | Where it appears                                                        |
| ---------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `loadId(20261027,'organization',1)`            | `d044310c-e30f-34b1-91b4-8c86cfb1c8fc` | DO-F `run-1/explain/createExport.explain-digest-all-statements.md`      |
| `loadId(20261027,'transformation',1)` (`LOAD-T01`) | `e2b51ceb-1ff1-38e9-a507-296ec2b67e13` | DO-H `rep-{1,2,3}/export-proof.json`, `transformationId`                |
| `loadId(20261027,'app_user',1)`                | `3e23f9e4-d64e-396c-8562-938142305301` | DO-H `rep-{1,2,3}/export-proof.json`, `requesterUserId`                 |

**Tests: each fails before the fix and passes after it.**

1. **`deploy/scripts/tests/load-generate-ids.vitest.mjs` (new; `pnpm test`, project unit-node).**
   - It joins through the existing `deploy/scripts/tests/**/*.vitest.mjs` include, so `vitest.config.ts` is not
     changed.
   - It validates with **the API's own `z.uuid()`**, zod resolved from `apps/api/package.json` (no new dependency).
   - Four tests:
     - every id `loadId` gives for the `default` profile's kinds (over 50,000 ids, including 20,001 audit ordinals)
       passes `z.uuid()` and the RFC 9562 layout, with no collision;
     - the reviewer's probe as a test (`loadId(1,'initiative',0..999)`: 0 rejected);
     - the id is deterministic, and equals the md5 with only the version nibble and the two variant bits changed;
     - the three pinned ids of the measured dataset above.
   - **Before** (generator at `7470ea74…`): `Tests 4 failed (4)`, exit 1, with `"rejected": 47623` in the first test
     (`T-DG6-DO-Y1-evidence/before-fix.log`).
   - **After** (`6b2a9007…`): `Tests 4 passed (4)`, exit 0 (`after-fix.log`).
2. **`deploy/load/generate.test.mjs`: a new integration test, "every id the generator writes passes the API's
   z.uuid()".**
   - After a `smoke` generation into a disposable PostgreSQL, it reads every `id` of the 19 `HASHED_TABLES` and of the
     generator's own audit events (`request_id = 'mth-load-generate'`).
   - It asserts that SQL-derived version-step events exist (`action LIKE '%.update'`), so that path is covered too.
   - It asserts zero ids rejected by `z.uuid()`.
   - Command:
     `QA_PG_PORT=<p> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh npx vitest run --project integration packages/db/test/integration/load-dataset.test.ts`
   - **Before:** `Tests 1 failed | 8 passed (9)`, exit 1, `expected { rejected: 2088, … } to deeply equal { rejected: +0 … }`
     (`integration-before-fix.log`, port 28300).
   - **After:** `Tests 9 passed (9)`, exit 0, 88 s (`integration-after-fix.log`, port 28340).
3. **The reviewer's probe on the fixed file:** `{"nonRfc":0,"rejectedByZodUuid":0,"of":1000}` (`domain-probe.log`).

**Documentation.** `deploy/load/README.md` gains three changes:

- **Determinism paragraph:** ids now carry the RFC 9562 v3 and variant bits, and the API's `z.uuid()` accepts them.
- **New paragraph, "The dataset of the measured load runs":**
  - this generator, at sha256 `6b2a9007…`, reproduces the dataset of DO-F run-1, BE-S, DO-G and DO-H;
  - those runs used a patched scratch copy with exactly this sha256;
  - the pre-fix generator (`7470ea74…`) had ids the API refused, and no load figure was measured on it.
- **Note under "Measured here":** DO-E's generation runs used the pre-fix generator, so the row hashes recorded there are
  not today's. The counts, the guard behaviour and the timings carry over.

The Files table also lists the new test.

**Not done, as the assignment says:** the full load was **not** re-run.

## 2. Changed files

| File                                                | Purpose                                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `deploy/load/generate.mjs`                          | RFC 9562 v3 ids (`rfcUuidFromMd5Hex`, `loadId`, and the SQL step audit id); now = measured `6b2a9007…` |
| `deploy/load/generate.test.mjs`                     | Integration test: every written id (tables and generator audit events, incl. SQL step ids) passes `z.uuid()` |
| `deploy/scripts/tests/load-generate-ids.vitest.mjs` | New unit test in `pnpm test`: `z.uuid()` over every default-profile id, determinism, pinned measured ids |
| `deploy/load/README.md`                             | Documents the RFC ids, and that this generator reproduces the DO-F/BE-S/DO-G/DO-H dataset          |
| `docs/delivery/handbacks/DG6/T-DG6-DO-Y1-*`         | This handback and its evidence                                                                     |

These files are owned by devops-engineer: p6-work-split §H/G.7 (`generate.mjs`, `generate.test.mjs`, README) and
`deploy/scripts/tests` (DO-A/DO-D). No product code, contract, schema or migration changed. No new dependency.

## 3. Behaviour per requirement row

**REQ-S20-029.** Acceptance: _"A22;A13: the load report states the dataset, infrastructure and workload, and gives
actual p95 figures for reads/updates and dashboards, with any miss against 2 s/4 s listed as a finding"_.

- This repair does not change the report or its figures (DO-G/DO-H).
- It makes the row's cited evidence file `deploy/load/generate.mjs` the exact generator of the dataset the report states
  (sha256 `6b2a9007…`). The documented dataset can now be regenerated from the candidate.
- The register notes' caveat "the run used DO-F's patched copy of generate.mjs, which is not in the tree" no longer holds
  once this is integrated. Updating that note belongs to the orchestrator or analyst, not to me.

## 4. Checks run

All checks ran in this worktree on Node 24.21.0, offline. The host is the shared 4 vCPU / 15 GB sandbox, with other
repair agents running at the same time: load average 15–27 and about 13 of 15 GB used during the runs. Logs and
`exit-codes.txt` are in `T-DG6-DO-Y1-evidence/`.

| #   | Command                                                                                                                  | Exit                            | Time     | Counts / notes                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| 0   | `node tools/gates/validate.mjs --historical --stage DG5`                                                                 | 0                               | —        | `PASS gate DG5 (historical)`                                                                       |
| 1   | `pnpm -r typecheck`                                                                                                      | 0                               | 389 s    | `01-typecheck.log`                                                                                 |
| 2   | `pnpm -r build`                                                                                                          | 0                               | 238 s    | `02-build.log`                                                                                     |
| 3   | `pnpm lint`                                                                                                              | 0                               | 56 s     | `03-lint.log`                                                                                      |
| 4   | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown`                               | 0                               | 158 s    | `04-prettier.log`. I re-checked this handback file afterwards; see the end                         |
| 5   | `pnpm openapi:lint`                                                                                                      | 0                               | 2 s      | `05-openapi-lint.log`                                                                              |
| 6   | `pnpm test` with `LANG`/`LC_ALL`/`LC_CTYPE`/`LANGUAGE` unset                                                             | **1**                           | 1,472 s  | unit-node **188 files / 2,821 tests passed**; unit-web **4 failed / 2,014 passed (2,018)**; unit-formula-nocodegen **3 files, 259 passed, 2 skipped (261)** |
| 7   | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test`                                                                                  | **1**                           | 1,984 s  | unit-node **2,821 / 2,821 passed**; unit-web **7 failed / 2,011 passed (2,018)**; unit-formula-nocodegen **3 files, 259 passed, 2 skipped (261)** |
| 8   | `QA_PG_PORT=28310 MTH_PORT_POOL=28311-28349 tests/qa/support/with-pg.sh pnpm test:integration`                           | **1**                           | 2,629 s  | 2 tests failed by timeout, then a Vitest worker crashed (`ERR_IPC_CHANNEL_CLOSED`) with no summary; see below |
| 9   | Same, rerun: `QA_PG_PORT=28320 MTH_PORT_POOL=28321-28349 …`                                                              | **not finished** (see §4.3)     | > 3,300 s | `09-integration-rerun.log`                                                                         |
| 10  | `npx vitest run --project unit-web <the 9 files that failed in 6 or 7>`, locale unset                                    | 1                               | 182 s    | 2 failed / 165 passed (167): `dashboards` "Hook timed out in 10000ms"; `integrations` retry chain  |
| 11  | Same with `C.UTF-8`                                                                                                      | 1                               | 153 s    | 1 failed / 166 passed (167): `integrations` retry chain                                            |
| 12  | `npx vitest run --project unit-web src/pages/integrations/integrations.test.tsx` (alone)                                 | **0**                           | 33 s     | 17 / 17 passed                                                                                     |
| 13  | `load-dataset.test.ts` alone, after the fix (with-pg, port 28340)                                                        | **0**                           | 88 s     | 9 / 9 passed                                                                                       |

In both runs, all three Vitest invocations ran: `pnpm test` uses `|| s=1`, so it carries on after a failure.

### 4.1 The `pnpm test` exit 1 is unit-web flakiness under host load, not this change

**My change touches no web file.** `git diff --name-only` lists only `deploy/load/{README.md,generate.mjs,generate.test.mjs}`,
and the one new file is under `deploy/scripts/tests/`. Every one of these failures is in `apps/web`.

**The failures are not stable.**

- Run 6 failed 4 tests and run 7 failed 7 others, with no overlap.
- Each is either `Test timed out in 20000ms` / `Hook timed out in 10000ms`, or a testing-library `findBy…` lookup that
  gave up (`Unable to find role=…`).
- The test in both reruns (10 and 11), `integrations.test.tsx › shows the retry chain and retries a failed run once`,
  passes alone, 17 / 17, exit 0 (run 12).

**unit-node passed in both locales.** It holds this task's test: 188 files and 2,821 tests, in both runs.

**Acceptance item 2 is therefore not met as written:** `pnpm test` did not exit 0 in either locale on this host at this
load. I did not rerun the whole `pnpm test` on a quiet host, because the host was never quiet during my run window.

### 4.2 The first integration run

Two tests failed, both in API test files this change does not touch:

- `contract.test.ts › P6 BE-L operations`: `Test timed out in 30000ms`;
- the route-inventory sweep case 4: `tables whose rows changed: expected [ 'public.session' ] to deeply equal []`, after
  24.9 s. A session row was refreshed while that very slow sweep ran.

Then a Vitest fork died with `Error: Channel closed` / `ERR_IPC_CHANNEL_CLOSED`, so there is no summary line. Memory was
at about 13 of 15 GB. 125 test files had passed before the crash, and `load-dataset.test.ts` had not run yet. That is
why I ran it alone afterwards (run 13: 9 / 9).

### 4.3 The integration rerun (run 9)

**It was still running when I hit the time limit, so it has no exit code and is not reported as passed.**

- It started at about 22:19 UTC.
- At Sun Nov  1 23:16:13 UTC 2026: **197 test files had completed, all passed, with 0 failed tests** (no line starting with the `×` failure marker).
- It had not yet reached `load-dataset.test.ts`. That file passed alone after the fix (run 13).
- A copy of the log at handback time is `09-integration-rerun.at-handback.log`. The live log `09-integration-rerun.log`
  may keep growing after this handback, if the run outlives my session.
- **No full integration summary line, and no pinned-count change, can be reported.**
- This change adds 1 test to `load-dataset.test.ts` (8 → 9 tests in that file). It changes no pinned count.

- **Update, 23:18 UTC.** The rerun was then **stopped by the runner's 3,600 s background time limit**, with no summary
  and no exit code. By then **201 test files had completed, all passed, with 0 failed tests**. The final log is
  `09-integration-rerun.log`, and `exit-codes.txt` records it as KILLED. A complete `pnpm test:integration` therefore
  remains **not run to completion**.

## 5. Operations routed (pending-list delta)

None. This task routes no API operation, so no `apps/api/test/support/p6-pending-*.ts` or `p6-exercises-*.ts` file
changed.

## 6. Contract, schema or dependency needs for the orchestrator

- None: no OpenAPI, zod-mirror or migration change, and no new dependency. zod is resolved from apps/api's existing
  dependency, and `pg` from `@mth/db`'s, as before. The highest migration on the branch is `0123_…`; none was added.
- **Suggestion:** after merge, update REQ-S20-029's register note. The caveat "the run used DO-F's patched copy of
  generate.mjs, which is not in the tree" no longer holds, because the tree's file now has that copy's sha256. This is
  for the analyst or orchestrator; I did not edit `requirements.csv`.

## 7. User-facing texts made untrue

None. The change is in load tooling under `deploy/load/`, with no en/ar product strings. In `deploy/load/README.md`, I
corrected the one statement this change affects: the "Measured here" row hashes now come from a pre-fix generator.

## 8. What remains

1. A green `pnpm test` (exit 0) in both locales on a host that is not overloaded. On this host, unit-web flaked by
   timeout in both locales. It is unrelated to this diff; see §4.1.
2. A completed, green full `pnpm test:integration`. Run 8 hit load timeouts and then a worker crash. Run 9 was unfinished
   at the time limit, with 197 files passed and 0 failed (§4.3).
3. The closure of F-DG6-101 and F-DG6-142, by the next review round. As the assignment says, the full load was not
   re-run.

## 9. Merge instructions

- There are no migrations.
- No conflicts are expected: the files are devops-owned, and the other round-1 repair tasks do not touch `deploy/load/`
  or `deploy/scripts/tests/`.
- After integration, check that `sha256sum deploy/load/generate.mjs` gives `6b2a9007…bdff8a`.

## End of run

`date -u` at the end: `Sun Nov  1 23:16:13 UTC 2026`. Elapsed: about 2 h 10 min, slightly over the ~2 h budget, because I waited for integration run 9.
