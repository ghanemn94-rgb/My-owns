# Handback T-DG6-DO-Z1: restricted-network operations text (devops-engineer)

- **Stage:** P6 / DG6 (FIXING after review round 2).
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-DO-Z1.md` (sha256 `1451cb4b9edc1f0cb325c917168cd42391b6eb854a04f6ea4260f1bababc4ae6`, verified).
- **Invocation:** run `DG6-T-DG6-DO-Z1-devops-engineer-20261104T065534Z-b6900c51`, session `b6900c51-2fd0-401d-871c-64e53437131b`.
- **Working tree:** `/home/user/wt/dg6-do-z1`, branch `dg6/do-z1`, starting `HEAD` `87b4424b4c7d4fc1cc80b16d6aaeb1d821f78f0f`. The tree was clean at the start.
- **Source:** the T-DG6-ARCH-14 handback §7 item 2 (a proposed Low documentation finding). The changes are left **uncommitted**, and no product code changed.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/operations/restricted-network.md` | The "Runtime" section is rewritten:<br>• It drops the untrue "makes no other outbound calls" and "will be listed here when it exists".<br>• It lists the default services per process.<br>• It adds the table "Optional outbound destinations (P6): each off unless IT configures it", plus what is *not* outbound (webhooks, outbound writes).<br>• It names the two controls: the binding's `hosts` and the deployment egress policy.<br>• It adds the test-only connection log. |
| `docs/operations/notifications.md` | §2 "Network route": "No other outbound route is needed" now reads "Email needs no other outbound route", with a link to the full list. §7 gains the egress-policy and binding-`hosts` sentences. |
| `docs/operations/storage.md` | §7 gains a pointer to the full list and the two controls. The existing storage-scoped text was already true and is unchanged. |
| `docs/operations/README.md` | The index row for `restricted-network.md` now mentions the optional destinations and their controls. |
| `docs/delivery/handbacks/DG6/T-DG6-DO-Z1-devops-engineer.md` | This handback. |

## 2. Each corrected statement and the code it was verified against

| Statement in `restricted-network.md` | Verified against |
|---|---|
| By default: PostgreSQL for `api`/`worker`/`migrate`; OIDC IdP for `api` only; SAML only through an IT-run OIDC broker | `.env.example` / `packages/config` `ENV_VARS` (`OIDC_*` "used by: api"); `apps/api/src/modules/admin/identity.ts:12` ("The product contains no SAML code") |
| `telemetryEnabled` is the constant `false` | `apps/api/src/modules/assistant/settings.ts:22,99,202` |
| **SMTP relay**: off until a channel is configured. The worker connects for notifications and the API for "test to me". Set per organization. | `apps/worker/src/channels/email.ts` and `apps/api/src/modules/tasks/channels/email.ts` (nodemailer `createTransport`); `nodemailer` in both `apps/worker/package.json:27` and `apps/api/package.json:35`; `apps/api/src/modules/admin/notification-channels.ts:406`; `docs/operations/notifications.md` §2/§3 |
| **`http_pull` connector endpoint**: API only (the test and the run watch); the worker only queues slots | `adapters/http-pull.ts:105` (`fetch`); `connectors.ts:1191` (the test); `runs.ts:33-36,679` (the run watch runs in the API every 10 s, and the worker cannot run due runs); `apps/worker/src/handlers/integrations.ts:5-11` (the worker creates slots only); `connectors.ts:320-323` (`endpointUrl` is required for `http_pull` only) |
| **S3 object store**: API only. It is reached on a test of a candidate or after switching to `s3`. With no row, the environment default applies. The worker makes no object-store connection. | `evidence/stores/s3.ts` (the `S3Client`, and `fetch` at `:413` for the anonymous-read check); `admin/storage.ts:11,564-565`; `@aws-sdk/client-s3` only in `apps/api/package.json:22`; `packages/reporting/src/storage.ts:158-176` (`createExportStore` refuses `s3`, so export files stay on the filesystem); no `S3`/`stores/s3` import under `apps/worker/src` |
| **Assistant `http_endpoint`**: API only. No provider exists unless the assistant is enabled. https is required in production. | `assistant/provider.ts:1-20,371` (`providerFor`); `conversations.ts:551` is the only caller; `settings.ts:332-333` (`assistant.insecure_endpoint`); ADR-0059 §2/§3 |
| **Webhooks** are inbound only, and the signing secret is never sent | `integrations/webhooks.ts:1-20` (`POST /api/v1/webhooks/{endpointKey}`); `packages/config/src/secret-bindings.ts:28` (`webhook_signing`: never sent, no hosts) |
| **Outbound writes** use only the test adapter in this release; `http_pull` answers `rejected` without I/O | `integrations/outbound.ts:36-37` (the 0104 guard); `adapters/http-pull.ts:19-20`; `connectors.ts:334` |
| Binding `hosts`: refused on save or test with `validation.secret_ref_host_not_bound`; resolved only for a matching host; the binding does **not** stop a credential-less connection | `packages/config/src/secret-bindings.ts:66-68,263-275`; `apps/api/src/modules/platform/secrets.ts:115` and `apps/worker/src/secrets.ts:110` (resolve through `secretBinding(…, host)`); `connectors.ts:324-333`; `assistant/settings.ts:289-302`; D-209 ("The binding's hosts are the credential egress rule … credential-less SSRF stays with the network egress policy") |
| The product has no egress allow-list of its own for credential-less endpoints | D-209 (no global endpoint allow-list is decided); T-DG6-ARCH-14 handback §7 item 3 |
| `MTH_CONNECTION_LOG` is a test instrument, ignored in production, and not a packet capture | `packages/config/src/connection-log.ts:1-17` |

**Sweep.**

- I ran `git grep -n -i -E "no other outbound|no outbound call|makes no other|exactly two services|outbound (call|connection|route)s?"` outside `docs/delivery`, `docs/source` and `trading_agent`, plus a grep of all `docs/operations/*.md` and of the app, package and deploy READMEs.
- The **only** install-wide claim was in `restricted-network.md`.
- `notifications.md:41,138` and `storage.md:206` make claims scoped to email and to storage. They are true. I clarified their wording and added cross-references.
- No separate handover guide makes the claim: the operations guides are the handover set, and `docs/operations/README.md` is the index.

## 3. Checks actually run

The environment was Linux 6.18.44 sandbox, Node v24.21.0 and pnpm 10.33.0, in the worktree above. No Docker was needed, and none was started.

| Command | Exit | Output tail |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG5` (before any edit) | 0 | `PASS gate DG5 (historical)` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `All matched files use Prettier code style!` |
| `pnpm lint` (`eslint . --max-warnings=0`) | 0 | no findings |
| `pnpm check:no-cdn` | 0 | `PASS no-cdn: scanned apps, packages` |
| `node tools/gates/validate.mjs --historical --stage DG5` (after the edits) | 0 | `PASS gate DG5 (historical)` |

- **Not run:** the no-egress Compose smoke (`deploy/scripts/verify-stack.sh`). The change is text only, and the behaviour it proves is unchanged.
- **Link targets:** no automated link checker exists. Each relative link target was checked with `test -f`.

## 4. Known gaps and what remains

- **ADR-0011:26 still says "later to IT-configured SMTP, connectors or an AI endpoint".** It is still broadly true: all of them are optional and off by default. It omits the object store. The ADR is owned by the solution-architect, so I did not edit it. I propose a Low note to that owner if an amendment is wanted.
- **Proposed Low (owner: devops-engineer, outside this assignment's literal scope):** `docs/operations/configuration.md` "Evidence storage" (the last section) still says "P1 uses the private filesystem adapter … The optional S3-compatible adapter is a later-stage item (P6)". In P6 the adapter exists (`storage.md`). I did not change it, because the assignment limits the sweep to the "no other outbound calls" claim. It is a one-line fix if the orchestrator assigns it.
- **ARCH-14 §7 item 3 is still open as an observation.** There is no product-level allow-list for credential-less endpoints, which leaves a server-side request forgery (SSRF) exposure. The doc now states this plainly and names the deployment egress policy as the control. It does not decide a product allow-list.
- **F-DG6-181 (owner BE) is not affected by this text change.** The doc describes the binding as `configuration.md` and the code at `platform/secrets.ts:115` implement it.
- **No live check.** No live SMTP relay, corporate source, object store or model endpoint was exercised. As the doc says, each is proven only against local fakes. A local Compose no-egress demonstration is not proof of high-availability production readiness, or of a production network policy.

## 5. Merge instructions

Documentation only: no migrations, no code, no ordering constraints. A conflict is possible only if another task edits the same lines:

- `docs/operations/restricted-network.md` lines 3–10;
- `notifications.md` §2 row "Network route" or §7;
- `storage.md` §7;
- the `restricted-network.md` row of `docs/operations/README.md`.
