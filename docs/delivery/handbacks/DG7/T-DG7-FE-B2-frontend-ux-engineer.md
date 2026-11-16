# Handback T-DG7-FE-B2 (frontend-ux-engineer): automation_rule hidden from the bundle export screen

- **Stage:** DG7 (P7 "Independent transfer and release", BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` `9822f666d4aaa7cfea37a5d21b4faf88ae6f5c8f`. At the start the working tree was clean except for this run's own `docs/delivery/runs/` directory.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-FE-B2.md`, sha256 `99d18530…f82c`, verified.
- **Invocation:** run `DG7-T-DG7-FE-B2-frontend-ux-engineer-20261114T211100Z-d216753b`, session `d216753b-d969-4008-afc7-ce58b33ceea7`.
- **Time:** started 2026-11-14T21:11:11Z (`date -u`). The end time is in §3.
- **What I read:**
  - p7-work-split §1, §2 and §D.2 (screen texts);
  - ADR-0065 in full, including Amendment 1 (A1.1–A1.3);
  - the ARCH-R7 handback and the BE-F2 handback (§4 items 2–3, Q3);
  - `UNPORTABLE_BUNDLE_KINDS` in `packages/shared/src/transfer/config-bundle.ts`;
  - the screen, its tests and FE-B's handback and screenshot script.
- **Not read in full:** `docs/architecture/p7-plan.md` and decisions D-243 onward. I read only the parts the ADR cites. No reread was needed for this one-screen change, but the assignment asked for it.
- **Scope:** web UI only. Nothing here grants a business, Finance or IT approval. Product gate G6 does not imply DG7, and DG7 does not imply any product gate.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `apps/web/src/api/p7.ts` | Adds `EXPORTABLE_CONFIG_BUNDLE_KINDS` and `UNPORTABLE_CONFIG_BUNDLE_KINDS`. Both are derived from the shared `UNPORTABLE_BUNDLE_KINDS` (`@mth/shared/transfer`), so the screen and the server read one list. `CONFIG_BUNDLE_KINDS` keeps all 12 values, matching the contract enum (A1.2 item 3). |
| `apps/web/src/pages/admin/config-transfer/ConfigTransferPages.tsx` | The export form offers and sends only `EXPORTABLE_CONFIG_BUNDLE_KINDS` (11 kinds, in contract order). A new `NotCarriedNote` sits inside the kinds fieldset, after the hint. The fieldset's `aria-describedby` names both the hint and the note, so a screen reader reads them with the group. Import item labels and sorting still use all 12 kinds. |
| `apps/web/src/i18n/en/transfer.json`, `apps/web/src/i18n/ar/transfer.json` | Adds the new key `bundle.notCarriedNote` (EN and AR). `bundle.kindsHint` now says "every **listed** kind", so the hint stays true: the default export leaves out `automation_rule` even when it is published. |
| `apps/web/src/pages/admin/migration/transfer-screens.test.tsx` | Four new component tests (two cases × EN/AR), described in §2. |
| `docs/delivery/handbacks/DG7/T-DG7-FE-B2-evidence/**` | Logs, the real-stack script `fe-b2-shots.mjs`, screenshots and `summary.json`. |
| this handback | — |

- **No API change.** There is no contract, migration or `p7-pending*.ts` change, and no pending entry belongs to this task (`grep` over `apps/api/test/support/p7-pending*.ts` found none).
- **No mutation added.** The export mutation is BE-F's, and its 422 refusal of the kind is BE-F2's, tested there. So this task adds no new authorization, validation, concurrency or audit obligations.

## 2. Behaviour per requirement

### REQ-S19-008 and ADR-0065 Amendment 1, A1.2 item 6 (BE-F2 Q3)

**The export form**

- The "Kinds to export" group offers 11 checkboxes in contract order. `automation_rule` is not among them. `automation_rule_set` still is.
- Ticking every offered kind sends exactly those 11 kinds. Leaving all unticked sends no `kinds` field, as before, and the server's default carries the 11 kinds (A1.2 item 2).

**The note.** It sits where the kinds are listed:

- EN: "Not carried by a bundle: automation rules. Each rule names its owner by user ID, which another installation does not have, so recreate automation rules by hand there, with their own owners. Automation rule sets are carried."
- AR (provisional): "لا تنقل الحزمة قواعد الأتمتة: تحدد كل قاعدة مالكها بمعرّف مستخدم لا يوجد في منصة أخرى، لذا أعد إنشاء قواعد الأتمتة يدويًا هناك مع مالكيها. أما مجموعات قواعد الأتمتة فتُنقل."
- The work split gives no text for this key. I wrote the Arabic, and it is labelled provisional automatically (source `fe-b` in `provisional-ar-p7-transfer.ts`, as for every non-work-split leaf).
- The note's `data-kinds` attribute is computed from the shared list. The test pins it to `automation_rule`, so the text and the list cannot drift silently.

**Import is unchanged.** An imported `automation_rule` item is still labelled "Automation rule" and shown as Refused, with the `kind_unavailable` text. Commit is not offered for it.

**Component tests** (`transfer-screens.test.tsx`, each case in EN and AR):

- **"the export form offers every kind except automation_rule, says why, and never sends it"** checks that:
  - the checkbox values equal `CONFIG_BUNDLE_KINDS` less `automation_rule`, and equal `EXPORTABLE_CONFIG_BUNDLE_KINDS`;
  - the shared list is exactly `["automation_rule"]`;
  - no "Automation rule" checkbox exists;
  - the note text is exact and is in the group's `aria-describedby`;
  - the POST body sends the 11 kinds;
  - no `unportable_reference` text is shown.
- **"an imported automation_rule item is still labelled, and shown refused with its reason"**.

**Mutation check.** I put `CONFIG_BUNDLE_KINDS.map` back into the form, and the first test failed in both locales (exit 1, `mutation-all-kinds-offered.log`). The file was then restored.

### Bilingual, accessibility and states

- EN and AR texts are present, and the namespace tests still pass (identical key sets, every Arabic leaf provisional, work-split texts exact, no gate or conformity wording).
- **Real stack, both locales:**
  - `dir` and `lang` are correct;
  - axe (WCAG 2.0/2.1 A+AA tags) reports no violations on these screens, before and after the export;
  - at 360 px there is no horizontal overflow;
  - no request leaves the origin.

## 3. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, agent sandbox with no network and no Docker. PostgreSQL comes from `/usr/lib/postgresql/*/bin` through the repository harnesses, and Chromium from `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Logs are in `docs/delivery/handbacks/DG7/T-DG7-FE-B2-evidence/`.

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 1 | `npx vitest run --project unit-web apps/web/src/pages/admin/migration/transfer-screens.test.tsx apps/web/src/app/p7-shell.test.tsx` | 0 | 2 files, 39 tests (28 + 11) | `component-tests.log` |
| 2 | Mutation: the form maps `CONFIG_BUNDLE_KINDS`; the same file with `-t "except automation_rule"` | 1 (expected) | 2 failed (en, ar), 26 skipped | `mutation-all-kinds-offered.log` |
| 3 | `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` | `validate-historical-DG6.log` |
| 4 | `pnpm -r build` | 0 | — | `build.log` |
| 5a | `E2E_PG_PORT=27741 E2E_API_PORT=27742 REPO_ROOT=$PWD OUT=… apps/web/e2e/support/with-stack.sh node fe-b2-shots.mjs` (run 1) | 1 | `10 checks, 2 failed`: script defect, see below | `screenshots-run-1-script-defect.log`, `screenshots-run-1-summary.json` |
| 5 | the same, with the fixed script (final) | 0 | `10 checks, 0 failed` | `screenshots-run.log`, `screenshots/summary.json` |
| 6 | `pnpm -r typecheck` | 0 | — | `typecheck.log` |
| 7 | `pnpm lint` | 0 | — | `lint.log` |
| 8 | `pnpm openapi:lint` | 0 | `OpenAPI 3.1.1, 965 operations` | `openapi-lint.log` |
| 9 | `pnpm test` | 0 | unit-node 205 files / 3022 tests; unit-web 130 / 2179 (ARCH-R7's run had 2175; +4 are this task's new tests); nocodegen 3 / 259 (+2 skipped, pre-existing) | `pnpm-test.log` |
| 10 | `QA_PG_PORT=27751 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | 0 | 111/111 | `contract-integration.log` |
| 11 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (this handback included) | 0 | `All matched files use Prettier code style!` | `prettier.log` |

**Run 5a (script defect).** In both locales the export returned 201 with the 11 kinds. The script read the "Bundle exported" banner with `isVisible()` before it had rendered. The run-1 screenshot shows the banner. The fix waits for the banner (`waitFor`, 15 s); nothing in the product changed between runs 5a and 5.

**Interaction checks in run 5**, per locale (`screenshots/summary.json`):

1. **The form.** The offered checkbox values equal the 11 expected kinds. There are 0 checkboxes labelled "Automation rule". The note's text equals the catalogue text, it is visible, and it is in the fieldset's `aria-describedby`. `dir` and `lang` are correct, and axe reports 0 violations.
2. **Keyboard.**
   - Focus starts on the first kind, then Tab ×10. Focus visits exactly the 11 kinds in order and never reaches an `automation_rule` control.
   - Each focused checkbox matches `:focus-visible` and has an outline or box shadow.
   - Space ticked all 11.
3. **Real export.**
   - With a reason, clicking "Export bundle" sent `kinds` = the 11 kinds.
   - The API answered **201**, and the response `kinds` lacks `automation_rule`.
   - The "Bundle exported" banner appeared, no `unportable_reference` text appeared, and axe reports 0 violations.
4. **Narrow viewport.** 360 px: horizontal overflow 0 px.
5. **No foreign requests.**

**Screenshots** (English in `screenshots/en/`, Arabic in `screenshots/ar/`, the same file names in both, all under `docs/delivery/handbacks/DG7/T-DG7-FE-B2-evidence/`):

- `config-transfer-export-form.png` (full page, before);
- `config-transfer-kinds-group.png` (the kinds group with the note);
- `keyboard-focus-first-kind.png` (viewport, focus ring on the first kind);
- `config-transfer-after-export.png` (full page, after the real export; the list shows the 11 kinds);
- `config-transfer-360.png`.

**Data and cleanup**

- All data is SYNTHETIC: the dev seed and the dev.admin user. The harness deleted its PostgreSQL clusters.
- My scratch copies under `$TMPDIR` (the original page copy for the mutation check, and the script copy) were deleted.
- No extra checkout was made.

**End:** 2026-11-14T21:33:23Z (`date -u` before the final prettier check).

**Protocol note:** the DG6 `--historical` validator ran after the edits, not before them. It passed.

## 4. Known gaps

1. **No existing e2e or visual spec covers this screen.** `e2e/` and `apps/web/e2e/` have no spec for `/admin/config-transfer`, so none needed updating. The real-stack evidence is the script in `fe-b2-shots.mjs` (as FE-B did). It is not a spec in CI. Turning it into a Playwright spec is QA's call (open question Q2).
2. **The Arabic of `bundle.notCarriedNote` is provisional**, written by this task. It is not reviewed by a qualified Arabic reviewer.
3. **The DOC-B `known-limitations.md` row and its Arabic summary for `automation_rule`** are not mine and not done here. They are routed per ADR-0065 A1.2 item 6.
4. **The note names only automation rules.** The ADR's wider "never in a bundle" list (drafts, history, business records, users, secrets, connectors, webhooks, `benefit_formula` versions) is not shown on the screen. The intro's "Export published configuration" already implies part of it. Whether to list it all is open (Q1).
5. **I did not read `p7-plan.md` and D-243 onward in full** (see the header).

## 5. Open questions and merge instructions

- **Q1 (orchestrator / domain).** Should the export screen also list ADR-0065 §1's "never in a bundle" items, or does the user guide (DOC-A) carry them? I kept the note to the kind this task removes, to avoid adding claims beyond its scope.
- **Q2 (QA).** Should `fe-b2-shots.mjs` (and FE-B's `fe-b-shots.mjs`) become a Playwright spec under `apps/web/e2e/`?
- **Q3 (DOC-A).** The admin guide's Configuration transfer section should mention that automation rules are not offered for export, and why.
- **Merge.** There are no migrations, contract, generated or `p7-pending` changes. A conflict is possible only if another task edits `transfer.json`, `ConfigTransferPages.tsx`, `api/p7.ts` or `transfer-screens.test.tsx`. The new texts are additive. `kindsHint` changed by one word in each locale.
- This change approves nothing. Product gate G6 does not imply DG7, and DG7 does not imply any product gate G1–G6. No business, Finance or IT approval is granted or implied.
