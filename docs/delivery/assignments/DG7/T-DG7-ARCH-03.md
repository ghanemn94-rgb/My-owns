# Assignment T-DG7-ARCH-03: slice E — backup, restore, upgrades and retention (solution-architect)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, at the current `HEAD`.
- **Preceding gate:** DG6 APPROVED (D-241). Run `node tools/gates/validate.mjs --historical --stage DG6` first and report it; it must exit 0.
- **Plan:** `docs/architecture/p7-plan.md` (adopted, D-243). Your task is its row **T-DG7-ARCH-03** in §4: read §1 (slice E), §3 (seams), §4, §5 and §6 (decided in D-243) first.
- **Time:** about 2 hours. **Disk is tight (about 4 GB free): never make a full extra checkout; delete your own temporary trees.** Run `date -u` at start and end; past about 100 minutes, finish the current section and write the handback with what remains.

## Environment

- Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline.
- The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `trading_agent/`.

## Deliverables

1. **ADR-0066** (backup and restore), **ADR-0067** (retention and archival) and **ADR-0068** (upgrades), exactly as scoped in the plan's ARCH-03 row, with the D-243 decisions (Q3 retention defaults `retain` with period "not set (IT to agree)", nothing in business, audit or snapshot classes is ever purged; IT approval is a **reference** text, never an approval by an agent; Q14 same-major restore) and D-245 (ADR-0064 manifest and attachment manifest, which the backup set reuses). Each ADR states what is built, by whom, how it is tested, and the honest residuals. No new runtime dependency.
2. **`docs/architecture/p7-work-split.md`**: append section §E only (never edit §1, §2, §A, §G, §C, §D): owners and file ownership, seams, exact EN and AR texts, test lists, and the clause each test proves, for REQ-S19-012, S19-013, S16-024 and S20-019.
3. **Schema and contract:** migrations from your range `0143`–`0149` (write from the low end; the rest is for implementers) with the P2 guard pattern and a guard probe on a real PostgreSQL; Kysely types and catalogue pins; `P7_PERMISSIONS` additions; the OpenAPI operations of the row (`/api/v1/admin/retention/classes`, `retention/runs`, `retention/archived`, `backups`, ≈ 9–10), following the D-245 shared-file pattern (`p7-pending-arch-03.ts`, your `P7_*_PERMISSIONS` block, your `p7-operations.ts` block) checked with `pnpm openapi:lint`, with `p7-pending` lists for the implementers; advisory locks 730410–730415; ERD, data-dictionary and permissions-matrix sections. You are the only run editing the shared contract files in this wave.
4. **Handback** `docs/delivery/handbacks/DG7/T-DG7-ARCH-03-solution-architect.md`: the `--historical` result, time used, summary, open questions (quote sources), anything undone.

## Acceptance

- The three ADRs and §E exist and cover the four requirements; the retention class registry covers every table (test-enforced) and the irreversible-migration catalogue classifies every migration, each clause mapped to a test and an owner. Integration tests (migrations and contract) pass on a disposable PostgreSQL; `pnpm -r typecheck`, `pnpm lint` and `pnpm openapi:lint` exit 0.
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.
