# Assignment T-DG7-ARCH-02: slices C + D — data migration manifest and tools, configuration transfer bundle (solution-architect)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, at the current `HEAD`.
- **Preceding gate:** DG6 APPROVED (D-241). Run `node tools/gates/validate.mjs --historical --stage DG6` first and report it; it must exit 0.
- **Plan:** `docs/architecture/p7-plan.md` (adopted, D-243). Your task is its row **T-DG7-ARCH-02** in §4: read §1 (slices C and D), §3 (seams), §4, §5 and §6 (decided in D-243) first.
- **Time:** about 2 hours. Run `date -u` at start and end; past about 100 minutes, finish the current section and write the handback with what remains.

## Environment

- Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline.
- The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `trading_agent/`.

## Deliverables

1. **ADR-0064** (migration manifest) and **ADR-0065** (configuration bundle), exactly as scoped in the plan's ARCH-02 row, with the D-243 decisions (Q4 verbatim audit import into an empty database, Q5 identity rebind, Q16 credential exclusion) and D-244 O2: name the environment-marker field (DO-A's fixture uses `sourceEnvironment`, which must equal `demo` for the demo export) and carry the ADR-0050 demo checksum as `demoChecksum` (the seed writes `now()` timestamps, so export bytes differ). Each ADR states what is built, by whom, how it is tested, and the honest residuals. No new runtime dependency.
2. **`docs/architecture/p7-work-split.md`**: append sections §C and §D only (never edit §1, §2, §A, §G): owners and file ownership, seams, exact EN and AR texts, test lists, and the clause each test proves, for REQ-S19-014, S19-016 and S19-008.
3. **Schema and contract:** migrations from your range `0133`–`0142` (write from the low end; the rest is for implementers) with the P2 guard pattern and a guard probe on a real PostgreSQL; Kysely types and catalogue pins; `P7_PERMISSIONS` additions; the OpenAPI operations of the row (`/api/v1/admin/migration-exports`, `migration-imports`, `identity-rebinds`, `config-bundles`, ≈ 17–19) checked with `pnpm openapi:lint`, with `p7-pending` lists for the implementers; advisory locks 730402–730409; ERD, data-dictionary and permissions-matrix sections. You are the only run editing the shared contract files in this wave.
4. **Handback** `docs/delivery/handbacks/DG7/T-DG7-ARCH-02-solution-architect.md`: the `--historical` result, time used, summary, open questions (quote sources), anything undone.

## Acceptance

- Both ADRs and §C/§D exist and cover the three requirements, each clause mapped to a test and an owner. Integration tests (migrations and contract) pass on a disposable PostgreSQL; `pnpm -r typecheck`, `pnpm lint` and `pnpm openapi:lint` exit 0.
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.
