# Handback: T-DG2-FE2, mode guidance (REQ-PB-003) and the Team screen (REQ-PB-012 / REQ-S10-008)

- **Role:** frontend-ux-engineer
- **Stage:** DG2 (BUILDING)
- **Branch:** `claude/mobily-transformation-platform-regate`
- **Base:** `ea72d86c7264e296a5bd033e6a73c7340f5d9e5f` (verified with `git rev-parse HEAD` before writing anything)
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG2-T-DG2-FE2-frontend-ux-engineer-20261002T032938Z-035157a6","session_id":"035157a6-4189-4afc-898f-b9188ed8c617"}`
- **Assignment:** `docs/delivery/assignments/DG2/T-DG2-FE2.md`, sha256 `2b7ab72a…a009084`, verified.

**Scope:** every change is under `apps/web/**`, except this handback file. There is no dependency change, and nothing under `apps/api`, `apps/worker`, `packages` or `docs` was touched.

This work is uncommitted in the working tree, so the orchestrator integrates it.

## 1. Changed files

| File | Purpose |
|---|---|
| `src/pages/transformations/TransformationCreatePage.tsx` | Each mode option now shows "When to use: …". A new `ModeGuidance` live region shows the selected mode's **When to use** and **How**, with a B0009 provenance line. In Arabic it also shows the verbatim English source on its own LTR line, marked `lang="en" dir="ltr"`. |
| `src/i18n/{en,ar}/transformations.json` | `form.modeHelp` (paraphrased help) is replaced by `form.modeGuidance.{title,whenToUse,how,source,original,end_to_end.*,modular.*}`. EN holds the B0009 source text verbatim; AR holds a translation marked provisional in the UI. Adds `tabs.team`, and the entry-phase hint now says it is required for Modular. |
| `src/pages/team/TeamPage.tsx` (new) | The **Transformations > Team** workspace tab (details in §2). |
| `src/i18n/{en,ar}/team.json` (new) | New `team` namespace (EN/AR key parity is tested). |
| `src/i18n/index.ts` | Registers the `team` namespace. |
| `src/components/Workspace.tsx`, `src/app/router.tsx` | Adds the `team` tab and the `transformations/:id/team` route. |
| `src/api/queries.ts`, `src/api/types.ts` | Adds `useRoleAccountabilities()` (`GET /api/v1/role-accountabilities`) and the `RoleAccountability` type, from the shared schema. |
| `src/components/People.tsx` | `usePeople` also returns `nameOf(id)`: the plain display name where readable, otherwise null. Existing callers are unchanged. |
| `src/styles/app.css` | `.mode-guidance*`, `.role-list`, `.role-card*`, `.accountability__source`. Tokens and logical properties only. |
| `src/pages/transformations/modeGuidance.test.tsx` (new) | 5 tests (listed in §3). |
| `src/pages/team/team.test.tsx` (new) | 6 tests (listed in §3). |
| `src/pages/p2.test.tsx` | The AUD sweep now includes `team`, and `Assign` was added to the write words. That word is anchored so the "Assigned at" sort button cannot match. |
| `src/i18n/i18n.test.ts` | The enumeration check now covers `modeGuidance.{mode}.{whenToUse,how}` instead of `modeHelp`. |
| `e2e/journeys.spec.ts` | The create journey asserts the verbatim guidance for **each** mode in EN and AR. It also asserts that Modular without an entry phase marks the field invalid and stays on `/new`. |
| `e2e/p2-journeys.spec.ts` | The Team tab is in the tab list. A new step "Team: the six governance roles … the lead assigns a Workstream Lead" was added. The AUD sweep now includes `team`: accountability is shown, the new assignment is visible, and there is no assign control. |

## 2. Behaviour delivered

### REQ-PB-003: verbatim mode guidance on New transformation

**Verbatim strings used (EN catalogue).** They are identical to `docs/source/playbook.md`, B0009 table. The unit test compares them character for character against that file.

| Mode | When to use | How |
|---|---|---|
| End-to-End | `New enterprise or business-unit transformation` | `Run Phases 1-6 sequentially. Do not launch initiatives before the North Star, outcomes and target state are clear.` |
| Modular | `A transformation is already underway` | `Enter at the relevant phase, complete the minimum mandatory templates, then reconnect to outcomes and benefits.` |

Source (playbook.md, after `<!-- B0009 table -->`):

```
| End-to-End | New enterprise or business-unit transformation | Run Phases 1-6 sequentially. Do not launch initiatives before the North Star, outcomes and target state are clear. |
| Modular | A transformation is already underway | Enter at the relevant phase, complete the minimum mandatory templates, then reconnect to outcomes and benefits. |
```

The assignment cited "the rows after B0008". The table itself is anchored **B0009**, so the UI and tests cite B0009.

**How the guidance appears**
- Each mode radio shows "When to use: …".
- A region named "Guidance for the {mode} mode" shows When to use and How for the selected mode. It is `aria-live="polite"`, so the guidance is announced when the mode changes.
- A provenance line reads "Source text of the Business Transformation Playbook v1.0, mode table (B0009)."

**Arabic**
- The Arabic text is a translation that uses the glossary terms (النمط الشامل / النمط الجزئي المرن, النجم الشمالي…).
- The UI labels it "ترجمة مؤقتة … وتحتاج إلى مراجعة مالك اللغة العربية".
- The verbatim English source is shown beneath it under "النص الأصلي للمصدر (بالإنجليزية)". So in both languages the e2e asserts that the exact source text is on screen.

**Modular requires an entry phase**
- Client side, the shared `transformationCreate` schema puts `validation.required` on the Entry phase field, and nothing is POSTed. This is tested in the unit test and in the e2e for EN and AR.
- A server field error with pointer `/entryPhase` is shown on that field. This is unit-tested.

### REQ-PB-012 / REQ-S10-008: Transformations > Team

**Minimum governance roles**
- The six B0018 roles in playbook order: SP, TL, BO, WL, FIN, TO.
- Each card shows:
  - the role name;
  - its **accountability** from `GET /role-accountabilities`. English is `accountabilityEn`, which is B0018 verbatim. Arabic is `accountabilityAr`. A provenance label is derived from `isSourceText`: "Playbook source text (B0018)" or "ترجمة مؤقتة لنص الدليل (B0018)";
  - the people assigned, with the scope: "This transformation" or "Inherited from Organization level".
- An unmapped role says "No one is assigned to this role for this transformation." in words and with an icon (`data-state="unassigned"`). It is never blank.

**Implementation roles**
- KDS, TD, CM and SEC are always listed, plus any other role on the team (for example AUD). Each is labelled "Platform text (M0187)".
- WL is listed once, under the governance roles.

**Team members table**
- Columns: person, role, **accountability on each assignment**, assigned at, effective from, effective until.
- It uses the existing `RegisterTable`, so sort, filter, column selection and pagination come with it.
- Dates are shown in the transformation's time zone.

**Names**
- A name resolves from the session or `GET /users/{id}` where readable.
- Otherwise it falls back to "Team member (roles, ref. xxxx)", the same pattern the existing owner pickers use. It is never a raw id alone.

**Assigning a role**
- **Assign** is offered only when `team.assign` is held on the transformation (TL/TO) and the transformation is not archived.
- Per role, it is offered only for WL, KDS, TD, CM and SEC (`TEAM_ASSIGNABLE_ROLES`). For approver/admin roles (SP, BO, FIN, TL, TO, AUD) the UI states that an access administrator assigns them.
- The dialog has three fields:
  - **Person.** Active org users if the caller has `user.read`, otherwise people already on the team. The caller is never listed, because the server refuses self-grants. The hint explains this.
  - **Role.**
  - **Reason** (required).
- The dialog also previews the selected role's accountability.
- The request is POSTed with the shared `teamAssignmentCreate` schema and an Idempotency-Key.
- 403 and 422 responses are shown as translated banners. On success the team is refetched and the status message reads "Role assigned: … recorded in the audit trail".
- The intro states that this is an access change and **not a business approval**. No G1–G6 or DG0–DG7 approval is implied.

**AUD and other non-assigners**
- The read-only note is shown and there is **no assign control** anywhere on the page. The server still returns 403.
- The unit test and the e2e (EN and AR) assert this.

## 3. Checks actually run

Environment: Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline sandbox, pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). All results below are from the final candidate state, after the last fix.

| Command | Result |
|---|---|
| `node tools/gates/validate.mjs --historical --stage DG1` (before implementation and again at the end) | `PASS gate DG1 (historical)`, exit 0 both times |
| `pnpm -r typecheck` | exit 0 (`apps/api typecheck: Done`, web includes `tsconfig.e2e.json`) |
| `pnpm -r build` | exit 0 (`apps/web build: ✓ built in 2.92s`) |
| `pnpm lint` (`eslint . --max-warnings=0`) | exit 0, no output |
| `pnpm format:check` | **exit 2, environment only:** prettier cannot read the untracked, sandbox-masked repo-root dotfiles (`.zshrc`, `.vscode`, `CLAUDE.local.md`… → EACCES). It still printed "All matched files use Prettier code style!". As a substitute I ran `git ls-files -co --exclude-standard -- apps/web \| xargs npx prettier --check --ignore-unknown` → "All matched files use Prettier code style!", exit 0. The orchestrator should re-run `pnpm format:check` outside the sandbox. |
| `pnpm --filter @mth/web test` | exit 0: **Test Files 11 passed, Tests 153 passed** (141 before this task) |
| `pnpm --filter @mth/design-tokens run check:contrast` | exit 0: `PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented` |
| New colour pair not in the token list: `feedback.warning.fg #7A4B00` on `surface.card #FFFFFF` (the "unassigned" text) | Computed with the WCAG formula (node): **7.41:1**, which passes AA 4.5:1 |
| E2E: `E2E_PG_PORT=55448 E2E_API_PORT=3448 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1 --reporter=list` (real API + disposable PostgreSQL, migrate + seed-dev) | **38 passed (2.3m)**, exit 0. That is 19 in `chromium-en` and 19 in `chromium-ar`. |
| axe in the e2e (WCAG 2.0/2.1 A+AA) | Serious or critical violations fail the test; none occurred. Every new page (`create-guidance-*`, `p2-team*`, `p2-aud-team`) has **zero violations of any impact** in both `axe-summary*.json`, EN and AR. |

**Unit tests added (11), all passing**
- `modeGuidance.test.tsx`:
  - EN catalogue equals the B0009 table from `docs/source/playbook.md`;
  - EN region shows When to use and How and switches with the mode; radio names include When to use;
  - Modular without an entry phase gives a field error and no POST;
  - a server `/entryPhase` error lands on the field;
  - AR shows the provisional text, RTL, and the English source in `bdi lang=en dir=ltr`.
- `team.test.tsx`:
  - six roles in order, with the B0018 text from the playbook file verbatim; holders; role+ref fallback; inherited scope; unassigned state; admin-only note; WL not duplicated;
  - members table with accountability, sort and filter;
  - assigning WL: POST body `{userId, roleCode:"WL", reason}`, Idempotency-Key, the caller excluded from candidates, accountability preview, success status;
  - a 403 is shown in words;
  - AUD: read-only, no assign control;
  - Arabic RTL.

**E2E relevant output (final run)**

```
  ✓   3 [chromium-en] › journeys.spec.ts:258:1 › create a modular transformation with an entry phase (4.2s)
  ✓  18 [chromium-en] › p2-journeys.spec.ts:750:1 › Team: the six governance roles with their B0018 accountability; the lead assigns a Workstream Lead (4.6s)
  ✓  19 [chromium-en] › p2-journeys.spec.ts:814:1 › read-only auditor (AUD): every P2 screen without write controls; Unknown and Unquantified rendered (10.6s)
  ✓  22 [chromium-ar] › journeys.spec.ts:258:1 › create a modular transformation with an entry phase (4.2s)
  ✓  37 [chromium-ar] › p2-journeys.spec.ts:750:1 › Team: … the lead assigns a Workstream Lead (4.1s)
  ✓  38 [chromium-ar] › p2-journeys.spec.ts:814:1 › read-only auditor (AUD): … (9.9s)
  38 passed (2.3m)
```

**Interaction checks run in the real-stack e2e**
- Create journey, both languages:
  - the End-to-End guidance is shown; checking the Modular radio switches the region;
  - the EN `[data-guidance]` and AR `[data-guidance-source] bdi` texts equal the literal B0009 strings;
  - Create without an entry phase gives `aria-invalid="true"` and the URL stays `/transformations/new`;
  - choosing Design then creates the record.
- Team (dev.lead):
  - 6 role cards in order;
  - every governance role has `data-source-text="true"` and the B0018 label; in EN the text is exactly B0018;
  - TL is "This transformation", TO is "Inherited from Organization level", BO is unassigned;
  - Assign: Workstream Lead → the dialog previews the WL accountability → choose dev.office → reason → **Assign role** → dialog closes, success status, WL has 1 holder.
- AUD on Team: read-only note, no enabled write control (the `team.assign.action` label is now in the sweep), 6 source-text accountabilities, the new WL assignment visible, no admin-only note.

**Screenshots** (Playwright, full page, regenerated by the final run, 52 per language)

`apps/web/e2e/screenshots/{en,ar}/`:
- `04b-create-guidance-end_to_end.png`
- `04c-create-guidance-modular.png`
- `p2-17c-team.png`
- `p2-17d-team-assign.png`
- `p2-17e-team-assigned.png`
- `p2-18-aud-team.png`
- `axe-summary.json`, `axe-summary-p2.json`

As in T-DG2-FE, this directory is gitignored (`.gitignore:22`) and my scope excludes `test-evidence/`, so these are local artefacts. They can be regenerated with the e2e command above.

I inspected the EN and AR guidance and Team screenshots myself. That inspection found two defects, both fixed before the final run:
- WL was duplicated in the implementation-role list;
- in Arabic, the inline English source wrapped around its Arabic label. It is now on its own LTR line.

## 4. Known gaps / not done

1. **Assigning approver roles from the Team screen is not possible, by design of the API.** `POST …/scoped-assignments` accepts only WL, KDS, TD, CM and SEC. SP, BO, FIN, TL, TO and AUD are assigned by an access administrator through the existing Administration > Assignments screen. The Team screen shows those roles, their accountability and holders, and states who assigns them.
2. **Candidate people for a TL/TO without `user.read`** are only the people already on the team, because `GET /users` needs `user.read`. To staff someone new, the TL/TO needs an access administrator or a directory permission. This is an API/permission-model constraint, stated in the dialog hint.
3. **No revoke or end-date control on the Team screen.** Effective-from and effective-to are optional in the API and are not offered in the dialog. Revocation stays in Administration > Assignments. This was not in this assignment.
4. **REQ-S10-008 later-gate acceptance is not delivered here.** Decision routing to the mapped Business Owner, and "unmapped role blocks routing" (final gate DG4), are outside the P2 UI. This screen delivers the role-to-person mapping view and the visible "No one is assigned" state.
5. **The Arabic texts are provisional.** This covers the mode guidance and the AR accountabilities (from the DB seed). They need review by a Mobily Arabic-language owner, and the UI says so.
6. **`pnpm format:check` at the repository root** could not complete in this sandbox (EACCES on the masked dotfiles). The prettier check over `apps/web` passed. This is listed as environment-limited, not as a pass.

## 5. Merge instructions

- No migrations, no dependency or lockfile change, and no API or contract change. The page uses only the existing `GET /role-accountabilities` and `GET`/`POST /transformations/{id}/scoped-assignments`.
- New untracked files to add:
  - `apps/web/src/pages/team/TeamPage.tsx`
  - `apps/web/src/pages/team/team.test.tsx`
  - `apps/web/src/pages/transformations/modeGuidance.test.tsx`
  - `apps/web/src/i18n/{en,ar}/team.json`
- The catalogue key `transformations.form.modeHelp.*` was **removed** in favour of `transformations.form.modeGuidance.*`. I found no other users in the repo (`grep -rn modeHelp` over `apps/web/src` and `apps/web/e2e`). A concurrent branch that still uses it would fail the i18n "used keys exist" test.
- `modeGuidance.test.tsx` and `team.test.tsx` read `docs/source/playbook.md` (read-only) to prove verbatim text, as `glossary.test.ts` already reads `docs/analysis/glossary.md`.
- I expect no conflicts. The touch points shared with other owners are none: everything is under `apps/web`.
