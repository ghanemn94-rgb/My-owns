# Handback T-DG5-ARCH-R4 (solution-architect): the round-1 repair amendments

- **Stage / gate:** P5, DG5, FIXING after review round 1 (D-170).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-ARCH-R4-solution-architect-20261018T073528Z-4ae2971a","session_id":"4ae2971a-8cd6-4fe7-811d-096869cce109"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-ARCH-R4.md`, sha256 `a8d40b9e…50d59fb` (checked before reading; it matches).
- **Working tree:** `/home/user/wt/dg5-arch-r4`, branch `dg5/arch-r4`, `HEAD` `9c96ee32cff2b81a7aae663495423e7b645aad63` (the V1 merge). The changes are **uncommitted**, as instructed.
- **Time:** `date -u` gave `Sun Oct 18 07:35:41 UTC 2026` at the start and `Sun Oct 18 07:48:17 UTC 2026` at the end of the checks.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited 0, at the start and at the end.
- **No approval was granted.** These are documentation amendments. A configuration review is not a business approval. The demo's G1–G4 decisions are synthetic and approve nothing real. G1–G6 stay separate from DG0–DG7, and nothing here calls the playbook or the product an official PMI standard.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0039-p5-studio-configuration-model-publish-pipeline.md` | Item 1. New dated amendment F1–F6 (`:260`). Short dated in-place pointers in §5 (the review bullet) and the §9 table row "decide review". |
| `docs/architecture/adr/ADR-0043-p5-automation-engine-rules-executions-failure-queue.md` | Item 1. New dated amendment F1–F5 (`:249`). In-place pointers in §4 (the "Review where configured" bullet) and the §8 table row. |
| `docs/architecture/adr/ADR-0042-p5-procedure-definitions-instances-seeded-procedures-coverage.md` | Item 2. New dated amendment V4 (`:311`). In-place pointers in §3, in V2 "Link evidence" and in the V3 refusal bullet. The §9 table: the "complete" row is amended, and a "link evidence" row is added. |
| `docs/architecture/adr/ADR-0050-p5-demo-environment-roaming-dataset-reset-walkthrough.md` | Items 3 and 4. New dated amendment D7–D10 (`:310`). An in-place pointer in §4. The stale line references in D5 and D6 are corrected in place, each marked "corrected 2026-10-18". |
| `docs/architecture/data-dictionary.md` | Item 5. New section "P5 repair migration 0097 and the round-1 repairs (DG5)" (`:12260`). It covers the two tables, the 16 triggers on earlier tables, the 7 functions, the refusal mapping, the backfill, the `procedure_instance_link` API read rule and the demo gate history. Dated in-place notes: the `config_review_request_guard()` row, the `config_review_request` and `automation_rule_version` trigger lists, the `automation_rule_version_review_sod` CHECK, the `procedure_instance_link` triggers, and the D-167 evidence-link reference. |
| `docs/architecture/erd.md` | Consistency with item 5. New §1s (`:1926`): the two contributor tables and their relationships. Additive only. The `a09` QA test only searches the ERD for table names. |
| `docs/architecture/p5-work-split.md` | BE-V1 §5's last bullet. Two dated parentheticals spell out "author" in the S06-007 and S12-002 test lines. |
| `docs/api/openapi.yaml` | Item 6, **description text only**. `ProcedureStepComplete.description` gets the read rule. The `decideConfigReview` summary gets the author definition. No operation, schema or response changed. |
| `docs/delivery/handbacks/DG5/T-DG5-ARCH-R4-solution-architect.md` | This handback. |

## 2. Item → amendment → evidence (merged tree `9c96ee3`)

| # | Item | Amendment | Evidence (`file:line`) |
|---|---|---|---|
| 1a | **Author definition** (ADR-0039 §1/§5/§9) | ADR-0039 F1, F2; the §5 and §9 pointers | `apps/api/src/modules/methodology/contributors.ts:23–31` (`configAuthors`: the creator plus the contributors); `packages/db/migrations/0097_p5_config_review_contributors.sql:51–61` (the table), `:114–152` (the two recording functions), `:155–182` (the content triggers), `:250–277`, `:295–300` (the backfill and its audit) |
| 1b | **Reviewer is never an author or the requester: API** | ADR-0039 F3 | `methodology/reviews.ts:334–340` (lock, then 403 `config_review.self_review`); `automation/lifecycle.ts:337`, `:340–341` (403 `automation_rule_version.self_review`) |
| 1c | **The same in the database** | ADR-0039 F3; ADR-0043 F2 | `0097:211–223` (`config_review_request_reviewer_not_contributor`), `0097:226–240` (`automation_rule_version_reviewer_not_contributor`); `apps/api/src/modules/platform/db-errors.ts:2626–2628`, `:2712–2719` (the mappings) |
| 1d | **Review tasks skip every author** | ADR-0039 F4; ADR-0043 F4 | `methodology/revision-impact.ts:310` (first round); `methodology/reviews.ts:289–294` (a later round); `automation/lifecycle.ts:257–261` (`submitVersion`) |
| 1e | **BEFORE-trigger ordering** | ADR-0039 F5; ADR-0043 F3; data dictionary "Firing order" | `0097:205–210`; `packages/db/test/integration/catalogue.test.ts:850` (the trigger list); `apps/api/test/integration/methodology/studio-coauthor-review.test.ts:338`; `apps/api/test/integration/automation/rule-coauthor-review.test.ts:226` |
| 1f | **Rule-version authors** (ADR-0043 §4/§8) | ADR-0043 F1–F5; the §4 and §8 pointers | `automation/lifecycle.ts:104–122` (`versionAuthors`); `0097:63–73`, `:185–202`, `:279–293`, `:301–305` |
| 2a | **Output read rule, every mode** (ADR-0042 §3, V3) | ADR-0042 V4; the §3 and V3 pointers | `apps/api/src/modules/procedures/outputs/kit.ts:115` (`OUTPUT_READ_PERMISSION`), `:124–137` (`requireOutputRead`), `:243–250` (every adapter), `:144–157` and `steps.ts:1341–1344` (the generic link) |
| 2b | **The evidence link** (BE-V2C) and the sibling paths | ADR-0042 V4; the V2 pointer | `steps.ts:1420–1442`, the read at `:1439`, before `insertLink` at `:1440`; the adopted-step check now at `:1426–1434`; the only link writer is `insertLink` at `steps.ts:680` |
| 2c | **Re-checked in the completing transaction** | ADR-0042 V4 | `steps.ts:1287` (`lockAndLoad` in `openStep`), `:517` (`refreshPrincipal` in `authorizeStepWrite`) |
| 2d | **422 `output_record_invalid`, audited as `authorization.denied`, nothing linked or adopted** | ADR-0042 V4 | `outputs/kit.ts:133–135` (the refusal plus `withDenial`); `apps/api/src/modules/access/denials.ts:23`; `steps.ts:1348`, `:1364` (link and adoption come after the check); tests `output-read-authorization.test.ts:107`, `:151`, `:170` and `evidence-link-read-authorization.test.ts:114`, `:151`, `:211`, `:227` |
| 2e | **§9 authorization table** | ADR-0042 §9 (the amended row and the added row) | as 2a–2d |
| 3a | **Demo created in Diagnose, advanced to Transform** | ADR-0050 D7; the §4 pointer | `packages/db/src/demo/data/roaming.ts:230`; `roaming-gates.ts:709` (the phase advance), `:761–769` (module `roaming.gates`, order 550), `:489–515` (the seed's own refusals) |
| 3b | **G1–G3 complete on seeded evidence; G4 complete except two accepted exceptions, with expiry; G5/G6 not submitted** | ADR-0050 D7, D8 | `roaming-gates.ts:231` (`seedGateEvidence`), `:136–167`, `:169`, `:457` (the exceptions; expiry = synthetic clock + 730 days = 2028-08-31), `:423–434` (the Finance baseline validation); `apps/api/test/integration/environment/demo-gate-history.test.ts:60`, `:164`, `:167` |
| 3c | **Synthetic label on each decision** | ADR-0050 D7 | `packages/db/src/demo/data/finance.ts:30`; `roaming-gates.ts:48–50`, `:642` (the rationale), `:150`, `:161` (the exception reasons) |
| 3d | **What the seed does not emit** | ADR-0050 D7 | `roaming-gates.ts:23–25` (no `gate.submitted`/`gate.decided` outbox events); no automation request execution (BE-V3 handback §8 item 4: no code seeds it); audit actor system/`cli` (`roaming-gates.ts:180–213`, `change`) |
| 3e | **Stale line references corrected** | ADR-0050 D10, plus the corrections in place in D5 and D6 | `roaming.ts:672`, `:676`; `roaming-states.ts:264–274`, `:285–350`, `:288–295`, `:297–317`, `:313–315`, `:322–336`, `:337–349`, `:353`, `:360`. Six of these were **not** in BE-V3's list; I found them shifted by the same +5 and corrected them too. |
| 4 | **Gate readiness line** | ADR-0050 D9 (no ADR or dictionary text stated it; `grep` for "mandatory outputs complete", "readiness line" and "readiness banner" under `docs/architecture` found nothing) | `apps/web/src/pages/gates/GatesPage.tsx:97–125`; `GateDetailPage.tsx:102`, `:242`; `apps/web/src/i18n/en/gates.json:40–41`, `ar/gates.json:40–41` |
| 5a | **Data dictionary: the contributor tables, functions, triggers and guard rows** | data dictionary `:12260` onwards, plus the in-place notes | `0097:51–73`, `:77–152`, `:155–240`, `:242–247` (the grants); `catalogue.test.ts:850` (all 20 triggers) |
| 5b | **Data dictionary: the API read rule on `procedure_instance_link`** | the dictionary section "`procedure_instance_link`: the API's read rule", plus the note under the table's triggers | as 2a–2d |
| 6a | **OpenAPI: `ProcedureStepComplete` description** | the read rule (text only) | `docs/api/openapi.yaml`, the `ProcedureStepComplete` schema (`:26226`) |
| 6b | **OpenAPI: `decideConfigReview` summary** | "never an author (the draft's creator or any person recorded as having written part of its content) or the requester" | `docs/api/openapi.yaml:17579` |

## 3. Checks actually run

Environment: Node 24.21.0, offline, in the worktree above.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` |
| 2 | `git ls-files -co --exclude-standard -z -- docs/architecture docs/api \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `Checking formatting...` / `All matched files use Prettier code style!` |
| 3 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` |
| 4 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` |

Not run: no product test suite. This task changes no code. The OpenAPI edits are description strings only, and I found no test that pins a hash of `openapi.yaml` (the references I found are comments). The `contract/contract.test.ts` integration run belongs to the orchestrator's merged-tree verification (D-164).

## 4. Known gaps, discrepancies and things not done

1. **"The next decision" after D-170 does not exist.** `docs/delivery/decisions.md` has no D-171 (D-170 is the newest entry, at line 7). I worked from D-170 and the handbacks only. The open questions the handbacks raised are therefore stated as open, not decided:
   - BE-V2C item 7: the launch's `subjectRecordId` is not read-checked (ADR-0042 V4, "Open").
   - BE-V1 §7 item 2: the `benefit_formula` path and the `methodology_migration` approval (ADR-0039 F6).
   - BE-V2's `linkEvidence` observation is **closed** by BE-V2C as merged.
2. **A precision correction to BE-V1's wording.** BE-V1 §2.4 says the author's direct rule-version decision now hits the new constraint before the 0074 CHECK, "the same refusal, and it maps to the same 403". In the merged code the 0074 CHECK `automation_rule_version_review_sod` has **no** mapping in `db-errors.ts`: the API refuses first (`db-errors.ts:2690–2692`). Only the new constraint maps to 403 (`:2712–2719`). ADR-0043 F2 and F3 state it that way.
3. **The demo G4 readiness line was not rendered by anyone on the merged tree.** FE-V1B could not render it, because BE-V3's seed was not in its tree. ADR-0050 D9 gives the text the code is expected to show and says it is still to be checked.
4. **ADR-0042 V2's other `steps.ts` references** (for example `adoptIntakeTransformation` `:722`, `:745`) read at the commits V2 names (`f78afff`/`b463552`). I corrected only the evidence-link reference that this fix touches, and did not re-base the rest. That was outside the items assigned.
5. **ADR-0035 is unchanged.** FE-V1B says its §4 web note "could" mention the covered count. Item 4 asks for an update only where a statement exists, and none does.

## 5. Merge instructions

- Documentation only: no migration and no ordering constraint.
- Expected conflicts: none. Only `docs/architecture/**` and description strings in `docs/api/openapi.yaml` changed.
- The untracked dotfiles at the worktree root (`.bashrc`, `.vscode`, `.mcp.json`, …) were there before this task and are not part of it.
- F-DG5-100, 101 and 120 close only through their reviewers' round-2 verifications. This handback closes nothing.
