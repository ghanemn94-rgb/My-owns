# Handback T-DG1-FE2: frontend round-2 repairs (frontend-ux-engineer)

- **Stage:** P1 / DG1, round 2 (repair). **Assignment:** `docs/delivery/assignments/DG1/round-2/T-DG1-FE2.md` (sha256 `6def2815…dfc95ac`, verified before starting).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-FE2-frontend-ux-engineer-20261001T071338Z-aa413271","session_id":"aa413271-64bd-44fd-b6fd-8bb206a2fe65"}`
- **Base revision:** `868ebb6c44c1b89709234e3db4e8dfd2d7672233` (worktree branch `dg1r2-fe`, ≥ `c433078`). The changes are uncommitted in the worktree for the orchestrator to integrate.
- **Findings in scope:** F-DG1-003 (Medium), F-DG1-004 (Low), F-DG1-005 (Low). I fixed only these. I closed none of them: closure is a reviewer's decision.
- Engineering only. Nothing here grants or implies any G1–G6 business approval, and nothing here bears on DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/i18n/ar/transformations.json` | F-DG1-003: glossary terms (Transformation = التحوّل, modes, phases, North Star, Transformation Lead). Status labels now agree with the masculine noun. F-DG1-004/005: new keys `createdNotVisible.*`, `audit.field.*`, `audit.untranslatedField`, `audit.untranslatedValue`. |
| `apps/web/src/i18n/en/transformations.json` | Same new keys in English. No existing English term deviated from the glossary, so I changed none. |
| `apps/web/src/i18n/ar/common.json` | F-DG1-003: playbook name `دليل تحوّل الأعمال` in About; product name and "My work" link use `التحوّل`. |
| `apps/web/src/i18n/ar/nav.json` | F-DG1-003: Transformations area `التحوّلات`. BAU area uses `العمليات الاعتيادية`, RAID and RACI use the glossary expansions, and decision rights use `صلاحيات القرار`. |
| `apps/web/src/i18n/ar/admin.json` | F-DG1-003: scope type, scope summary and ID hint use `التحوّل`. The `initiative` scope stays `المبادرة`. |
| `apps/web/src/i18n/ar/problems.json` | F-DG1-003: archived messages use `التحوّل`. `not_allowed_for_mode` names `النمط الشامل (من البداية إلى النهاية)` instead of `المتكامل`. |
| `apps/web/src/lib/auditChanges.ts` (new) | F-DG1-005: maps audited field keys (snake_case or camelCase) and values to localized labels or typed values. Fallback is the raw key or code, marked as untranslated. |
| `apps/web/src/pages/transformations/TransformationDetailPage.tsx` | F-DG1-005: the Changes column renders via `describeAuditChanges` and the new `AuditValueView`. F-DG1-004: adds the `CreatedNotVisible` state. Also, a 403/404 now always replaces a cached copy instead of showing it as Stale. |
| `apps/web/src/pages/transformations/TransformationCreatePage.tsx` | F-DG1-004: passes `{created: {id, code, name}}` (from the creator's own 201 response) as router state. It no longer seeds the detail cache from the 201, so the detail page shows what the server lets the creator read. |
| `apps/web/src/i18n/glossary.test.ts` (new) | F-DG1-003: parses `docs/analysis/glossary.md` and asserts that the catalogue terms match it and that Transformation ≠ Initiative. |
| `apps/web/src/lib/auditChanges.test.ts` (new) | F-DG1-005: unit tests of the mapping in AR and EN, including the fallbacks. |
| `apps/web/src/pages/transformations/transformations.test.tsx` (new) | F-DG1-004 and F-DG1-005: component tests against a mocked API, in AR and EN. |
| `docs/delivery/handbacks/DG1/round-2/T-DG1-FE2-evidence/capture.spec.ts`, `capture.config.ts` (new) | Mocked-API Playwright capture of the screenshots below, with axe. |
| `docs/delivery/handbacks/DG1/round-2/T-DG1-FE2-evidence/screenshots/{en,ar}/*.png`, `axe-summary.json` (new) | Visual evidence. |

The diffstat for tracked files is `8 files changed, 225 insertions(+), 64 deletions(-)`, plus the new files above. I did not touch `apps/api/**`, `packages/**`, `deploy/**`, `.github/**`, `tools/**`, `docs/api/openapi.yaml`, `pnpm-lock.yaml` or the design tokens.

## 2. Behaviour delivered

### F-DG1-003 (REQ-PB-003): Arabic domain terms follow the DG0 glossary

**Glossary source:** `docs/analysis/glossary.md` (T-DG0-AN-01, revised by T-DG0-AN-05; sha256 `935c1065…63497814`, last commit `73c48546`). The rows used are:

| English | Glossary Arabic | Line |
|---|---|---|
| Business Transformation Playbook | دليل تحوّل الأعمال | 32 |
| Transformation | التحوّل | 33 |
| End-to-End mode | النمط الشامل (من البداية إلى النهاية) | 34 |
| Modular mode | النمط الجزئي المرن (الدخول عند المرحلة المناسبة) | 35 |
| Define | التحديد (تحديد التوجّه) | 40 |
| Mobilize | التعبئة (حشد الموارد والتهيئة للتنفيذ) | 42 |
| Transform (Phase 5) | التحويل والتنفيذ | 43 |
| Transformation Lead | قائد التحوّل | 59 |
| North Star | النجم الشمالي (الغاية العليا) | 89 |
| Initiative | مبادرة | 115 |
| BAU (business as usual) | العمليات الاعتيادية | 171 |

The revision table (lines 14–24) also notes that `معياري` reads as "standard/normative".

What changed:

- **Transformation and Initiative are now distinct.** Every `مبادرة/مبادرات التحول` became `التحوّل` or `التحوّلات` (and `تحوّل جديد` for "new transformation"). This covers the list, detail, create and edit titles, breadcrumbs (they use `listTitle`), buttons, empty states, archive dialog, error messages, admin scope type and summary, the nav area and the "My work" link. `المبادرة` / `المبادرات وخرائط الطريق` now refer only to Initiatives.
- **Consistent spelling.** The Arabic catalogue has no unshadda'd `تحول` left; it is `تحوّل` everywhere, as in the glossary.
- **Modes, phases and other terms.** Modes, phases, North Star, playbook name and BAU now use the glossary terms above. I used the full glossary terms, including their clarifying parentheses, for the modes and for Define/Mobilize, because the AN-05 revision says the bare words are ambiguous. The screenshots show they wrap cleanly in the stepper and radio cards.
- **Grammatical agreement.** Lifecycle status labels changed from feminine (agreeing with `مبادرة`) to masculine (agreeing with `تحوّل`): `نشط / معلّق / مغلق / مؤرشف`. The "Draft – not submitted" label is unchanged.
- **English.** No deviations found (Transformation, Initiative, End-to-End, Modular, the phase names, Executive Sponsor, Transformation Lead, North Star, Business Transformation Playbook), so no English strings changed. The test now guards them as well.
- **Review still needed.** The glossary itself says its Arabic terms are proposals that need review by a Mobily Arabic-language owner. That review is still outstanding and is not something an engineering agent can provide.

### F-DG1-004 (REQ-S10-002): no dead "Not found" after create

- After a 201, the create page navigates to `/transformations/{id}` with router state `{created: {id, code, name}}`. The code and name are taken only from the creator's own 201 response, so nothing new is disclosed.
- **When the server lets the creator read the record** (the expected case once backend F-DG1-106 lands), the detail page reads it back from the server and shows the usual "created as a draft, not submitted or approved" banner and the workspace.
- **When the server answers 403/404 for the record just created**, the page shows a localized `created-not-visible` state instead of "Not found". It contains:
  - the heading "Transformation created, but you cannot open it" / `أُنشئ التحوّل، لكن لا يمكنك فتحه`;
  - "TR-xxxx · name was saved as a draft. It is not submitted or approved…";
  - the next step: ask an access administrator for a role at this transformation's scope;
  - a link back to Transformations.

  It has `role="alert"`, a lock icon, a text label and an RTL/LTR layout.
- **Truly out-of-scope records** (no matching router state, or state for a different id) still get the existing messages:
  - 404: "Not found / غير موجود — the record does not exist, or your role assignments do not allow you to see it". Existence is not disclosed.
  - 403: "You do not have access".

  Separately, a 403/404 on refetch now replaces previously cached data. Before, the cached record could stay on screen labelled only "Stale".
- **What still depends on the backend:** whether the creator can actually open the record (F-DG1-106, backend-workflow-engineer). The frontend handles both outcomes.

### F-DG1-005 (REQ-S15-007, M0302): audit Changes in human terms

- **Field labels.** Field keys map to localized labels: `status → Status / الحالة`, `current_phase → Phase / المرحلة`, `business_unit_id → Business unit / وحدة العمل`, `lead_user_id → Transformation Lead / قائد التحوّل`, `archivedAt → Archived on / تاريخ الأرشفة`, and so on. This covers every field in `TRANSFORMATION_AUDIT_FIELDS`, plus `archived_at` and `archive_reason`.
- **Enum values** use the catalogue labels for status, mode, phase and deliverable. Only plain `[a-z0-9_]` codes are looked up, so a stored value cannot address another catalogue key.
- **Typed values:**
  - User ids render as the user's name, via the existing `UserName`, which shows Unknown if the user is not visible.
  - BU ids render as the BU name and code.
  - Timestamps render in the record's time zone.
  - Code, time zone and currency stay as LTR-isolated technical identifiers.
  - Free text is shown as entered.
  - An absent value shows "None / لا يوجد" instead of the old `∅`.
- **Fallbacks.** An unknown field or value is shown as the raw key/code in `<bdi dir="ltr">` followed by "(field without a translation)" / "(حقل بلا ترجمة)" or "(value without a translation)" / "(قيمة بلا ترجمة)". It is never blank and never given a guessed label.
- **Order.** Fields appear in a stable order, with unknown fields last.

## 3. Checks actually run

All checks ran in the worktree `/home/user/mth-wt-fe`, offline, with no API/DB stack started. Environment: Linux sandbox, Node and pnpm from the workspace, `node_modules` present, Playwright 1.56.1 with the pre-installed chromium in `/opt/pw-browsers`.

| Command | Result |
|---|---|
| `pnpm --filter @mth/web test` (baseline before changes, at `868ebb6`) | exit 0. 5 files, 66 tests passed. |
| `pnpm --filter @mth/web typecheck` | exit 0 |
| `pnpm --filter @mth/web test` (final) | exit 0. **8 files, 92 tests passed**: 66 existing + 8 glossary + 9 audit-mapping + 9 screen tests. |
| `pnpm lint` (`eslint . --max-warnings=0`) | exit 0, no output |
| `pnpm check:no-cdn` | exit 0. `PASS no-cdn: scanned apps, packages` |
| `pnpm --filter @mth/web build` | exit 0. `✓ built in 2.52s` |
| `npx prettier --check apps/web docs/delivery/handbacks/DG1/round-2` | `All matched files use Prettier code style!` |
| Design-token contrast check | N/A: no token changes. |
| **New tests against the OLD sources:** I restored the 8 changed tracked files to their `HEAD` contents with `git show HEAD:<f> > <f>`, ran the 3 new test files, then restored my versions (the diffstat afterwards was identical). | exit 1. **15 failed / 11 passed (26)**. Examples are below. |
| Mocked-API Playwright capture with axe (`capture.spec.ts` against `vite preview` of the built dist, EN and AR) | exit 0. **6 passed**. Axe found **0 violations of any impact** on all 12 pages (WCAG 2.0/2.1 A+AA tags). |

Output tail from the run against the old sources, showing the new tests fail on the old strings and behaviour:

```
 FAIL glossary.test.ts > Arabic catalogue follows the glossary > names a Transformation with the glossary term everywhere it is the subject
AssertionError: expected 'مبادرة التحول' to be 'التحوّل' // Object.is equality
 FAIL glossary.test.ts > ... never renders a Transformation as an Initiative (no 'مبادرة/مبادرات التحول' anywhere)
AssertionError: expected [ [ …(2) ], [ …(2) ], [ …(2) ], …(23) ] to deeply equal []
 FAIL glossary.test.ts > ... uses the glossary terms for the modes; never 'معياري' (reads as standard/normative)
AssertionError: expected 'متكامل من البداية إلى النهاية' to be 'النمط الشامل (من البداية إلى النهاية)'
 FAIL glossary.test.ts > ... uses the glossary terms for the six phases; Phase 5 differs from the Transformation term
AssertionError: define: expected 'التحديد' to be 'التحديد (تحديد التوجّه)'
 FAIL glossary.test.ts > ... uses the glossary role, record and methodology names
AssertionError: expected 'قائد التحول' to be 'قائد التحوّل'
 FAIL auditChanges.test.ts > audit field labels > maps every audited field key to a label in both languages (no raw keys)
 FAIL transformations.test.tsx > after create (F-DG1-004) > explains, in English, that the draft was created but cannot be opened (server 404), instead of 'Not found'
 FAIL transformations.test.tsx > after create (F-DG1-004) > explains the same in Arabic (RTL), using the glossary term for Transformation
 FAIL transformations.test.tsx > after create (F-DG1-004) > treats a 403 for the just-created record the same way
 FAIL transformations.test.tsx > audit trail changes (F-DG1-005) > English: field and value labels, not raw keys or enum codes
 FAIL transformations.test.tsx > audit trail changes (F-DG1-005) > Arabic: the same changes with Arabic labels in the RTL layout
 Test Files  3 failed (3)
      Tests  15 failed | 11 passed (26)
```

Of the 11 that passed on the old code, 4 assert behaviour that was already correct and must stay so:

- the plain 404 and 403 messages;
- foreign router state not being misread as "just created";
- the shown-when-readable path;
- the English glossary names.

The others exercise the new pure module on its own.

Final test tail:

```
 ✓ |unit-web| src/i18n/glossary.test.ts (8 tests)
 ✓ |unit-web| src/lib/auditChanges.test.ts (9 tests)
 ✓ |unit-web| src/pages/transformations/transformations.test.tsx (9 tests)
 ✓ |unit-web| src/components/States.test.tsx (15 tests)
 ✓ |unit-web| src/lib/lib.test.ts (18 tests)
 ✓ |unit-web| src/app/app.test.tsx (16 tests)
 ✓ |unit-web| src/i18n/i18n.test.ts (11 tests)
 ✓ |unit-web| src/styles/styles.test.ts (6 tests)
 Test Files  8 passed (8)
      Tests  92 passed (92)
```

### Interaction checks run

**In the component tests (jsdom, real router and providers, scripted fetch):**

- Fill the create form (select the BU, type the name, click Create) as a TL with a non-inheriting BU grant. Then:
  - the server returns 200 for the new record: navigation happens and the success banner and `TR-0042` heading appear;
  - the server returns 404, or 403: the `created-not-visible` alert appears, with the correct EN and AR text and a working back link, and "Not found" does not appear.
- A direct 404 shows Not found (EN and AR), and a 403 shows no-permission.
- The rendered audit trail has exact Changes-cell text in EN and AR, and no raw keys, enum codes, UUIDs or `∅`.

**In Playwright (mocked API, built SPA):**

- the list;
- the create form with the Modular radio checked;
- About;
- the detail page with the audit trail;
- TL create → created-not-visible;
- a plain 404.

Each was captured in both languages, with `<html dir>` asserted (`rtl` for AR, `ltr` for EN) and axe run.

## 4. Visual evidence

These screenshots were produced with a mocked API, not the live stack. Data is SYNTHETIC. Directory: `docs/delivery/handbacks/DG1/round-2/T-DG1-FE2-evidence/screenshots/`.

| Screen | EN | AR |
|---|---|---|
| List (title, nav label) | `en/01-list.png` | `ar/01-list.png` |
| Create form, Modular (mode terms, buttons) | `en/02-create-form-modular.png` | `ar/02-create-form-modular.png` |
| About (playbook name) | `en/03-about.png` | `ar/03-about.png` |
| Detail: phase stepper (Phase 5 `التحويل والتنفيذ`) and localized audit trail | `en/04-detail-audit-trail.png` | `ar/04-detail-audit-trail.png` |
| TL after create: created-not-visible | `en/05-created-not-visible.png` | `ar/05-created-not-visible.png` |
| Plain 404 | `en/06-plain-not-found.png` | `ar/06-plain-not-found.png` |
| axe summary | `en/axe-summary.json` | `ar/axe-summary.json` (contains both languages; all empty) |

I reviewed AR 02, 04 and 05 and EN 04 myself:

- RTL mirroring is correct.
- The long glossary phase and mode labels wrap inside the stepper boxes and radio cards without overflow.
- LTR identifiers (TR-0001, SAR, Asia/Riyadh) are isolated correctly inside the Arabic audit rows.

## 5. Known gaps, not done, BLOCKED

- **BLOCKED: real-stack e2e (`apps/web/e2e/journeys.spec.ts`).** I did not run it. The assignment says the reviewers run it authoritatively on the frozen candidate, and asks me not to start the API/DB stack. I checked statically that its assertions use `tr(lang, key)` with `escape(...)`, so the new mode label with parentheses is still matched as a regex substring.
- **Round-1 screenshots now outdated.** `apps/web/e2e/screenshots/{en,ar}/*` are the round-1 real-stack captures. The Arabic ones now show outdated terms until the next real-stack e2e run regenerates them. I did not edit them by hand.
- **F-DG1-004 end to end.** Whether the TL actually lands on the record after create depends on backend F-DG1-106. I verified the frontend logic for both server outcomes with mocked responses only.
- **Arabic-language owner review** of the glossary terms is still pending, as the glossary itself says.
- **Workspace artifacts not mine.** Untracked files in the worktree root (`.bashrc`, `.profile`, `.gitconfig`, `.zshrc`, `CLAUDE.local.md`, `.idea`, `.vscode`, `.mcp.json`, …) were not created by this task. Do not integrate them.

## 6. Dependency requests

None. I used only packages that were already installed: `@playwright/test`, `@axe-core/playwright`, `vitest` and testing-library.

## 7. Merge instructions

- No migrations and no API or contract changes.
- Expect conflicts only if another round-2 worker edits `apps/web/src/i18n/**` or the two transformation pages. All JSON edits are value changes plus added keys, so resolve key by key.
- After integration, rerun `pnpm --filter @mth/web test`. The glossary test reads `docs/analysis/glossary.md` through a relative path from `apps/web/src/i18n`, so the repository layout must stay as it is.
- The real-stack e2e will regenerate `apps/web/e2e/screenshots/**` with the new terms.
