# Handback T-DG7-ARCH-R2 (solution-architect): the import load design (ADR-0064 §6 amendment)

- **Stage:** P7, gate DG7 (BUILDING). This is a repair task under p7-plan §5.3 (ARCH repair), decided in D-258 item 1.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-ARCH-R2-solution-architect-20261113T123838Z-6b764ba8","session_id":"6b764ba8-fcef-4dcc-9bb2-cce773db86df"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-ARCH-R2.md`. I verified its sha256 as `d72ed7b816e2d4cceea852c695fcf7836e465eba60a627c2a211147859d33c29`.
- **Base:** `9430663aa2681a2e776eb396ff8c46148edbf405` on `claude/mobily-transformation-platform-dg6-regate`. The tree was clean apart from this run's own directory. Nothing was committed.
- **Time (`date -u`):** I started at 12:38:49Z. The last `date -u` before this handback read 12:56:44Z. As DO-D noted, the sandbox clock runs slow, so these stamps understate the elapsed time. The work stayed within the time box.
- **Two gate systems.** These are engineering design records only. Nothing here grants or implies a G1–G6, Finance or IT approval, and nothing reads or writes a DG0–DG7 record.

## 1. Changed files

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0064-p7-migration-manifest-export-import-reconciliation-identity-rebind.md` | **Appended** the section "Amendment 1 (2026-11-13, T-DG7-ARCH-R2)", A1.1–A1.11. The approved text is unchanged: `git diff --numstat` shows 300 insertions and 0 deletions. |
| `docs/architecture/p7-work-split.md` | **Appended** `### C.12 BE-R1: the import load …` at the end of §C (after C.11), and `### B.6 DO-D2: complete and run the transfer drill …` at the end of §B (after B.9). No existing section was edited: 200 insertions, 0 deletions. |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-R2-solution-architect.md` | this handback |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-R2-evidence/*.log` | the logs of §3 |

No code, migration, contract or test was changed. Migration `0149` is specified for BE-R1 and has not been written.

## 2. The decision and why

### Options weighed (A1.1)

| Option | Verdict |
| --- | --- |
| (a) empty `audit_event` on the target before the load | needs the triggers off, which is a DG1 reopen, so rejected |
| (b) keep the target's rows and shift every carried `seq` by a recorded offset | verifiable, but it alters the stored `seq` of every source event, which breaks T-C8's "including `seq`" and D-243 Q4's "verbatim", so rejected |
| (c) BE-D's option c | drops source migration events, so rejected |
| (d) a target path whose migrations write no audit rows | would mean editing applied migrations, so rejected |
| (e) a separate archive table | already rejected by D-243 Q4 |

### Decision: (f), reserve the target's audit sequence

`mth-db migrate --reserve-audit-seq-for <package>` sets `audit_event_seq_seq` to `M + 1`, where `M` is the package's highest audit `seq`. It does this inside the transaction of the migration that creates the sequence (0003), when `audit_event` provably has no row, so the target's own migration events then start above the package. The effects:

- **Source audit rows load verbatim**, including `id` and `seq`. Nothing is renumbered, and T-C8 and D-243 Q4 hold as written.
- **The target's baseline events are kept** as they are.
- **The import's own events and all later use come after both.** The trail has one non-interleaving order: carried, then baseline, then post-import.
- **The cost is one preparation step on the target.** A plainly migrated target is refused, and the message names the remedy (check E3).

### What the amendment specifies

| Asked for | Where |
| --- | --- |
| the empty-target rule (which baseline rows are allowed) | A1.3 E1–E4. A baseline row is `source='migration'`, `actor_type='system'`, with no actor, organization or transformation. E1 lists the use indicators. The check runs under `LOCK TABLE audit_event IN EXCLUSIVE MODE`, inside the load transaction. |
| how source audit rows are carried | A1.4 L5: verbatim. A1.6 records the ranges on `migration_import`. |
| how the chain and the order are verified | A1.5: count and digest of `seq <= M`; the recorded baseline; the non-interleaving ranges; the triggers on |
| load order, sequence resets, holds | A1.4 L0–L12 (`audit_event` excluded from DISABLE and DELETE by name; sequences never lowered); holds at L11 |
| the `migration_import` record and the `migration.imported` event | A1.6 (seven columns, 0149), A1.7 |
| the post-import recheck rule (BE-D Q2) | A1.9. **Mode 1 (before use):** strict, except for audit additions and recorded rebinds. **Mode 2 (after use):** row by row against the package, with an allowance file. A table's added and changed keys must equal exactly what the drill lists. `audit_event` may only gain rows after the baseline. A fixed operational list, which never includes identity, approval, decision or financial tables, is counted. Anything else is a mismatch. |
| BE-E's `verify` output (BE-D gap 2) | A1.8 adopts BE-E's `mth-attachment-verify/1` as built, with the reader's refusals. A package with attachments can never be reconciled with `attachments_checked = 0`. |
| how each DG1 audit guarantee is preserved | A1.10, one row per guarantee |

The OIDC loopback exception that D-258 item 2 decided is placed in C.12 as BE-R1's (`packages/config/src/load.ts` and `oidc.ts`, T-R10).

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, offline, inside the run sandbox.

| Command | Exit | Log / output |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (at the start, before any edit) | **0** | `PASS gate DG6 (historical)` (`validate-historical-DG6-start.log`) |
| `pnpm -r typecheck` | **0** | `typecheck.log` |
| `pnpm lint` | **0** | `lint.log` |
| `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` (`openapi-lint.log`) |
| `npx prettier --check` on the ADR and the work split, after `--write` | **0** | (console) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (run after this handback was written) | **0** | "All matched files use Prettier code style!" (`prettier.log`) |
| `node tools/gates/validate.mjs --historical --stage DG6` (at the end) | **0** | `PASS gate DG6 (historical)` (`validate-historical-DG6-end.log`) |

**Not run:**
- the PostgreSQL tests: I wrote no code, so there is nothing to execute;
- `pnpm test`: no source change.

**What is not proven:** the design's claims about PostgreSQL behaviour are reasoned, not measured. Specifically:
- that `setval` inside 0003's transaction is enough;
- that `pg_stat_xact_user_tables` shows the transaction's own counters;
- that no deferred trigger event is queued while user triggers are disabled.

BE-R1's T-R2, T-R4 and T-R3 are the tests that measure these. If one of them fails, it is a design question for me, not a reason for a workaround.

## 4. Residual risks

1. **An operator might forget the preparation step.** E3 refuses with the remedy, and DO-D2 adds the guide section `#migration-import`. No data is at risk: the refusal changes nothing.
2. **Each migration seed's creation appears twice in the trail**, once in the source history and once in the target's baseline. Both events are true. The `seedRowsReplaced` field of `migration.imported` records the replacement.
3. **Mode 2 proves only what the allowance names.** The keys must come from API responses (B.6 DO-D2), never from "whatever is new". A reviewer can read `allowance.json`.
4. **`RECHECK_OPERATIONAL_TABLES` is a judgement.** A test excludes every identity, approval, decision and financial table from it. Adding a name needs the architect.
5. **E1 and E2 rest on ADR-0004's coverage rule**, plus the heartbeat and session indicators. T-R1 measures that a fresh target passes.
6. **0149 drops and re-adds a CHECK.** The migration catalogue may classify it as destructive. BE-R1 regenerates the catalogue and must not lower the class.

## 5. Not done, contradictions and open points

1. **Heading clash.** The assignment asks for `### B.6 DO-D2: …`, but §B already has `### B.6 Seams with other slices`. I followed the assignment's exact title, because existing sections may not be edited. The two headings have different Markdown anchors. I placed the new one at the end of §B, and its first paragraph points out the clash. **Orchestrator:** refer to it as "B.6 DO-D2" in DO-D2's assignment.
2. **Contract change.** C.12 asks BE-R1 for an additive contract change: seven nullable `MigrationImport` fields and `MigrationReconciliation.deltas[]`. DG7 is not approved, so no approved contract changes. The orchestrator may still prefer to defer it. Without it, the FE-B screen cannot show the deltas, although the CLI report would still show them.
3. **Files outside BE-R1's original slice.** C.12 assigns BE-R1 two files that belong to others:
   - a one-body switch in KBE-A's `tests/integration/transfer/financial-parity.test.ts`;
   - the one-line `vitest.config.ts` include (KBE-A Q2).

   Please confirm, or reassign them.
4. **BE-E's open questions:**
   - Q3: "refuse on other bytes" is compatible with the amendment.
   - Q2: an S3 target for the CLI.
   - Q1: the worker's S3 export.

   None is decided here. The drill uses the filesystem store.
5. **BE-D Q3–Q5:** the extra `line <k>` reasons, users with zero or several identities, and FE ownership. None is decided here. They don't affect the load.
6. **D-243 Q4 and T-C8 are unchanged** by this design. No decision record needs amending for the audit rows. **Orchestrator:** record the adoption of Amendment 1 in `decisions.md`; I can't write it.

## 6. Merge instructions

- Documentation only. No migration or contract change in this task.
- Order: BE-R1 (C.12) next, then DO-D2 (B.6 DO-D2). BE-R1 takes migration id `0149`, or the next free id at merge (D-245 O9).
