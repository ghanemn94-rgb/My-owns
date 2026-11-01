# T-DG6-ARCH-10 handback: ADR records of D-204 (as built), D-205 and migration 0123 (solution-architect)

- **Stage:** P6, gate DG6 (BUILDING). **Branch:** `claude/mobily-transformation-platform-dg5-regate2`, main checkout, `HEAD` `ff63e22156fc2c4f4c6f1bd7e735f3f012e5da1d`. The tree was clean except for this run's directory.
- **Invocation:** run `DG6-T-DG6-ARCH-10-solution-architect-20261101T050020Z-0e849f9b`, session `0e849f9b-4de7-4015-88bb-2fcccbcd6a10`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-ARCH-10.md`, sha256 `6d40b144…ccce127`, checked with `sha256sum`.
- **Time:** start `Sun Nov  1 05:00:31 UTC 2026`, end `Sun Nov  1 05:08:24 UTC 2026`.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited 0 at the start. It exited 0 again at the end (§4).
- **Changes are left uncommitted** for the orchestrator. Only documents were edited.
- **Approvals:** nothing here grants or records a business, Finance or IT approval. Nothing touches product gates G1–G6, and nothing reads or writes DG0–DG7.

## 1. Changed files

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0043-p5-automation-engine-rules-executions-failure-queue.md` | New amendment "2026-11-01, T-DG6-ARCH-10; D-204, D-205", sections G1–G4. Its preamble names the three ARCH-09 passages (E1 and E2) that it replaces. |
| `docs/architecture/data-dictionary.md` | The 0122 intro sentence now points to the new section. New section "P6 pre-freeze repair migration 0123 (DG6)": the column meanings, the five `source` values, the new index, the replaced function and the 0123 backfill. |
| `docs/architecture/erd.md` | The §1aa intro sentence and the §1aa.1 `source` list are updated. New §1aa.2 for 0123 (no new entity or relationship, so the diagram is unchanged). |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-10-evidence/format-check.log`, `openapi-lint.log`, `validate-dg5.log` | Check output. |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-10-solution-architect.md` | This handback. |

## 2. Items: applied or declined

I checked the facts against the merged code, not only against BE-X10's handback:
- `0123_p6_automation_rule_enablement_disable.sql`;
- `engine.ts` `candidates` (the ledger subquery, `DISABLE_SOURCES`, `r.enabled = true`, `published`/`superseded` for events only);
- `rules.ts` `setEnabled` (a no-op returns early; starters refuse disable);
- the "0123" catalogue test;
- the five test names in `automation-version-at-occurrence.test.ts`.

| Item (source) | Status | Where |
| --- | --- | --- |
| D-204 as implemented (BE-X10 §5 item 1, §2) | **Applied** | ADR-0043 G2 |
| The ledger records disables (0123), so its rows form the interval history (§5 item 2) | **Applied** | ADR-0043 G1 |
| The kill-switch choice (§5 item 3), confirmed by D-205 | **Applied** as decided | ADR-0043 G3 |
| The residual race (§5 item 4, §8), accepted by D-205 | **Applied** | ADR-0043 G4 |
| `disable` and `backfill_disable` in the data dictionary (§5 item 5) | **Applied** | data-dictionary "P6 pre-freeze repair migration 0123 (DG6)" |
| Migration 0123 in the data dictionary and ERD (assignment) | **Applied** | data dictionary, same section; erd.md §1aa intro, §1aa.1, §1aa.2 |
| ARCH-09's own open point: `enabled_from` on a disable row means "stopped at" | **Applied** (documented; no rename, because migrations are forward-only) | ADR-0043 G1; data dictionary 0123 column table |
| ARCH-09 consistency check (assignment) | **Done.** Three ARCH-09 passages had become untrue. Each is replaced explicitly by the G amendment's preamble, and the earlier text is kept, following the ADR convention "nothing above is removed": the E1 bullet "disabling writes nothing", the E2 "work in progress" paragraph, and the E2 open point that D-205 now decides. The 0122 sections of the data dictionary and ERD now point to the 0123 section, which wins where they differ. The rest of E1–E6 is consistent with D-204 and D-205: E2's constraints are met (G2), and E3–E6 are unaffected. | ADR-0043 G preamble; data dictionary 0122 intro; erd.md §1aa |
| BE-X10 §0: the missing `p6-work-split.md` section | **Not mine to fix.** Ownership is for the orchestrator. My assignment does not name that file. | — |

## 3. Points for the orchestrator

These are recorded, not decided by me:

1. **The race's worst case is a second execution, by a different version** (ADR-0043 G4). D-205 says "no action is taken against a rule the administrator had not enabled at occurrence". That is true. But if the same envelope is evaluated a second time after the late commit, through a relay redelivery or a retry, it can resolve a different version. The execution UNIQUE is per version, so that would be a second execution for the same event and rule. It needs both the overlap and a second evaluation, and it is untested. I documented it rather than understate it. If that outcome is not acceptable under REQ-S12-021, it is a reopen trigger.
2. **A consequence of the kill switch** (ADR-0043 G3), documented and untested. An event that occurred while the rule was enabled, was evaluated while it was disabled, and is evaluated again after re-enable can then be acted on, at most once per rule. A completed evaluate job has no operator replay path (§5/§6), so this happens only through a redelivery or a retry.

## 4. Checks actually run

Environment: Node 24.21.0, offline, main checkout.

| Command | Exit | Result |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` |
| `pnpm format:check` (after the last edit, this handback included) | 0 | "All matched files use Prettier code style!" (`T-DG6-ARCH-10-evidence/format-check.log`) |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` (`T-DG6-ARCH-10-evidence/openapi-lint.log`) |
| `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `PASS gate DG5 (historical)` (`T-DG6-ARCH-10-evidence/validate-dg5.log`) |

No code was changed, so I ran no typecheck, unit or integration tests.

## 5. Known gaps

- G3's re-evaluation consequence and G4's race are documented only. No test covers them (§3).

## 6. Merge instructions

- Documents only: no migration, no contract change, no dependency.
- The new text is appended (ADR-0043, data dictionary) or inserted as a new subsection (erd.md §1aa.2). Two sentences of the ARCH-09 data-dictionary and ERD sections were rewritten, and one register cell was extended.
- A conflict is unlikely: no concurrent task edits `docs/architecture/**`.
