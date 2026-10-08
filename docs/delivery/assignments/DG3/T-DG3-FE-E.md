# Assignment T-DG3-FE-E: P3 UI completion: funding decisions, capacity editing, deliverables, milestones and waves, audit labels (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P3 "Mobilization and portfolio" / gate DG3 (BUILDING).
- **Working tree:** a **separate git worktree** prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg3/fe-e`, at the integrated `HEAD`:
  - every P3 backend task is merged; all 270 contract operations are routed and G4 is enabled (`0026`);
  - every P3 screen is merged (FE-A0, FE-A, FE-B, FE-C).

  `node_modules` is installed and the packages are built.
- **Concurrency (D-004):** ARCH-04 runs alongside you in its own worktree. It owns the contract and ADR follow-ups, migration `0027`, and `apps/api/src/modules/kpi/calculations.ts`. Stay out of `apps/api/**`, `packages/**` and `docs/**`, except your handback.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. Work in the order below. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback listing what remains.

## Environment

- Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23850–23899 only**: `QA_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL` for `apps/web/e2e/support/with-stack.sh`.
- Remove any empty `.claude/.cc-writes` directories inside source folders before you run tests.

## Why this task exists

The wave-4 screens left out four write paths that the DG3 requirements need. Each task's handback states what it left out:

- **Funding decisions.** No screen records one (REQ-S09-003, REQ-S04-006). FE-A built selection; nobody was assigned the funding dialog.
- **Capacity editing.** Resource roles, capacity rows, and demand create/edit are missing (REQ-PB-059). FE-B handback §5.
- **Deliverables and milestones.** No screen creates them (REQ-PB-045's "Key deliverables 3–7", REQ-S09-006). FE-A handback §5.8, FE-B.
- **Waves.** No screen edits a wave's planned dates, owner or labels, or adds a non-source wave (ADR-0023 §1).

## Ownership (this task)

The wave-4 FE tasks are done, so their folders are yours for these additions.

**You may edit:**
- `apps/web/src/pages/{portfolio,roadmap,capacity}/**`;
- `apps/web/src/lib/auditChanges.ts` and its test;
- `apps/web/src/components/RecordDialog.tsx` (only the namespace prop in item 6);
- the matching i18n files: `portfolio`, `roadmap`, `capacity`, and the audit keys in `transformations` (EN and AR);
- a **new** e2e spec, `apps/web/e2e/p3-ui-completion.spec.ts`, and its screenshots `apps/web/e2e/screenshots/{en,ar}/p3-completion-*.png`.

**Do not edit:** any other e2e spec, `app/**`, `api/**`, or `i18n/index.ts`.

## Binding design (read first)

- **The handbacks:**
  - `docs/delivery/handbacks/DG3/T-DG3-FE-A-frontend-ux-engineer.md` (§2, §5);
  - `T-DG3-FE-B-frontend-ux-engineer.md` (§2, §4, §5);
  - `T-DG3-BE-E-backend-workflow-engineer.md` (§2 endpoints, §7 decisions and codes: the deselect rule, `funding.not_revocable`, `funding.amount_invalid`, the `resource_demand.*` codes and commit authority);
  - `T-DG3-ARCH-03-solution-architect.md` (delegation refused);
  - `T-DG3-FE-A0-frontend-ux-engineer.md` §3–§5 (seams, `p3Keys`, `useP3Refresh`, `client.ts`).
- **The ADRs:**
  - ADR-0021 §3 (`selected → funded`, revoke) and §6 (business approvals, in person, no on-behalf);
  - ADR-0023 §1 (waves: editable columns, non-source waves), §2 (milestones and deliverables), §6 (capacity and the conflict rule) and §7 (funding decisions);
  - ADR-0009.
- **The contract,** `docs/api/openapi.yaml`, and the zod mirrors in `@mth/shared/schemas`.
- **The DG2 web rules, binding:**
  - bilingual AR-RTL and EN-LTR, translated at render time, with problem codes translated;
  - one form-level alert per form, with inline field errors;
  - session-bound actions through `auth/sessionBound.ts`, imported directly;
  - decimal strings only, formatted with `formatDecimal`, never `Number()`;
  - Unknown is never 0;
  - AUD sees read-only views;
  - "business approval" labels, never DG0–DG7;
  - `If-Match` on every edit, and 409 shows the conflict banner.

## Scope (in this order)

1. **Funding decisions** (initiative card, `pages/portfolio/**`).
   - A "Record funding decision" dialog for a selected or funded initiative.
     - Fields: outcome (approved, rejected, deferred, revoked), amount (decimal SAR, may be empty = Unknown), currency, funding source, conditions, **rationale (required)**, and an optional business-case link.
     - Labelled **business approval**. Shown only to holders of `funding.approve` (FIN and SP by default), with **no on-behalf control**.
     - Translate these 422s as the dialog's one alert:
       - `funding.not_selected`;
       - `funding.not_revocable`;
       - `funding.amount_invalid` (inline at `/amount`);
       - `funding.on_behalf_not_supported`.
   - Show the funding history on the card, from `GET /funding-decisions` filtered by initiative.
   - After an approved decision, the card shows **Funded**, and the portfolio list's Funding column updates. The deselect rule from BE-E §7 is visible: after a re-selection the card shows 'Selected - unfunded' again.
2. **Capacity editing** (`pages/capacity/**`).
   - Resource roles: create, edit and archive. A taken code is 409; an archived role is 422.
   - Capacity rows per role and month: create and edit, decimal FTE. A duplicate is 409.
   - Resource demand per initiative, role and month: create and edit while it is planned. Commit and release already exist; keep them.
   - The conflict indicator and its shortfall update after each save, and Unknown capacity stays Unknown.
   - Use the BE-E codes from its §7, translated.
3. **Deliverables and milestones** (initiative card, and the roadmap where it fits).
   - **Deliverables:** create, edit and archive (title, description, owner, due date). The card's 3–7 warning reflects the count.
   - **Milestones:** create and edit (title, owner, wave, forecast date). Approve-date already exists.
   - A closed initiative (cancelled or completed) shows these as read-only. The server answers 422 `initiative.read_only`, translated.
   - Afterwards the timeline, table and board update through the single `["roadmap", id]` entry.
4. **Waves** (`pages/roadmap/**`).
   - Edit a wave's planned start and end, owner, and EN/AR label overrides. **The verbatim source text is never editable.**
   - Add a non-source wave.
   - Overlapping dates are accepted.
5. **The initiative's wave and planned dates.** If FE-A's card edit doesn't already let a user set the initiative's wave, planned start and planned end (`planned_end >= planned_start`), add it.
6. **Translation gaps.**
   - **(a) Audit trail.** Label every remaining P3 enum code on the audit trail in EN and AR (`lib/auditChanges.ts`): `line_kind`, `benefit_class`, `unit_kind`, `polarity`, `confidence`, `result_*`, `frequency`, `recurrence` (FE-A §5.6).
   - **(b) Audit names.** Check FE-A's anticipated audit action and field names for BE-E against BE-E's actual audit writes (`apps/api/src/modules/portfolio/{funding,capacity,resource-demands}.ts`). Fix any mismatch.
   - **(c) Dialog problem codes.** Give `RecordDialog` an optional `namespaces` prop, so the portfolio create and edit forms translate `initiative.read_only` and `initiative.planned_range` specifically (FE-A §5.2).

## Acceptance (real output in the handback)

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm --filter @mth/design-tokens run check:contrast`
2. `pnpm test` passes with the locale unset and with `C.UTF-8`. Report the counts and your new web tests (EN and AR, stubbed API).
3. **`apps/web/e2e/p3-ui-completion.spec.ts`** passes on the real stack in chromium-en and chromium-ar, in both locale settings. It covers:
   - FIN or SP records an approved funding decision on a selected initiative, which then shows Funded;
   - the capacity owner creates a role, a capacity row and a demand above capacity; the conflict indicator shows; committing works;
   - a TL creates three deliverables and a milestone, and the timeline, table and board show them;
   - a wave edit;
   - an AUD read-only pass;
   - axe with 0 serious or critical issues on each new dialog state.
4. **The whole product e2e suite** (`apps/web/e2e`) still passes in both projects and both settings. Report the counts per spec.
5. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-FE-E-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-FE-E-evidence/`. Include:
- the files changed;
- each flow and the requirement it closes, quoting its acceptance text;
- the checks with exit codes and the e2e counts;
- any backend or contract mismatch, with its reproduction;
- anything left undone.
