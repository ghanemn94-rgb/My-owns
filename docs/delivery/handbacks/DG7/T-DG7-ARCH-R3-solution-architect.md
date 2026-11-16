# Handback T-DG7-ARCH-R3 (solution-architect): ADR-0064 Amendment 2 (shared baseline audit ids, the mode 2 allowance, the register snapshot under R2)

- **Stage:** P7, gate DG7 (BUILDING). This is the repair task of p7-plan §5.3 (D-259, repair round 2).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-ARCH-R3-solution-architect-20261113T141333Z-89613a69","session_id":"89613a69-7913-443f-b678-fab582b2ec75"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-ARCH-R3.md`. I verified its sha256 as `bca0d3cbe9ae8fa3ca3c155f26f1499ac0db799ab4695ed12f220beae660a94c`.
- **Base:** `ecd65f96b732e272780a82272164af6a760f6586` on `claude/mobily-transformation-platform-dg6-regate`. The tree was clean apart from this run's own directory. Nothing was committed.
- **Time (`date -u`):** start 14:13:43Z, end 14:31:24Z (after the final validation).
- **Two gate systems.** Nothing here grants or implies a G1–G6, Finance or IT approval. Nothing reads or writes a DG0–DG7 record.

## 1. Changed files

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0064-p7-migration-manifest-export-import-reconciliation-identity-rebind.md` | Appends the dated section **Amendment 2** (A2.1–A2.10). No earlier text was changed; `git diff --numstat` shows 228 lines added and 0 deleted. |
| `docs/architecture/p7-work-split.md` | Appends `### C.13 BE-R2` at the end of §C and `### B.7 DO-D3` at the end of §B. No existing section was edited; `git diff --numstat` shows 127 added and 0 deleted. |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-R3-solution-architect.md` | this handback |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-R3-evidence/*.log` | the scan measurement and the check logs (§3) |

## 2. Decisions (behaviour delivered as design; nothing is implemented by this task)

### 2.1 R1: carried audit ids equal to target baseline ids (A2.1–A2.5, A2.7)

**Fact that changes D-259's wording.** On the two copies of a shared-id migration event, `seq` (`GENERATED ALWAYS`; the A1.2 reservation puts the target's above `M`) and `occurred_at` (`DEFAULT now()`) necessarily differ. BE-R1 measured this (handback §5). So "every column byte-identical" would refuse every import.

**Options weighed:**
- (a) D-259 literally: refuses every import.
- (b) Insert under a new id: renumbering.
- (c) Skip silently: loses data.
- (d) Load the trail before `0068` runs: `0068`'s own INSERT then fails.
- (e) Replace the baseline copy: a DG1 reopen.
- (f) **Chosen:** content identity over the 13 non-database-assigned columns, plus the baseline predicate on both copies.

**Decision (f).**
- A shared-id carried row is accepted only when it is the same event: the 13 columns are identical under the §2.3 encoder, and both copies are migration baseline rows.
- It is then **not inserted**, counted as `already_present`, stored as `migration_import.audit_already_present_rows`, and written as a delta `audit_already_present`.
- Its source `seq` and `occurred_at` are recorded **inside the trail**, in `migration.imported` `auditAlreadyPresent`. They are therefore protected by the DG1 triggers and travel with any later export.
- Reconciliation rebuilds the source's `audit_event` file from the live rows plus that record and requires the manifest's `contentDigest`, which covers every column. This also proves the recorded values.
- Any difference exits 1 with the A2.7 lines, and nothing changes.
- Schema follow-up: migration `0150` (one column, a widened `basis` CHECK); additive contract fields.

**DG1:** A2.9 re-checks every A1.10 guarantee. The design uses no UPDATE, DELETE or TRUNCATE, and both triggers stay on. The only new rows are the import's own events. No `seq` is reassigned. D-259's escalation condition is not met.

### 2.2 The mode 2 allowance (A2.6)

**Options weighed:**
- the operational list: "ignore the table", rejected;
- count-only expected deltas: cannot tell rows apart, rejected;
- "whatever is new": proves nothing, rejected;
- **chosen:** key-by-key explanation through the database-enforced audit trail.

**Why the audit trail can carry this.** `p2_audit_required` (0010 and 0120) refuses at COMMIT every audited row write that has no matching `audit_event` (`record_type`, `record_id`, `new_version`).

**What `mth-recheck-allowance/2` adds:**
- `actors`: journalled sign-ins, resolved on T.
- `audited`: each added or changed row needs an event after the baseline, by a listed actor (or on their behalf), at the row's version. `mustInclude` keeps the API-returned keys mandatory.
- `children`: FK children of explained parents, through a named constraint, acyclic.

All of these stay strict. No row may be missing, and every refusal has an exact line. The never-operational tables can use these three key-by-key forms, but never `operational`.

### 2.3 DO-D2 gap 1: register snapshot under R2 (A2.8)

**Measured:** exactly 2 T1 hits over the 412 rows, both R2. They are REQ-DLV-006 (`procedure`) and REQ-DLV-023 (`notes`). Evidence: `T-DG7-ARCH-R3-evidence/register-t1-scan.log`.

**Options weighed:**
- **Neutralise in the builder: rejected.** It breaks ADR-0071 §2.2, T-I1 and `getRequirement`'s "every column verbatim", and it hides from the scanner what the scanner is for.
- **An R2 `file`+`sha256` allow-list entry: rejected.** ADR-0062 §8 permits it, but it goes stale at every register edit; a path-wide entry would weaken R2.
- **Chosen:** reword the two fields at the source (exact replacement strings in A2.8), plus the early guard T-R16 in `register-snapshot.test.mjs` using `scanLine`.

Measured in memory: after the rewording there are 0 hits (`register-t1-scan-reworded.log`). ADR-0062 and ADR-0071 are unchanged.

## 3. Checks actually run (Node 24.21.0, offline, `MTH_PNPM_OFFLINE=1`)

| Command | Exit | Result / log |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (**first**, before writing) | **0** | `PASS gate DG6 (historical)` |
| T1 scan of the register fields (`scanLine` + `parseRegister`, inline `node --input-type=module`) | 0 | `register-t1-scan.log`: 2 hits (R2, REQ-DLV-006 and REQ-DLV-023) |
| The same after the A2.8 rewording, applied in memory only | 0 | `register-t1-scan-reworded.log`: 0 hits |
| `npx prettier --check` on the ADR and on the work split, after editing | 0 | `All matched files use Prettier code style!` |
| `pnpm -r typecheck` / `pnpm lint` / `pnpm openapi:lint` | see §3a | `typecheck.log`, `lint.log`, `openapi-lint.log`, `exits.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | see §3a | `prettier.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` (end) | see §3a | `validate-historical-DG6-end.log` |

§3a, the final results, follows at the end of this file.

Not run: any test suite. This task changes no code, so there was nothing new to test.

## 4. Known gaps, residual risks and open questions

1. **A2.10 residual 1 narrows D-243 Q4's "verbatim" and T-C8's "including `seq`"** for the shared migration events only (44 by reading `0068`, `0069` and `0095`; BE-R2 measures the exact number). Their source `seq` and `occurred_at` are recorded and proven, not stored in the row. **Orchestrator:** record this in `decisions.md`.
2. **The register rewording (A2.8 item 1) needs a requirements-analyst assignment.** I cannot write `requirements.csv` as its owner. Until it lands, BE-R2's T-R16 fails by design, and DO-D3's T-B11 D0 fails.
3. **Heading clash.** `### B.7 DO-D3` clashes with the existing "B.7 Integration order", as B.6 DO-D2 did (accepted in D-259). The section says so.
4. **`audit_explained` trusts the actor list** (A2.10 residual 3). **`child_of`** cannot see transaction boundaries (residual 4).
5. **The 13-column list depends on `audit_event` keeping 15 columns.** C.13 makes BE-R2 pin this with a test.
6. **The allowance format moves to `/2`.** DO-D2's `allowance.mjs` writes `/1`, so DO-D3 must move it (B.7). `/1` was never parsed by any built code.
7. **New CLI `mth-db table-digest`** (read-only, `mth_app`, exported tables only), for DO-D2 gap 6. It is a new operator-facing command, not an API operation.

## 5. Merge instructions

- Documentation only. No migration, contract or code change in this task. Expect no conflicts: the work-split additions are new sections placed before `## §D.` and `## §F.`.
- Order: the analyst rewording (A2.8) and BE-R2 (C.13) can run in parallel; DO-D3 (B.7) runs after both.

## 3a. Final check results

| Command | Exit | Tail |
| --- | --- | --- |
| `pnpm -r typecheck` | **0** | `typecheck.log` |
| `pnpm lint` | **0** | `lint.log` |
| `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | `All matched files use Prettier code style!` (`prettier.log`). It ran after this section was written; its exit code is in `exits.log`. |
| `node tools/gates/validate.mjs --historical --stage DG6` (end) | **0** | `PASS gate DG6 (historical)` (`validate-historical-DG6-end.log`). It ran after this section was written; its exit code is in `exits.log`. |

If `exits.log` shows anything other than 0 for the last two rows, this table is wrong and the log is authoritative.
