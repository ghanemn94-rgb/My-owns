# Handback T-DG7-DO-D2 (devops-engineer): complete and run the transfer drill

- **Stage:** P7, gate DG7 (BUILDING). Task "B.6 DO-D2" of `docs/architecture/p7-work-split.md` (D-258). ADR-0069 §4, ADR-0064 Amendment 1 (A1.9).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-DO-D2-devops-engineer-20261113T133829Z-d0298da0","session_id":"d0298da0-66fb-45c2-b3b1-2e0f5775b50e"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-D2.md`. I verified its sha256 as `fbd227b99d03b85a573f56a9248f931a6dbc95b373f180dcc4897905ee603ff4`.
- **Base:** `82b4c4b3ce92be755c66582704da504fd5003cba` on `claude/mobily-transformation-platform-dg6-regate`. At the start, `git status` showed my run folder and a modified `vitest.config.ts`. That one-line include is BE-R1's (its handback §1), left uncommitted by the integration, and I did not touch it. Nothing was committed.
- **Time (`date -u`):** start 13:38:39Z, last stamp 14:06:58Z. As earlier handbacks note, the sandbox clock runs slow, so these understate the real elapsed time. I stopped at the time box.
- **Two gate systems.** Every user, secret, origin and decision in the drill is SYNTHETIC. The drill's G1 decision is the outcome `deferred`, labelled "approves nothing real". Nothing here grants or implies a G1–G6, Finance or IT approval. Nothing reads or writes a DG0–DG7 record.
- **A local, container-free drill is not evidence of high-availability production readiness.** The Compose, image and Keycloak halves stay the orchestrator's (no Docker daemon, D-243 Q1).

## Headline

- **DO-D gaps 3–6 are closed in code.** Done:
  - D1 uploads two evidence files;
  - D8 (b) records a KPI value, creates a RAID item, submits a gate, and has a rebound approver decide it;
  - D8 (d) builds and opens the deep link;
  - the D9 job checks and the D7 `getDeploymentStatus` assertion are built;
  - every key goes into `journal.json`, and the allowance is built only from it.
- **T-B10 passes under `NODE_ENV=production`, `AUTH_MODE=oidc`**, using BE-R1's loopback exception. T-B16 passes. T-B15 passes except the one case that needs BE-R1's `parseAllowance`, which does not exist yet. That case FAILS with `BLOCKED:` and is not skipped.
- **T-B11 (the real drill) was RUN, and its result is FAIL at D0.** It ran on a real archive built from HEAD with a real BE-C demo export, inside the no-network namespace. D1–D11 are `NOT_RUN`. The cause is upstream (§4 gap 1). D5 could not pass anyway: `prepare-target.mjs` and the mode 1 and mode 2 rechecks are missing, and the load is blocked by R1 (§4 gaps 2–3). **T-B11 is not satisfied.**

## 1. Files changed

| File | Purpose |
| --- | --- |
| `deploy/scripts/transfer-drill.sh` (modified) | Changes by step:<br>• **Disk check first:** `df -Pm`, need = 4 × the archive + 1024 MB, an estimate overridable by `MTH_TD_NEED_MB`. Prints the exit-3 B.6 line.<br>• **D1:** `journey.mjs --mode dev --steps signin,uploads`.<br>• **D2:** `export.mjs` only, with no `copy-out`. Asserts `attachments.json` count = S's rows with a `storage_key`.<br>• **D5:** `#migration-import`. A new empty database and evidence directory, then `prepare-target.mjs --from`, then `import.mjs --keep-reports`, then `reconcile.mjs --from` mode 1 → `reconcile-d5.json`.<br>• **D6:** rebind, then mode 1 → `reconcile-d6.json`, which must show the rebind delta.<br>• **D7:** actors chosen among the rebound users by permission. Asserts `getDeploymentStatus` `origin` and `environmentKind` = the manifest's `sourceEnvironment`.<br>• **D8:** submitter, rebound approver and transformation passed to the journey. Download count = manifest count.<br>• **D9:** the job-check sequence (see "D9 jobs" in the work split), then the allowance and mode 2 → `reconcile-d9.json`, with the two B.6 D9 FAIL lines.<br>• The report lists the reports and the allowance and journal checksums.<br>**Two drill bugs found by the real run and fixed:**<br>• D2 ran the export without `NODE_ENV`, so it was refused: `NODE_ENV is required for db-cli`.<br>• The operator `transfer-drill (synthetic)` fails the CLI's operator pattern `^[\p{L}\p{N} ._@-]{1,100}$`. It is now `transfer-drill synthetic operator`. |
| `deploy/scripts/drill/journey.mjs` (modified) | New steps, each with the key taken from the API response into the journal:<br>• `status` (D7);<br>• `uploads` (D1, dev sign-in on S): `createEvidence` and `uploadEvidenceContent` ×2;<br>• `writes` (D8 (b)): transformation, RAID item, KPI actual (`save_draft`, value `"1.5"` as a decimal string), gate submission;<br>• `approve`: the rebound approver decides `deferred`; reads back the worker-derived `kpi_evaluation` and `calculation_run` through `getKpiStatus`;<br>• `deeplink` (D8 (d)): the inbox `linkPath` must resolve and open under T's origin;<br>• `exportq` and `exportwait` (D9): queued, then `succeeded` within 120 s, with the download SHA-256 = `fileSha256`.<br>Also adds the `Journal` class (`mth-drill-journal/1`) and `--mode dev`. |
| `deploy/scripts/drill/allowance.mjs` (new) | Builds `mth-recheck-allowance/1` from `journal.json` only:<br>• resolves sign-ins on T by (issuer, subject) through psql;<br>• adds `app_user` keys only if the T-B16 measurement says so;<br>• merges duplicates;<br>• keeps `operational` to the minimum, each table with its reason in `allowance-reasons.json`;<br>• never lists a never-operational table there.<br>The constants come from `recheck.ts` when it exists. Until then they are ADR-0064 A1.9's literal lists, and the reasons file says which source it used. |
| `deploy/scripts/drill/job-check.mjs` (new) | `snapshot` / `compare`, read-only through psql:<br>• `job_run` (count, highest id, digest);<br>• enabled `job_schedule`;<br>• the pg-boss schema and table **measured** on the target, with rows by queue and state. None found → BLOCKED (exit 2), never PASS;<br>• `gate_decision`, `approval`, `approval_decision` by count and digest. |
| `deploy/scripts/tests/transfer-drill.test.mjs` (modified) | Adds:<br>• T-B10 production cases (status PASS, and a wrong expectation FAILS);<br>• the "no data to prove never passes" case;<br>• the T-B16 sign-in measurement;<br>• T-B15 (4 cases);<br>• T-B16 job checks on a fixture database (5 cases);<br>• T-B9 disk-BLOCKED.<br>Removes the "deep link not built" case. |
| `docs/handover/deployment.md` | the new section `## Moving an installation {#migration-import}`, with the exact EN text |
| `docs/handover/deployment.ar-summary.md` | its summary line, with the exact AR text, under the summary's existing provisional banner |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D2-evidence/*` | logs, `app-user-signin.json`, `transfer/` (the T-B11 report), `files.sha256` |

No migration, contract, permission or product-code change. `apps/api/test/support/p7-pending*.ts` has no DO-D2 entry (DO-D2 owns no operation), so I removed none.

## 2. Behaviour per requirement

| Requirement / clause | Test | Status |
| --- | --- | --- |
| REQ-S19-017 "successful key workflows" / "rebind identity" | T-B10 | **PASS** under `NODE_ENV=production, AUTH_MODE=oidc`, drill IdP at `http://127.0.0.1:<p>`:<br>• sign-in;<br>• CSRF 403 for the source origin;<br>• unbound refused with `identity_unbound`, `/me` 401;<br>• `getDeploymentStatus.origin` = target, `environmentKind` `production`;<br>• the unregistered redirect refused.<br>The D8 (b) write chain and the deep link were **not exercised end to end**: they need carried demo data on T (T-B11 D8). |
| REQ-S19-017 "records, jobs and approvals intact after a full restart" | T-B16 | **PASS** (5/5): a changed enabled schedule fails, a removed `job_run` row fails, a new `job_run` row passes (counted), a changed approval row fails, and a missing pg-boss table is BLOCKED (exit 2). **Measured:** a sign-in changes `app_user` (`appUserChangedBySignIn: true`) and `user_identity`. |
| A1.9 allowance | T-B15 | **3/4 PASS**: valid shape, duplicates merged, never-operational tables only in `tables`, reasons for every operational table, `app_user` only by the measurement, and invalid entries refused (CLI exit 1). **1 FAIL (BLOCKED):** "parseAllowance accepts the file". `packages/db/src/transfer/recheck.ts` does not exist (BE-R1 gap 2). |
| REQ-S19-017 counts/checksums, downloads; REQ-S01-006 different base URL; REQ-S19-009 template and guides | T-B11 | **FAIL at D0** (§4 gap 1). D1–D11 `NOT_RUN`. |
| REQ-S19-009 guide | — | `#migration-import` section and AR summary line added, with the exact texts. D5 and D6 cite it. |

### T-B11 as run

- **Driver:** `tests/qa/support/with-pg.sh bash $TMPDIR/b11/run.sh`. Attempt 3 is the one that counts; attempts 1 and 2 stopped at the two drill bugs in §1. Logs: `t-b11-attempt1.log`, `t-b11-attempt2.log`, `t-b11-run.log`.
- **Free disk before:** 3565 MB under `$TMPDIR`; 3192 MB before the drill. The drill's check needs 4 × 14 + 1024 = 1080 MB.
- **Demo export:** fresh database, `migrate`, `seed-demo`, then `tools/migration/export.mjs`.
  - Result: export `01a1d531-…`, demo at level `0149_p7_transfer_import_load`: **335 tables, 4798 rows, 0 attachments**.
  - Manifest sha256 `a54c4e9401f241c9f44bac39dec22d104e7edd801c190c3e61693f36e1c21808`. 7.5 s.
  - Seam check: the export writes the package itself, so no `copy-out` is needed. seed-demo has 0 evidence objects, which is why D1 uploads two.
- **Archive:** `build-archive.mjs --repo <this repo> --commit 82b4c4b3ce92be755c66582704da504fd5003cba --demo-data <export> --out …`. Exit 0, 15.4 s.
  - Archive `mth-transformation-hub-0.1.0-737e32430646.tar.gz`, 14 188 889 bytes.
  - Archive sha256 `cf185ccc2ab95ec487af1a95d3b552708803810bce3cc91f515aedd4647d9cfb`.
  - Tar sha256 `8cf5f379…89b6`, candidate `sha256:737e32430646…314c`.
  - The archive is HEAD, so it does **not** contain this task's changes. The drill scripts ran from the working tree, and the archive's `tools/migration/*` come from HEAD.
- **Store:** a byte copy of `/root/.local/share/pnpm/store/v10`, 4.8 s.
- **Drill:** `deploy/scripts/transfer-drill.sh --archive … --sha256 cf185ccc… --store … --out docs/delivery/handbacks/DG7/T-DG7-DO-D2-evidence/transfer`. **Exit 1 in 170.9 s.**
  - Probe: `tcp 1.1.1.1:443 ENETUNREACH`, `dns registry.npmjs.org EAI_AGAIN`, so isolation was effective.
  - **D0:** `archive-verify: PASS` (7/7). In `build-from-archive.sh`, these steps exited 0: unpack 0.6 s, install 1.5 s, build 142.2 s, assemble 4.7 s, check-no-cdn 0.5 s.
  - **`scan-assets` exit 1 (18.9 s): 2 R2 hits in `apps/api/dist/release/register-snapshot.json`**, which means `build-from-archive: FAIL`.
  - Report `transfer/transfer-drill-report.json`: `result: FAIL`, D0 FAIL, D1–D11 NOT_RUN.
  - The work tree was deleted (no `--keep`), and so were all my temporary trees.
- **Environment:** Node v24.21.0, bubblewrap 0.9.0, PostgreSQL 16.15, uid 0, offline (`MTH_PNPM_OFFLINE=1`), no Docker daemon.

## 3. Checks run (real exit codes)

| Command | Exit | Result / log |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (**first**, before implementing) | 0 | `PASS gate DG6 (historical)`, `validate-historical-DG6-before.log` |
| `MTH_DRILL_MEASURE_OUT=… tests/qa/support/with-pg.sh node --test --test-reporter=spec deploy/scripts/tests/transfer-drill.test.mjs` (first run) | 1 | 27/33 pass. Six failures, all from my journal bug: a sign-in entry without an issuer. Fixed. `transfer-drill-test.run1.log` |
| Same command, final run on the final files | **1** | **33 tests, 32 pass, 1 fail.** The fail is T-B15 "parseAllowance": `BLOCKED: parseAllowance is not exported by packages/db/src/transfer/recheck.ts (T-DG7-BE-R1 gap 2)`. `transfer-drill-test.log` |
| T-B11 driver, attempts 1 / 2 / 3 | 13 / 13 / **1** | 1: `NODE_ENV is required for db-cli`. 2: operator pattern. 3: the drill ran, FAIL at D0. `t-b11-*.log`, `transfer/` |
| `npx eslint deploy/scripts/drill deploy/scripts/tests/transfer-drill.test.mjs` | 0 | `eslint-own.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` |
| `pnpm lint` | 0 | `lint.log` |
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm test` | 0 | unit-node 204 files / 3006 tests; unit-web 130 / 2175; nocodegen 3 / 259 (+2 skipped). `pnpm-test.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `All matched files use Prettier code style!`, `prettier.log` |
| `bash -n deploy/scripts/transfer-drill.sh` | 0 | after every edit |
| `node tools/gates/validate.mjs --historical --stage DG6` (end) | 0 | `validate-historical-DG6-end.log` |

**Not run:** the A18 harness `tests/qa/integration/a18-transfer-drill.test.ts`, which needs a PASSing drill report; the contract test (I changed no contract); and any vitest integration file (I touched none).

## 4. Known gaps / not done

1. **T-B11 D0 FAILS on an upstream defect, not in my files.** `apps/api` `build` copies `docs/delivery/requirements.csv` into `dist/release/register-snapshot.json` (`scripts/register-snapshot.mjs`, BE-H). Row REQ-DLV-006 quotes `/var/tmp/mth-run.XXXXXX` and a `/tmp…` path. ADR-0062's asset scan rule R2 (absolute build-host paths) then refuses the runtime tree.
   - Every archive built from HEAD fails `build-from-archive` this way, independent of the drill.
   - I did not work around it, as B.6 requires.
   - The owner is BE-H (the snapshot text) or DO-A (an R2 allow-list entry with a reason, if ADR-0062 §8 permits one for this file). See Q1.
2. **D5 cannot pass even after (1):**
   - `tools/migration/prepare-target.mjs` does not exist (BE-R1 gap 3), so D5 FAILs with `tools/migration/prepare-target.mjs is not in the archive`.
   - `import.mjs` has no `--keep-reports`, and `reconcile.mjs`/`reconcile-migration` have no `--from` or mode 2 (`--after-use --allow`). Their strict parsers will refuse.
   - Behind those, the load itself stops at L1 on R1 (BE-R1 §0).
   - The drill calls the interfaces the work split names, so these steps will FAIL until BE-R1's remaining work and R1's decision land.
3. **T-B15's `parseAllowance` case is BLOCKED** (BE-R1 gap 2). `allowance.mjs` uses ADR-0064 A1.9's literal constants until `recheck.ts` exists. Those exclude the 17 financial tables of T-C17 only implicitly: `operational` is limited to a fixed list of job and notification tables.
4. **D8 (b) and (d) and the D9 export steps are not exercised end to end.** They are written against the OpenAPI contract and run only inside T-B11 on carried demo data, which never ran. Choices that need a real run to confirm:
   - the KPI value is `save_draft` on the first active definition with an open period of the chosen transformation;
   - the actors are a `gate.submit` and a different `gate.decide` holder on one transformation, among the rebound users;
   - the export is `registers`/CSV/EN;
   - the deep link is the inbox `linkPath`, which needs the API to answer 200 or a same-origin redirect on that path.
5. **The mode 2 allowance may be too narrow, a design risk for the architect (Q2).** D8's writes create rows whose keys no API response returns, for example:
   - the gate instance's updates;
   - work items;
   - the decision's child rows;
   - the role assignment and lifecycle rows a new transformation creates.

   Under A1.9 rule 5 these would be `unexplained`, and D9 would FAIL even if the product is correct. "Keys from API responses only" (B.6) and "every other table unchanged" may not both hold for these writes.
6. **The `job-check.mjs` digest is not the §2.3 encoder.** It is SHA-256 over `row::text` in key order. That is equal for equal rows, but it is not the encoder's digest that "D9 jobs" item 6 names. Using the encoder needs a database connection through `packages/db`, which I did not add.
7. **The disk need is an estimate** (4 × archive + 1024 MB), not a measurement of a full drill.
8. **The CI wiring fragment** (DO-D gap 7) stays the orchestrator's: `tests/qa/support/with-pg.sh node --test deploy/scripts/tests/transfer-drill.test.mjs`. Expect exit 1 until BE-R1's `parseAllowance` exists.

## 5. Open questions and merge instructions

- **Q1 (orchestrator / BE-H / DO-A):** how do we clear the R2 hits in `register-snapshot.json`? Reword REQ-DLV-006's path text in the snapshot, or add an allow-list entry with a reason? Every release archive is affected.
- **Q2 (architect):** given gap 5, should the drill's D8 journal also take the child rows each write creates? Those keys are not API-returned. Or should A1.9 gain a rule for rows created in the same transaction as a journalled key?
- **Q3 (orchestrator):** after BE-R1's remaining work (`prepare-target.mjs`, `recheck.ts`, the mode 1 and mode 2 CLI flags, `--keep-reports`) and R1, re-run T-B11 with an archive that contains this task's drill. The command is in §2.
- **Merge:**
  - No migration and no contract change. No new `docs/handover/` file, so the index needs no new line; one section was added to `deployment.md`.
  - `guide-keys.json` is unchanged: no new configuration key.
  - Expect no conflicts. `vitest.config.ts` (BE-R1's) is still uncommitted in the tree and is not part of this task.
