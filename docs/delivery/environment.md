# Delivery environment record

Recorded by: delivery-orchestrator (main Claude Code session)
Recorded at: 2026-09-28 (UTC), stage P0
Purpose: section 0.1 of the master prompt. This records what the build environment actually provides, so later stages don't assume capabilities that aren't there.

## Repository

| Item | Finding |
|---|---|
| Repository | `ghanemn94-rgb/My-owns` (GitHub), cloned at `/home/user/My-owns` |
| Working branch | `claude/mobily-transformation-platform-kwcc4i` (created from `claude/us-stock-trading-agent-GXNc1` @ `f099f3d`) |
| Pre-existing content | `trading_agent/`: an unrelated Python paper-trading project belonging to the user. **Preserved untouched.** The platform lives in new top-level paths and never modifies `trading_agent/`. |
| Existing CLAUDE.md / .claude config | None before this stage |
| Git identity for commits | `Claude <noreply@anthropic.com>` (pre-configured) |

## Authoritative source

| Item | Finding |
|---|---|
| Source file | `Business_Transformation_Playbook(2).docx`, supplied as a session upload (`~/.claude/uploads/.../b513e626-Business_Transformation_Playbook.docx`) |
| Repository copy | `docs/source/Business_Transformation_Playbook.docx` |
| SHA-256 | `2584a35282804e639a697478eae75a55a43cfb8c551345dfc7636b9b34548ad2` |
| Extraction | `tools/source/extract_docx.py` (standard library only) → `docs/source/playbook.md` (human-readable, block anchors `B0001`–`B0165`) and `docs/source/playbook.blocks.json` (machine-readable). 165 blocks, 49 tables. The footer text is "BUSINESS TRANSFORMATION PLAYBOOK \| PRACTICAL EDITION". |
| Source version | "Version 1.0 \| September 2026" (block B0005) |
| Arabic edition of the master prompt | Not present. Per the master prompt it is an equivalent translation and adds no scope; the English edition is the one being executed. |

## Runtime and tooling (verified by command output)

| Capability | Version / status | Verified by |
|---|---|---|
| Claude Code CLI | 2.1.283 | `claude --version` |
| Nested non-interactive Claude invocation | Works (`claude -p` returned the expected reply) | `claude -p "Reply with exactly: PONG"` |
| Node.js | v22.22.2 | `node --version` |
| npm | 10.9.7 | `npm --version` |
| pnpm | 10.33.0 | `pnpm --version` |
| npm registry access | Available through the session egress proxy | `npm view fastify version` |
| Python | 3.11.15 (no `python-docx`; extraction uses the stdlib) | `python3 --version` |
| PostgreSQL (host) | 16.13, cluster `16/main` started on port 5432 | `pg_ctlcluster 16 main start`, `pg_lsclusters` |
| Docker Engine | 29.3.1. The daemon was **not running** at session start; it was started manually (`dockerd` in background, overlayfs, cgroup v1) | `docker info` |
| Docker Compose | v5.1.1 | `docker compose version` |
| Image registry access | Docker Hub pulls work (`postgres:16-alpine` pulled) | `docker pull` |
| Headless browser | Chromium pre-installed; Playwright configured (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) | environment notes |
| Compute | 4 vCPU, 15 GiB RAM, ~30 GiB free disk allowance | `nproc`, `free -g`, `df -h` |
| Egress | All outbound HTTPS goes through a TLS-re-terminating proxy. Tools must trust `/root/.ccr/ca-bundle.crt`, and container builds that fetch packages must receive that CA. | `/root/.ccr/README.md` |

## Agent capabilities

| Capability | Status |
|---|---|
| Project subagent definitions (`.claude/agents/*.md`) | Created in P0. How they load and how they're invoked is recorded in `docs/delivery/agents.md` after verification. |
| Built-in delegation (Agent tool / Workflow agents) | Available; used for real, separate agent invocations |
| Agent Teams (experimental) | Not relied on (optional per §0.1) |
| Worktree isolation | Available via git worktrees; used when concurrent writers touch the same repository |
| Concurrency ceiling adopted | At most 4 active workers per stage step (§0.2 default) |

## Limitations and constraints

1. **Ephemeral container.** The container is reclaimed after inactivity, so all durable state (delivery records, source, code) must be committed and pushed to the working branch. Delivery records never depend on agent memory.
2. **Docker daemon is started manually** and can be absent after a container restart. `scripts/dev/ensure-docker.sh` (added in P1) restarts it idempotently. The production package does not depend on this.
3. **Egress proxy CA.** Image builds must accept an optional build-time CA secret. Runtime images must not require public internet (verified in P6/P7).
4. **No stable provider run IDs.** The runtime exposes an internal agent identifier per invocation. Review records store it as `invocation_reference` together with the transcript path when available. Where no ID is exposed, the record says so explicitly rather than inventing one.
5. **Permission classifier interruptions.** Shell commands were intermittently refused while the permission classifier was unavailable. Read-only tools were used meanwhile. This doesn't affect product behaviour.
6. **Unit-test load envelope (F-DG4-148, D-134).** The review machine has 4 cores. `pnpm test` is a valid gate check when the 1-minute load average stays at or below **8** (twice the core count) for the whole run, sampled at least every 30 s and recorded in the evidence.
   - Above that load, first renders of lazily loaded page modules can miss unit-web's 5 s wait, and `architecture.test.ts` can miss its 30 s timeout, without any product defect. The load the three concurrent reviews create (22–30) is well above it.
   - A reviewer runs `pnpm test` for the gate when no other heavy test phase is running. It records the load samples. A run that fails above the envelope is disclosed, and the check is re-run inside it.
   - Evidence: the orchestrator's pre-freeze runs passed at load 1.22–2.33 in every round (measured), and qa round 7 passed 4/4 at low load. qa saw 3/4 runs fail at load 22–30 and 1/4 at a measured load of 12.40–17.65 (the target band was 13–16).
   - The user accepted F-DG4-148 as an observation on this basis (D-134).

## Changes after P0 start

| Date | Change | Reason |
|---|---|---|
| 2026-09-28 | Installed `bubblewrap` 0.9.0 and `socat` with apt | They're required by the Claude Code Bash sandbox (D-025). The container has no unprivileged user namespaces, so agents run with `enableWeakerNestedSandbox`. Sandboxed agent shells have no network access. |
| 2026-09-28 | Claude Code created `~/.config/git/ignore` containing `**/.claude/.cc-writes/` the first time a sandboxed session ran (18:09 UTC). | This is Claude Code's own bookkeeping, a global git exclude for its `.claude/.cc-writes` directory. It's benign. The runner's config scan watches the file, and the live probe's temporary `HOME` pre-creates it so the environment is mirrored. |
| 2026-09-29 | The container was recreated, so `bubblewrap` 0.9.0 and `socat` were installed again with apt. `setpriv` (util-linux) is present. | The runner now also needs `setpriv` for the process sandbox (D-030). |
| 2026-09-29 | The Claude Code CLI (2.1.284) in this environment registers the processes its Bash tool spawns in the cgroup `/sys/fs/cgroup/memory/process_api`, so the process sandbox binds that directory read-write (D-030). Inside the sandbox the CLI keeps only `CAP_SETFCAP`, which its own Bash sandbox needs to map uid 0 into a user namespace. | Found while building the process sandbox. The previous user experiment had shown that the Bash tool fails without the cgroup bind. |
| 2026-09-29 | The auto permission mode is not available for `claude-haiku-4-5` in `-p` runs here: file writes then ask for a permission that cannot be granted. | Seen in a sandbox plumbing experiment. Agents always run with the orchestrator's model (`claude-opus-5-5`), where auto mode works. |
| 2026-09-28 | The orchestrator runs candidate checks through `tools/gates/sandbox-run.sh` (bubblewrap; D-026). CI installs `bubblewrap` and sets `kernel.apparmor_restrict_unprivileged_userns=0` on the hosted Ubuntu 24.04 runner. | Here the orchestrator runs as root, so bubblewrap creates its namespaces without unprivileged user namespaces. A hosted CI runner is unprivileged and needs them. The CI step is **unverified** until the first workflow run on the branch reports: this session has no GitHub Actions access. |

## P6 residuals: live integrations not exercised in this environment

Written by T-DG6-DO-C (devops-engineer) on 2026-10-29, against tree `135ff1d`, under p6-work-split §J/C.12 and
§2 rule 14. Each integration below ships with its port, a local test double and contract tests. None of them has
been exercised against a live corporate system here. None is called "live", "integrated with Mobily" or "tested
against production". In each row, the "IT supplies" column is a configuration slot that Mobily IT fills; no row
records an IT approval.

Environment facts behind this table, from `docs/delivery/handbacks/DG6/T-DG6-DO-C-evidence/environment-facts.txt`:

- Docker client 29.3.1 and Compose v5.1.1 are present.
- `docker info` exits 1 inside the agent sandbox ("permission denied while trying to connect to the docker API at
  unix:///var/run/docker.sock"), so no container could be run by this task.
- Outbound HTTPS works through the egress proxy for `raw.githubusercontent.com` and `hub.docker.com`.
- `github.com` and `api.github.com` answer 403 ("GitHub access to this repository is not enabled for this session").

| Integration | What is proven here, and how | Residual: not exercised | What Mobily IT supplies | Guide |
|---|---|---|---|---|
| **Corporate identity provider (OIDC)** | The OIDC code flow with PKCE against the local fake OP (`apps/api/test/support/fake-idp.ts`). Issuer, audience and key rejection with a second issuer `mth-other` (BE-G, ADR-0054 §1). | Sign-in through Mobily's IdP | Issuer URL (https), client ID, client secret (as `OIDC_CLIENT_SECRET_FILE`), redirect URI registration, the `email` and `name` claims, and group → role mapping input | `docs/operations/configuration.md` |
| **Keycloak test realm e2e** (REQ-S16-007) | Realm `mth-test` ships (`deploy/keycloak/realm-mth-test.json`). The image pin moves to `quay.io/keycloak/keycloak` by digest (D-197 item 1; DO-B). | **BLOCKED wherever no container runtime exists.** In this sandbox the Docker daemon is not reachable (above), so the Keycloak e2e (`mth-test` login, `mth-other` token refused) cannot run. The cross-realm rejection is carried by BE-G's integration test (D-195 Q5, D-049). | A host with a container runtime, to run the `test-idp` profile | `docs/operations/configuration.md`; DO-B's e2e |
| **Brokered SAML** | Nothing executable: the hub is OIDC-only and has no SAML code (ADR-0054 §1). Keycloak as the SAML → OIDC broker is a documented configuration. | The whole brokered path: no SAML IdP exists here | The corporate SAML IdP metadata, its signing certificate and rotation, and the attribute mappings for `email` and `name` | `docs/operations/identity-saml-broker.md` (DO-B; **not yet written** at `135ff1d`) |
| **IT object store (S3-compatible)** (REQ-S16-006) | The `@aws-sdk/client-s3` adapter and the filesystem adapter pass one contract suite. The S3 run is against the in-process, SigV4-verifying fake (`apps/api/test/support/fake-s3.ts`; BE-H). No URL is returned anywhere. | Any real object store, including the SeaweedFS 4.51 test store (Apache-2.0, verified 2026-10-29; not bundled), which could not be run here (no container runtime). Driver selection and Administration > Storage are BE-H2 (not on `135ff1d`). | Endpoint (https), region, a private bucket, an optional key prefix, a least-privilege access key pair as secret references, and the CA if it is corporate | `docs/operations/storage.md` |
| **SMTP relay** (REQ-S12-023) | The nodemailer 10.2.1 adapter against the in-process fake SMTP (`apps/api/test/support/fake-smtp.ts`; BE-I): plain, STARTTLS, AUTH refused, a drop mid-DATA. A21: no channel means in-app only. Fan-out exactly once is BE-I2 (not on `135ff1d`). | Any real relay; DKIM, SPF and DMARC; delivery to real mailboxes | Relay host and port, security mode, optional credentials as secret references, sender address, and the CA if it is corporate | `docs/operations/notifications.md` |
| **Enterprise messaging** | Port only. Enabling it is refused (422 `notification_channel.adapter_unavailable`; CHECK `notification_channel_no_messaging_adapter`). | No adapter ships in P6 | — (a later release would add an adapter) | `docs/operations/notifications.md` |
| **Corporate data source (`http_pull` connector)** | ADR-0055 §1: the port and a contract test against a local fake HTTP source (BE-L2, planned). The `test_adapter` is the local adapter of M0335. | Any corporate source (M0334 "when access is supplied") | The source endpoint (https), its credential as a secret reference, the field mapping, and the network route | ADR-0055; handover guide for connectors (owner: slice B) |
| **AI model endpoint (optional assistant)** | ADR-0059: the provider port, against a local fake chat-completions server (`apps/api/test/support/fake-model.ts`; BE-T, planned). The assistant is disabled by default (M0337; ADR-0059 §3). | Any IT-hosted model endpoint | The endpoint, model name and credential reference of an IT-approved provider, if Mobily chooses to enable the assistant | ADR-0059; row to be confirmed by BE-T's handback |

A row's proof cell names the task that delivers it. "Planned" or "not on `135ff1d`" means that the proof had not been
merged when this table was written. The orchestrator updates the row when that task's handback is merged.
