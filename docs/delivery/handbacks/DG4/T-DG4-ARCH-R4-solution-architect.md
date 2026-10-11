# Handback T-DG4-ARCH-R4 (solution-architect): the gross/net basis (F-DG4-121) and the `GateView.canSubmit` description

- **Stage:** P4, gate DG4, review round 1 (repairs before round 2).
- **invocation_reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-ARCH-R4-solution-architect-20261011T005930Z-6073f3bb","session_id":"6073f3bb-0316-4f1c-bd78-6dfece48f12e"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-ARCH-R4.md`. Its sha256 `a061fdb7…66a7b9` was verified.
- **Base:** `f5579e7af2c793cd6dc5b529c9a88f33f815d785` on branch `dg4/arch-r4`. Before I started, `git status` showed no tracked changes.
- **Time:** started `Sun Oct 11 00:59:42 UTC 2026` and finished `Sun Oct 11 01:10:06 UTC 2026`, so about 11 minutes.
- **Changes are uncommitted**, as the assignment asks.

This is engineering text only. It grants no business, Finance or IT approval. Product gates G1–G6 and DG7 are not touched.

## 1. Changed files, and every changed line with its reason

### `docs/api/openapi.yaml` (description lines only; 6 lines)

| Line (new) | Member | Change | Reason |
|---|---|---|---|
| 21083 | `GateView.canSubmit` | description rewritten | Item 2. The old text ("holds gate.submit and every mandatory criterion is complete") was not the server's rule. The new text lists exactly the five conjuncts of `gateView` in `workflows/gates.ts`: `def.submissionEnabled`; `status !== "approved"`; every mandatory criterion is complete or covered by an accepted, unexpired `gate_exception` on the transformation's business date (`coveringExceptions`, ADR-0035 §4); `sequenceProblem` is null (no `gate.out_of_sequence`, with the Modular entry skip); and `gate.submit`. It also says what `canSubmit` does **not** evaluate (see §4 item 1). |
| 25014 | `BenefitTotalsCurrency.gross` | `description` added | F-DG4-121. Gross = `margin_uplift` + `cash_saving` + `working_capital_release` per state. `revenue_uplift` (top line) and `avoided_cost` (non-cash) are never in gross or net. `non_financial_valued` is never in gross. |
| 25031 | `BenefitTotalsCurrency.net` | `description` added | F-DG4-121. Net = that gross − `implementationCost.total`. Unknown, never 0. |
| 28253 | `FinanceValueLine.valueClass` | `description` added | F-DG4-121. States what `gross` and `net` lines are, on the new basis. |
| 28257 | `FinanceValueLine.drilldownHref` | description rewritten | ADR-0037 N2 item 3. A gross line no longer equals one drill-down's sum, so its href is `null`, as a net line's is, and its three class lines each drill. The old text said that every gross line carries an href. Under the new basis that text would have been false. |
| 28271 | `FinanceDashboard.lines` | `description` added | F-DG4-121. The basis of the gross and net lines on the Finance dashboard. |

**Schema unchanged.** I parsed the base and the new YAML (`yaml@2.8.1`), deleted every `description` key and compared the results: `IDENTICAL without descriptions`, exit 0. The same members, types, enums and required lists, and still 652 operations.

### `docs/architecture/adr/ADR-0030-p4-benefit-values-finance-validation-totals.md`

| Lines | Change | Reason |
|---|---|---|
| 101 | §7 item 6 heading: added "the gross basis is amended on 2026-10-11, amendment N1, which wins over this item" | Points readers of §7.6 to the amendment. The body of item 6 is not removed. |
| 210–242 | New section "Amendment (2026-10-11, T-DG4-ARCH-R4): the gross and net basis (F-DG4-121, D-117)", **N1** | F-DG4-121, D-117. It covers: the gap and the reviewer's example; the rule exactly (gross = margin + cash + working capital; revenue uplift (top line) and avoided cost (non-cash) are separate lines, never summed into gross or net; net = gross − implementation cost); Unknown handling; what is unchanged (the per-class lines, the validated totals); how labels name the basis; where the rule applies; the worked example (gross = net = 90.0000 instead of 435); and the owners. Cites M0172 and B0145. |

### `docs/architecture/adr/ADR-0037-p4-dashboards-t10-my-work-overview-header.md`

| Lines | Change | Reason |
|---|---|---|
| 322–349 | New section "Amendment (2026-10-11, T-DG4-ARCH-R4): the Finance dashboard's gross and net basis (F-DG4-121, D-117)", **N2** | It restates the §2 Finance row on the N1 basis (assignment item 1). It also records the consequence for drill-down: a gross line no longer equals `value.planned` / `value.validated`, so its `drilldownHref` becomes `null` and it resolves through its three class lines. It adds the invariant for KBE-R5 to test, the contract members whose descriptions changed, and "no codes or keys added". |

### `docs/delivery/handbacks/DG4/T-DG4-ARCH-R4-solution-architect.md`

This handback.

**Not changed:** code, tests, shared schemas, migrations, web i18n, other ADRs, delivery records.

## 2. Behaviour delivered

| Item | Requirement / finding | What is delivered |
|---|---|---|
| 1 | F-DG4-121 (REQ-S08-009, REQ-S08-011; M0172, B0145) | ADR-0030 N1 states the D-117 rule. ADR-0037 N2 applies it to the Finance dashboard. The contract descriptions of `BenefitTotalsCurrency.gross`/`.net`, `FinanceDashboard.lines`, `FinanceValueLine.valueClass` and `.drilldownHref` say the same. **This is text only.** The code still sums five classes until KBE-R5 lands. |
| 2 | FE-R3 handback wording note (`GateView.canSubmit`) | The description now matches `gateView` exactly (§1 line 21083). |
| 3 | Code table (continues from row 207) | **Not extended. No label key or code is added or renamed.** The API sends no label key for gross, net or a Finance line (`FinanceValueLine` has no `labelKey`, and gross and net are not `DashboardHeadline`s). The gross and net labels are web i18n keys, which belong to FE-R4. N1 item 6 gives the English meaning they must convey. |

## 3. Checks actually run

Environment: worktree `/home/user/wt/dg4-arch-r4`, Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, no database.

| # | Command | Result |
|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` (before any edit, and again at the end) | `PASS gate DG3 (historical)`, **exit 0** both times |
| 2 | `pnpm openapi:lint` | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 652 operations`, **exit 0** |
| 3 | `pnpm -r typecheck` | `apps/worker typecheck: Done`, `apps/api typecheck: Done`, **exit 0** |
| 4 | `pnpm lint` (`eslint . --max-warnings=0`) | no output, **exit 0** |
| 5a | `pnpm format:check` (`prettier --check .`) | **exit 2**, for an environment reason only: `[error] Unable to read file "CLAUDE.local.md": EACCES: permission denied`. That path is a character device (`crw-rw-rw- 1,3`, i.e. `/dev/null`) that the run sandbox bind-mounts at the worktree root. It is not tracked by git (`git ls-files --error-unmatch` fails). Apart from that file, prettier printed `All matched files use Prettier code style!` |
| 5b | `git ls-files -z \| xargs -0 pnpm exec prettier --check --ignore-unknown` (every tracked file, including the three changed ones) | `All matched files use Prettier code style!`, **exit 0** |
| 5c | `pnpm exec prettier --check` on the three changed files | **exit 0** |
| 6 | Schema-identity script: parse the base and the new `openapi.yaml`, strip every `description`, compare | `IDENTICAL without descriptions`, **exit 0** |
| 7 | `pnpm exec vitest run apps/api/src/modules/kpi/kpi.test.ts apps/api/src/modules/admin/branding.test.ts apps/api/src/modules/benefits/totals.test.ts` (unit tests that read `openapi.yaml`) | `Test Files 3 passed (3)`, `Tests 57 passed (57)` |
| 8 | `(cd apps/web && pnpm exec vitest run src/i18n/problems-slices-hijk.test.ts)` (the ADR-table guard; my amendments add no refusal table) | `Test Files 1 passed (1)`, `Tests 18 passed (18)` |
| 9 | `git diff --name-only` | only `docs/api/openapi.yaml`, ADR-0030 and ADR-0037. This handback is new and untracked. |

Integration, contract and e2e tests were not run. They need PostgreSQL and code changes, and this task changes neither code nor schema.

**Housekeeping:** the Edit tool's hook left an empty `docs/architecture/adr/.claude/.cc-writes` directory. I removed it with `rmdir`. It was untracked.

## 4. Known gaps, discrepancies and decisions for the orchestrator

1. **The assignment's premise about the Modular G3 waiver is not what the server does.** The assignment says that `canSubmit` "for a Modular G3, applies the waiver rule". At `f5579e7`, `gateView` does not evaluate the Modular links precondition at all. `assertModularLinks` (the blocking missing links and the G3 waiver) runs only inside `submitGate`. FE-R3's own handback confirms this: A03's `gate.modular_links_missing` refusal is "still sent and shown" with `canSubmit: true`. To keep the description exactly true, as the assignment requires, it describes the code as it is, and says explicitly that `canSubmit` does not evaluate that precondition and that `submitGate` can still refuse with 422 `gate.modular_links_missing` unless a waiver is in force. If the orchestrator wants `canSubmit` to include the Modular rule, that is a behaviour change for a backend task (BE), not a description change.
2. **The gross drill-down changes (contract-visible; KBE-R5 and FE-R4 must follow it).** Under N1, a gross line (three classes) no longer equals `value.planned` / `value.validated` (five classes). D-117 keeps those headlines and their drill-down unchanged ("validated totals unchanged"; REQ-S13-003). So the existing gross href would break the K1 item 4 sum invariant. The decision, without a schema change (ADR-0037 N2 item 3), is that the gross line's `drilldownHref` becomes `null`, as a net line's is, and the gross line resolves through its three class lines, each of which drills. This needs:
   - **KBE-R5:** `finance.ts` `grossNetLines`: `drilldownHref: null` on gross lines, the gross basis, the header comment ("exactly the Value area's headline" is no longer true), and the N2 item 4 invariant test.
   - **FE-R4:** the dashboard shows gross as "margin uplift + cash saving + working-capital release", with links to those three class lines.

   KBE-R5 and FE-R4 run concurrently and may not have assumed this. **Option, not taken (it would be a schema change):** make gross drillable by adding a `gross` value to the drill-down's `valueClass` parameter. That would be additive and would need its own assignment.
3. **How I read "validated totals unchanged" (D-117).** I read it as: what counts as validated, the overlap hold, the exclusions, and the T10 Value-area `value.planned` / `value.validated` headlines and drill-downs are unchanged, while **both** gross states (`planned` and `validated`) and both net states move to the new basis. N1 item 5 states this. The other reading, that `gross.validated` keeps all five classes, would make `net.validated` mix revenue and profit again, against M0172. If the orchestrator meant that reading, N1 needs a further amendment.
4. **An adjacent observation, outside D-117.** The T10 Value-area headlines "Planned value" / "Validated value" (`value.planned` / `value.validated`, also on the Executive and Finance dashboards) and the Value-area gap ratio and RAG still sum all five financial classes, revenue uplift and avoided cost included. D-117 keeps them unchanged, and so do N1 and N2. The round-2 domain reviewer may judge them against M0172 in the same way. I raise it here and make no change.
5. **No contract break.** DG4 is not approved, and `drilldownHref` was already nullable, so I raise no reopening of an approved gate. The meaning of the gross href does change, however (item 2).

## 5. Merge instructions

- No migrations, no code and no ordering constraint on the other repair branches. The only expected conflict is on `docs/api/openapi.yaml` and the ADRs, of which this task is the only writer (D-004).
- Merge before, or together with, KBE-R5 and FE-R4. Their F-DG4-121 changes must follow ADR-0030 N1 and ADR-0037 N2, including §4 item 2 above.
- After the merge, re-run `pnpm openapi:lint` (expect 652 operations) and KBE-R5's drill-down invariant tests.
