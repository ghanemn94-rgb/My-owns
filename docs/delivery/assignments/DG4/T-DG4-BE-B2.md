# Assignment T-DG4-BE-B2: follow-up to BE-B: the REQ-S10-003 literal 403 and the approval reminders (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/be-b2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-BE-C, T-DG4-KBE-C and T-DG4-KBE-D2 run in their own worktrees. None of them owns your files.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first. It must exit 0.
- **Time:** about 45 minutes; the hard limit is 2 hours. Run `date -u` at the start and at the end.
- **Your harness ports are 23400–23449 only.**

## Binding decisions

Read them verbatim in `docs/delivery/decisions.md`:
- **D-094**, which scheduled this task;
- **D-089**;
- the BE-B handback, `docs/delivery/handbacks/DG4/T-DG4-BE-B-backend-workflow-engineer.md` §4.1 and §4.2.

## Scope

### 1. REQ-S10-003, the literal acceptance

The acceptance text reads: "A12: an ADM-only user calling a gate or Finance approval endpoint gets 403".

As built, an ADM-only caller gets **404** from these DG1–DG3 endpoints, because it holds no `transformation.read`:
- the gate decision, `POST …/gates/{code}/decision` (`apps/api/src/modules/workflows/gates.ts`);
- the Finance baseline validation, `POST …/baselines/{id}/validation` (the `kpi` module);
- any other Finance approval endpoint, such as the P3 benefit-formula Finance validation. List the ones you find.

**Apply one narrow rule (D-094).** If the caller's **every** grant in the target organization is a technical-admin role (`ADM_TECH`, `ADM_ACCESS`, `ADM_METHOD`; see ADR-0026 §8 and ADR-0020), answer **403** with the same problem code and text that `decideApproval` already uses for this case. Every other caller's response stays exactly as it is today, including the 404 for a caller who cannot read.

- Prefer one shared helper over per-route copies, for example in `access/` next to BE-B's check.
- `apps/api/test/integration/adm-not-approver.test.ts` currently pins the 404 divergence. Update it to the 403, and add tests proving that non-ADM callers are unchanged: a reader without the approval right, a non-member, and AUD.

**You may edit:**
- the read-gate lines of those routes;
- the shared helper;
- that test file;
- the contract, only if an operation lacks a declared 403. Report it if one does; most already declare it.

### 2. The approval reminders (ADR-0026 §4 and §6)

- **Migration `0058`** (repair range, assigned by D-094) inserts two `work_item_kind` rows:
  - `approval_outcome`: 'Your approval request was decided' / 'تم البت في طلب الموافقة الخاص بك', `owner_module` `workflows`, source `M0213`;
  - `approval_overdue`: 'An approval you follow is overdue' / 'موافقة تتابعها متأخرة', with the same owner and source.

  Mark the Arabic as provisional, as the other seeds do. Update the catalogue and seed test pins and `schema.ts` as needed.
- **In `decideApproval`,** on approve or reject, call `createWorkItemOnce` for the requester with kind `approval_outcome` and dedupe key `approval.outcome:<id>:<round>:<requester>`.
- **In `escalateOne`,** call it for the requester and for the current assignee with kind `approval_overdue` and dedupe key `approval.overdue:<id>:<round>:<due>:<user>`. Name the delay and any routing error in the item.
- **Tests:**
  - one reminder per decision;
  - none on defer or request-changes, unless the ADR says otherwise (quote it);
  - escalation reminders are created once and are idempotent on retry.

## Acceptance

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm openapi:lint`
2. `pnpm test` passes with the locale unset and with `C.UTF-8`.
3. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts.
4. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-BE-B2-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-BE-B2-evidence/`. List every endpoint whose ADM-only response changed, with before and after. Leave your changes **uncommitted**.
