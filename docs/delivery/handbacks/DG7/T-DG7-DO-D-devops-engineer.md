# Handback T-DG7-DO-D (devops-engineer): the transfer drill

- **Stage:** DG7 (BUILDING). Task §B.2 of `docs/architecture/p7-work-split.md`; ADR-0069 §4.
- **Run:** `DG7-T-DG7-DO-D-devops-engineer-20261113T093100Z-685f3b07`, session `685f3b07-b35c-4783-bf4a-ff8a5fe00288`.
- **Base:** `f4da19fcc9255f1fed5e7d7de8135289efe18004`, branch `claude/mobily-transformation-platform-dg6-regate`. The tree was clean except my own run folder.
- **Start and end:** `date -u` gave 09:31:08 at the start and 09:48:07 at the last check. The sandbox clock advanced much more slowly than the work did, so these two stamps understate the elapsed time. I stopped at the assignment's time box. Section 4 lists what remains.
- **Outcome in one line:** every §B.2 file exists. 19 of the 20 tests pass. The production case of T-B10 fails because of a real configuration gap (§4 gap 1). **T-B11, the drill run itself, was not run**, and cannot pass today because of upstream BE-D Q1 (§4 gap 2).

## 1. Files changed

All of these are new files. No existing file was modified.

| File | Purpose |
| --- | --- |
| `deploy/scripts/transfer-drill.sh` | D0–D11 driver. It checks `bwrap` and `PGBIN` (exit 3 with the B.5 lines), then re-runs itself inside one `bwrap --dev-bind / / --unshare-net --die-with-parent`. The network probe runs first. Ports are fixed in the pool (PG 25432/25433, API 25301/25302, IdP 25401); the namespace is fresh, so they're free. Each step records id, guide section, command, exit, seconds, result and detail. A failed step prints `transfer-drill: step <Dn> failed: …`, and every later step is recorded `NOT_RUN`, never PASS. D11 writes `transfer-drill-report.json` (`mth-transfer-drill/1`). The PASS line is the B.5 text. |
| `deploy/scripts/drill/fake-idp-server.mjs` | The synthetic drill IdP. It wraps the P6 `FakeIdp` (`apps/api/test/support/fake-idp.ts`, loaded through Node 24 type stripping) and adds three things: an authorization endpoint (`login_hint=<sub>`, the redirect URI must be registered), a client secret read from a file the drill generates (the fake's built-in test value is replaced), and a pool port. It prints `{ issuer, clientId, label, users }`. It is used only by the drill and is not in the runtime tree. |
| `deploy/scripts/drill/journey.mjs` | The `oidc-drill` journey. Steps: `signin`, `unbound`, `csrf`, `writes`, `downloads`, `deeplink`. It exports `runJourney`, `client` and `Jar`. Steps that are not built report FAIL (§4 gap 4). |
| `deploy/scripts/drill/origin-scan.mjs` | D10. Through `psql`, it scans every `text`, `varchar` and `jsonb` column of every public base table with `strpos(col::text, origin) > 0`, so the test is a plain substring with no LIKE wildcards. Hits in `audit_event` are listed with `accepted: true`. Any other hit fails with the B.5 line. Report: `mth-origin-scan/1` with `hits[]`. |
| `deploy/scripts/drill/config-trace.mjs` | D3. It fills `.env.example` keys only through the map. A key outside the map, or an anchor missing from the guide, prints the B.5 "undocumented step" line. A key outside the template fails too. Secrets are written as `<KEY>_FILE` and never appear in the trace. Report: `mth-config-trace/1` with `entries[{ key, form, section }]`. |
| `deploy/scripts/drill/guide-keys.json` | Key → `docs/handover/deployment.md#anchor` for all 34 `.env.example` keys. It is generated from DOC-B's "Configuration key index", and every anchor exists (tested). |
| `deploy/scripts/tests/transfer-drill.test.mjs` | T-B3, T-B9 and T-B10 (`node --test`; the PostgreSQL parts run under `with-pg.sh`). |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D-evidence/*` | Test, lint and validator logs, plus `files.sha256`. |

I did not modify `smoke.mjs`, `clean-start-local.sh` or `compose.yaml`, and I did not create `compose.transfer.yaml` (B.2). No migration, contract, permission or `p7-pending*` change: DO-D owns no operation, so there were no pending entries to remove.

## 2. Behaviour per requirement (agent half; ADR-0069 §7 split)

| Requirement | Delivered | Status |
| --- | --- | --- |
| REQ-S01-006 different base URL / no stored origin | `origin-scan.mjs` (T-B3); D3 sets target origin `http://127.0.0.1:<pT>` against source `http://localhost:<pS>`; D7 reads `getDeploymentStatus` (wired, not run) | T-B3 passes. D7 and D10 not run on a real transfer. |
| REQ-S01-006 no builder or personal credentials | D3: secrets are generated for each run (`crypto.randomBytes`) into `*_FILE`; the ADR-0063 `secret-scan.mjs --path .env.example` and `generate-env-example.mjs --check` run first | T-B9 trace logic passes. D3 not run inside a real drill. |
| REQ-S01-006 egress disabled | Namespace and probe; isolation failure → exit 1 with the B.5 line | T-B9 passes (a loopback listener stands in for a reachable address). |
| REQ-S19-009 template and guides only | `config-trace.mjs` and `guide-keys.json`; the shipped map covers every template key with existing anchors | T-B9 passes. |
| REQ-S19-017 rebind identity | D6 builds the mapping from carried users who hold an `unbound` hold, leaves one unmapped, and runs `mth-db rebind-identity`; journey `unbound` asserts `identity_unbound` and `/me` 401 | Journey half passes in development mode only (T-B10, §4 gap 1). D6 not run. |
| REQ-S19-017 counts/checksums, downloads, restart | D5 and D9 `reconcile-*.json` (`equal` ⇔ exit 0); D8 and D9 downloads by SHA-256 from `attachments.json`; D9 restarts PostgreSQL, API and worker | Written, **not run**. Blocked by D5 (§4 gap 2). |
| REQ-S20-018, REQ-S01-001 clean environment, workflows | D0 (`build-archive --verify`, `build-from-archive.sh`), D1 (seed-demo, seed-dev, smoke), D7 | Written, **not run** (no archive here; §4 gap 3). |

## 3. Checks run (real exit codes)

Environment: Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), bubblewrap present (`/usr/bin/bwrap`, nested bwrap and unshare measured OK), PostgreSQL 16.15 at `/usr/lib/postgresql/16/bin`, uid 0, offline, no Docker daemon (D-243 Q1).

| Command | Exit | Result |
| --- | --- | --- |
| `tests/qa/support/with-pg.sh node --test --test-reporter=spec deploy/scripts/tests/transfer-drill.test.mjs` (log `transfer-drill-test.log`) | **1** | 20 tests, 19 pass, **1 fail**: T-B10 production sign-in, with `Invalid configuration: OIDC_ISSUER_URL must use https when NODE_ENV=production` (§4 gap 1). T-B3 4/4, T-B9 10/10, T-B10 supporting (development) 3/3, T-B10 production 2/3. |
| `node --test --test-name-pattern='BLOCKED, isolation' deploy/scripts/tests/transfer-drill.test.mjs` (re-run after the lint fix) | 0 | 4/4 |
| `npx eslint deploy/scripts/drill deploy/scripts/tests/transfer-drill.test.mjs` | 0 | (first run: exit 1, one `no-unused-expressions`, fixed) |
| `npx prettier --check --ignore-unknown <my 7 files>` | 0 | |
| `bash -n deploy/scripts/transfer-drill.sh` | 0 | |
| `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)`. Run at the end, not before implementing (protocol deviation, disclosed). |

**Not run (time box, not BLOCKED by a tool):** `pnpm -r typecheck`, `pnpm lint` (whole workspace), `pnpm openapi:lint`, `pnpm test`, the repository-wide `git ls-files … | xargs npx prettier --check`, and the A18 harness `tests/qa/integration/a18-transfer-drill.test.ts`. I changed no TypeScript source and no contract, but these are still unverified for this task.

**T-B11 (the drill run): NOT RUN.** I have no release archive: `build-archive.mjs` needs a commit and a BE-C demo export, and disk is about 3.7 GB free. The run would also stop at D5 (gap 2), and it cannot be a PASS today.

A defect found and fixed during testing: the first `stop_pid` ran `kill -KILL 0` on an empty PID, which killed the whole test process group (exit 137 twice). It now ignores anything that isn't a positive integer.

## 4. Known gaps / not done

1. **T-B10 under `NODE_ENV=production` fails (real gap).** `packages/config/src/load.ts` l.310 refuses an `http:` `OIDC_ISSUER_URL` in production, with no loopback exception, unlike `APP_BASE_URL` (l.267). The drill IdP is http on loopback, so D7 and D8 cannot start T in production mode as written. The same journey passes end to end against the real OIDC code path (openid-client, PKCE, `resolveOidcUser`, CSRF hook, `identity_unbound`) in `NODE_ENV=development, AUTH_MODE=oidc`. That run is labelled "supporting, NOT production semantics", and it does not satisfy T-B10. Options, for the orchestrator or architect (Q1).
2. **D5 cannot pass: BE-D Q1 is undecided** (D-254 to D-257). `mth-db import-migration` refuses every migrated target as not empty and has no load. KBE-A records the same blocker. So D5 to D10 never run on real imported data, and T-B11 cannot pass until the import load exists. Also:
   - `reconcile-migration` reports `attachments_checked = 0` (BE-D gap 2).
   - A recheck after D8's writes will mismatch on `audit_event` and on the written tables (BE-D Q2). D9's "tables D8 wrote to show exactly D8's additions" needs that rule; my D9 treats any non-zero reconcile exit as FAIL.
3. **T-B11 not run** (no archive; §3). D0 to D4 were not exercised on a real archive either. Unverified seams in the script: `seed-dev` after `seed-demo` on S; the smoke journey against seed-dev users; `transfer-attachments copy-out` running inside `export-migration` (I assumed the export writes `attachments.json`, as DO-F's backup does; if not, D2 needs an explicit `copy-out`).
4. **The journey is incomplete for D8 (b) and (d).** It creates a transformation and reads it back with its audit trail. These are not built and report FAIL, never PASS: the KPI value, the RAID item, the gate submission, the approval decision by a rebound approver, and the deep-link step. D1 also uploads no evidence file, and seed-demo has 0 evidence objects (DO-F gap 2). So D8 (a) would fail with "the download list is empty" rather than pass vacuously.
5. **D9 job checks are not built.** The checks for pg-boss rows, `job_run`, enabled `job_schedule` equality, and a job queued before the stop completing after it, are missing.
6. **D7 `getDeploymentStatus`:** the journey does not yet call it to assert `origin` and `environmentKind`. D7 checks `/readyz` only (`ready`, `storage: ok`, `worker: alive`).
7. **CI and harness wiring:** `deploy/scripts/tests/transfer-drill.test.mjs` is not in any vitest project and not in CI. Fragment for the wave's CI owner:
   ```yaml
   - name: transfer drill scripts (T-B3, T-B9, T-B10)
     run: tests/qa/support/with-pg.sh node --test deploy/scripts/tests/transfer-drill.test.mjs
   ```
8. A local, container-free drill is not evidence of high-availability production readiness. The Compose, image-load and Keycloak halves are the orchestrator's (ADR-0069 §6–§7). Every user, secret and origin in the drill is synthetic, and nothing here approves anything (no G1–G6, no DG gate).

## 5. Open questions

- **Q1 (architect / orchestrator; blocks T-B10 and T-B11).** How should the drill IdP be used under production semantics? Options:
  - (a) A loopback exception for `OIDC_ISSUER_URL` in `packages/config/src/load.ts`, mirroring `APP_BASE_URL`'s (one rule and its tests; not my file).
  - (b) Serve the drill IdP over https with a self-signed certificate made at run time, trusted through `NODE_EXTRA_CA_CERTS`. That is a variable outside `.env.example`, so D3 would need a guide anchor for it (DOC-B), or it becomes an "undocumented step".
  - I recommend (a), limited to loopback hosts.
- **Q2 (architect; carried BE-D Q1/Q2).** Decide the import load and the post-use recheck rule. DO-D's D5 and D9 consume them unchanged.
- **Q3 (orchestrator).** A follow-up task for gaps 3–6 (the D8 (b) writes, deep link, evidence upload in D1, the D9 job checks, the D7 deployment-status assertion), then the real T-B11 run with an archive and offline store. That run needs an archive built from the candidate commit with a real BE-C export.
- **Q4 (QA-A).** The report field shapes I chose, against the A18 harness's O2:
  - `archive.sha256`, `idp.label`
  - `config-trace.json` `entries[{ key, section }]` with section `docs/handover/deployment.md#<anchor>`
  - `origin-scan.json` `hits[{ table, column, rows, accepted }]`
  - `reconcile-*.json` `{ equal, exit, output[] }`

  All of these match `tests/qa/support/a18-a19-reports.ts`'s readers.
- **Q5 (DOC-B).** No missing anchor. Every key maps to an existing section. The step sections in the report cite `first-deployment`, `configuration-keys`, `database`, `corporate-sso-mapping`, `monitoring` and `origin-change`.

## Merge instructions

- New files only. No migration, contract, lockfile or image change. No conflicts expected.
- Run: `tests/qa/support/with-pg.sh node --test deploy/scripts/tests/transfer-drill.test.mjs`. Expect exit 1 until Q1 is resolved.
