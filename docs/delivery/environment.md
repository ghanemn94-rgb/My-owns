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

## Changes after P0 start

| Date | Change | Reason |
|---|---|---|
| 2026-09-28 | Installed `bubblewrap` 0.9.0 and `socat` with apt | They're required by the Claude Code Bash sandbox (D-025). The container has no unprivileged user namespaces, so agents run with `enableWeakerNestedSandbox`. Sandboxed agent shells have no network access. |
| 2026-09-28 | Claude Code created `~/.config/git/ignore` containing `**/.claude/.cc-writes/` the first time a sandboxed session ran (18:09 UTC). | This is Claude Code's own bookkeeping, a global git exclude for its `.claude/.cc-writes` directory. It's benign. The runner's config scan watches the file, and the live probe's temporary `HOME` pre-creates it so the environment is mirrored. |
