# Handback T-DG3-FE-F: the G4 refusal in the shown language, item by item (frontend-ux-engineer)

- **Stage:** DG3 (P3 "Mobilization and portfolio"), BUILDING. **Task:** T-DG3-FE-F (assignment sha256 `cdb328f9…99c13`).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-FE-F-frontend-ux-engineer-20261008T052715Z-f3128b69","session_id":"f3128b69-9586-4e77-997e-030bf6700cbf"}`
- **Working tree:** `/home/user/wt/dg3-fe-f`, branch `dg3/fe-f`, starting `HEAD` `af78f8b8f6cb98e288dee90495ca13fa7105ceb1` (clean apart from untracked sandbox stubs such as `.bashrc` and `.mcp.json`, which are not mine and not part of this change).
- **Time:** started `Thu Oct 8 05:27:23 UTC 2026`, ended `Thu Oct 8 06:09:44 UTC 2026` (`date -u`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` → `PASS gate DG2 (historical)`, exit **0**, at the start (`validate-dg2-historical-start.log`) and again at the end (`validate-dg2-historical-end.log`).
- **Nothing is committed.** The changes are in the working tree for the orchestrator to commit and merge (see §5).

All evidence is under `docs/delivery/handbacks/DG3/T-DG3-FE-F-evidence/`. All data is SYNTHETIC. Every business decision in the e2e setup (G1–G3 approvals, selection, Finance validations, funding, capacity commitment) is a demo record that approves nothing real. Product gate G4 never implies any engineering gate DG0–DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/gates/GateDetailPage.tsx` | The fix. `GateProblem` sends a G4 422 `gate_criteria_incomplete` (every `errors[].pointer` is `/criteria/g4.*`, see `g4RefusedCriteria`) to the new `G4RefusalItems`. That component lists the refused criteria's items **from the gate view** (`useGate(tid,"G4")` → `criteria[].missing[]`), one `<li>` per item. Each item shows the translated label for its code and its subject. Without a usable view, it shows one translated title per criterion. The joined English `message` is never read for display. `SubmitDialog` now refreshes through `useP3Refresh` (P2 and P3 keys, session-bound, invalidation only, no `setQueryData`). `useSubjectResolver(withInitiatives)` resolves G4 initiative items to the record's own `code name` (reads `p3Keys.initiatives`, only for G4), and also handles `/dependencies/…` and `/resource-roles/…`. It translates business case section codes and the card field list of `g4.initiative_card_incomplete`. Empty-id pointers (`/initiatives`, `/business-cases`) get no subject. `g4Subject` now strips the card field suffix, and `g4CardFields` is new. G1–G3 refusals go through the unchanged DG2 branch. |
| `apps/web/src/pages/gates/g4.test.tsx` | New unit tests, run in EN and AR: (a) a stubbed 422 whose single `g4.owners` entry joins two English labels, plus a stubbed gate view with two `g4.owner_missing` items and the initiatives list. The test expects two separate translated items with the right initiative each, no joined message, a re-read of the gate view after the 422, and in AR no "Owners", "Finance validation" or "Gap link missing" in the alert or the page. (b) The refreshed view fails (404), and the test expects one translated line per refused criterion and no English. (c) `g4Subject` and `g4CardFields` parsing. |
| `apps/web/e2e/p3-g4-refusal.spec.ts` | **New** e2e on the real stack (chromium-en, chromium-ar). See §2. |
| `apps/web/src/i18n/en/gates.json`, `apps/web/src/i18n/ar/gates.json` | Missing keys added: `missingItems.g4__initiative_card_incomplete` (the §11 item 2 code had no label); `criterionTitle.g4__*` (8 criterion titles for the fallback, with the AR titles copied from the seeded `label_ar` of migration 0024); `subject.dependency` and `subject.resourceRole`. Arabic strings are provisional translations, like the rest of the AR catalogue. |

Not touched: `apps/api/**`, `packages/**`, `app/**`, `api/**`, `apps/web/e2e/support/p3-journey-setup.ts` (imported read-only).

## 2. Behaviour delivered

The defect is FE-D handback §5 item 1, under ADR-0021 §7 "The refusal shape" (REQ-PB-019 "rejected listing 'Owners'", REQ-PB-046, and the bilingual rule).

- **Item by item, translated.** On a G4 422, the dialog's alert keeps the translated problem headline. Under it, it lists every missing item of each refused criterion from the refreshed gate view. Each item shows:
  - `t("gates.missingItems.<code>")`, then " — ", then the subject in `<bdi>`;
  - for initiatives, the subject is the record's `code name` from `GET /initiatives?transformationId=` (fallback: the data part of that single item's message, which is data, not label text);
  - for dependencies, the dependency code; for capacity conflicts, the role and period;
  - for section items, the translated section title; for Finance items, a translated "Business case" or "Benefit formula" subject.
- **Order:** the 422's criterion order, then the view's item order. `data-missing=<code>` and `data-refused-criterion=<key>` are on every item, and `data-g4-refusal="items|criteria"` is on the list.
- **Refresh:** after any 409 or 422, `SubmitDialog` awaits `useP3Refresh(tid)()` (invalidation only, session-generation-checked). This invalidates `["p2", tid, "gate", "G4"]` and the P3 initiative list.
- **Fallback:** if the gate view query is in error, or a refused criterion has no items in the view, that criterion shows one line, `t("gates.criterionTitle.<key>")` (e.g. "Owners" / "المالكون"). It never shows the English message. Disclosure: while the post-422 refetch is in flight, the list renders from the previously cached view. A criterion that was complete in that cached view shows its translated fallback title until the fresh view arrives, typically within milliseconds. No English is shown at any point.
- **Plain text inside the alert.** My first e2e run showed links inside the error banner failing axe `color-contrast` (serious). The global link/banner CSS is outside my file scope, so the refusal list renders subjects as plain text. The live readiness table behind the dialog still links each item to its record, and the e2e asserts those links.
- **G1–G3 unchanged:** their 422 goes through the original branch byte-for-byte (`g4RefusedCriteria` returns null unless every pointer is `/criteria/g4.*`). `g1-agreements.test.tsx` and the DG2 journeys pass unchanged.
- **Readiness table (side benefit, same resolver):** G4 initiative items now show the record's name. A card-incomplete item shows translated field names instead of `objective, scopeIn`. A section item shows the translated section title instead of the raw code.

**The e2e (`p3-g4-refusal.spec.ts`, 2 tests × 2 projects):**

1. **setup** (real API, built like `support/p3-journey-setup.ts` and importing it read-only). It creates a synthetic End-to-End transformation with a synthetic SP and FIN user. G1 is approved with the three confirmations, then G2 and G3. Two complete initiatives are created, submitted, scored and ranked, then selected by SP. It adds a transformation case and two initiative cases (ten sections, an investment line and a benefit line each), each benefit line backed by its own T09 formula. FIN validates every baseline and formula version and approves funding for both initiatives. Capacity is planned and committed by dev.office (TO). The setup asserts that every G4 criterion is complete.
2. **TL (dev.lead) in the UI:**
   - TL opens G4 (8 criteria, none incomplete) and opens the submit dialog.
   - In another session, both initiatives' `workstreamLeadUserId` is cleared. The spec asserts that the server's joined English text is `"Owners: INI-01 … Owners: INI-02 …"`.
   - TL clicks Submit. The alert has `data-problem=gate_criteria_incomplete`, exactly **2** `[data-missing]` items, both `g4.owner_missing`, each with the translated label, its own `code name`, and not the other initiative's code. The joined text is absent.
   - In EN, "Owners" is visible. In AR, the alert and the whole dialog contain none of "Owners", "Finance validation", "Gap link missing", "Funding decision missing" or "Capacity commitment missing".
   - axe finds no serious or critical violations, and a screenshot is taken.
   - After cancel, the readiness table shows owners incomplete with 2 items, each linking to its initiative. In AR, `main` has no English label.
   - No request leaves the origin.

**Screenshots** (full page, the refusal dialog over the live readiness):

- EN: `docs/delivery/handbacks/DG3/T-DG3-FE-F-evidence/screenshots/en/p3-g4-refusal-two-owners.png` (sha256 `bde071c5…dcdb5`)
- AR: `docs/delivery/handbacks/DG3/T-DG3-FE-F-evidence/screenshots/ar/p3-g4-refusal-two-owners.png` (sha256 `749cea3b…7bd7da6`)

I viewed both. EN shows "✕ Owners — INI-01 Synthetic roaming bundle relaunch" and "✕ Owners — INI-02 Synthetic prepaid top-up redesign" as two lines. AR shows "✕ المالكون — INI-01 …" and "✕ المالكون — INI-02 …" as two lines, RTL, with no English label. The dark backdrop covers only the first viewport height of the full-page capture: the backdrop is fixed-position and the capture is full-page, which is pre-existing and also visible in FE-D's dialog shots.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, Chromium 1194 from `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (never installed). Harness ports were `QA_PG_PORT=23500`, `E2E_API_PORT=23501` and `MTH_PORT_POOL=23502-23549`; every run bound 23500/23501 on the first attempt. Every e2e run uses a fresh `with-stack.sh` stack. "Locale unset" means `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`; "C.UTF-8" means `env LANG=C.UTF-8 LC_ALL=C.UTF-8`. I removed an empty `apps/web/.claude/.cc-writes` directory before the tests.

| Check | Command | Exit | Result (log) |
|---|---|---|---|
| DG2 historical (start) | `node tools/gates/validate.mjs --historical --stage DG2` | 0 | `PASS gate DG2 (historical)` (`validate-dg2-historical-start.log`) |
| Typecheck | `pnpm -r typecheck` | 0 | `typecheck.log` |
| Build | `pnpm -r build` | 0 | `build.log` (final run after the last source change) |
| Lint | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | `lint.log` |
| Prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (`prettier.log`; this handback was checked separately afterwards, see below) |
| Contrast | `pnpm --filter @mth/design-tokens run check:contrast` | 0 | "PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented" (`contrast.log`) |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | 80 files, **1528/1528** (`test-locale-unset.log`; FE-D's baseline was 1523, plus my 5) |
| Unit, C.UTF-8 | `env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | 80 files, **1528/1528** (`test-c-utf8.log`) |
| New spec, locale unset | `env -u LANG … apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p3-g4-refusal.spec.ts --workers=1 --reporter=list` | 0 | **4 passed** (2 chromium-en, 2 chromium-ar), 14.5 s (`e2e-p3-g4-refusal-locale-unset.log`; screenshots from this run) |
| Whole product e2e, locale unset | `env -u LANG … apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1 --reporter=list` | 0 | **168 passed**, 12.3 min (`e2e-full-locale-unset.log`) |
| Whole product e2e, C.UTF-8 | same with `env LANG=C.UTF-8 LC_ALL=C.UTF-8` | 0 | **168 passed**, 11.9 min (`e2e-full-c-utf8.log`) |
| Prettier (this handback, written after the full check) | `npx prettier --check docs/delivery/handbacks/DG3/T-DG3-FE-F-frontend-ux-engineer.md apps/web/e2e/p3-g4-refusal.spec.ts` | 0 | "All matched files use Prettier code style!" |
| DG2 historical (end) | `node tools/gates/validate.mjs --historical --stage DG2` | 0 | `PASS gate DG2 (historical)` (`validate-dg2-historical-end.log`) |

Per spec, passed counts were identical in both locale settings (chromium-en + chromium-ar):

| Spec | en | ar |
|---|---|---|
| journeys.spec.ts | 9 | 9 |
| p2-blank-text.spec.ts | 9 | 9 |
| p2-journeys.spec.ts | 12 | 12 |
| p3-business-cases.spec.ts | 6 | 6 |
| **p3-g4-refusal.spec.ts (new)** | **2** | **2** |
| p3-journeys.spec.ts (incl. FE-D's 6a G4 refusal, still 2 items) | 18 | 18 |
| p3-portfolio.spec.ts | 6 | 6 |
| p3-prioritization-roadmap.spec.ts | 7 | 7 |
| p3-seams.spec.ts | 3 | 3 |
| p3-ui-completion.spec.ts | 7 | 7 |
| session-end.spec.ts | 5 | 5 |
| **Total** | **84** | **84** (= 168; 0 failed, 0 flaky, 0 skipped) |

**Non-zero exits during development, all fixed before the final runs:**

- Two earlier runs of the new spec exited 1. In the first, the setup's readiness assertion failed: the `investment` and `benefits` business-case sections need lines, so I added them. In the second, everything functional passed, but axe reported a serious `color-contrast` violation for `.link` inside the error banner, so I removed the links from the alert (§2).
- One `tsc` attempt failed on a `TFunction` parameter type, which I fixed.
- An unrelated `tail` usage error in my own shell one-liner exited 1 after all five static checks had already printed exit 0.

## 4. Known gaps / not done

- **A visible lag after the 422.** Until the post-422 refetch of the gate view returns, a criterion that was complete in the cached view shows its translated criterion title instead of the items. It is translated and never English, and it is replaced as soon as the fresh view arrives. The e2e waits for the item list.
- **Finance validation items name only the record type.** A `g4.finance_validation_missing` item shows "Business case" or "Benefit formula", translated, rather than the case or formula title. The pointer gives only the id, and I did not add a business-case or formula lookup to the gates page. The readiness table links it.
- **Some subjects are server data, shown as the server returns them.** Dependency codes (`DEP-nn`) and capacity-conflict role and period come from the single item's message, after the label. They are data, not label text. The role label there is the role's English `labelEn` from the server, so in AR a role's English name can appear as data. The fix would be a backend change (structured item data), which is out of scope.
- **The backend 422 shape is unchanged,** by design (ADR-0021 §7, option (a)).

## 5. Merge instructions

- No migrations. Web-only change. Stage and commit the four modified files, the new spec and this handback with its evidence directory. Do **not** stage the untracked sandbox stubs at the repository root (`.bashrc`, `.bash_profile`, `.profile`, `.zshrc`, `.zprofile`, `.gitconfig`, `.gitmodules`, `.idea`, `.vscode`, `.mcp.json`, `.ripgreprc`, `CLAUDE.local.md`). They are character devices created by the sandbox, not project files.
- Expected conflicts: none with BE-G (`apps/api/**`) or AN-P3B (`requirements.csv`). Within `apps/web/src/i18n/{en,ar}/gates.json`, I only added keys.
- A product e2e run now has 168 tests (164 + this spec's 4).
