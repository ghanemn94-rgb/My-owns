# Handback T-DG6-ARCH-14 (solution-architect): SecretRef binding design (F-DG6-181, High) and ADR-0053 freshness text (F-DG6-160)

- **Stage:** DG6 (P6), FIXING after review round 2.
- **Invocation:** `DG6-T-DG6-ARCH-14-solution-architect-20261104T001125Z-1d1f6ea8` (session `1d1f6ea8-5bed-48a8-9402-428ba51a1ee6`).
- **Base:** branch `dg6/arch-14` at `561565123` ("DG6: assignment T-DG6-ARCH-14"). The tree was clean at the start.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-ARCH-14.md`. I verified its sha256 `b2860e16…6732e5` before reading.
- **Time:** started `2026-11-04T00:11:36Z` (`date -u`); checks ended `2026-11-04T00:39:44Z`; handback finished about `00:41Z` (about 30 minutes).
- **State:** documentation and design only. No product code, test, contract, migration or operations document was changed. Changes are left **uncommitted**.
- **Approvals:** none. No product gate (G1–G6), Finance or IT approval was granted, and nothing here records a DG0–DG7 result. All examples are synthetic.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited 0 at the start (`T-DG6-ARCH-14-evidence/00-validate-dg5-historical-start.log`) and at the end (§8).

## 2. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0052-p6-request-input-hardening-uploads-preview-secrets-audit-api-sweeps.md` | §5 gains a "Binding (F-DG6-181)" bullet. A new amendment (2026-11-04) specifies the design in sections A–I: the IT binding manifest, the match rule, the consumer table, the write-time refusal and its audit event, the fail-closed resolve, `resolvable`, the egress decision, migration and compatibility, and the operations text. |
| `docs/architecture/adr/ADR-0053-p6-operations-service-identities-exceptions-logs-heartbeat.md` | F-DG6-160: the §2 bullet "Not changed by this repair (open …)" is replaced by the shipped `kpiFreshness` rule. The change is recorded in a dated amendment at the end. |
| `docs/architecture/adr/ADR-0051-p6-authorization-boundary-read-scope-sensitive-records-deep-links.md` | Sweep after T-DG6-BE-Z1. §2 did **not** enumerate the child sources, so no list needed correcting. An amendment records the child-source rule as shipped (`column` / `pair` / `via`, with `benefit_calculation` as the first `via` source) and names the code as the authoritative enumeration. |
| `docs/architecture/adr/ADR-0054-…`, `ADR-0055-…`, `ADR-0056-…`, `ADR-0059-…` | One short amendment each: the binding applies to this ADR's SecretRefs (SMTP and S3; connector credentials and `resolvable`; webhook signing; the assistant). |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-14-solution-architect.md` | This handback. |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-14-evidence/*.log`, `summary.txt` | Command logs (§8). |

**Migrations:** none (ADR-0052 amendment §H). **API operations added:** none. **Pending operations routed:** none; my pending list is unchanged (§9).

## 3. Behaviour delivered, per requirement row

This task delivers design records. The behaviour is shipped by T-DG6-BE-Z2 (§4). The rows are not complete until BE-Z2 has run and been reviewed.

### REQ-S16-029 (F-DG6-181, High, mandatory)

Acceptance, quoted: *"A12;A22: a log scan after the test suite finds no secrets or storage URLs; a job's identity cannot read records outside its scope"*.

The design in the ADR-0052 amendment of 2026-11-04 answers each point the assignment asks for:

- **How IT declares the binding (§A).** IT keeps a JSON manifest at `SECRET_BINDINGS_FILE`, mounted read-only into the API and the worker. It holds names, scopes and hosts, never a value. No API operation, table or product role can change it.
  - Each `(provider, name)` has **one** consumer kind (`connector` | `webhook_signing` | `smtp` | `storage` | `assistant`) and **one** scope.
  - For the tenant kinds, the scope is an organization **code**. The code is immutable in the product (`OrganizationUpdate` has no `code`), and it is known before the organization has settings.
  - For the installation kinds `storage` and `assistant`, the scope is `null`.
  - Every kind that sends its secret anywhere also lists 1–16 `hosts`.
  - No manifest means nothing is bound (fail closed).
  - An installation secret can never be named by a tenant setting, and the reverse also holds: the consumer kind and the scope must both match.
- **Where the check runs (§B–§E):**
  - **Write time.** The binding check runs after authorization, the shape check and the namespace check. Every failing reference of the request gives a field error in one `400 validation`: `validation.secret_ref_not_bound` at the reference, or `validation.secret_ref_host_not_bound` at the host field. The `not_bound` body is identical whatever the cause. Each refused request writes the audit event `secret_ref.refused` in a separate short transaction, as `authorization.denied` does.
  - **Resolve time.** `SecretProviderRegistry.resolve(ref, use)` becomes the only resolve. An unbound reference returns `undefined` without asking the provider, and the consumer keeps its existing unresolvable code. One `warn` log line is written without a value.
- **`resolvable` (§F):** it is computed through the binding with the connector's own scope. A caller can store only a bound reference, so there is no existence oracle for another organization's or the installation's secret.
- **Egress (§G):** decided. The binding's `hosts` is the credential egress rule, and the host checked is the host called (redirects stay refused). No global endpoint allow-list is needed for this finding. Server-side request forgery to internal hosts without a credential remains the network egress policy's concern; I propose it as an observation in §7.
- **Configuration and handover text (§I):** the texts are in §5 below, for BE-Z2 to apply together with the code.

### REQ-S12-019 (F-DG6-160, Low)

Acceptance, quoted: *"A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date"*.

ADR-0053 §2 now states the shipped rule (verified at `561565123` in `apps/worker/src/handlers/operations.ts` lines 145–235 and 280–330). `kpiFreshness` reads the newest open or closed period whose transformation-scope `period` evaluation (the highest run seq) has a non-null value; the lateral join filters `ev.value IS NOT NULL` before `ORDER BY p.period_end DESC LIMIT 1`. It then applies `withReadTimeStaleness`.

As a result:

- an empty or Unknown later period does not hide a stale value;
- the scan emits one `data.stale` per episode (key `data.stale:<kpiId>:<dataAsOf>`);
- `operations.exception_raise` opens or recurs `data_stale`;
- `fresh` resolves the exception `recovered`.

The amendment section records the history: what was replaced, why, and that the question is now decided. The text follows BE-Y3 handback §6's proposal and adds the verified details.

### REQ-S10-002 (ADR-0051 sweep after T-DG6-BE-Z1)

ADR-0051 §2 never enumerated `SENSITIVE_CHILD_SOURCES` (`grep` finds neither the constant nor `benefit_calculation` in the ADR), so there was no list to correct. I added an amendment that states the child-source rule as shipped and points to `apps/api/src/modules/access/sensitive-reach.ts` as the authoritative list. I found no code that contradicts §2 (see §7).

## 4. Implementation brief for T-DG6-BE-Z2

The binding rules are ADR-0052's amendment of 2026-11-04, sections A–I. Read it first. This brief lists files, exact rules, tests and order.

### 4.1 Files and changes

1. **`packages/config/src/secret-bindings.ts` (new; exported from `@mth/config`).** Shared by the API and the worker, so it is not a twin.
   - **`loadSecretBindings(env)`** reads `SECRET_BINDINGS_FILE`. Unset gives an empty set. Otherwise it reads the file (at most 1 MiB) and parses it with a strict zod schema:
     - `{version: 1, bindings: Binding[≤1000]}`;
     - each `Binding` is `{provider, name, consumer, organization, hosts?}`;
     - rules A1–A9 apply;
     - the namespace check reuses the same regexes as `secretRefInNamespace`. Move them into `@mth/config`, and have `platform/secrets.ts` and `apps/worker/src/secrets.ts` import them.
     - Any violation throws `ConfigError([`SECRET_BINDINGS_FILE: bindings[<i>].<field> …`])`, which never prints file content.
   - **`secretBinding(bindings, ref, use)`** returns `"bound" | "not_bound" | "host_not_bound"`, following rule B.
     - Host canonicalization: `new URL("https://" + entryHost).hostname` and `.port` at load. The use's host comes from `new URL(endpoint)` (connector, assistant, S3) or from `{host, port}` (SMTP), both lower-cased.
     - An entry without a port matches any port. An entry with a port matches the effective port (default 443 for `https:`).
     - Hosts must match exactly; there is no suffix match.
   - **The exact message constants:** `SECRET_REF_NOT_BOUND_CODE = "validation.secret_ref_not_bound"`, `SECRET_REF_HOST_NOT_BOUND_CODE = "validation.secret_ref_host_not_bound"`, and the two English texts of ADR-0052 §D, verbatim.
2. **`packages/config/src/index.ts` and `load.ts`:**
   - Add `SECRET_BINDINGS_FILE` to `ENV_VARS`: `required: false`, `secret: false`, `usedBy: ["api","worker"]`, with this description: "Path of the IT-maintained JSON manifest that binds each SecretRef to one setting kind, one organization code (or the installation) and the hosts it may be sent to. Holds no values. Unset: no SecretRef is bound."
   - Load it at start. An invalid file exits 78.
   - Regenerate `.env.example` with `node deploy/scripts/generate-env-example.mjs`.
3. **`apps/api/src/modules/platform/secrets.ts` and `apps/worker/src/secrets.ts`:**
   - `createSecretProviderRegistry({ bindings, organizationCodeOf })`.
   - Replace `resolve(ref)` with `resolve(ref, use: SecretUse)`, where `SecretUse = { consumer, organizationId: string | null, host: {hostname, port} | null }`. There is no overload without a use.
   - Inside `resolve`: check the namespace; look up the code through `organizationCodeOf(organizationId)` (a cached read of `organization.code`; the API and worker composition pass a DB-backed function); call `secretBinding`. An unbound result logs `warn {event:"secret_ref.refused", consumer, organizationId, provider, name, reason}` and returns `undefined` **before** `provider.get`.
   - Add a test setter `setSecretBindings(bindings)` (returns the previous set), like `setConnectorSecretProviders`.
4. **`apps/api/src/modules/platform/secret-namespace.ts`:**
   - Add `assertSecretRefsBound(db, entries: {ref, pointer}[], use, hostPointer)`. It runs `assertSecretRefInNamespace` first, then the binding check. It collects **all** failing field errors into one `problems.validation([...])` and attaches `secretRefusal = { consumer, organizationId, refs: [{provider, name, reason, host?}] }` to the `HttpProblem`.
   - Never call a provider here.
5. **`apps/api/src/modules/access/denials.ts` (or a sibling hook registered next to it):** in `onError`, when an `HttpProblem` carries `secretRefusal` and the request has `principal.userId`, write in a separate transaction:
   - `action: "secret_ref.refused"`;
   - `recordType: "user"`, `recordId: <actor user id>`;
   - `organizationId: <setting's organization id or null>`;
   - `reason: "<METHOD> <route>: <consumer> reference <provider>:<name> not bound"`, or `"… not bound to host <host>[:<port>]"`, one line per refused reference joined by `"; "`, at most 1000 characters;
   - no `changes`.

   Track it with `app.inFlight` exactly as the denial hook does.
6. **Write-time call sites.** Replace each `assertSecretRefInNamespace` with the bound check:

   | Call site | Consumer | Organization | Host and host pointer | Notes |
   |---|---|---|---|---|
   | `integrations/connectors.ts` `checkConfig` (all `credentialRefs` keys) | `connector` | the `organizationId` argument (already authorized) | `/config/endpointUrl`, or `null` when `endpointUrl` is null | Runs on create and on every config version, so a changed endpoint re-checks a stored reference. |
   | `integrations/webhooks.ts` `checkSecretRef` (create and rotate) | `webhook_signing` | the connector's organization | `null` | Pass the organization in. |
   | `admin/notification-channels.ts` (`/smtp/usernameRef`, `/smtp/passwordRef`) | `smtp` | the channel's organization | `body.smtp.host` and `port`; pointer `/smtp/host` | |
   | `admin/storage.ts` `checkedS3` (`<pointer>/accessKeyRef`, `<pointer>/secretKeyRef`) | `storage` | `null` | the S3 endpoint; pointer `<pointer>/endpoint` | Applies to PUT and test. |
   | `assistant/settings.ts` (`/credentialRef`) | `assistant` | `null` | `endpointUrl`; pointer `/endpointUrl` | `null` for the test-adapter provider kind. Re-check on `enableAssistant` with the stored row. |
7. **Resolve-time call sites.** Pass the use:
   - **Connectors.** `integrations/secret-refs.ts`: `credentialRefViews(stored, use)` and `resolveCredentials(stored, use)`. Callers:
     - `connectors.ts` `toConnector` view and `fetchForTest`;
     - `runs.ts` fetch stage;
     - `outbound.ts` `callAdapter`.

     Each builds the use with `consumer: "connector"`, `organizationId: connector.organization_id`, and a host from `adapterConfigOf(...).endpointUrl`.
   - **Webhooks.** `webhooks.ts` `resolveRef` uses `webhook_signing`, the endpoint's organization and host `null`.
   - **SMTP in the API.** `notification-channels.ts:593` uses `resolveSecret: (ref) => secrets.resolve(ref, smtpUse)`.
   - **SMTP in the worker.** In `apps/worker/src/main.ts:73` and `handlers/notifications.ts`, build the resolver per channel row: `smtp`, `row.organization_id`, `{row.smtp_host, row.smtp_port}`.
   - **S3.** `evidence/stores/s3.ts:152-153` uses `storage`, `null` and the store's endpoint. Its `resolve(ref)` port type changes accordingly.
   - **Assistant.** `assistant/provider.ts:298` uses `assistant`, `null` and the endpoint host.
8. **`docs/api/openapi.yaml` (description only; no schema change).**
   - Append this paragraph to `SecretRef.description`: "IT also binds each secret, in `SECRET_BINDINGS_FILE`, to one kind of setting, one organization (or the installation) and the hosts it may be sent to. A reference that is not bound to this setting is refused with `400 validation`, field error `validation.secret_ref_not_bound`. A bound reference sent to a host IT did not list is refused with `validation.secret_ref_host_not_bound` at the host field. A stored reference that is no longer bound resolves as not set."
   - Append this sentence to `CredentialRefView.resolvable`: "Computed through the binding: a reference not bound to this connector's organization and host is `false`, and the secret provider is not asked."
   - Run `pnpm openapi:lint` and the contract suite.
9. **Operations texts:** apply §5 below.

### 4.2 Tests that must fail before and pass after

Each test names its owner file. The "before" state is HEAD `561565123`.

**Unit: `packages/config/src/secret-bindings.test.ts` (new).**

- Parse:
  - the valid example of ADR-0052 §A, with org code `ORGB`, parses;
  - unset gives empty;
  - each of these fails with a `ConfigError` naming `SECRET_BINDINGS_FILE`, the index and the field, and the message contains no host string from the file:
    - an unknown key;
    - `version: 2`;
    - an unknown consumer;
    - `storage` with an organization;
    - `connector` with `null`;
    - `connector` without `hosts`;
    - `webhook_signing` with `hosts`;
    - a host with a scheme, path, `*` or upper case;
    - a port of 0 or 70000;
    - the name `DATABASE_URL` or `OIDC_CLIENT_SECRET` (outside the namespace);
    - a duplicate `(provider, name)`;
    - more than 1000 entries;
    - a file over 1 MiB;
    - an unreadable path.
- Match matrix:
  - own scope and host gives `bound`;
  - another org's code gives `not_bound`;
  - another consumer gives `not_bound`;
  - a storage secret used as `connector` gives `not_bound`;
  - a connector secret used as `storage` gives `not_bound`;
  - B's `webhook_signing` secret used as A's `connector` gives `not_bound`;
  - an unlisted host gives `host_not_bound`;
  - `x.erp.orgb.example` against `erp.orgb.example` gives `host_not_bound`;
  - an entry `:587` with use port 25 gives `host_not_bound`;
  - a port-less entry with any port gives `bound`;
  - an upper-case use host is canonicalized and gives `bound`;
  - a `null` use host with `webhook_signing` gives `bound`.

**Registry: `apps/api/src/modules/platform/secrets-registry.test.ts`, `apps/worker/src/secrets.test.ts`.**

- `resolve(ref, use)` for an unbound reference returns `undefined`, and a spy provider's `get` is called **0** times.
- A bound reference returns the value.
- The `warn` line holds no value.
- `// @ts-expect-error` on `registry.resolve(ref)` without a use, so the typecheck enforces it.

**Integration: `apps/api/test/integration/integrations/secret-binding.test.ts` (new).** It runs against the real env provider, with the http_pull transport replaced by a recorder (as in the reviewer's probe).

1. **SB-1 (port of the reviewer's reproduction `zz-cs-r2-secret-cross-org.test.ts`).**
   - Setup: `setSecretBindings` binds `MTH_SECRET_CS_R2_ORGB_ERP_TOKEN` to `connector`, `w.orgB.code`, `["erp.orgb.example.invalid"]`.
   - B's ADM_TECH creates the connector: 201, `resolvable: true`.
   - A's admin GETs B's connector: 404.
   - A's admin POSTs an org-A `http_pull` connector to `https://collector.attacker.example.invalid/x` naming the same secret: **400** `validation`, field `validation.secret_ref_not_bound` at `/config/credentialRefs/bearer`. No connector row is added for A.
   - One `audit_event` row exists with `action = 'secret_ref.refused'`, the actor A, `organization_id = A`, `record_type = 'user'`, and a reason containing the name. No `changes`.
   - The recorder holds **no** request to the attacker host.
   - *Before the fix:* 201, and `Bearer synthetic-orgb-erp-token-cs-r2-e3f1` is captured (the reviewer's log 42).
2. **SB-2 (no oracle).** A names `MTH_SECRET_CS_R2_NOBODY_SET` (unset, unbound), and then B's name with B's variable **unset**. The `status`, `type`, `code` and `errors` of both bodies equal SB-1's. Only request-specific fields may differ.
3. **SB-3 (host rule, own organization).** B creates a new config version of its own connector with `endpointUrl` `https://collector.attacker.example.invalid/x`: **400** `validation.secret_ref_host_not_bound` at `/config/endpointUrl`. The recorder captures nothing. *Before:* 201, and the token is sent on test.
4. **SB-4 (resolve time, fail closed).**
   - Insert directly through the owner DB an org-A connector config naming B's secret (written past the API).
   - GET: `resolvable: false`.
   - `POST …/test`: `connector.secret_unresolvable`.
   - A manual run fails with `connector.secret_unresolvable`.
   - An outbound dispatch gives `no_response`, with `dispatched` false.
   - The recorder captures nothing.
   - A `warn` `secret_ref.refused` line is captured, and the captured log contains no token.
   - Then remove B's binding with the setter: B's own connector shows `resolvable: false` and its test fails `connector.secret_unresolvable`.
5. **SB-5 (installation and cross-kind).** Bind `MTH_SECRET_CS_S3_KEY` to `storage`/`null` and `MTH_SECRET_CS_ORGB_SIGNING` to `webhook_signing`/`ORGB`. Each of the following is 400 `validation.secret_ref_not_bound` at its pointer:
   - an org-A connector naming `MTH_SECRET_CS_S3_KEY`;
   - org A's SMTP PUT naming it;
   - an org-A webhook create naming `MTH_SECRET_CS_ORGB_SIGNING`;
   - an org-A connector naming `MTH_SECRET_CS_ORGB_SIGNING`;
   - a storage PUT naming B's connector secret;
   - an assistant PUT naming B's connector secret.
6. **SB-6 (SMTP host).** Org A's SMTP binding has host `smtp.orga.example.invalid:587`. A PUT with host `attacker.example.invalid` gives 400 `validation.secret_ref_host_not_bound` at `/smtp/host`.
7. **SB-7 (manifest unset).** With an empty set, B's own create naming its secret gives 400 `validation.secret_ref_not_bound` (fail closed).
8. **SB-8 (organization code invariant).**
   - `PATCH /api/v1/organizations/{id}` with `{code: "X"}` gives 400.
   - The openapi `OrganizationUpdate` has no `code` property.
   - A grep shows no `updateTable("organization")` that sets `code`.

**Webhook receive: `apps/api/test/integration/integrations/webhooks.test.ts`.** Add one case: with the binding removed, a correctly signed delivery gives 401 `webhook.unauthenticated` and no receipt row.

**Worker: the worker notification-delivery suite (`apps/worker/test/integration/…notifications…`).** A channel row whose `passwordRef` is bound to another organization gives `smtp.secret_unavailable`, and the fake SMTP server sees **no** connection.

**The reviewer's reproduction, run unchanged after the fix.** It now fails at its **first** expectation, `expect(own.status).toBe(201)`: no manifest binds the name, so B's own create is refused, which is the intended fail-closed behaviour. SB-1 is the faithful port with the one binding line added. Please state this in the BE-Z2 handback so that the reviewer re-runs SB-1, or the probe with a binding.

### 4.3 Existing suites that need a binding (fail closed breaks them otherwise)

These tests name real references and need `setSecretBindings(...)`, using `w.orgX.code` for tenant kinds:

- `apps/api/test/integration/integrations/{connectors,runs,outbound,webhooks,secret-namespace,secret-composition,graceful-degradation,run-failure-kpi-links,s16-022-entity-group}.test.ts`;
- `admin/notification-channels.test.ts`;
- `tasks/{channel-fanout,email-adapter-contract}.test.ts`;
- `assistant/{composition,provider,settings,conversations,suggestions}.test.ts` and `be-u-fixtures.ts`;
- `operations/log-redaction.test.ts`;
- `evidence/store-contract.test.ts`;
- `portfolio/deliverable-confirmation.test.ts`;
- the contract exercises `p6-exercises-be-{i,l,n,t,u}.ts`;
- the worker channel tests.

Grep for `MTH_SECRET_` and `provider: "file"` to find them all. Many use `credentialRefs: {}` and are unaffected.

**Outside BE-Z2's write scope (for the orchestrator and qa-verifier):**

- `tests/qa/integration/a17-import-and-integration.test.ts` (webhook `signingSecretRef` `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET` on `w.orgA`) needs one `setSecretBindings` line (`webhook_signing`, `w.orgA.code`).
- `e2e/a17-import-and-integration.spec.ts` uses the stack's own organization (`me.organization`). Its stack launcher needs a `SECRET_BINDINGS_FILE` that binds that name to `webhook_signing` and the seeded organization **code**. A UUID could not work here; this is why the code was chosen.
- Without these, A17's webhook step gets 400 after BE-Z2. Run them in the same merge.

### 4.4 Migration

None. Bindings are configuration (ADR-0052 §H), and `p6_secret_ref_valid` stays a shape check. If BE-Z2 nevertheless adds a DB guard (for example a trigger that makes `organization.code` immutable, which is optional defence in depth and not required by the ADR), it takes the next id above the highest file in `packages/db/migrations/` and says so (D-196).

### 4.5 Order and size

The suggested order is 1–3 (shared module and registry; typecheck then lists every resolve site), 4–7, the tests of §4.2, the suites of §4.3, then 8–9.

If BE-Z2 needs a separable second half (D-059/D-070), §4.3's suite updates cannot be deferred, because `pnpm test` and the touched integration files must stay green. The deferrable parts are the `warn` log assertion of SB-4 and SB-8's grep check. The write-time and resolve-time checks are not deferrable.

## 5. Operations and handover texts (for BE-Z2 to apply with the code)

These are not applied here, because they would be untrue until the code ships (F-DG4-160).

**`docs/operations/configuration.md`, "Secret providers":**

- Replace the first paragraph's list "(connector credentials, SMTP, an assistant endpoint)" with "(connector credentials, webhook signing secrets, the email channel, the object store, the assistant endpoint)".
- Insert after the namespace bullets:

> **The binding (F-DG6-181).** A reference in the namespace is still not enough: IT also **binds** each secret to the one setting it was provisioned for, in a JSON manifest named by `SECRET_BINDINGS_FILE` (mounted read-only into the API and the worker, for example `/run/mth-config/secret-bindings.json`). The manifest holds names, scopes and hosts, never a value; no screen or API can change it. Each entry is `{ "provider", "name", "consumer", "organization", "hosts" }`:
>
> - `consumer`: `connector`, `webhook_signing`, `smtp` (the email channel), `storage` (the S3 object store) or `assistant`.
> - `organization`: the organization's **code** for `connector`, `webhook_signing` and `smtp`; `null` for `storage` and `assistant`, which are installation-wide. An installation secret can never be used by an organization's setting, and the reverse.
> - `hosts`: for every kind except `webhook_signing`, the 1–16 hosts (`host` or `host:port`, lower case, no scheme or path, no wildcard) the secret may be sent to. A connector, email channel, object store or assistant pointed at another host does not receive the secret.
> - Each `(provider, name)` appears once: provision a separate secret for each organization and each use.
>
> Unset `SECRET_BINDINGS_FILE` means **no reference is bound**: every setting that names a secret is refused. An invalid file stops the API and the worker at start (exit 78, naming the entry and field, never the content). The file is read at start; restart both after a change.
>
> A setting that names a secret not bound to it is refused when it is saved or tested: `400 validation` with the field error `validation.secret_ref_not_bound` (the same answer whether the secret exists or belongs to another organization), or `validation.secret_ref_host_not_bound` at the host field when the host is not listed. Each refusal is audited (`secret_ref.refused`). A stored reference that is no longer bound (a binding removed) resolves as "not set": nothing is sent, and the connector shows the reference as not resolvable.

- Replace the bullet "A reference outside the namespace stored before this rule resolves as 'not set' … Re-point it to an `MTH_SECRET_*` name." with: "A stored reference outside the namespace, or not bound to its setting, resolves as 'not set': nothing is sent. Re-point it to an `MTH_SECRET_*` name and bind it."

**`docs/operations/notifications.md` (after the `env` / `file` examples) and `docs/operations/storage.md` (after the table at line ~138):**

> IT also binds each secret to this setting in `SECRET_BINDINGS_FILE` (`configuration.md`, "The binding"): consumer `smtp` with the organization's code and the SMTP host (`storage` with `null` and the object store's endpoint host). An unbound secret is refused with `400 validation` (`validation.secret_ref_not_bound`).

**Handover:**

- `.env.example` gains `SECRET_BINDINGS_FILE=`, through the generator.
- If the DG7 handover checklist lists P6 secrets, add "the secret binding manifest" next to `SECRETS_DIR`.

## 6. Proposed D-entry (for the orchestrator to record)

> **D-2xx (2026-11-04, solution-architect T-DG6-ARCH-14; F-DG6-181).** A `SecretRef` resolves only for the setting IT provisioned it for.
>
> - IT declares, in a read-only JSON manifest `SECRET_BINDINGS_FILE` (outside the database, no values), each secret's one consumer kind (`connector` | `webhook_signing` | `smtp` | `storage` | `assistant`), one scope (an organization code; `null` = installation for `storage` and `assistant`), and the hosts it may be sent to (required except `webhook_signing`).
> - The organization code is immutable in the product, and the binding relies on it.
> - The check (`@mth/config` `secretBinding`) runs:
>   - at write time, after authorization, shape and namespace: `400 validation`, field error `validation.secret_ref_not_bound` (identical for every cause) or `validation.secret_ref_host_not_bound` at the host field; audit `secret_ref.refused` in a separate transaction, as `authorization.denied`;
>   - at resolve time, through `SecretProviderRegistry.resolve(ref, use)`, the only resolve. Unbound returns undefined without asking the provider, and each consumer keeps its existing unresolvable code.
> - Fail closed: no manifest, nothing bound.
> - `resolvable` is computed through the binding, so it is no existence oracle.
> - The per-secret `hosts` is the credential egress rule, and redirects stay refused. No global endpoint allow-list is decided here.
> - No migration and no contract shape change; openapi descriptions only.
> - ADR-0052 §5 and its amendment of 2026-11-04, with cross-references in ADR-0054/0055/0056/0059.
> - Implementer: T-DG6-BE-Z2. QA A17 (integration and e2e) needs one binding each.

## 7. Proposed findings and observations (for the orchestrator)

1. **Code that contradicts the ADRs.** `apps/api/src/modules/platform/secrets.ts`, `apps/worker/src/secrets.ts`, `integrations/secret-refs.ts`, `connectors.ts:302-303` and the other `assertSecretRefInNamespace` call sites contradict ADR-0052 §5 as amended. That is F-DG6-181 itself (already open, owner BE), so it is **not a new finding**. No other contradiction was found:
   - ADR-0053 §2 vs `kpiFreshness`: now consistent;
   - ADR-0051 §2 vs `sensitive-reach.ts` and `kpi/calculations.ts`: consistent.
2. **Proposed Low, documentation (owner devops-engineer): `docs/operations/restricted-network.md` lines 5–10.** The doc says the processes need "exactly two services … The application makes no other outbound calls" and that SMTP, connectors and an AI endpoint "will be … listed here when it exists". In P6 these integrations exist (off by default, configured by IT). The text should list them as optional outbound destinations, and point to the binding's `hosts` and the deployment's egress policy. It is a user-facing operations text that P6 made untrue (F-DG4-160 class). I did not edit it, because it is outside my repair.
3. **Proposed observation (not a finding of F-DG6-181's scope): no product-level egress allow-list for credential-less endpoints.** An ADM_TECH can point an `http_pull` connector without credentials, or the storage or assistant endpoint, at an internal host (server-side request forgery). The binding stops credentials from going there, but not the request. Today the control is the deployment's network egress policy. Deciding a product-level allow-list (for example an IT-maintained `CONNECTOR_EGRESS_HOSTS`) is an orchestrator or code-security question for a later round.
4. **Proposed wording improvement (owner frontend-engineer; not untrue today).** Two texts in `apps/web/src/i18n/{en,ar}/integrations.json` are not wrong, but they become less helpful once binding ships:
   - `errors.connector__secret_unresolvable.todo` ("Ask IT to provide the secret {{name}} to the application's secret provider, then retry."), together with its `_noParams` twin;
   - `credentials.hint` ("a secret that IT holds").

   Suggested en: "Ask IT to provide the secret {{name}} and bind it to this connector and its host, then retry." The ar text is to be provided by the owner.

## 8. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, worktree `/home/user/wt/dg6-arch-14`. Empty `.claude/.cc-writes` directories were removed before the tests (none were found). Logs are in `docs/delivery/handbacks/DG6/T-DG6-ARCH-14-evidence/`.

| # | Command | Exit | Result / counts | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | `00-validate-dg5-historical-start.log` |
| 1 | `pnpm -r typecheck` | 0 | all workspace packages typecheck | `01-typecheck.log` |
| 2 | `pnpm -r build` | 0 | all packages built | `02-build.log` |
| 3 | `pnpm lint` | 0 | no errors | `03-lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | all matched files formatted (`docs/` is in `.prettierignore`, so the ADR and handback edits are not formatted by design) | `04-prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | contract unchanged and valid | `05-openapi-lint.log` |
| 6 | `pnpm test` with the locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | 0 | unit-node 189 files / **2851 passed**; unit-web 120 files / **2020 passed**; unit-formula-nocodegen 3 files / **259 passed, 2 skipped** (261; the 2 skips are pre-existing in `packages/shared/src/formula/fuzz.test.ts`) | `06-test-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | identical counts: 2851 / 2020 / 259 passed + 2 skipped | `07-test-c-utf8.log` |
| 8 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `PASS gate DG5 (historical)` | `08-validate-dg5-historical-end.log` |

No failed, flaky or timed-out test in either run; a grep of both logs for "fail" matches test titles only. The integration tests are not run: this task changed no code or test, so no integration file is touched (acceptance item 3).

## 9. Operations routed (pending-list delta)

None. This task routes no operation. My `p6-pending-*` list is unchanged, and so is `contract.test.ts`.

## 10. Contract, schema and dependency needs (for the orchestrator)

- **Contract:** description-only changes to `SecretRef` and `CredentialRefView.resolvable` (§4.1 item 8), applied by BE-Z2. No operation, schema, status or top-level problem code changes. Two new **field-error** codes inside 400 `validation`: `validation.secret_ref_not_bound` and `validation.secret_ref_host_not_bound`.
- **Configuration:** a new optional variable, `SECRET_BINDINGS_FILE`.
- **Audit:** a new action, `secret_ref.refused`. If an audit-action catalogue or i18n label list exists (the Administration > Audit filter), its owner adds the label in en and ar.
- **Schema / migration:** none.
- **Dependency:** none. zod and the WHATWG `URL` are already in use.

## 11. User-facing texts

- **Made untrue by this work:** none. ADRs are design records, and no shipped en/ar string or operations text changed.
- **Texts that become untrue when BE-Z2 ships, unless updated in the same change:**
  - `docs/operations/configuration.md`, "Secret providers" and "The namespace": the last bullet;
  - `notifications.md`;
  - `storage.md`;
  - the `SecretRef` description in openapi.

  The replacement texts are in §5 and §4.1 item 8.
- **Already untrue, not caused by this work:** `docs/operations/restricted-network.md` lines 5–10 (§7 item 2).

## 12. What remains and merge instructions

- **Remains:** all of the behaviour. F-DG6-181 is closed only by T-DG6-BE-Z2's implementation (§4) and a reviewer's verification. The A17 QA and e2e binding lines (§4.3) need qa-verifier or the orchestrator.
- **Remains: orchestrator records.** The proposed D-entry (§6) and the proposed findings and observations (§7) are for the orchestrator to record.
- **F-DG6-160:** the ADR text is corrected. Closure is by a reviewer's verification.
- **Merge:** documentation only, so no conflicts are expected. The appended amendments in ADR-0051/0052/0053/0054/0055/0056/0059 are at the end of each file, except ADR-0052's §5 bullet and ADR-0053's §2 bullet (one line each).
