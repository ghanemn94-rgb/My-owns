# Handback T-DG3-ARCH-05: F-DG3-120, the `inheritedApproval` annotation on the gate list and gate view (solution-architect)

- **Stage:** P3 / DG3 (FIXING), repair before review round 2.
- **Assignment:** `docs/delivery/assignments/DG3/round-2/T-DG3-ARCH-05.md` (sha256 `f1ff57d6…8888f64`, verified at start).
- **Invocation:** run `DG3-T-DG3-ARCH-05-solution-architect-20261008T075606Z-9f5e1f99`, session `9f5e1f99-c0e4-47db-8adf-b572054a10ca`.
- **Worktree:** `/home/user/wt/dg3-arch-05`, branch `dg3/arch-05`, base `HEAD` `33f2ac0265310c409d9c0f31a212a6ca95ee996f` (the round-1 candidate `873115d9` plus the round-1 review records). The changes are **uncommitted** in the worktree, for the orchestrator to integrate.
- **Time:** started `2026-10-08T07:56:15Z` and finished `2026-10-08T08:27:22Z` (`date -u`).
- **Preceding gate:** before any write, `node tools/gates/validate.mjs --historical --stage DG2` printed `PASS gate DG2 (historical)` and exited 0. It was re-run at the end with the same result (`validate-dg2-historical.log`).
- **Concurrency (D-004):** I did not touch `eslint.config.js` or `packages/shared/src/formula/fuzz.test.ts` (KBE-D).

## The fix for F-DG3-120 (REQ-PB-004, Low)

ADR-0021 §5 promised that the gate list keeps showing a Modular gate as `draft` with an `inheritedApproval` annotation. That annotation is now built end to end. It is additive, and the ADR sentence was kept, not deleted.

1. **Contract** (`docs/api/openapi.yaml`, additive within v1).
   - `GateInstance`, the `gate` of every `GateView` (`listGates`, `getGate`, and the `configureGate` response, which returns the same view), gains `inheritedApproval`. It is required and nullable: a `GateInheritedApproval`, or `null` when the gate has none.
   - The new schema `GateInheritedApproval` is `{dispensationId, status, counts, approvingBody, approvedOn}`, with `additionalProperties: false`.
     - `status` is one of `pending_verification | accepted | rejected | revoked`. A dispensation in `pending` is shown as `pending_verification`.
     - `counts` is the sequencing rule's own verdict.
   - **Which one is shown when a gate has several:** the one that counts; otherwise the newest pending one; otherwise the newest.
   - No operation, path, status code or other field changed. `pnpm openapi:lint` still reports 270 operations, and the `contract.test.ts` pins did not move (it passed unchanged, 25 tests).
   - Zod mirror: `gateInheritedApproval` and `INHERITED_APPROVAL_STATUSES` in `packages/shared/src/schemas/gate.ts`, plus `gateInstance.inheritedApproval: gateInheritedApproval.nullable()`.
2. **API.**
   - `GateFactsProvider` (`workflows/g4.ts`) gains a third member, `inheritedApprovals(db, transformationId)`, which returns `InheritedApprovalFact[]`.
     - `server.ts` wires it with portfolio's new `loadInheritedApprovalFacts` (`portfolio/dispensations.ts`, exported by `portfolio/index.ts`).
     - `workflows` still never imports `portfolio`, so the module graph stays acyclic. `architecture.test.ts` passed.
     - `UNWIRED_GATE_FACTS.inheritedApprovals` returns `[]`, so with no wiring every gate carries `null`, which is the DG2 shape.
   - `counts` is not re-implemented. `loadInheritedApprovalFacts` calls the sequencing function `hasInheritedApproval` (Modular, accepted, evidence verified now) on each dispensation, using the `counts` that `loadDispensations` already evaluates.
   - `workflows/gates.ts`:
     - The new pure function `inheritedApprovalOf(facts, gateCode)` chooses and maps the annotation.
     - `toGateInstance(row, annotation = null)` carries it.
     - `gateView` receives the facts. The list route loads them once per request; the get and PATCH routes each load them once.
   - **What does not change:** `status`, `approvedAt` and `gate_decision` are untouched, and nothing writes. The G1–G3 (and G4) submission snapshots don't use `toGateInstance`, so they stay byte-stable.
3. **Web.**
   - `GatesPage.tsx` exports two new pieces:
     - `InheritedApprovalBadge`, a neutral `status-chip--unknown` chip with the `info` icon. It never uses the approved colour (`on-track`) or the check icon, and it sits in the same chip row as `GateStatusChip`.
     - `inheritedApprovalSource`, a visible line such as "Approved earlier by {body} on {date}; recorded as evidence, not as a decision on this gate."
   - `GateDetailPage.tsx` adds a labelled `Inherited approval` row next to the Status row. It holds the badge, the source line and a link to the Dispensations page.
   - Every badge text says that it does not approve the gate. For example:
     - 'Inherited approval: pending verification (does not approve this gate)';
     - 'Inherited approval: accepted, counts for sequencing (does not approve this gate)';
     - 'Inherited approval: accepted, does not count now (…)';
     - 'Inherited approval: rejected (…)' and '… revoked (…)'.
   - EN and AR keys are under `gates.inheritedApproval` in `i18n/{en,ar}/gates.json`. The Arabic uses the existing Dispensations terms (اعتماد موروث, مقبول, مرفوض, مُبطَل, يُحتسب في التسلسل).
4. **Records.**
   - ADR-0021 §5 has a new parenthetical sentence stating the contract field, its states, the `counts` rule, the selection rule and `null`.
   - `docs/architecture/p3-work-split.md` §9 has a new item 23, under "Amendments in the DG3 round-2 repair (T-DG3-ARCH-05)".

### How to verify

- **API:** `apps/api/test/integration/portfolio/dispensations.test.ts`, describe "the gate list and gate view inheritedApproval annotation (ADR-0021 §5; F-DG3-120)". The test uses a Modular world:
  1. No dispensation yet: G1 shows `inheritedApproval: null`.
  2. The office verifies a note evidence item, then the lead records an inherited approval for G1 with that **verified** evidence. G1 shows `{status: "pending_verification", counts: false, approvingBody, approvedOn, dispensationId}`.
  3. The synthetic Sponsor accepts it. G1 shows `accepted` and `counts: true`, and readiness reports `canSubmitInitiatives: true`.
  4. The Sponsor revokes it. G1 shows `revoked` and `counts: false`, and `canSubmitInitiatives` is `false` again.

  Every check through those four states asserts:
  - G1 `status` is `draft` and `approvedAt` is `null`, in both `listGates` and `getGate`;
  - the `gate_instance` row is `G1:draft`;
  - **zero** `gate_decision` rows exist;
  - G2–G6 carry `null`;
  - both bodies parse with the zod mirrors `gateList` and `gateView`.

  A second test checks that all six gates of an End-to-End transformation carry `null`. The contract test validates every gate response against the OpenAPI document.
- **Web:** `apps/web/src/pages/gates/inherited-approval.test.tsx` has 16 tests, 8 each in EN (LTR) and AR (RTL):
  - **Gates list:** one test each for G1 `pending_verification`, `accepted` with `counts` true, `accepted` with `counts` false, `rejected` and `revoked`. Each asserts:
    - the exact translated badge text;
    - the badge is next to the `draft` / 'Not submitted' (لم تُقدَّم) status chip;
    - `data-inherited-approval` and `data-counts` are set;
    - the chip is neutral, never `on-track`, and has no check-icon path;
    - no `[data-gate-status="approved"]` exists and no "Approved" text appears;
    - the source line is visible;
    - only G1 is annotated.
  - **Gate view:** the labelled `<dt>` row, the source line and the Dispensations link.
  - **No annotation:** neither the list nor the view shows a badge or a row.
- **Manually:** on a Modular transformation, record and accept an inherited approval for G1, then open Gates. G1 reads 'Not submitted' with the badge beside it.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/api/openapi.yaml` | `GateInstance.inheritedApproval` (required, nullable) and the new `GateInheritedApproval` schema |
| `packages/shared/src/schemas/gate.ts` | The zod mirror: `gateInheritedApproval`, `INHERITED_APPROVAL_STATUSES` and `gateInstance.inheritedApproval` |
| `apps/api/src/modules/workflows/g4.ts` | `InheritedApprovalFact`; the `GateFactsProvider.inheritedApprovals` member; the unwired loader returns `[]` |
| `apps/api/src/modules/workflows/index.ts` | Exports the `InheritedApprovalFact` type |
| `apps/api/src/modules/workflows/gates.ts` | `inheritedApprovalOf` (selection and mapping); `toGateInstance` carries the annotation; `gateView` and the GET, list and PATCH routes pass it |
| `apps/api/src/modules/portfolio/dispensations.ts` | `loadInheritedApprovalFacts`, with `counts` decided by `hasInheritedApproval` |
| `apps/api/src/modules/portfolio/index.ts` | Exports `loadInheritedApprovalFacts` |
| `apps/api/src/server.ts` | Wires `inheritedApprovals: loadInheritedApprovalFacts` into the `GateFactsProvider` |
| `apps/api/test/integration/portfolio/dispensations.test.ts` | Two new integration tests (the lifecycle above, and End-to-End `null`) |
| `apps/web/src/pages/gates/GatesPage.tsx` | `InheritedApprovalBadge` and `inheritedApprovalSource`; the badge beside the status on the list |
| `apps/web/src/pages/gates/GateDetailPage.tsx` | The labelled inherited-approval row in the gate view |
| `apps/web/src/i18n/en/gates.json`, `apps/web/src/i18n/ar/gates.json` | `gates.inheritedApproval.*` keys in EN and AR |
| `apps/web/src/test/p2fixtures.ts` | `gateViews()` sets `inheritedApproval` (`null` by default) and has the option `g1InheritedApproval` |
| `apps/web/src/pages/gates/inherited-approval.test.tsx` | New web unit test, EN and AR |
| `docs/architecture/adr/ADR-0021-p3-portfolio-initiative-lifecycle-g4.md` | §5: the sentence naming the contract field |
| `docs/architecture/p3-work-split.md` | §9 item 23 |
| `docs/delivery/handbacks/DG3/T-DG3-ARCH-05-*` | This handback and its logs |

## 2. Behaviour delivered

- **REQ-PB-004 / F-DG3-120.** A Modular inherited approval now appears on the gate list and the gate view as the `inheritedApproval` annotation, with status `pending_verification`, `accepted`, `rejected` or `revoked`, `counts`, the approving body and the date.
  - The gate's own status stays as recorded (`draft`), and no gate decision is created.
  - The web never renders it as approved.

  This is the behaviour ADR-0021 §5 describes. No other requirement's behaviour changed.

## 3. Checks actually run

The environment for every check:
- Node 24.21.0 from `/opt/nvm/versions/node/v24.21.0/bin`, offline;
- PostgreSQL 16.13, in disposable clusters;
- chromium from `/opt/pw-browsers` (`playwright install` was never run);
- ports 23700–23749 only.

Before the tests I removed the empty `apps/web/.claude/.cc-writes` directory and its empty parent, as instructed. The logs are in `docs/delivery/handbacks/DG3/T-DG3-ARCH-05-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG2` (start) | 0 | `PASS gate DG2 (historical)` | (console; repeated in row 12) |
| 1 | `pnpm -r typecheck` | 0 | all packages clean | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | built | `build.log` |
| 3 | `pnpm lint` | 0 | clean | `lint.log` |
| 4 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 270 operations` | `openapi-lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 6 | `pnpm --filter @mth/design-tokens run check:contrast` | 0 | pass | `contrast.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | 0 | 81 files, **1544 passed** | `unit-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | 81 files, **1544 passed** | `unit-c-utf8.log` |
| 9 | `QA_PG_PORT=23700 MTH_PORT_POOL=23701-23719 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | "applied 27 migrations to a fresh database"; 56 files, **793 passed**; `contract.test.ts` 25 tests passed | `integration.log` |
| 10 | `env -u LANG -u LC_ALL -u LC_CTYPE E2E_PG_PORT=23720 E2E_API_PORT=23721 MTH_PORT_POOL=23722-23749 E2E_SCREENSHOT_DIR=$TMPDIR/e2e-shots apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1 --reporter=list` | 0 | **168 passed (12.8 min)**: 84 chromium-en and 84 chromium-ar; PostgreSQL on 23720 and the API on 23721, both at attempt 1 (no retries) | `e2e.log` |
| 11 | During development: `npx vitest run src/pages/gates/` (web) and `with-pg.sh npx vitest run --project integration …/dispensations.test.ts` | 0 / 0 | 42 passed / 7 passed | (console only, superseded by rows 7–9) |
| 12 | `node tools/gates/validate.mjs --historical --stage DG2` (end) | 0 | `PASS gate DG2 (historical)` | `validate-dg2-historical.log` |

**Non-zero exits, failures and timeouts:** none. In `integration.log`, a grep for "timeout" matches 11 lines. All of them are the *names* or stdout of passing tests (`requestTimeout`, `connectionTimeoutMillis` and `idle_in_transaction_session_timeout` tests). None is a hook timeout or a failure.

## 4. Known gaps / notes

- **No dedicated e2e step for the badge.** The full product e2e suite ran and passed, but no Playwright spec asserts the badge itself. The real-stack behaviour is covered by the API integration test (row 9). The rendering is covered by the web unit test in EN and AR (rows 7–8). A Playwright step can be added in a later web or QA task if a reviewer wants the badge on a real screen.
- **The field is required and nullable, not optional.** The assignment specifies `null` when absent, which matches the house style (`approvedAt`, `currentSubmissionId`). It is still additive for consumers: a new response field, with no request schema or status change.
- **Selection rule.** When a gate has several inherited approvals (for example a rejected one, then a new one), the annotation shows the one that counts, else the newest pending one, else the newest. The rule is recorded in the contract description and in ADR-0021 §5. The Dispensations page still lists them all.
- **Pending shown as pending verification.** A `pending` inherited approval is shown as `pending_verification` even when its evidence is already verified: acceptance by a person other than the recorder is still outstanding. The contract's status description says so.
- **Untracked files I didn't create.** `git status` shows untracked home-directory files in the worktree root: `.bash_profile`, `.bashrc`, `.gitconfig`, `.zshrc`, `.mcp.json`, `CLAUDE.local.md` and others. I left them alone. They are not part of this change, and the prettier check passed with them present.

## 5. Merge instructions

- No migration and no seed change.
- **Shared types first.** Rebuild `@mth/shared` before typechecking `apps/api` and `apps/web` (`pnpm -r build`). `GateInstance` now requires `inheritedApproval`.
- **Possible conflicts:**
  - Another task building `GateView` / `GateInstance` fixtures, or object literals of `GateFactsProvider`, must add `inheritedApproval: null` or the `inheritedApprovals` member. Today the only literals are `server.ts` and `UNWIRED_GATE_FACTS`, both updated.
  - `apps/web/src/test/p2fixtures.ts` is shared with other web tests; the change adds one field and one optional option.
- **Disjoint from KBE-D.** No overlap with KBE-D's `eslint.config.js` or `packages/shared/src/formula/fuzz.test.ts`.
- **Review routing.** This is an engineering repair only. It grants no business, Finance or IT approval, and product gates G1–G6 never imply any DG gate. The finding closes only through a non-author reviewer's verification sidecar.
