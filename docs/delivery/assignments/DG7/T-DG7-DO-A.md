# Assignment T-DG7-DO-A: Slice A: archive, offline build, service list, procurement flag, asset scan (devops-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, at the current `HEAD`. Work in the repository root.
- **Your task is §A.1 of `docs/architecture/p7-work-split.md`.** Read the whole of §1, §2 and §A first, then ADR-0062 and ADR-0063 (`docs/architecture/adr/`), the plan `docs/architecture/p7-plan.md` and decisions D-243 and D-244 in `docs/delivery/decisions.md`. The work split is binding: file ownership, exact texts, tests and the requirement → clause → test table.
- **Time:** 60–75 minutes. Run `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.
- **Concurrency:** T-DG7-ARCH-02 and T-DG7-DO-B run at the same time. Touch only the files §A.1 assigns to you. `tools/release/lib/patterns.mjs` is frozen: import it, never edit it.

## Environment

- Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768.
- The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`.
- **No Docker daemon** is available to you (D-243 Q1): build and test the container-free halves; leave the container halves as scripts the orchestrator runs, and say so.

## Deliverables

Everything §A.1 lists under "Creates" and "Changes", with its tests passing. Then the handback `docs/delivery/handbacks/DG7/T-DG7-DO-A-devops-engineer.md`: what was built (file list), each test with its real result, every command with its real exit code, deviations from the work split with reasons, open questions, and anything undone. Put logs under `docs/delivery/handbacks/DG7/T-DG7-DO-A-evidence/`.

## Acceptance

- Every §A.1 test passes (`node --test` as specified).
- `pnpm lint` and `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exit 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

## Evidence honesty

Never report a check as passed that did not run. A missing tool is BLOCKED.
