# Handback T-DG6-BE-Y2 (backend-workflow-engineer): DG6 round-1 repair of F-DG6-120 (SecretRef scope)

- **Stage:** DG6 (FIXING after review round 1). **Branch:** `dg6/be-y2`, base `eb75a6aa6fe99b7064712e926ddb384a6e7a137a`. The changes are **uncommitted**, as the assignment asks.
- **Invocation:** run `DG6-T-DG6-BE-Y2-backend-workflow-engineer-20261101T210513Z-2d01dcc1`, session `2d01dcc1-93a9-44bb-a7c3-d3a34addb301`.
- **Time:** started `Sun Nov 1 21:07:37 UTC 2026`, ended `Sun Nov 1 23:03 UTC 2026` (`date -u`: 23:02:48 after the last check). I passed the 100-minute mark while running checks, so I stopped as D-059/D-070 says. The section "What remains" lists the checks that did not run to completion.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` exited **0** (`PASS gate DG5 (historical)`).
- **Migration:** none. **New dependency:** none. **Business approvals:** none granted; every value in the tests is synthetic.

## F-DG6-120: cause, fix, test, result

**Cause.** The built-in `env` SecretProvider accepted any upper-case variable name (`ENV_SECRET_NAME = /^[A-Z][A-Z0-9_]{0,127}$/`), and no SecretRef consumer restricted names beyond their shape. So `{provider: "env", name: "OIDC_CLIENT_SECRET"}` resolved the platform's own secret. The `file` provider had a similar gap: it read any plain name in `SECRETS_DIR`, including through a symbolic link that leads out of the directory, and the operations docs suggested `/run/secrets` as `SECRETS_DIR`, which is where Compose mounts `database_url` and `oidc_client_secret`.

**Fix (server side, enforced both when a reference is written and when it is resolved).**

1. **The rule.** It lives in `platform/secrets.ts` and in the identical worker twin `apps/worker/src/secrets.ts` (the twin test still passes).
   - `secretRefInNamespace(ref)` decides what a reference may name:
     - `env` accepts only `MTH_SECRET_<NAME>`: `A–Z 0–9 _`, the first character after the prefix a letter or digit, at most 128 characters, and not ending in `_FILE`. `MTH_SECRET_<NAME>_FILE` is still read, by the ADR-0011 rule.
     - `file` accepts only a plain file name.
     - A provider IT registers itself owns its own namespace.
   - **Resolve time.** `envSecretProvider.get` returns `undefined` for any name outside the namespace. That is the same answer as an unset variable, so the answer is no oracle.
   - **`fileSecretProvider(dir, env)`** (`registerBuiltInSecretProviders` now passes the env in):
     - It returns `undefined` for a name outside the namespace, and for a file whose real path leaves `SECRETS_DIR`, such as a symbolic link out.
     - It raises a `ConfigError` when `SECRETS_DIR` holds the target of any platform `<VARIABLE>_FILE` other than `MTH_SECRET_*_FILE`. The error names the variable, never a path or a value.
2. **Write time.** The check is `assertSecretRefInNamespace(ref, pointer)` in the new file `platform/secret-namespace.ts`, exported from `platform/index.ts`.
   - It answers **400 `validation`** with the field error `validation.secret_ref_namespace` at the field's pointer, before any row is written.
   - Each consumer calls it after its existing shape check:
     - connector credentials: `connectors.ts` checkConfig, pointer `/config/credentialRefs/<key>`;
     - webhook signing secrets on create and rotate: `webhooks.ts` `checkSecretRef`, pointer `/signingSecretRef`;
     - the SMTP channel: `notification-channels.ts`, pointers `/smtp/usernameRef` and `/smtp/passwordRef`;
     - S3 storage, on save and on test: `storage.ts` `checkedS3`, pointers `/s3/...` and `/candidate/...`;
     - the assistant: `assistant/settings.ts`, pointer `/credentialRef`.
   - The answer depends on the name alone, never on whether the variable exists.
3. **Rows stored before the fix.** Every consumer resolves through the registry: connector `resolveCredentials`/`resolvesNow`, the assistant provider, the email channel in the API and the worker, and the S3 store. So a stored out-of-namespace reference resolves as unset:
   - the connector test makes no outbound request and fails `connector.secret_unresolvable`;
   - the view shows `resolvable: false`.

**Tests (each fails before the fix and passes after it).**

- **Unit:** `apps/api/src/modules/platform/secrets.test.ts`.
  - Negative cases:
    - platform variables (`OIDC_CLIENT_SECRET`, `DATABASE_URL`, `DATABASE_OWNER_URL`, `MTH_DEMO_ADMIN_DATABASE_URL`, `MTH_SECRETS_DIR`, `SECRETS_DIR`, `SMTP_PASSWORD`, `MTH_SECRET_`, `MTH_SECRET_X_FILE`) resolve nothing even when they are set;
    - a platform `X_FILE` cannot be reached;
    - `file` traversal names (`../etc/passwd`, `a/b`, `/etc/passwd`, `.hidden`, `..`, `.`, empty, `a\b`) resolve nothing;
    - a symbolic link out of `SECRETS_DIR` resolves nothing;
    - a `SECRETS_DIR` that holds `OIDC_CLIENT_SECRET_FILE`'s target is a `ConfigError`.
  - Positive cases: an `MTH_SECRET_*` variable and a nested dedicated directory resolve.
  - A 20-row namespace table.
  - **Before the fix:** I put the HEAD `secrets.ts` back temporarily and ran the file: **20 failed / 19 passed**, exit 1 (`T-DG6-BE-Y2-evidence/00-unit-before-fix.log`). With the fix it passes; see the checks below.
- **Integration (real API, disposable PostgreSQL scratch database):** the new file `apps/api/test/integration/integrations/secret-namespace.test.ts`, with 9 tests.
  - For connectors, webhooks (create and rotate), SMTP (both fields), storage (test and save, both keys) and the assistant: platform variables and `file` traversals that pass the shape check (`x/../database_url`, `secrets/../../run/secrets/oidc_client_secret`) are refused with 400 `validation.secret_ref_namespace`, and no row is written.
  - The response for a set variable (`OIDC_CLIENT_SECRET`) and an unset one (`DATABASE_OWNER_URL`) is identical, so the refusal is no oracle.
  - Positive cases with `MTH_SECRET_*`:
    - a connector is created and its test sends `Bearer <MTH_SECRET value>`;
    - the webhook is created and rotated;
    - the SMTP channel is saved;
    - the S3 test passes;
    - the assistant setting is saved.
  - A caller without `connector.configure` still gets 403.
  - A platform reference written straight into the scratch database, as the round-1 candidate allowed, resolves nothing: `resolvable: false`, `connector.secret_unresolvable`, no outbound request.
  - **Before the fix:** the HEAD source files were restored temporarily with `git show HEAD:<file> > <file>`: **7 failed / 2 passed** (the 2 are the positive case and the 403 case), exit 1 (`11-it-secret-namespace-before-fix.log`). After the fix: 9/9.
  - A first attempt to restore them with `git checkout` failed because the git index is read-only in this sandbox. That attempt ran no tests, and I discarded it.
- **The reviewer's own reproduction** (`docs/delivery/test-evidence/DG6/code-security/round-1/repro/zz-cs-r1-env-secret-exfil.test.ts`), copied into `tests/qa/integration/` for one run and removed afterwards, now fails at its first step:
  - the connector create answers `400 validation.secret_ref_namespace` instead of `201`;
  - nothing is captured.
  - Log: `12-reviewer-repro-after-fix.log`, exit 1, which is the expected result after the fix.

## Behaviour per requirement row

**REQ-S16-029.** Acceptance (verbatim): *"A12;A22: a log scan after the test suite finds no secrets or storage URLs; a job's identity cannot read records outside its scope"*.

- This repair supports the "never expose secrets" title of the row: a SecretRef can no longer resolve, send or reveal the existence of a platform secret.
- It does not change the log-scan or service-identity behaviour. I did not run the A12/A22 log scan in this task; see "What remains".

## Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/platform/secrets.ts` | the namespace rule `secretRefInNamespace`, `ENV_SECRET_PREFIX`, the code and message constants; `env` and `file` resolve only inside the namespace; the `file` real-path check and the platform-file check |
| `apps/worker/src/secrets.ts` | the same code, verbatim below the header (D-198 twin) |
| `apps/api/src/modules/platform/secret-namespace.ts` (new) | `assertSecretRefInNamespace`: 400 `validation.secret_ref_namespace` |
| `apps/api/src/modules/platform/index.ts` | the new exports |
| `apps/api/src/modules/integrations/connectors.ts`, `integrations/webhooks.ts`, `admin/notification-channels.ts`, `admin/storage.ts`, `assistant/settings.ts` | the write-time check in each SecretRef consumer |
| `apps/api/src/modules/platform/secrets.test.ts`, `apps/worker/src/secrets.test.ts` | the unit tests above; the fixture names moved to `MTH_SECRET_*` |
| `apps/api/test/integration/integrations/secret-namespace.test.ts` (new) | the integration tests above |
| 13 integration fixture files: `admin/{notification-channels,storage}`, `assistant/{composition,conversations,provider,settings}`, `contract/p6-exercises-be-{h2,n}`, `integrations/{connectors,secret-composition,webhooks}`, `operations/log-redaction`, `tasks/email-adapter-contract`, plus `tests/qa/integration/a17-import-and-integration.test.ts` and `e2e/a17-import-and-integration.spec.ts` | the synthetic secret names moved into the namespace (for example `MTH_TEST_SMTP_PASS` → `MTH_SECRET_TEST_SMTP_PASS`, `QA_A17_WEBHOOK_SIGNING_SECRET` → `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET`); `MTH_CONNECTION_LOG` is not a secret and is unchanged |
| `apps/web/src/i18n/{en,ar}/integrations.json` | `integrations.webhooks.secretRefHint` used `WEBHOOK_SECRET` as its example, which is now refused; it now names `MTH_SECRET_WEBHOOK` and says env names start with `MTH_SECRET_` (en and ar) |
| `docs/operations/configuration.md`, `notifications.md`, `storage.md` | the namespace is documented ("The namespace (F-DG6-120)"); the examples use `MTH_SECRET_*`; `SECRETS_DIR` must be a dedicated directory, never `/run/secrets` itself |
| `docs/api/openapi.yaml` | the `SecretRef` description states the namespace and the 400 refusal (description only; no schema or pattern change) |
| `docs/architecture/adr/ADR-0052-…md` §5 | the example name is now `MTH_SECRET_SMTP_PASSWORD`, plus one "Namespace (F-DG6-120)" bullet. The old example (`SMTP_PASSWORD`) is refused by the new rule, so the text needed the change. ADR-0055 needed no change. **The solution-architect should confirm this edit.** |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Y2-*` | this handback and its evidence |

## Checks (command, exit code, counts)

Environment: Node 24.21.0, offline, harness ports 28150–28199 (`QA_PG_PORT=28150 MTH_PORT_POOL=28151-28199`). Logs are under `docs/delivery/handbacks/DG6/T-DG6-BE-Y2-evidence/`.

| # | Command | Exit | Result / log |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` | **0** | `PASS gate DG5 (historical)` |
| 2 | `NODE_OPTIONS=--max-old-space-size=3584 pnpm -r --workspace-concurrency=1 typecheck` | **0** | all 8 packages (`01-typecheck.log`). See note (a). |
| 3 | `pnpm lint` | **0** | `02-lint.log`. It ran before the one-line `as const` fix in `secrets.ts`; after that fix, `npx eslint --max-warnings=0` on the 3 touched platform/worker files exited **0** (`02b-lint-after-const-fix.log`). |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | `04-prettier.log`. It ran before the `as const` fix; the two re-edited files were re-checked with prettier afterwards: clean. |
| 5 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` (`03-openapi-lint.log`) |
| 6 | `npx vitest run --project unit-node apps/api/src/modules/platform/secrets apps/worker/src/secrets.test.ts` | **0** | 3 files, **44 passed** (`05-unit-secrets.log`) |
| 7 | the same, against the pre-fix `secrets.ts` | 1 (expected) | 20 failed / 19 passed (`00-unit-before-fix.log`) |
| 8 | `with-pg.sh npx vitest run --project integration` on `secret-namespace`, `connectors`, `secret-composition` | **0** | 3 files, **32 passed** (`10-it-secret-namespace.log`) |
| 9 | the new integration file against the pre-fix source | 1 (expected) | 7 failed / 2 passed (`11-it-secret-namespace-before-fix.log`) |
| 10 | the reviewer's repro against the fix | 1 (expected) | refused at its step 1 with 400 (`12-reviewer-repro-after-fix.log`) |
| 11 | `with-pg.sh npx vitest run --project integration` on the 10 other files with renamed fixtures (incl. `tests/qa/integration/a17-…`) | **0** | 10 files, **129 passed** (`21-it-renamed-fixtures.log`) |
| 12 | `with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | **0** | 1 file, **105 passed** (`22-it-contract.log`) |
| 13 | `QA_PG_PORT=28150 MTH_PORT_POOL=28151-28199 tests/qa/support/with-pg.sh pnpm test:integration` (full) | **1, did not complete** | see note (b) (`20-integration-full-run1-incomplete.log`) |
| — | `pnpm test` (locale unset and `C.UTF-8`) | **not run** | see "What remains" |
| — | `pnpm -r build` | **not run** | see "What remains" |

**Notes**

**(a) Typecheck.** In this sandbox the bash cgroup is capped at about 13.4 GB. While the full integration suite was running, and after it crashed, the processes I could not see still held about 8.3 GB. Three typecheck attempts were SIGKILLed (**exit 137**), with no TypeScript diagnostics (`Killed`). With a capped V8 heap, the API typecheck then found **one real error**: TS1355, an `as const` on a concatenated string in `secrets.ts`. I fixed it in both twins, and the full serial `pnpm -r typecheck` exited 0.

**(b) Full integration suite.** It ran from 21:24 to about 22:25 UTC, on a host with load average about 15 on 4 CPUs (the other repair agents were running in parallel), and it did **not finish**.
- After 141 test files, vitest's pool crashed with `Unhandled Rejection: Error: Channel closed (ERR_IPC_CHANNEL_CLOSED)`. It printed no summary and exited 1. The most likely cause is a fork killed at the memory cap, while my typecheck attempts were running alongside.
- Before the crash, 4 tests failed, all on a timeout, in files this change does not touch:
  - `procedures/seeded-procedures.test.ts`: "kpi_submission … links the submitted actual …", 30 043 ms;
  - `connection-hygiene.test.ts`: "SIGTERM: the API process exits 0 within the grace period …", 20 105 ms;
  - `contract/response-validation.test.ts`: "U+0000 in the query is a declared 400 invalid_character", 30 011 ms, and "an undeclared request media type is a declared 400 validation.content_type", 90 003 ms.
- I did not rerun them in isolation; they are listed under "What remains". Nothing in them names a SecretRef.
- There is no pinned-count change: I removed or renamed no test, and I added one test file with 9 tests.

**(c) `contract.test.ts`.** It ran after the `as const` fix: 105/105 passed, exit 0, so the renamed `p6-exercises-be-h2/-n` fixtures stay green.

## Operations routed (pending-list delta)

None. This repair adds no operation and routes none. My `p6-pending-*.ts` lists are unchanged. The fixtures of `p6-exercises-be-h2.ts` and `p6-exercises-be-n.ts` now use `MTH_SECRET_*` names.

## Contract, schema and dependency needs (for the orchestrator)

- **New field error code `validation.secret_ref_namespace`.** Proposed English text: *"Name a secret IT provisioned for this setting: for the env provider a variable MTH_SECRET_<NAME>, for the file provider a plain file name in the secrets directory."* It is carried inside the existing 400 `validation` problem, so the top-level code is unchanged, and each touched operation already declares 400.
  - The field-error codes of `validation` are not i18n keys today (for example `validation.credential_refs` has none). The **FE owner** may want an Arabic text if the forms show field messages.
  - p6-work-split §2 rule 17 asks that a code not in the ADR tables be proposed in the handback, so the **architect** should add this row to ADR-0052 or ADR-0055.
- **ADR-0052 §5:** I edited the example name and added a Namespace bullet. The solution-architect should confirm or reword them.
- **No migration.** The database CHECK `p6_secret_ref_valid` still checks only the shape. A database-level namespace CHECK would need a new migration (next id above 0123) and the handling of existing rows. I did not add one: the application rules at write and resolve time close the finding.
- **Deployment / e2e:** whoever runs `e2e/a17-import-and-integration.spec.ts` must now export `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET` (it was `QA_A17_WEBHOOK_SIGNING_SECRET`) before the stack starts.
  - Deployments that point a SecretRef at a non-`MTH_SECRET_*` variable must rename that variable. Stored references of that kind resolve as unset until they are re-pointed.
  - A `SECRETS_DIR` equal to `/run/secrets` that holds the platform secret files is now a configuration error for the `file` provider.
  - I did not touch `deploy/**`, which belongs to DevOps (DO-Y1 runs at the same time). Compose sets no `SECRETS_DIR`.
- **Optional, not done:** an egress host allow-list for connector, assistant, SMTP and S3 endpoints (the finding's "optionally").

## User-facing texts made untrue, and what I did

- `integrations.webhooks.secretRefHint` (en and ar) gave `WEBHOOK_SECRET` as an example, which is now refused. I corrected it in both languages.
- I found no other en/ar string that names a secret.
- `docs/operations/monitoring.md` §4 sets canary variables (`SMTP_PASSWORD`, `S3_SECRET_ACCESS_KEY` …) for the log scan. Those are redaction canaries and are not resolved through a SecretRef, so they are still true; I left them unchanged.

## What remains (not done; D-059/D-070)

1. **The full `pnpm test:integration`** (acceptance item 3) did not complete; see note (b). It needs to be rerun on a less-loaded host or with the memory free, and its counts reported.
   - The 4 timeout failures need to be rerun in isolation: `seeded-procedures`, `connection-hygiene` (SIGTERM), and the two `response-validation` cases.
2. **`pnpm test` with the locale unset and with `C.UTF-8`** (acceptance item 2) was **not run**. Only the affected unit files ran (44/44).
3. **`pnpm -r build`** (acceptance item 1) was **not run**.
4. The **e2e spec** `e2e/a17-import-and-integration.spec.ts` (fixture renamed) was not run. Its env export changed; see above.

The separable second half of this task is items 1–4. They are verification only; I believe no code change is pending for them.
