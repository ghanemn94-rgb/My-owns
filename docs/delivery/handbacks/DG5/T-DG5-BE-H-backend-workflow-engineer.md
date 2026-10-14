# Handback T-DG5-BE-H (backend-workflow-engineer): P5 slice D, p5-work-split §D.1

- **Stage / gate:** P5, DG5 (BUILDING). Task T-DG5-BE-H. Assignment `docs/delivery/assignments/DG5/T-DG5-BE-H.md` (sha256 `d7caab98…2ebb42`, verified at start).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-H-backend-workflow-engineer-20261014T055654Z-b607cfe7","session_id":"b607cfe7-f72b-484a-ac6a-8b3ccf33fc4b"}`.
- **Base:** worktree `/home/user/wt/dg5-be-h`, branch `dg5/be-h`, `HEAD` `8ac7fec8db8d2cfce34c9d3f11c5543800872798`. Changes are **uncommitted**, as the assignment asks.
- **Time:** start `2026-10-14T05:57:07Z` (`date -u`), end `2026-10-14T07:48Z` (`date -u`).
- **Two gate systems:** nothing here reads or writes DG0–DG7 records. No rule, seed or test grants a business, Finance or IT approval. A rule-version review is a configuration review, not a G1–G6 business approval. All test data is synthetic.

## 1. Files changed

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/automation.ts` (new) | Zod mirrors for the `automation` tag: content (triggers, conditions, actions, identity, service permissions, parameters), request bodies, catalogue/rule/version/dry-run response mirrors, the six `HUMAN_ONLY_ACTION_CODES`, the `create_task`/`notify`/`escalate` parameter schemas, the starter parameter schemas (ADR-0044 §1) and `AUTOMATION_MESSAGE_KEYS`. |
| `packages/shared/src/schemas/index.ts` | One barrel line for `automation.ts`. |
| `apps/api/src/modules/automation/registry.ts` (new) | The `AutomationActionRegistry` port: descriptor and plan-context types, `createAutomationActionRegistry` (it refuses to register a human-only code), and `setAutomationActionRegistry`/`automationActionRegistry` (the wiring line). |
| `apps/api/src/modules/automation/human-only.ts` (new) | The S12-026 refusal (`automation_rule.human_only_action`). It runs on the parsed body before any lock or write. |
| `apps/api/src/modules/automation/catalogue.ts` (new) | `GET /admin/automation-catalogue`, plus the catalogue loader shared with rules and versions. |
| `apps/api/src/modules/automation/rules.ts` (new) | Rules: list, create (disabled, with draft v1), get, update, enable, disable. Also rule access: reader scope and commit-time configure check. |
| `apps/api/src/modules/automation/versions.ts` (new) | Versions: list, create draft (copied from the effective version), get, update draft content. Also the ADR-0043 §9 refusals, content validation, the canonical content hash, the en/ar readable summary and the presenters. |
| `apps/api/src/modules/automation/routes.ts` | Filled BE-A's stub: registration lines for catalogue, rules, versions and BE-H2's two stub files. |
| `apps/api/src/modules/automation/dry-run.ts`, `lifecycle.ts` (new stubs) | BE-H2's route files. They register nothing until BE-H2 fills them (p5-work-split §D.1 "stubs for BE-H2's `lifecycle.ts`/`dry-run.ts`"). |
| `apps/api/src/modules/tasks/automation-actions.ts` (new) | Descriptors for `create_task`, `notify` and `escalate`: parameter schema and a read-only planner (scope check, initiating-user check, recipients through the policy function). The types are structural, so tasks never imports automation (architecture test). |
| `apps/api/src/server.ts` | The registry wiring lines (create, register tasks' descriptors, set). BE-J adds its `launch_procedure` line below. |
| `apps/api/src/modules/platform/db-errors.ts` | P5 lines only: `mapP5AutomationError`, for the three 0074 guards a race can reach (`automation_rule_code_key`, `automation_rule_version_one_open_key`, `automation_rule_version_content_frozen`), and its call line. |
| `apps/api/src/modules/automation/content.test.ts` (new) | Unit tests: refusal order (human-only first), the §9 codes, the starter fixed part, the hash, the en/ar summary, and the registry refusing human-only codes. |
| `apps/api/test/integration/automation/automation-rules.test.ts` (new) | 13 integration tests against real PostgreSQL (§2 and §3). |
| `apps/api/test/support/p5-pending-be-h.ts` | Emptied: all 11 operations are routed. |
| `apps/api/test/integration/contract/p5-exercises-be-h.ts` | Exercises all 11 operations through the validating client: a success and every declared refusal they can reach, plus 11 zod mirrors. |
| `apps/api/test/integration/contract/contract.test.ts` | **Outside my listed files (disclosed):** the media-type pin `[327, 326, 1]` → `[332, 331, 1]`, plus a comment line. The orchestrator reconciles this pin (rule 14); I changed it so the suite stays green. |
| `apps/api/src/server.test.ts` | **Outside my listed files (disclosed):** the test pinned `automation` as `"scaffold"`, which stops being true the moment this task routes it. The loop now expects `active` when a module has routes and `scaffold` otherwise, and pins automation as `active`. BE-D and BE-F will need the same change for forms and procedures, and this loop already covers them. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-H-*` | This handback and its evidence logs. |

Untracked files at the worktree root that are **not mine**: `.bashrc`, `.bash_profile`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md`. They were present (or were created by the sandbox) at start. Do not integrate them.

**Migrations:** none. This task needed no database change; `0074`–`0076` (ARCH-03) are used as delivered.

**API endpoints added (11 operations):**

| Operation | Route | Permission |
|---|---|---|
| getAutomationCatalogue | `GET /api/v1/admin/automation-catalogue` | automation.read |
| listAutomationRules | `GET /api/v1/admin/automation-rules` | automation.read |
| createAutomationRule | `POST /api/v1/admin/automation-rules` | automation.configure |
| getAutomationRule | `GET /api/v1/admin/automation-rules/{ruleId}` | automation.read |
| updateAutomationRule | `PATCH /api/v1/admin/automation-rules/{ruleId}` | automation.configure, If-Match |
| enableAutomationRule | `POST …/{ruleId}/enable` (bodiless) | automation.configure, If-Match |
| disableAutomationRule | `POST …/{ruleId}/disable` | automation.configure, If-Match, reason |
| listAutomationRuleVersions | `GET …/{ruleId}/versions` | automation.read |
| createAutomationRuleVersion | `POST …/{ruleId}/versions` | automation.configure, If-Match = the rule's version |
| getAutomationRuleVersion | `GET …/{ruleId}/versions/{versionNo}` | automation.read |
| updateAutomationRuleVersion | `PATCH …/{ruleId}/versions/{versionNo}` | automation.configure, If-Match = the version's version |

Every `config.consumes` equals the operation's request media type: JSON for the five operations with a body, none for `enable` (the contract test's consumes-drift check passes).

## 2. Behaviour delivered, per requirement row

**REQ-S12-026.** Acceptance: *"A08;A13: saving a rule with action 'approve gate' is rejected; all automatic preparation and reminder rules run"*.
- Saving a rule (create, or a draft edit) whose actions include `approve_gate` is refused with 422 `automation_rule.human_only_action`, using the exact ADR-0043 §9 text. So is each of the other five human-only codes (`decide_approval`, `decide_investment`, `attest_finance_value`, `decide_executive_ask`, `approve_methodology_migration`).
- Nothing is written: no rule row, no audit event for the request, and the draft is unchanged (version and audit trail).
- The check runs first, ahead of every other content fault. The registry also refuses to register a human-only code, and the catalogue lists the six codes as `human_only` and never selectable.
- A service identity cannot hold `approval.decide` or any other `business_approval`/`finance_validation` permission (422 `automation_rule.service_permission_forbidden`).
- "All automatic preparation and reminder rules run": that half is the engine (BE-H2) and the starters (BE-J). Here, the sixteen starters list as enabled and can never be disabled.

**REQ-S12-002, BE-H's part (builder content, enable/disable).** Acceptance: *"A06;A13: a dry-run creates no tasks; a failed execution appears in the queue and succeeds on retry without duplicating actions"*. Those two clauses are BE-H2 (dry run) and BE-I (failure queue); this task delivers the builder and the switch:
- **Readable builder content:** typed `{field, op, value}` conditions. A condition may test only a field common to every trigger. Numeric operators take decimal strings only; a float is a 400, never coerced.
- Catalogued, admin-selectable triggers and actions, each action's settings validated by its owning module's schema, and an en/ar readable summary on every version and on the rule's effective version.
- Disabling a starter → 422 `automation_rule.guarantee_protected`, with the exact text (D-142 Q3).
- Disabling an admin rule needs a reason of 3–1000 characters; a missing or blank reason is a 400.
- Enabling without an effective version → 422 `automation_rule.no_effective_version`.
- A starter version with a condition → 422 `automation_rule.starter_fixed`. A starter version accepts only its declared settings (`minimumSlipDays` 1–90, `roleTaskDueWorkingDays` 1–30); others → 422 `action_parameters_invalid`.
- `initiating_user` on a schedule trigger → 422 `automation_rule.initiating_user_unavailable`.
- A new admin rule starts disabled.

**REQ-S12-001, BE-H's part (rules and versions).** Acceptance: *"A13: each execution is recorded with rule version, trigger event and outcome"*. Executions are BE-H2's. Here a rule is stored with its trigger(s), conditions, actions, scope (organization or transformation), owner, versions and effective version:
- Version numbers are sequential, and a rule has at most one open version (409 `automation_rule_version.draft_exists`).
- A new draft copies the effective version.
- A content edit recomputes `content_sha256`: SHA-256 of canonical JSON, keys in code-point order, integers only.
- A published version never changes (409 `automation_rule_version.not_editable`).
- List, get and versions are scoped. A reader sees the platform starters and the admin rules of the organizations where it holds `automation.read`. Another organization's rule is a 404, and its list omits that rule.

**Every mutation** (shared rule 4):
- AUD and TO get 403 on every write. This is tested on create, update, enable, disable, version create and version update.
- `If-Match` gives 428 when missing and 409 when stale. A create is version 1 (`createAutomationRule` declares no If-Match, per the contract).
- One audit event per row written, in the same transaction, asserted per record.
- Commit-time re-authorization: a grant revoked while the request waits gives 403 with nothing written. This is tested on create and on a version edit.
- No remote I/O.
- Free text goes through `freeText`. The strict UTF-8 parser is the platform's (no route-local parser).

**Authorization design note:** `automation.configure` is decided at the rule's **organization**, through a grant of that organization. This is the Studio and TOM precedent: ADM_METHOD has `inheritsDownward: false`, so a transformation-level decision would never allow it. A transformation-scoped rule must name a transformation of that organization. A caller who holds `automation.configure` but targets an organization or transformation outside it gets 422 `automation_rule.scope_invalid` ("…in your scope"); a caller without it anywhere gets 403.

## 3. Checks actually run (logs under `docs/delivery/handbacks/DG5/T-DG5-BE-H-evidence/`)

Environment: Node 24.21.0, offline. PostgreSQL is a disposable cluster from `tests/qa/support/with-pg.sh` on ports 23901+ (pool 23902–23949).

| Command | Exit | Result | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` | `validate-historical-DG4-start.txt` |
| `pnpm -r typecheck` | 0 | | `typecheck.txt` |
| `pnpm -r build` | 0 | | `build.txt` |
| `pnpm lint` | 0 | | `lint.txt` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | | `prettier-check.txt` |
| `pnpm openapi:lint` | 0 | | `openapi-lint.txt` |
| `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` (locale unset) | **1** | unit-node 1819/1820 (1 failed: timeout); unit-web 1384/1385 (1 failed: timeout); unit-formula-nocodegen 259 passed + 2 skipped by design | `unit-locale-unset.txt` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | Same: unit-node 1819/1820; unit-web 1384/1385; formula 259 + 2 skipped | `unit-c-utf8.txt` |
| Isolated re-runs of both failing files, locale unset and C.UTF-8: `npx vitest run --project unit-node apps/api/src/architecture.test.ts`; `(cd apps/web && npx vitest run src/pages/raid/raid.test.tsx)` | 0, 0, 0, 0 | architecture 139/139 (the boundary test took 21.4 s and 21.1 s against its 30 s limit); raid 18/18 | `rerun-architecture-{unset,C.UTF-8}.txt`, `rerun-raid-web-{unset,C.UTF-8}.txt` |
| `QA_PG_PORT=23910 MTH_PORT_POOL=23911-23949 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **212 files, 2062/2062 passed** (W3's 2049 + this task's 13). Contract test 72/72 (also run alone earlier on port 23901: exit 0). | `integration.txt` |
| `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` | `validate-historical-DG4-end.txt` |

**The two `pnpm test` failures, disclosed: acceptance item 2 is NOT met in this run.**

- **The failures.** Both locale runs failed the same two tests, both with timeouts:
  - `apps/api/src/architecture.test.ts` "every import respects dependsOn…": its 30 s test timeout.
  - `apps/web/src/pages/raid/raid.test.tsx` "action register: source, follow-up date and overdue flag; edit sends If-Match": a `findByRole` timeout ("Unable to find role=link … Synthetic call the vendor").
- **Load.** The host's load average was 17–25 on 4 CPUs during these runs (`uptime`), with the other W4 agents running.
- **Isolated re-runs.** Both files pass in both locales when re-run alone (rows above).
- **My part.**
  - The raid web test is in code this task did not touch (no `apps/web` change).
  - The architecture test walks and parses every module file. This task adds 8 API source files to that walk. In isolation, under the same load, it took 21 s of its 30 s budget, so it is load-sensitive (the F-DG4-143 family) and my files add to its work.
- **Not re-run.** I did not re-run the full `pnpm test` at lower load, because I reached the time bound. This is listed in §7, and the test files are not mine to change.

Intermediate runs during development, disclosed:
- `architecture.test.ts` first failed on a computed member key in `versions.ts`. It is fixed with a `Map` lookup.
- `server.test.ts` failed on the `scaffold` pin. It is fixed as described in §1.
- The first automation integration run had 2 failures out of 13, both fixed:
  - My first configure check was transformation-level, which ADM_METHOD never satisfies (see the design note in §2).
  - A test used `limit=200`, which is over the maximum.

## 4. Operations routed (delta to my pending list)

`p5-pending-be-h.ts`: 11 → 0. The 11 routed operations are getAutomationCatalogue, listAutomationRules, createAutomationRule, getAutomationRule, updateAutomationRule, enableAutomationRule, disableAutomationRule, listAutomationRuleVersions, createAutomationRuleVersion, getAutomationRuleVersion and updateAutomationRuleVersion.

Pinned-count deltas for the orchestrator (rule 14):
- **Media-type triple:** `[327, 326, 1]` → `[332, 331, 1]` (+5 JSON bodies). I made this change in `contract.test.ts`; please reconcile it with the other W4 tasks.
- **Rate-limit floor** (`>= 285`): unchanged.
- **Operation count:** 763, unchanged.

## 5. Contract, schema and dependency needs (for the orchestrator)

1. **Action parameter schemas.** ADR-0043 and the OpenAPI file leave the `create_task`/`notify`/`escalate` settings open (`parameters: {type: object}`). I defined them in `packages/shared/src/schemas/automation.ts`, and the catalogue publishes each as JSON Schema in `parametersSchema`:
   - `create_task`: `{assigneeRole, messageKey, dueInWorkingDays? 1–60, targetTransformationId?}`.
   - `notify`: `{recipientRole, messageKey, targetTransformationId?}`.
   - `escalate`: `{toRole, messageKey, targetTransformationId?}`.
   - `messageKey` is one of four `automation.message.*` keys.
   - BE-H2's worker executors and FE-D's builder must use these; please confirm, or have the architect record them in ADR-0043.
2. **`launch_procedure`** is catalogued `admin_selectable` but has no descriptor until BE-J registers one. Until then the catalogue reports it `adminSelectable: false` and a rule using it gets 422 `automation_rule.action_unknown`. That is true today, and it changes automatically once BE-J adds its line in `server.ts`.
3. **Codes not in the ADR-0043 §9 table** (rule 15), proposed:
   - (a) A non-active or foreign `ownerUserId` gets 422 `validation.user_invalid`. This reuses the existing DG3 register-kit code (`apps/api/src/modules/transformations/register-kit.ts`), with the detail "A named person must be an active user of the rule's organization.".
   - (b) A starter `PATCH` naming a description or owner gets 422 `automation_rule.starter_fixed`. The OpenAPI summary says a starter's "names only" may change, and starter_fixed is the closest §9 code.
   - (c) `runAs: initiating_user` with service permissions is a 400 validation error (`validation.service_permissions_need_service`), mirroring CHECK `automation_rule_version_service_permissions`.
4. **Idempotent enable/disable:** enabling an enabled rule, or disabling a disabled one, returns 200 and writes nothing (no version step, no audit event). The ADR does not say; please confirm.
5. **Version-level `parameters` of an admin rule** must be `{}`; anything else gets 422 `action_parameters_invalid`. ADR-0043 §1 describes them as starter settings.
6. **No new dependency.** Zod 4's built-in `z.toJSONSchema` renders `parametersSchema`.

## 6. User-facing texts

- `apps/web/src/i18n/{en,ar}/admin.json` `plannedSections` ("…automation … settings are planned for later releases"). Still **true**: this task ships API operations only, and there is no automation settings screen yet. It becomes untrue when FE-D ships the builder, so it goes to FE-D (D-144 handled `admin.plannedSections` the same way for the Studio). I did not change it.
- **Missing translations** (web i18n files are FE-owned; for FE-D or the owner of `problems.json`). The slice D problem codes this task returns have no `problems.json` keys yet:
  - `automation_rule__human_only_action`, `__trigger_unknown`, `__action_unknown`, `__condition_invalid`, `__action_parameters_invalid`, `__initiating_user_unavailable`, `__service_permission_forbidden`, `__scope_invalid`, `__guarantee_protected`, `__starter_fixed`, `__no_effective_version`, `__code_taken`;
  - `automation_rule_version__draft_exists`, `__not_editable`;
  - `validation__service_permissions_need_service`.
  - The English texts are ADR-0043 §9's. I did not write Arabic for them.
- The four message keys `automation.message.follow_up`, `.review_needed`, `.update_due` and `.attention_required` (params `ruleName`, `triggerLabel`) need en/ar labels before BE-H2's executors create items with them.
- The rule/version `summary` is rendered server-side in en and ar from the catalogue labels, as the contract's `AutomationRuleSummary` requires. Condition field names and values are shown as stored.

## 7. What remains

- **Acceptance item 2 is not demonstrated green:** the full `pnpm test` failed in both locales with two load-induced timeouts (§3). Re-run it on a quieter host. If `architecture.test.ts` still exceeds 30 s, its owner should raise its explicit timeout (the file is not mine).
- Nothing in my §D.1 file list is left undone.
- The dry run, review, publish, discard and the evaluation engine are BE-H2's (stubs are in place).
- Executions and the failure queue are BE-I's.
- `launch_procedure` is BE-J's.
- The pinned-count reconciliation and the §5 confirmations are the orchestrator's.
