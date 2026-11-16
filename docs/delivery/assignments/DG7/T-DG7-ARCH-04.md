# Assignment T-DG7-ARCH-04: slices B + F — clean deployment, offline runtime, transfer drill; schema, API and connector handover (solution-architect)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, at the current `HEAD`.
- **Preceding gate:** DG6 APPROVED (D-241). Run `node tools/gates/validate.mjs --historical --stage DG6` first and report it; it must exit 0.
- **Plan:** `docs/architecture/p7-plan.md` (adopted, D-243). Your task is its row **T-DG7-ARCH-04** in §4: read §1 (slices B and F), §3 (seams), §4, §5 and §6 (decided in D-243) first.
- **Time:** about 2 hours. **Disk is tight (about 4 GB free): never make a full extra checkout; delete your own temporary trees.** Run `date -u` at start and end; past about 100 minutes, finish the current section and write the handback with what remains.

## Environment

- Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline.
- The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `trading_agent/`.

## Deliverables

1. **ADR-0069** (clean deployment and transfer) and **ADR-0070** (schema and API handover), exactly as scoped in the plan's ARCH-04 row, with the D-243 decisions (Q1 the drill split: agents build and run the container-free halves, the orchestrator runs Compose up, image load and Keycloak e2e on its host; Q6 storage gates readiness, worker reported only; Q10 root `.env.example` kept; Q12 no unknown-target manifests; Q15 bootstrap re-proved; Q17 a different origin proven, sub-path only if already supported) and D-245/D-248 (the migration manifest, backup set and upgrade dry run the transfer drill uses). Each ADR states what is built, by whom, how it is tested, and the honest residuals. No new runtime dependency.
2. **`docs/architecture/p7-work-split.md`**: append sections §B and §F only (never edit §1, §2, §A, §G, §C, §D, §E): owners and file ownership, seams, exact EN and AR texts, test lists, and the clause each test proves, for REQ-S01-001, S01-006, S16-008, S19-009, S19-010, S19-017, S19-018, S20-018, S19-005, S19-007 and S17-004.
3. **Schema and contract:** migrations from your range `0150`–`0152` (none expected) (write from the low end; the rest is for implementers) with the P2 guard pattern and a guard probe on a real PostgreSQL; Kysely types and catalogue pins; `P7_PERMISSIONS` additions; the OpenAPI changes of the row (the `/readyz` schema change and `/api/v1/admin/deployment`, ≈ 1), following the D-245 shared-file pattern (`p7-pending-arch-04.ts`, your `P7_*_PERMISSIONS` block, your `p7-operations.ts` block) checked with `pnpm openapi:lint`, with `p7-pending` lists for the implementers; advisory locks 730416–730417; ERD, data-dictionary and permissions-matrix sections. You are the only run editing the shared contract files in this wave.
4. **Handback** `docs/delivery/handbacks/DG7/T-DG7-ARCH-04-solution-architect.md`: the `--historical` result, time used, summary, open questions (quote sources), anything undone.

## Acceptance

- Both ADRs and §B/§F exist and cover the eleven requirements, with the drill split per clause (agent or orchestrator host), each clause mapped to a test and an owner. Integration tests (migrations and contract) pass on a disposable PostgreSQL; `pnpm -r typecheck`, `pnpm lint` and `pnpm openapi:lint` exit 0.
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.
