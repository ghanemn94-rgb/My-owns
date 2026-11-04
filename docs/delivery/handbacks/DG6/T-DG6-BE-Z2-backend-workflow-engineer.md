# Handback T-DG6-BE-Z2 (backend-workflow-engineer): SecretRef binding (F-DG6-181, High, mandatory)

- **Stage:** DG6 (P6), FIXING after review round 2.
- **Invocation:** `DG6-T-DG6-BE-Z2-backend-workflow-engineer-20261104T004405Z-de1d011b` (session `de1d011b-26b5-4640-8472-8f876b4a5ad8`).
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Z2.md`. I verified its sha256 `6c180d08…2762af` before reading it.
- **Base:** branch `dg6/be-z2` at `dcf55054f` ("DG6: assignment T-DG6-BE-Z2"). The tree was clean at the start.
- **Continuation (T-DG6-BE-Z2B):** a container restart killed the run above before it finished. §5 and §8 were still placeholders, and nobody knew whether its logs had run on the final bytes. The continuation run `DG6-T-DG6-BE-Z2B-backend-workflow-engineer-20261104T015333Z-ef0a43a0` (session `ef0a43a0-fdc5-4e23-9e6c-42b81f9d7e50`; assignment `docs/delivery/assignments/DG6/T-DG6-BE-Z2B.md`, sha256 `96d0da70…b977` verified) completed this handback. It did not redesign anything and changed no product, test or documentation file. It checked every item of the ARCH-14 brief §4.1–§4.3 and §5 against the working tree and found each one done (§8). It then re-ran every acceptance check on the current bytes (the `z2b-` logs), filled §5 and §8, and corrected the one statement in §3 that its logs contradicted (the reviewer's probe *was* run).
- **Time:** the first run started at `2026-11-04T00:44:15Z` (`date -u`). The continuation ran from `2026-11-04T01:57:50Z` to `2026-11-04T02:35:02Z`.
- **State:** the changes are left **uncommitted** for the orchestrator.
- **Approvals:** none. No product gate (G1–G6), Finance or IT approval was granted, and nothing here records a DG0–DG7 result. Every name, code, host and value in the tests and fixtures is synthetic. No secret value is in the repository: the manifests hold names, scopes and hosts only.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited 0 three times:

- at the first run's start (`T-DG6-BE-Z2-evidence/00-validate-dg5-historical-start.log`);
- at the continuation's start (`z2b-00-validate-dg5-historical.log`);
- at the continuation's end (`z2b-50-validate-dg5-historical-end.log`).

## 2. Changed files

**Migrations:** none (ADR-0052 amendment §H; brief §4.4). **API operations added:** none. **Contract:** descriptions only (§6).

### Shared module and composition

| File | Purpose |
|---|---|
| `packages/config/src/secret-bindings.ts` (new) | The binding manifest (`loadSecretBindings`, `parseSecretBindings`: strict zod, rules A1–A6, errors name `SECRET_BINDINGS_FILE`, the index and the field, never file content), the match rule `secretBinding(bindings, ref, use)` (rule B: `bound` / `not_bound` / `host_not_bound`), host canonicalization (`secretUseHost`, `secretUseHostOfUrl`), the namespace regexes moved here from `platform/secrets.ts`, the two field-error codes and exact texts (§D), and the process's active manifest (`setSecretBindings`, `activeSecretBindings`; empty until set: fail closed). One module for both processes, not a twin. |
| `packages/config/src/secret-bindings.test.ts` (new) | Brief §4.2 unit tests: parse (the ADR example, unset, 18 refusals each naming the variable, entry and field and leaking nothing; oversized, unreadable, invalid JSON) and the full match matrix (15 cases), the empty manifest, URL hosts, the exact texts. |
| `packages/config/src/index.ts`, `load.ts` | `SECRET_BINDINGS_FILE` in `ENV_VARS` (the brief's description verbatim; optional, not secret, api and worker). `loadConfig` loads the manifest into `AppConfig.secretBindings`; an invalid file is a `ConfigError`, so the entry points exit 78. |
| `.env.example` | Regenerated with `node deploy/scripts/generate-env-example.mjs` (34 variables, names only). |
| `apps/api/src/main.ts`, `apps/worker/src/main.ts` | `setSecretBindings(config.secretBindings)` at start. The worker now creates its pool before the registry so the registry gets the cached organization code lookup. |
| `apps/api/src/modules/platform/secrets.ts` and its verbatim worker twin `apps/worker/src/secrets.ts` | `SecretUse = { consumer, organizationId, host }`. `createSecretProviderRegistry({ bindings?, organizationCodeOf?, warn? })`. `resolve(ref, use)` is the only resolve (no overload without a use). It checks the namespace, looks up the organization code, applies `secretBinding`; anything but `bound` logs one `warn` line `{event:"secret_ref.refused", consumer, organizationId, provider, name, reason}` and returns `undefined` **before** `provider.get`. The default `organizationCodeOf` answers null, so a tenant use is never bound without a lookup. The namespace rule is re-exported from `@mth/config`. |
| `apps/api/src/modules/platform/organization-code.ts` (new), `apps/worker/src/organization-code.ts` (new) | The cached `organization.code` lookup (the code is immutable, so the cache is safe). |
| `apps/api/src/modules/platform/secret-namespace.ts` | `assertSecretRefsBound(db, entries, use, hostPointer)`: the namespace first (unchanged 400 `validation.secret_ref_namespace`), then the binding of every entry. Every failing reference goes into one 400 `validation`: `validation.secret_ref_not_bound` at its pointer, `validation.secret_ref_host_not_bound` once at the host pointer. The problem carries a `secretRefusal` (in a `WeakMap`, read by `secretRefusalOf`). It never calls a provider. |
| `apps/api/src/modules/access/secret-refusals.ts` (new), `access/index.ts`, `server.ts` | The `onError` hook that writes `secret_ref.refused` in a separate short transaction, tracked by `app.inFlight` as the denial hook is. Fields: actor; `recordType: "user"`, `recordId`: actor; `organizationId`: the setting's organization or null; `reason`: `<METHOD> <route>: <consumer> reference <provider>:<name> not bound[ to host <host>:<port>]`, joined by `"; "`, at most 1000 characters; no `changes`. `server.ts` passes `organizationCodeOf: organizationCodeLookup(db)` and a `warn` sink to the pino logger. |
| `apps/api/src/modules/platform/index.ts` | Exports the new types and functions. |

### Write-time call sites (brief §4.1 item 6)

| File | Consumer, organization, host and host pointer |
|---|---|
| `integrations/connectors.ts` `checkConfig` | `connector`, the authorized `organizationId`, the host of `/config/endpointUrl` (null without one). Runs after the endpoint's shape checks, on create and on every new configuration version. New `connectorSecretUse(row, config)` helper for the resolve sites. |
| `integrations/webhooks.ts` | `webhook_signing`, the connector's organization (create, after `requireWebhookConfigure`) or the locked endpoint's organization (rotate, after `lockForChange`), host null. |
| `admin/notification-channels.ts` PUT | `smtp`, the authorized organization, `{smtp.host, smtp.port}`; pointer `/smtp/host`. New `smtpSecretUse`. |
| `admin/storage.ts` PUT and test | `storage`, null, the S3 endpoint host; pointer `<pointer>/endpoint` (`/s3` or `/candidate`). New `assertStorageSecretsBound`. |
| `assistant/settings.ts` PUT and enable | `assistant`, null, the `endpointUrl` host (null for the test adapter, which has no reference); pointer `/endpointUrl`. Enable re-checks the stored row inside its transaction. New `assertAssistantSecretBound`. |

Each check runs after authorization, the consumer's shape check and the namespace, and before any write (ADR-0052 amendment §D order).

### Resolve-time call sites (brief §4.1 item 7)

| File | Change |
|---|---|
| `integrations/secret-refs.ts` | `credentialRefViews(stored, use)` and `resolveCredentials(stored, use)`. `resolvable` is computed through the binding. |
| `integrations/connectors.ts` (`toConnector` view, `fetchForTest`), `runs.ts` (fetch stage), `outbound.ts` (`callAdapter`) | Pass `connectorSecretUse(connector, config)`: `connector`, `connector.organization_id`, the host of `config.endpoint_url`. |
| `integrations/webhooks.ts` `resolveRef` | `webhook_signing`, the endpoint's organization, host null (current and previous). |
| `admin/notification-channels.ts` test send | `secrets.resolve(ref, smtpSecretUse(organizationId, smtp))`. |
| `apps/worker/src/handlers/notifications.ts`, `main.ts` | `NotificationChannelDeps.resolveSecret` is now `(ref, use)`. `channelFor` receives the delivery row's `organization_id` and builds the per-channel resolver with `smtp`, that organization and the row's host and port. |
| `evidence/stores/s3.ts` | `SecretResolver.resolve(ref, use)`; the store resolves with `storage`, null and its endpoint's host. |
| `assistant/provider.ts` | `assistant`, null, the endpoint's host. |

### Tests (brief §4.2 and §4.3)

| File | Purpose |
|---|---|
| `apps/api/test/integration/integrations/secret-binding.test.ts` (new) | SB-1 to SB-8 (§3). |
| `apps/api/test/support/secret-bindings.ts` (new) | `bindSecrets([...])` and `testSecretBindings([...])`: build a manifest through the same strict parser as `SECRET_BINDINGS_FILE`, and restore the previous manifest. |
| `apps/api/src/modules/platform/secrets-registry.test.ts`, `secrets.test.ts`, `apps/worker/src/secrets.test.ts` | Registry: an unbound reference returns `undefined` and a spy `get` is called 0 times (5 causes); a bound reference returns the value; the `warn` line holds no value (injected and default sinks); `// @ts-expect-error` on `resolve(ref)` without a use (API and worker). |
| `integrations/webhooks.test.ts` | New case: with the binding removed, a correctly signed delivery is 401 `webhook.unauthenticated` and stores nothing. |
| `tasks/channel-fanout.test.ts` | New worker case: a channel whose `passwordRef` is bound to another organization gives `smtp.secret_unavailable`, and the fake SMTP server sees no new connection. It runs the worker's real registry (`apps/worker/src/secrets.ts`) and organization lookup. |
| §4.3 suites: `integrations/{connectors,webhooks,secret-namespace,secret-composition}.test.ts`, `admin/{notification-channels,storage}.test.ts`, `assistant/{composition,conversations,provider,settings}.test.ts`, `operations/log-redaction.test.ts`, `evidence/store-contract.test.ts`, `contract/p6-exercises-be-{h2,n}.ts` | Each binds the names it uses with `bindSecrets` (organization **codes** for tenant kinds, null for storage and assistant, and the hosts the suite calls), and restores the manifest after. Registries the suites create pass `organizationCodeOf: organizationCodeLookup(api.db)`. The check is not weakened anywhere. |
| `tests/qa/integration/a17-import-and-integration.test.ts` | One binding line (`webhook_signing`, `w.orgA.code`) in `beforeAll`, restored in `afterAll` (brief §4.3, "outside BE-Z2's write scope": the assignment asked me to add it in the test support). |
| `apps/web/e2e/support/with-stack.sh` | Unless the caller names its own `SECRET_BINDINGS_FILE`, the stack writes a synthetic manifest that binds `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET` to `webhook_signing` and the seeded organization code `SYN-DEV`, and exports it. |

Suites the brief lists that needed no change: `integrations/{runs,outbound,graceful-degradation,run-failure-kpi-links,s16-022-entity-group}.test.ts`, `tasks/email-adapter-contract.test.ts` (it calls the adapter with its own resolver), `assistant/suggestions.test.ts`, `assistant/be-u-fixtures.ts`, `portfolio/deliverable-confirmation.test.ts` and `contract/p6-exercises-be-{i,l,t,u}.ts` all use empty credential maps or `null` references. No other e2e spec names a secret (`a20-p6-axe`, `a17-failing-connector-exception`, `a13-connector-run-once`, `a12-p6-scope-isolation`, `apps/web/e2e/p6-integrations-imports` use `credentialRefs: {}` or `credentialRef: null`).

### Texts (brief §4.1 items 8–9 and §5; assignment)

| File | Change |
|---|---|
| `docs/api/openapi.yaml` | `SecretRef.description` gains the brief's paragraph verbatim; `CredentialRefView.resolvable` gains the brief's sentence. No schema change. |
| `docs/operations/configuration.md` | "Secret providers": the consumer list replaced; "The binding (F-DG6-181)" added with the format, the example, the rules, fail closed, exit 78, the two field errors and the audit event; the namespace bullet replaced with the handback §5 text; a `SECRET_BINDINGS_FILE` row. |
| `docs/operations/notifications.md`, `docs/operations/storage.md` | The binding paragraph of handback §5. |
| `apps/web/src/i18n/{en,ar}/integrations.json` | `actionable.connector__secret_unresolvable.todo` and `todo_noParams`, and `credentials.hint`: IT must provide **and bind** the secret to this connector and its host. en and ar; the key sets are unchanged. |
| `docs/architecture/adr/ADR-0055-…md` | The §4 table's what-to-do text of `connector.secret_unresolvable` changed to the same English text, with a dated "Text update" note. The web test `integrations-i18n.test.ts` reads that table verbatim, so the ADR and the i18n file must change together. |

## 3. Behaviour delivered, per requirement row

### REQ-S16-029 (F-DG6-181, High, mandatory)

Acceptance, quoted: *"A12;A22: a log scan after the test suite finds no secrets or storage URLs; a job's identity cannot read records outside its scope"*.

A secret IT provisioned for one setting can no longer be used by another setting, another organization or another host:

- **Write time.** `secret-binding.test.ts`:
  - **SB-1** is the reviewer's reproduction with the one binding line IT would add. B creates its connector (201, `resolvable: true`); A gets 404 on it. A's org-A `http_pull` connector to `https://collector.attacker.example.invalid/x` naming B's secret is **400** `validation` with exactly one field error, `validation.secret_ref_not_bound` at `/config/credentialRefs/bearer`. No connector row is added for A. One `audit_event` `secret_ref.refused` is written, with actor A, `organization_id` A, `record_type` `user`, `record_id` A, the name in the reason and `changes` null. The recorder holds no request to the attacker host, and the audit holds no token.
  - **SB-2.** An unset unbound name, and B's name with B's variable unset, give `status`, `type`, `code` and `errors` identical to SB-1's, so there is no oracle.
  - **SB-3.** B's own new configuration version pointing at the attacker host is 400 `validation.secret_ref_host_not_bound` at `/config/endpointUrl` and is audited with the host. B's own connector, tested, sends its token only to its bound host.
  - **SB-5.** Each of these is 400 `validation.secret_ref_not_bound` at its pointer: org-A connectors naming the installation's S3 key and B's webhook signing secret; org A's SMTP PUT naming the S3 key; an org-A webhook endpoint naming B's signing secret; a storage PUT and an assistant PUT naming B's connector secret. The two installation refusals are audited with organization null.
  - **SB-6.** A bound SMTP secret sent to `attacker.example.invalid` is 400 `validation.secret_ref_host_not_bound` at `/smtp/host`.
  - **SB-7.** With an empty manifest, even B's own create is refused (fail closed).
  - **SB-8.** `PATCH /organizations/{id}` with `{code}` is 400 and the code is unchanged; `OrganizationUpdate` in openapi has no `code`.
- **Resolve time.** **SB-4** stores a reference on A's connector that is not bound to A (IT bound it by mistake, then corrected the manifest; configuration versions are append-only, so this is how such a row arises). Then:
  - GET shows `resolvable: false`;
  - the test is `connector.secret_unresolvable`;
  - a manual run, executed, is `failed` with `connector.secret_unresolvable`;
  - `resolveCredentials` with the connector's use, the function `outbound.ts` `callAdapter` calls before dispatch, rejects with `connector.secret_unresolvable`, so `callAdapter` answers `no_response` with nothing dispatched;
  - the recorder captured nothing for that connector;
  - a `warn` `secret_ref.refused` line with `reason: not_bound` was logged, and the captured log holds no token.

  When IT removes B's binding, B's own connector shows `resolvable: false` and its test fails with `connector.secret_unresolvable`. The webhook receive (401, no receipt) and the worker SMTP delivery (`smtp.secret_unavailable`, no SMTP connection) are covered by the two new cases above.
- **Logs.** The refusal log line and the audit reason hold names only. The registry tests assert that no value appears in either sink.

### REQ-S10-004 (organization scoping) and REQ-S16-030 (the secret-management interface)

The binding makes the secret provider interface organization-scoped. A setting's organization comes from the authorized target or the stored row, never from an unauthorized request field. `resolve(ref, use)` is the only resolve: the type has no overload without a use, which is pinned by `@ts-expect-error` in the API and the worker tests.

### The reviewer's reproduction, run unchanged

Brief §4.2: once the fix is in, the reviewer's probe `zz-cs-r2-secret-cross-org.test.ts` fails at its **first** expectation, `expect(own.status).toBe(201)`. That is the intended fail-closed behaviour: no manifest binds the name, so B's own create is refused (400 `validation.secret_ref_not_bound`). **SB-1 is the faithful port with the one binding line added.** Please re-run SB-1, or the probe with a `bindSecrets` line for `w.orgB.code`.

Both runs ran the unchanged probe. Each copied it from `docs/delivery/test-evidence/DG6/code-security/round-2/repro/` into `tests/qa/integration/` and removed it afterwards (logs `12-reviewer-probe-unchanged.log` and, on the final bytes, `z2b-40-reviewer-probe-unchanged.log`). Both times it fails exactly as predicted: `org B connector 400 {"type":"urn:mth:problem:validation",…}`, `expected 400 to be 201` at line 94, exit 1. The probe itself cuts the logged body short, so its field errors are not in the log. SB-1 asserts them.

## 4. Operations routed (pending-list delta)

None. This repair adds no operation, so no `p6-pending-*` list changes. The contract suite (`contract.test.ts`) was run (§5) with the `be-h2` and `be-n` exercises updated to bind their names.

## 5. Checks actually run

Environment: Node 24.21.0, offline, worktree `/home/user/wt/dg6-be-z2`; harness ports 29000–29049 (`QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT`, `MTH_PORT_POOL`). Before the tests I removed three empty `.claude/.cc-writes` directories (`packages/config`, `apps/worker`, `apps/api`), as the assignment says. Logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-Z2-evidence/`.

**The final table relies only on the `z2b-` logs.** The continuation run (`…-20261104T015333Z-ef0a43a0`) wrote them on the current bytes, between `2026-11-04T01:57Z` and `02:35Z`. After the first log of the run, no product, test or documentation file changed. The only file edited afterwards is this handback. Each log starts with its command and its `date -u`, and ends with `exit <status>`.

| # | Command | Exit | Counts | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | `z2b-00-validate-dg5-historical.log` |
| 2 | `pnpm -r typecheck` | 0 | every package `Done` | `z2b-01-typecheck.log` |
| 3 | `pnpm -r build` | 0 | every package `Done` | `z2b-02-build.log` |
| 4 | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | 0 problems | `z2b-03-lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `z2b-04-prettier.log` |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `z2b-05-openapi-lint.log` |
| 7 | `pnpm test`, locale unset (`LANG`, `LC_*` unset; `env` shows none) | 0 | unit-node 190 files / **2899 passed**; unit-web 120 / **2020 passed**; unit-formula-nocodegen 3 / **259 passed, 2 skipped** (the fuzz suite's skips, also in the first run) | `z2b-10-test-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same: 2899 / 2020 / 259 passed + 2 skipped | `z2b-11-test-c-utf8.log` |
| 9 | `QA_PG_PORT=29002 tests/qa/support/with-pg.sh npx vitest run --project integration <34 files>`. The files: `contract/contract.test.ts`; all 13 `integrations/*.test.ts` (including the new `secret-binding.test.ts`); `admin/{notification-channels,storage}`; all 9 `assistant/*.test.ts`; `audit/audit-events`; `evidence/store-contract`; `operations/log-redaction`; `portfolio/deliverable-confirmation`; `tasks/{channel-fanout,email-adapter-contract,notification-delivery}`; `organizations.test.ts` (SB-8's neighbour); and QA `tests/qa/integration/a17-import-and-integration.test.ts` | 0 | **34 files passed; 526 tests passed, 1 todo** (`audit-events.test.ts`'s existing `it.todo`, shown as "1 skipped" on its line). QA a17: 10 passed. `secret-binding.test.ts`: 8 passed | `z2b-20-integration-touched.log` |
| 10 | `E2E_PG_PORT=29020 E2E_API_PORT=29030 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a17-import-and-integration.spec.ts --workers=1` | **1** | 8 passed, **2 failed** | `z2b-30-e2e-a17-import.log` |
| 10b | the same, with `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET` exported as a synthetic value generated at run time (ports 29022/29032) | 0 | **10 passed** (en and ar). The log does not contain the value (`grep -c` = 0) | `z2b-30b-e2e-a17-import-secret-exported.log` |
| 11 | `E2E_PG_PORT=29021 E2E_API_PORT=29031 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p6-admin-screens.spec.ts apps/web/e2e/p6-integrations-imports.spec.ts e2e/a13-connector-run-once.spec.ts e2e/a17-failing-connector-exception.spec.ts e2e/a20-p6-axe.spec.ts e2e/a21-p6-degradation.spec.ts --workers=1` (these specs configure a connector, the email channel, storage or webhooks) | 0 | **116 passed, 18 skipped** (7.7 min). The skips are the a20 axe routes that need a record id the stack does not seed. The first run's log shows the same 18 | `z2b-31-e2e-connector-email-webhook.log` |
| 12 | The reviewer's probe, unchanged: copied into `tests/qa/integration/`, run with `QA_PG_PORT=29004 tests/qa/support/with-pg.sh npx vitest run --project integration …`, then removed | **1 (expected)** | 1 failed at its first expectation `expect(own.status).toBe(201)`: received 400 `validation`, the intended fail-closed refusal (§3) | `z2b-40-reviewer-probe-unchanged.log` |
| 13 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `PASS gate DG5 (historical)` | `z2b-50-validate-dg5-historical-end.log` |

All runs used harness ports in 29000–29049 (`MTH_PORT_POOL=29000-29049`). No port retry was logged.

Row 5 ran before this handback was filled in. After the last edit, `npx prettier --check` on this handback alone printed "All matched files use Prettier code style!" and exited 0 (not logged).

**Non-zero exits, explained:**

- **Row 10** was my invocation error, not a product failure. The spec's webhook test (`a17-import-and-integration.spec.ts:296`, en and ar) requires the caller to export `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET` before the stack starts. Its assertion message says so: `… must be exported before the stack starts (BLOCKED otherwise)`, `Received: undefined` at line 317. I had not exported it. Row 10b exports a synthetic random value and passes 10/10. `with-stack.sh` writes the binding manifest, which holds names only; the value comes from the caller's environment.
- **Row 12** is expected to fail (§3, brief §4.2).

**Earlier logs (first run `…-20261104T004405Z-de1d011b`), kept but not relied on.** Nobody knows whether they ran on the final bytes.

- `00-validate-dg5-historical-start.log` (exit 0), `02-typecheck.log`, `03-build.log`, `05-prettier.log`, `06-lint.log`, `07-openapi-lint.log`: all exit 0.
- `04a-test-locale-unset-first-run-2-failures.log`: exit 1, with **two** failing tests in two Vitest projects.
  - `apps/api/src/architecture.test.ts` failed because `secrets-registry.test.ts` used computed non-literal keys (lines 32–33).
  - `integrations-i18n.test.ts` failed because ADR-0055 §4's what-to-do text of `connector.secret_unresolvable` still had the old wording.
  - Both were fixed in that run: the registry test no longer uses computed keys, and the ADR-0055 row was updated with a dated note (§2). The current bytes pass (rows 7–8).
- `04-test-locale-unset.log` and `05b-test-c-utf8.log`: exit 0 (2899 / 2020 / 259 + 2 skipped).
- `10-integration-touched.log`: exit 1, 1 failed of 506.
  - `assistant/settings.test.ts`'s locked-while-enabled case got 400 `validation` instead of 422 `assistant.locked_while_enabled`. Its new reference `file:model_key` was not bound, so the binding check answered before the lock check.
  - The fix is the `model_key` binding in that suite's `beforeAll` (`settings.test.ts` lines 97–100). Re-run alone in `11-integration-assistant-settings-rerun.log`: 17 passed. It passes on the current bytes in row 9.
- `12-reviewer-probe-unchanged.log`: exit 1, expected (row 12).
- `20-e2e-a17-import.log`: 10 passed, exit 0.
- `21-e2e-connector-email-webhook.log`: 116 passed, 18 skipped, exit 0.

**Not run:** the full `pnpm test:integration`. The assignment does not require it: it takes over 2 hours on this host, and the orchestrator runs it on the merged tree.

## 6. Contract, schema and dependency needs (for the orchestrator)

- **Contract:** the description-only changes of `SecretRef` and `CredentialRefView.resolvable` (§2). Two new **field-error** codes inside 400 `validation`: `validation.secret_ref_not_bound` and `validation.secret_ref_host_not_bound`. No operation, schema, status or top-level problem code changes.
- **Configuration:** a new optional variable, `SECRET_BINDINGS_FILE` (`.env.example` regenerated).
- **Audit:** a new action, `secret_ref.refused`, with record type `user`. The transformation history's action labels (`transformations.json` `audit.actions`) do not list it, and need not: the event is never attached to a transformation. If Administration > Audit gains an action-label catalogue, its owner adds the label in en and ar.
- **Schema / migration:** none. **Dependency:** none (zod and WHATWG `URL` were already in use).
- **Merge:** a deployment that already stores `SecretRef`s must provide a manifest before the upgrade, or every stored reference resolves as "not set" (by design; `configuration.md`). The test stacks are covered (`with-stack.sh`). `e2e/support/a13-a22-stack.ts` and `e2e/support/fresh-install.ts` start their own APIs without a manifest. They name no secret today, so nothing changes for them.

## 7. User-facing texts

- **Made untrue by this work, and corrected in the same change:**
  - `configuration.md`, "Secret providers" (the consumer list) and "The namespace" (the last bullet);
  - `notifications.md` and `storage.md` (the binding is now required);
  - `openapi.yaml` `SecretRef` and `CredentialRefView.resolvable`;
  - `integrations.json` en/ar `connector__secret_unresolvable.todo` and `todo_noParams`, and `credentials.hint`, with ADR-0055 §4's verbatim row.
- **Not changed, for their owners:**
  - `docs/operations/restricted-network.md` lines 5–10 (handback T-DG6-ARCH-14 §7 item 2; devops-engineer). It was already untrue before this work.
  - I found no DG7 handover checklist that lists `SECRETS_DIR` (`grep` of `docs/operations` and `docs/delivery` for a handover file), so "the secret binding manifest" was not added to one. If the DG7 checklist is written later, it should name `SECRET_BINDINGS_FILE` next to `SECRETS_DIR`.
- The field-error messages are not web i18n keys, as for `validation.secret_ref_namespace` (ADR-0052 amendment §D). No form shows them as text today.

## 8. What remains

**Nothing of the ARCH-14 brief §4.1–§4.3 or §5 remains.** Nothing was deferred under §4.5: SB-4's `warn` log assertion and SB-8's grep check are both in. The continuation run checked the working tree item by item:

- §4.1 items 1–9 are present (§2):
  - the shared module;
  - `ENV_VARS` and `.env.example`;
  - the registry `resolve(ref, use)` in the API and the worker, with no overload without a use;
  - `assertSecretRefsBound` (namespace first) and the `secret_ref.refused` hook;
  - the five write-time and seven resolve-time call sites;
  - the openapi descriptions;
  - the operations texts.
- §4.2's tests are present: the unit tests, the registry tests, SB-1 to SB-8, the webhook receive case and the worker SMTP case.
- §4.3's suites are present, plus QA a17 and `with-stack.sh`.
- §5's texts are present in `configuration.md`, `notifications.md` and `storage.md`, and `.env.example` is regenerated.

The remaining `assertSecretRefInNamespace` calls in `connectors.ts`, `webhooks.ts`, `notification-channels.ts`, `storage.ts` and `settings.ts` are the existing namespace shape checks. Each is followed by the bound check, which repeats the namespace first.

**Deviations from the brief's wording:**

- **Worker SMTP case location.** The brief places the worker SMTP case in "the worker notification-delivery suite (`apps/worker/test/integration/…notifications…`)". No such worker suite exists: the worker's email delivery is exercised from `apps/api/test/integration/tasks/channel-fanout.test.ts`, so the case is there. It runs the worker's real registry and organization lookup.
- **Twin header comments.** `apps/worker/src/secrets.ts` matches `apps/api/src/modules/platform/secrets.ts` except for the header comment, as before this change.

**For the orchestrator, at merge:**

- **Migrations:** none.
- **Merge order:** merge with the QA A17 suite and the e2e stack in the same change. `tests/qa/integration/a17-import-and-integration.test.ts` and `apps/web/e2e/support/with-stack.sh` were changed here, as the assignment asked (brief §4.3 calls them outside BE-Z2's write scope). Without the change, A17's webhook step gets 400.
- **e2e secret:** runs of `e2e/a17-import-and-integration.spec.ts` must export a synthetic `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET`, as the spec already requires (§5 row 10).
- **Full integration suite:** `pnpm test:integration` was not run here (by the assignment). Please run it on the merged tree. Other suites may name a secret without a binding: `grep` found none outside the files listed in §2.
- **Upgrade:** a deployment that already stores `SecretRef`s needs a `SECRET_BINDINGS_FILE` before the upgrade (§6).

**For other owners (unchanged from §7):**

- `docs/operations/restricted-network.md` lines 5–10 (devops-engineer).
- When the DG7 handover checklist is written, it should name `SECRET_BINDINGS_FILE` next to `SECRETS_DIR`.

**For the reviewer:** re-run SB-1, or the probe with one `bindSecrets` line for `w.orgB.code` (§3). Only the originating reviewer can verify F-DG6-181. This handback does not close it.

**This handback grants no approval:** no product gate (G1–G6), Finance or IT approval, and no DG6 result.
