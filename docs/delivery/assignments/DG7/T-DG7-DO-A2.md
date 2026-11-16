# Assignment T-DG7-DO-A2: repair P-1 and P-2 from T-DG7-DO-A; drop `tool.node` from the archive manifest (devops-engineer)

## Stage and base

- **Stage:** P7, gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Read first:** D-246 in `docs/delivery/decisions.md`; `docs/delivery/handbacks/DG7/T-DG7-DO-A-devops-engineer.md` §4 (D4) and §5 (P-1, P-2, Q1); ADR-0062; `p7-work-split.md` §A.
- **Time:** 45–60 minutes. `date -u` at start and end.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): build in one place, delete your own temporary trees when done, and never make a full extra checkout.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon.

## Work

1. **P-1 (High).** In `deploy/scripts/assemble-runtime.sh`, strip only pnpm's peer suffix after the version, so names containing `_` are kept (`string_decoder@1.1.1` unchanged; `react-dom@19.1.0_react@19.1.0` → `react-dom@19.1.0`). Add a regression test that fails on the old expression. Check every other place in `deploy/**` and `tools/release/**` that parses pnpm directory names the same way.
2. **P-2 (Medium).** Make `assemble-runtime.sh` remove `node_modules/.modules.yaml`, `.pnpm-workspace-state-v1.json` and the `.bin` shims from the runtime tree, after confirming nothing at runtime needs them (the API, worker and CLI entry points run as `node <file>`; check the Dockerfile `CMD`/entry points, `clean-start-local.sh` and the CLI wrappers).
3. **Q1.** Move `tool.node` from `ARCHIVE-MANIFEST.json` to `build-report.json`, update its tests, and add a dated amendment to ADR-0062 §4.2 saying so.
4. Re-run **T-A5** (build from the unpacked archive, no network) and **T-A11** (asset scan on the real assembled tree), and the rest of the `tools/release` and `licenses` tests; and re-run `clean-start-local.sh` phase A if it fits in the disk budget, else say why not.

## Handback

`docs/delivery/handbacks/DG7/T-DG7-DO-A2-devops-engineer.md`, logs in `docs/delivery/handbacks/DG7/T-DG7-DO-A2-evidence/`: files changed, each test with its real result, every command with its real exit code, anything undone.

## Acceptance

- T-A5 and T-A11 pass; the new regression test fails on the old expression and passes on the new.
- `pnpm lint` and `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exit 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run.
