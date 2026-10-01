# Handback T-DG1-FE4: frontend round-3 repairs (frontend-ux-engineer)

- **Stage:** DG1 (round-3 repair). **Assignment:** `docs/delivery/assignments/DG1/round-3/T-DG1-FE4.md` (sha256 `38e01f96…0d06702`, verified).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-FE4-frontend-ux-engineer-20261001T090248Z-ae51d388","session_id":"ae51d388-360b-44eb-b8c2-110f38444257"}`
- **Base revision:** `e7a7084` (≥ `45d0297`), branch `dg1r3-fe4`, worktree `/home/user/mth-wt-fe4`. `git status` was clean for tracked files at start.
- **Findings addressed:** F-DG1-208 (High, mandatory), F-DG1-005 / F-DG1-008 (Low). Nothing else was changed. The author does not close these findings; a non-author reviewer verifies them.
- Evidence: `docs/delivery/handbacks/DG1/round-3/T-DG1-FE4-evidence/` (logs, screenshots, `changes.diff`). This follows the `T-DG1-DEVOPS-evidence/` precedent, because implementers cannot write `docs/delivery/test-evidence/**`.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/e2e/journeys.spec.ts` | **F-DG1-208:** every name/text locator now matches the whole accessible name. New helpers: `exactly`, `fieldLabel`, `navLink`. One new real-stack journey for F-DG1-008. |
| `apps/web/src/lib/auditChanges.ts` | **F-DG1-008:** localized labels for `scoped_assignment.*` events. Covers the action (derived vs manual grant, revoke), the fields (`userId`, `roleCode`, `scope`, `effectiveFrom/To`, `derivedFromAssignmentId`, `revokedAt`), role-code labels, a typed `scope` value and the revocation time `"now"`. The marked fallback still applies to unknown actions, fields and values. |
| `apps/web/src/pages/transformations/TransformationDetailPage.tsx` | The audit "Action" cell uses `describeAuditAction`; an unknown action stays raw and LTR, and is marked "(action without a translation)". `AuditValueView` renders a `scope` as "‹scope type›: ‹name›", where a scope on the current record reads "this transformation", a business unit shows its name and code, the user's own organization shows its name, and anything else shows Unknown. |
| `apps/web/src/pages/transformations/common.tsx` | `UserName` takes the signed-in user's own name from the session, with no `/users/{id}` fetch. A BU-scoped Lead holds no `user.read`, so the creator would otherwise show as Unknown in the derived event. |
| `apps/web/src/i18n/en/transformations.json`, `apps/web/src/i18n/ar/transformations.json` | New keys under `transformations.audit`: `actions.scoped_assignment_create`, `actions.scoped_assignment_create_derived`, `actions.scoped_assignment_revoke`; `field.user_id`, `field.role_code`, `field.scope`, `field.effective_from`, `field.effective_to`, `field.derived_from_assignment_id`, `field.revoked_at`; `role.<all 14 ROLE_CODES>`; `value.eventTime`, `value.thisTransformation`; `untranslatedAction`. |
| `apps/web/src/lib/auditChanges.test.ts` | 6 new unit tests (AR + EN) on the derived-assignment event, in the exact shape `grantCreatorTransformationRoles` records. |
| `apps/web/src/pages/transformations/transformations.test.tsx` | 3 new rendered tests (EN, AR RTL, and unknown-action fallback in both). The existing F-DG1-005 render test now uses a distinct lead user id (`LEAD_ID`), so it still exercises the fetched-name path now that the signed-in user's own name comes from the session. |

No product strings were changed for F-DG1-208. The only i18n edits are the additions for F-DG1-008.

## 2. Behaviour delivered

### F-DG1-208: Arabic e2e journeys red because of an ambiguous nav locator (High, mandatory)

**Cause:** Playwright matches a string `name` or `getByText` as a case-insensitive **substring**, and an unanchored RegExp matches anywhere in the name. In Arabic, `nav.areas.myWork.label` = «عملي» is a substring of «العمليات الاعتيادية والتحسين» (BAU, from the F-DG1-003 glossary). The locator therefore resolved to two links, and the serial describe skipped 6 AR journeys.

**Fix:** I audited the whole spec, not only line 138. Every `getByRole`/`getByLabel`/`getByText` name now matches the **whole** accessible name:

- Plain catalogue strings use `exact: true` (headings, buttons, links, checkboxes, regions, navigation, column headers, `getByText`). That is 30+ call sites, including those that only use `toHaveCount(0)`, where a loose match would give a false failure.
- Some names legitimately carry extra text. These are now spelled out completely from the component markup and anchored with `^…$`:
  - `navLink(nav, lang, area)`: `^‹label›(\s+‹nav.planned›)?$` (Shell.tsx appends the "Planned" tag). Used for myWork, governance and admin (×3).
  - `fieldLabel(lang, key)`: `^‹label›(\s*\(‹common.form.required›\))?$` (Form.tsx's required marker). Used for the username (both languages at sign-in), business unit, name (×2), entry phase, reason and role.
  - The sortable column header: `^‹Code›\s+(‹notSorted›|‹sortedAsc›|‹sortedDesc›)$` (DataTable.tsx's hidden sort state).
  - The mode radio: `^‹Modular›\s+‹modeHelp.modular›$`.
  - The filter chip: `^‹Status›: ‹Draft›\s+‹common.filter.remove›$` inside the "active filters" group. This replaces the loose `/Draft/` plus `.first()`.
  - The language switch: its exact `aria-label` (`common.language.switchTo` in the current language). This replaces `/English/` and `/العربية/`.
  - Edit link absent: `exactly(‹Edit›)`.
- Left as-is on purpose: `toContainText`, `filter({ hasText })` and `getByTestId` are content assertions, not name locators. Fixed literals (`SYN-DEV`, `SYN-RETAIL`, `createdCode`, the user display name) also gained `exact: true`.

**Proof:** I ran the full e2e suite (`apps/web/e2e/**` and `e2e/**`, both projects): **22 passed, 0 failed, 0 did not run, exit 0** (§3). All original 20 journeys pass in EN and AR, including the six AR journeys that were skipped before. The extra 2 are the new F-DG1-008 journey in EN and AR. The Arabic project alone, using the reviewer's command form, also gives 11/11, exit 0. axe found 0 violations of any impact on all 14 checked pages per language.

### F-DG1-005 / F-DG1-008: derived-assignment audit entry not localized (Low)

The derived creator assignment from F-DG1-106 now renders in human terms on the new record's audit trail. Real-stack screenshots: `screenshots/{en,ar}/17-lead-audit-trail.png`.

| | English | Arabic (RTL) |
|---|---|---|
| Action | Role granted to the creator (carried over from a business-unit assignment) | إسناد دور لمُنشئ السجل (منقول من إسناد على مستوى وحدة العمل) |
| userId | User: None → Synthetic Transformation Lead | المستخدم: لا يوجد ← Synthetic Transformation Lead |
| roleCode | Role: None → Transformation Lead | الدور: لا يوجد ← قائد التحوّل |
| scope | Scope: None → Transformation: this transformation | النطاق: لا يوجد ← التحوّل: هذا التحوّل |
| effectiveTo | Effective until: None → None | يسري حتى: لا يوجد ← لا يوجد |
| derivedFromAssignmentId | Carried over from assignment: None → ‹assignment UUID, LTR›. A technical identifier, kept readable as F-DG1-005 permits. | منقول من الإسناد: لا يوجد ← ‹UUID› |

- A manual grant reads "Role granted / إسناد دور", and a revoke reads "Role revoked / سحب دور". A `revokedAt: "now"` value reads "at the time of this event / وقت هذا الحدث".
- Role labels cover all 14 `ROLE_CODES` in both languages. Arabic role names follow the DG0 glossary where it defines them (SP, TL, BO, WL, FIN, TO). The others use the seeded role catalogue (`0005_seed_roles_permissions.sql`). Like the glossary, these Arabic terms still need review by a Mobily Arabic-language owner.
- The safe fallback is unchanged and extended. An unknown action (now marked "(action without a translation)" / «(إجراء بلا ترجمة)»), an unknown field, an unexpected role code or a malformed scope stays raw, LTR-isolated and explicitly marked. Values can never address another catalogue key: action, enum and role codes are pattern-checked.

## 3. Checks actually run

Environment: worktree `/home/user/mth-wt-fe4` @ `e7a7084` plus the uncommitted changes above (left uncommitted, see §5); Node v22.22.2; pnpm workspace with existing `node_modules`; offline, no install; Chromium 1194 from `/opt/pw-browsers`; PostgreSQL 16.13 (disposable cluster via `e2e/support/qa-stack.sh`). Logs are in `T-DG1-FE4-evidence/`.

| # | Command | Result | Log |
|---|---|---|---|
| 1 | `pnpm --filter @mth/web typecheck` | exit 0 | `01-typecheck.log` |
| 2 | `pnpm lint` (`eslint . --max-warnings=0`) | exit 0 (an `eqeqeq` error in my first draft was fixed and re-run) | `02-lint.log` |
| 3 | `pnpm check:no-cdn` | `PASS no-cdn: scanned apps, packages`, exit 0 | `03-no-cdn.log` |
| 4 | `npx prettier --check apps/web` | exit 0 | `04-format.log` |
| 5 | `npx tsc -p <scratch tsconfig extending tsconfig.base.json, lib dom>` on `apps/web/e2e/journeys.spec.ts` (the web tsconfig does not include `e2e/`) | exit 0 | `05-e2e-spec-tsc.log`, `05-e2e-spec-tsconfig.json` |
| 6 | `pnpm exec vitest run --project unit-web` | 8 files, **106 passed**, exit 0 | `06-test-web.log` |
| 7 | `pnpm test` (unit-node + unit-web) | 21 files, **219 passed**, exit 0 | `07-test-all-unit.log` |
| 8 | `pnpm -r build` | exit 0 | `08-build.log` |
| 9 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers QA_E2E_PG_PORT=5461 E2E_SCREENSHOT_DIR=… e2e/support/qa-stack.sh npx playwright test --workers=1 --reporter=list` (full suite, both projects) | **22 passed (53.0s), 0 failed, 0 did not run, exit 0** | `10-e2e-full.log` |
| 10 | Same stack: `npx playwright test e2e --project=chromium-ar --workers=1` (AR alone, the reviewer's form) | **11 passed, exit 0** | `11-e2e-ar-rerun.log` |

Tail of run 9:

```
  ✓  12 [chromium-ar] › apps/web/e2e/journeys.spec.ts:134:1 › sign-in page: Arabic RTL by default, provisional wordmark, dev form in dev mode (1.2s)
  ✓  13 [chromium-ar] › apps/web/e2e/journeys.spec.ts:156:1 › shell: navigation, language persistence and My Work (Transformation Office) (1.9s)
  ✓  14 [chromium-ar] › apps/web/e2e/journeys.spec.ts:182:1 › create a modular transformation with an entry phase (3.2s)
  ✓  15 [chromium-ar] › apps/web/e2e/journeys.spec.ts:222:1 › list: sort, filter chips, column selection and pagination controls (2.9s)
  ✓  16 [chromium-ar] › apps/web/e2e/journeys.spec.ts:262:1 › edit: a concurrent change gives a 409 conflict with compare and re-apply (2.3s)
  ✓  17 [chromium-ar] › apps/web/e2e/journeys.spec.ts:296:1 › archive with a mandatory reason makes the record read-only (2.3s)
  ✓  18 [chromium-ar] › apps/web/e2e/journeys.spec.ts:317:1 › administration screens (access + technical administrator) (5.0s)
  ✓  19 [chromium-ar] › apps/web/e2e/journeys.spec.ts:355:1 › a user without roles sees no Administration and no business records (1.7s)
  ✓  20 [chromium-ar] › apps/web/e2e/journeys.spec.ts:371:1 › a business-unit Lead creates a record; its audit trail shows the derived access grant localized (F-DG1-008) (2.2s)
  ✓  21 [chromium-ar] › e2e/a20-bilingual-shell.spec.ts:100:3 › A20 bilingual shell › Arabic RTL by default; English LTR after the switch; persisted; switch back (1.3s)
  ✓  22 [chromium-ar] › e2e/a20-bilingual-shell.spec.ts:159:3 › A20 design tokens reach the rendered CSS › seeded --mth-* colours and referencing surfaces equal the built token source (707ms)

  22 passed (53.0s)
exit 0
```

(EN rows 1–11 are the same journeys, all ✓; see the log.)

**Audit-label tests (F-DG1-008),** included in runs 6 and 7:

- `auditChanges.test.ts` › "role-assignment events on a transformation's trail (F-DG1-008)", 6 tests. They cover: action labels in EN and AR (derived, manual and revoke grants); the null fallback for unknown or malformed actions; every field and value of the derived event localized in EN, and in AR with the glossary role name; a label for every role code; `"now"` read as the event time; and the marked fallback for unexpected role codes and malformed scopes.
- `transformations.test.tsx` › "derived creator assignment on the audit trail (F-DG1-008)", 3 rendered tests (EN, AR with `dir=rtl`, unknown-action marker in both languages). They assert the exact action text and each "Field: None → value" line. They also assert that none of these appear: `scoped_assignment`, `userId`, `roleCode`, `effectiveTo`, `derivedFromAssignmentId`, JSON, raw user or transformation UUIDs, the bare `TL` code, or an "untranslated" marker. Finally they check that the creator's name needs no `/users` call.
- Real stack: journey 9/20 above. `dev.lead` (TL at SYN-RETAIL only) creates a record, and the test asserts the same lines plus axe on that page.

**Interaction checks run (Playwright, real API + PostgreSQL), per language:** sign-in; language switch and persistence after reload; skip-link keyboard focus; nav `aria-current`; planned area; create validation; create; list sort (`aria-sort`), status filter chip, column hide and pagination; edit with a 409 conflict and re-apply; archive with a mandatory reason; admin screens; the no-roles no-permission and empty states; the BU-lead create and audit trail. Every step ran axe (WCAG 2.0/2.1 A+AA): 0 violations of any impact (`screenshots/{en,ar}/axe-summary.json`), and every request stayed same-origin.

**Visual evidence (both languages):** `T-DG1-FE4-evidence/screenshots/en/01…17-*.png` and `…/ar/01…17-*.png`. The visible change for this task is `17-lead-audit-trail.png` (EN LTR, AR RTL). I viewed both: the audit trail rows read as in the table in §2, and the Arabic layout is RTL with LTR-isolated codes and dates.

## 4. Known gaps / not done / observations

- **Observation, not fixed (outside the two findings): stale session grants right after a BU-scoped Lead's create.** The SPA reads the caller's grants from `/api/v1/me` at sign-in. After `dev.lead` creates a record, the new derived transformation-scope grant is not in the cached session, so on the post-create page `canOn(me, "audit.read", record)` is false. The audit-trail section is hidden, and permission-gated controls may be too, until the page is reloaded. After a reload everything shows (journey 9/20 reloads, as the reviewers' reproduction does). A likely fix is to invalidate the `me` query after a successful create. That is a product behaviour change, so I'm leaving it for the orchestrator to triage rather than widening this repair's scope. The comment in `journeys.spec.ts` (lead journey) points here.
- The Arabic role names for KDS, TD, CM, SEC, AUD, ADM_* come from the seeded role catalogue, not the DG0 glossary (which doesn't define them). As with the glossary, they still need review by a Mobily Arabic-language owner.
- "Effective until: None → None" for an open-ended derived grant is accurate but terse. I didn't add an "open-ended" wording, to stay within scope.
- Nothing BLOCKED. All requested checks ran (§3).

## 5. Merge instructions

- **Not committed.** `git add` failed in this run's sandbox: `fatal: Unable to create '/home/user/My-owns/.git/worktrees/mth-wt-fe4/index.lock': Read-only file system` (git metadata is read-only for agents). The changes are left **uncommitted** in worktree `/home/user/mth-wt-fe4` (branch `dg1r3-fe4`, base `e7a7084`), ready for the orchestrator to commit. The files to commit are the 8 modified paths under `apps/web/**` (§1), this handback, and `docs/delivery/handbacks/DG1/round-3/T-DG1-FE4-evidence/**`. The untracked dotfiles at the worktree root (`.bashrc`, `.mcp.json`, `.idea`, …) are not mine and must not be committed. `T-DG1-FE4-evidence/changes.diff` is the exact `git diff` of the `apps/web/**` changes.
- No migrations, no API or shared-package changes, no new dependencies.
- Possible conflict: `apps/web/src/i18n/{en,ar}/transformations.json` (the `audit` object), if another round-3 task edits the same block. The additions are new keys only.
- Re-run on the merged candidate: `pnpm -r build`, then `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers e2e/support/qa-stack.sh npx playwright test --workers=1`. Expected: 22 passed.
