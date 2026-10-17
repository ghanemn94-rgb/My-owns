# Handback T-DG5-ARCH-R3 (solution-architect): the last amendment references

- **Stage:** P5 / DG5 (BUILDING). Docs-only repair task under D-168.
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG5/T-DG5-ARCH-R3.md`, sha256 `b6e676e38cd83e02508cec834e7f09a38b175a0fd07e28cedb102c70420bcb5b`. Verified at the start: it matches.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-ARCH-R3-solution-architect-20261017T184154Z-c1e8ca41","session_id":"c1e8ca41-040b-459c-a578-4a19ae620127"}`.
- **Worktree:** `/home/user/wt/dg5-arch-r3`, branch `dg5/arch-r3`, `HEAD` `b4635521e9054deef117ce8f650c65f2ecfc37d7` (D-168 commit, W22 merged).
- **Time:** started `2026-10-17T18:42:06Z`, ended `2026-10-17T18:49:56Z` (`date -u`).
- **Changes are uncommitted**, as the assignment asks. I wrote only `docs/architecture/**` and this handback.
- **Two gate systems:** nothing here grants or implies a business, Finance or IT approval. Product gates G1–G6 and engineering gates DG0–DG7 are untouched. The seeded demo approval is synthetic. The playbook is described only as a synthesis inspired by PMI, Brightline and BRM, never as an official PMI standard.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0042-p5-procedure-definitions-instances-seeded-procedures-coverage.md` | V2, last block: replaces "decided by D-167, implemented by T-DG5-BE-T5 (W22) … not in this tree" with the adopted-step authorization as merged, with `file:line` evidence and tests. |
| `docs/architecture/adr/ADR-0043-p5-automation-engine-rules-executions-failure-queue.md` | S2: the `f78afff` sentence is marked as historical, and the D-167 bullet is brought to the built state (registry entry, sample, catalogue test, dry-run tests, registry test). |
| `docs/architecture/adr/ADR-0044-p5-starter-automations-approval-routes-notification-policy.md` | §7: two dated in-place corrections (slip key and `dependency.slipped` payload). The amendment header notes them. B4 is rewritten to the built state, and its defect bullet is kept as history. |
| `docs/architecture/adr/ADR-0046-p5-exporters-pdf-docx-xlsx-pptx-csv-fonts-rtl-injection-export-jobs.md` | New dated amendment E4: the export runner removes earlier attempts' files (D-QA-F2-3). |
| `docs/architecture/adr/ADR-0050-p5-demo-environment-roaming-dataset-reset-walkthrough.md` | New dated amendment: D5 (REQ-PB-090, the B0147 names and the literal-line test) and D6 (the seeded pending approval routed to `roaming.user.bo`). |
| `docs/architecture/data-dictionary.md` | The D-167 paragraph ("Who reads and acts on an adopted step") is brought to the built state with `file:line` evidence. |
| `docs/delivery/handbacks/DG5/T-DG5-ARCH-R3-solution-architect.md` | This handback. |

## 2. Item → amendment → evidence

All references are at `b463552` unless marked otherwise. I read each line in the merged tree before citing it.

| Item | Amendment | Evidence (`file:line`) |
|---|---|---|
| 1a. `dependency.slipped` v1 in `OUTBOX_EVENT_SCHEMAS` | ADR-0044 B4 (built state); ADR-0043 S2 | `packages/shared/src/schemas/events.ts:218` (entry), `:176–219` (registry), `:50–55` (schema); `apps/worker/src/queues/portfolio.ts:6`, `:8`; `apps/api/src/modules/automation/outbox-registry.test.ts:123`, `:149`, `:162`; `apps/api/test/integration/automation/dependency-slip-relay.test.ts:61–62` |
| 1a. its `samplePayload` | ADR-0043 S2; ADR-0044 B4 | `apps/api/src/modules/automation/samples.ts:165–170` (placeholder `T` = `SAMPLE_TRANSFORMATION_ID`, `:12`, `:16`); `samples.test.ts:49–50`; `apps/api/test/integration/automation/catalogue-sample-payload.test.ts:90–92` |
| 1b. adopted step authorized on its transformation | ADR-0042 V2 (last block); data dictionary D-167 paragraph | `apps/api/src/modules/procedures/steps.ts:409–414` (`adoptedTransformationOf`), `:417–429` (`stepTargets`), `:432–439` (`stepRoleTarget`), `:444–458` (`requireReadInAny`), `:464–493` (`requireInstanceOrAdoptedRead`), `:501–536` (`authorizeStepWrite`), `:1276–1285` and `:1293` (`openStep`), `:1400` (assign), `:1421–1431` (link evidence); `instances.ts:416–456` (inputs), `:464`, `:592`; test `apps/api/test/integration/procedures/adopted-step-authorization.test.ts:110`, `:111`, `:212` |
| 1c. export runner cleans earlier attempts' files | ADR-0046 E4 (new) | `apps/worker/src/reports/export-runner.ts:334–336` (`attemptStorageKey`), `:346–351` (`discardEarlierAttempts`), `:367` (at start), `:455` (at success), `:454` (own file on failure, unchanged); tests `export-runner.test.ts:24`, `apps/api/test/integration/reporting/exports-orphan.test.ts:88`, `:89`, `:142` |
| 1d. seeded pending approval routed to a demo role user | ADR-0050 D6 (new) | `packages/db/src/demo/data/roaming-states.ts:259–269`, `:280–345`, `:283–290`, `:292–312` (`:308–310`: Unknown due date), `:317–331`, `:332–344`, `:348`, `:355`; `roaming-ids.ts:59–61`; `packages/db/src/demo/coverage.ts:235–239`; test `apps/api/test/integration/environment/demo-pending-approval.test.ts:54`, `:55`, `:82`, `:110`, `:118` |
| 2a. §7 payload | ADR-0044 §7, dated correction (T-DG5-ARCH-R3) | `{slipId, dependencyId, transformationId, slipDays}`: `events.ts:50–55`; producer `apps/api/src/modules/portfolio/slip-events.ts:240–245` |
| 2b. §7 slip key | ADR-0044 §7, dated correction (T-DG5-ARCH-R3) | `<predecessor initiative id>:<milestone id>.<milestone version>`: `slip-events.ts:202` (`after` is the `SlipMilestoneState` with `id`, `initiative_id`, `version`, `:38–45`), header `:14–15`; `0075_p5_starters_routes_policies.sql:460–461` (comment), `:469` (length 1–200), `:480` (UNIQUE `(dependency_id, slip_key)`) |
| 3. REQ-PB-090 literal line | ADR-0050 D5 (new) | `packages/db/src/demo/data/kpis.ts:311`, `:356`, `:394`; `benefits.ts:109`, `:188`, `:224`; `roaming-chains.ts:34–37`, `:56`; `docs/source/playbook.md:696` (B0147); test `apps/api/test/integration/environment/demo-traceability-chains.test.ts:67–69` (the lines), `:136–166` (each chain), `:155` (the literal `join(" -> ")` assertion), `:169`, `:176` (negatives) |

## 3. Behaviour delivered (documentation)

- **REQ-S06-003 (ADR-0042 V2, data dictionary).** D-167's adopted-step authorization is now described as merged. The W21 statement `steps.ts:1142–1144` is kept and labelled as the W21 state.
- **REQ-S12-012 (ADR-0044 §7 and B4, ADR-0043 S2).** `dependency.slipped` v1 is registered, sampled and checked by the registry test. The §7 payload and slip key now match the schema and the merged code. Both corrections are dated and marked "T-DG5-ARCH-R3".
- **D-QA-F2-3 (ADR-0046 E4).** The cleanup of earlier attempts' files is described as merged.
- **REQ-S18-002 (ADR-0050 D6).** The seeded pending approval in `roaming.user.bo`'s inbox is described as merged.
- **REQ-PB-090 (ADR-0050 D5).** The line 'Low activation -> Proposition + journey -> Pass redesign + digital activation -> Attach rate / activation -> Revenue uplift' is recorded, with the test that asserts it literally.

## 4. Checks actually run (worktree `/home/user/wt/dg5-arch-r3`, sandboxed shell, Node from the environment)

| # | Command | When | Exit | Output tail |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` | start, 18:42Z | 0 | `PASS gate DG4 (historical)` |
| 2 | `git ls-files -co --exclude-standard -z -- docs/architecture \| xargs -0 npx prettier --check --ignore-unknown` | after the edits | 0 | `Checking formatting...` / `All matched files use Prettier code style!` |
| 3 | `node tools/gates/validate.mjs --historical --stage DG4` | end, 18:49Z | 0 | `PASS gate DG4 (historical)` |

No code, test or migration was changed, so no test suite was run. All test results quoted in the ADRs come from the W22 handbacks and D-168, and are attributed to them there. They were not re-run here.

## 5. Known gaps and notes

1. **Placement of items 1c and 1d.** The assignment lists the export-runner cleanup and the seeded approval under item 1, but no "decided by D-167 / not in this tree" sentence for them existed in `docs/architecture/`. I checked with grep for `D-QA-F2-3`, `QA-E2 O-1`, `T-DG5-BE-T5` and `W22`. So I recorded them as new dated amendments in their owning ADRs: ADR-0046 E4 (exports §5) and ADR-0050 D6 (seed coverage §5). Nothing else was moved.
2. **`0075` table comment.** `0075_p5_starters_routes_policies.sql:460–461` still says the slip key is `<predecessor initiative id>:<schedule version>`. That migration has been applied and is outside my write scope, so I did not edit it. ADR-0044 §7 now states the merged key and explains how it relates to that comment. The data dictionary's `slip_key` row (`data-dictionary.md:10621`) states only the CHECK constraint, so it is still accurate.
3. **ADR-0044 B2** keeps the shorthand `dependency.slipped {slipId, dependencyId, slipDays}` in its list of things that are "unchanged". I did not edit it, because the assignment names §7. B4 now says that the schema governs.
4. **The D-168 wording point.** `roaming.ts:669` sets each chain outcome's statement to the B0147 KPI text, and the comment at `:665` is no longer accurate. ADR-0050 D5 records this as D-168 does: a wording point, not a defect, outside the line. No code was changed.
5. **The relay negative control** was run only by the interrupted BE-T5 run. ADR-0044 B4 says so and does not cite it as fresh evidence.
6. **Untracked files.** The worktree's untracked top-level dotfiles (`.bashrc`, `.mcp.json`, …) are sandbox mount points, not mine. Do not integrate them.

## 6. Merge instructions

- Docs only: no migrations, no ordering constraints.
- **Concurrency.** T-DG5-AN-P5C writes only `docs/delivery/requirements.csv`, so no conflict is expected. These six `docs/architecture/` files are touched by no other running W23 task named in D-168.
