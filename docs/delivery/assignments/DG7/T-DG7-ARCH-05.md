# Assignment T-DG7-ARCH-05: slices I + H — traceability, in-app register, honest completion; handover documentation set (solution-architect)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, at the current `HEAD`.
- **Preceding gate:** DG6 APPROVED (D-241). Run `node tools/gates/validate.mjs --historical --stage DG6` first and report it; it must exit 0.
- **Plan:** `docs/architecture/p7-plan.md` (adopted, D-243). Your task is its row **T-DG7-ARCH-05** in §4: read §1 (slices I, H and J), §3 (seams), §4, §5 and §6 (decided in D-243) first.
- **Time:** about 2 hours. **Disk is tight (about 4 GB free): never make a full extra checkout; delete your own temporary trees.** Run `date -u` at start and end; past about 100 minutes, finish the current section and write the handback with what remains.

## Environment

- Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline.
- The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `trading_agent/`.

## Deliverables

1. **ADR-0071** (traceability and honest completion) and **ADR-0072** (handover documentation set), exactly as scoped in the plan's ARCH-05 row, with the D-243 decisions (Q7 guide languages: user and admin guides in EN and AR, IT and operator guides in EN with an Arabic summary, unchecked Arabic marked provisional; Q11 build-time register snapshot; Q19 rows completing with the DG7 gate or the seal recorded IMPLEMENTED with notes) and D-249 (the protocol-audit historic hits are disclosed in the known-limitations guide, generated from DO-I's report; DO-I already built `tools/release/protocol-audit.mjs`, so ADR-0071 records it, it does not re-specify it). ADR-0072 also absorbs D-247 O3 and O5 (the `security-controls.md` index line; matrix links to the deployment and backup guides). Each ADR states what is built, by whom, how it is tested, and the honest residuals. No new runtime dependency.
2. **`docs/architecture/p7-work-split.md`**: append sections §I, §H and §J only (never edit §1, §2, §A–§G): owners and file ownership, seams, exact EN and AR texts, test lists, and the clause each test proves, for REQ-S02-003, S02-005, S21-003, S19-011, S19-015, and how each of the 16 J rows is evidenced (DO-I tooling, records, the D-249 disclosure).
3. **Schema and contract:** migrations from your range `0153`–`0155` (none expected; a new permission code needs a seed migration, so prefer existing codes as ARCH-04 did, D-250 O1) (write from the low end; the rest is for implementers) with the P2 guard pattern and a guard probe on a real PostgreSQL; Kysely types and catalogue pins; `P7_PERMISSIONS` additions; the OpenAPI operations of the row (`/api/v1/admin/requirements` list and get, `/api/v1/admin/about`, ≈ 3), following the D-245 shared-file pattern (`p7-pending-arch-05.ts`, your `P7_*_PERMISSIONS` block, your `p7-operations.ts` block) checked with `pnpm openapi:lint`, with `p7-pending` lists for the implementers; advisory locks 730418–730419; ERD, data-dictionary and permissions-matrix sections. You are the only run editing the shared contract files in this wave.
4. **Handback** `docs/delivery/handbacks/DG7/T-DG7-ARCH-05-solution-architect.md`: the `--historical` result, time used, summary, open questions (quote sources), anything undone.

## Acceptance

- Both ADRs and §I/§H/§J exist and cover the five requirements and the 16 J rows; the release module (D-251 item 3) gets its guard table, each clause mapped to a test and an owner. Integration tests (migrations and contract) pass on a disposable PostgreSQL; `pnpm -r typecheck`, `pnpm lint` and `pnpm openapi:lint` exit 0.
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.
