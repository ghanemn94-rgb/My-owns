# T-DG7-DOC-A handback: user and admin guides, EN and AR (frontend-ux-engineer)

- **Stage:** P7 / DG7 (BUILDING). This is engineering work only. No business, Finance or IT approval was granted. Product gate G6 does not imply DG7.
- **Run:** `DG7-T-DG7-DOC-A-frontend-ux-engineer-20261113T094958Z-72f4a230` (session `72f4a230-8dd1-495e-85b3-400cca30ec21`).
- **Base:** `8c204f45f3f708f1273107d1e30d341cc1e4386e` on `claude/mobily-transformation-platform-dg6-regate`. At the start the tree was clean apart from this run's `docs/delivery/runs/` folder.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DOC-A.md` (sha256 `93f77f66…3200ae`, checked).
- **Time:** `date -u` 09:50:07 at the start, 10:11:51 at the end.
- **Read:** p7-work-split §1, §2, §H (all of it), §C.7/§C.8, §E.6/§E.7, §I.2/§I.3; ADR-0072; the FE-A, FE-B and FE-C handbacks and their screenshots; D-243 through D-257; `tools/release/check-handover.mjs`.
- **Evidence:** `docs/delivery/handbacks/DG7/T-DG7-DOC-A-evidence/`.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/handover/guides/user/en/user-guide.md` (new) | User guide (ADR-0072 §7) with 8 `##` sections and anchors: `sign-in`, `my-work`, `journey` (six phases, G1–G6 as **business** approvals inside the product, B0023), `evidence`, `kpis-benefits` (Unknown/Stale never zero or on track), `search`, `notifications`, `states` |
| `docs/handover/guides/user/ar/user-guide.md` (new) | Full Arabic version: same file name, the same 8 `##` sections and anchor set, wrapped in `<div dir="rtl" lang="ar">…</div>`, the H.3 provisional line (EN + AR) directly under the first heading |
| `docs/handover/guides/admin/en/admin-guide.md` (new) | Admin guide with 11 `##` sections: `users-roles`, `identity`, `storage`, `channels`, `job-schedules`, `config-transfer` (ADR-0065; FE-B screen), `data-export` (Data export and Migration status; §C.8 texts; FE-B screens), `retention` (§E.6 texts and the inbox effect; see gap 1), `register-about` (ADR-0071; FE-C screens), `deployment-status` (ADR-0069; see gap 2), `external` |
| `docs/handover/guides/admin/ar/admin-guide.md` (new) | Full Arabic version, same rules as the user pair |
| `docs/handover/known-limitations.md` (DOC-B's file; **generated block only**) | Regenerated with `node tools/release/known-limitations.mjs --protocol-audit <DO-I fixture> --write`, never edited by hand. The `provisional-arabic` block now lists the two Arabic guide files (10 → 12 files). Without this, `check-handover` `generated` FAILs as soon as the guides exist. Diff: `known-limitations.diff` |
| `docs/delivery/handbacks/DG7/T-DG7-DOC-A-evidence/**` | Logs; the proposed test fix (`proposed-check-handover-test-fix.patch`) and its verification |
| this handback | — |

No API, web, database, migration or `p7-pending*.ts` file was changed: this task has no pending entry and no mutation.

**Index line (§2 rule 10).** None is needed. `docs/handover/README.md` already links `guides/user/` and `guides/admin/` as folders, and the index check covers every file under them.

## 2. Behaviour per requirement

### REQ-S19-015, clause "Guides are written in English and Arabic where user-facing" (T-H5; D-243 Q7)

**Language rule (ADR-0072 §2).**

- **Pairs.** User and admin guides are English and Arabic in full. Each `en` file has an `ar` file with the same name, the same `##` count (8 for the user guide, 11 for the admin guide) and the same `{#anchor}` set.
- **Arabic files.** Each is RTL-wrapped and carries the exact §H.3 provisional line in both languages. `arabic-review.json` is untouched (`[]`): no agent adds an entry.

**Written on the finished screens.**

- **Labels.** Labels and texts are the shipped i18n strings: `nav.json`, `auth.json`, `common.json`, `gates.json`, `transfer.json` (§C.8 and §D.2), `adminP6.json`, `release.json` (§I.3) and `retention.json` texts (§E.6).
- **Checked against screenshots.** I checked the FE-B screenshots `en/data-export-after-request.png` and `en/config-bundle-import-validated.png`. While writing I found and corrected two claims that did not match the screens:
  - **Identity:** "Sign-in settings" is read-only, with claim mapping and no group → role mapping.
  - **Users:** the screen pre-provisions users, binds identities and disables accounts.
- **Screen paths.** Every screen path named is a route of `router.tsx` or `nav.ts`: 35 distinct paths in each user file and 27 in each admin file (`screen-paths.log`), all matched by T-H5.

**Honesty.**

- **No claim wording.** There is no "certified", "compliant", "approved by Mobily" or "production-ready" wording. The claims scan over `docs/handover/**` reports nothing (H tests: 66/67 pass, and the one failure is the DOC-B test defect in §4).
- **Fixed texts.** The H.3 texts are used verbatim: the role-matrix header, handover acceptance, corporate IdP and "not verified in this release".
- **Branding.** It is stated as provisional.
- **Playbook.** It is described as a synthesis inspired by PMI, Brightline and BRM, not a PMI standard.
- **Gates.** G1–G6 are stated as business approvals inside the product. G6 is stated to say nothing about the platform's own release.
- **Demo data.** It is stated as synthetic.

**Seams.**

- **§C.7 (DOC-A covers the Data export screen):** the admin guide section `data-export`.
- **§E.7 (DOC-A covers the Retention screen including the inbox effect):** the admin guide section `retention`, which also has a pointer from the user guide's `notifications` section.

**Screenshots.** The guides embed none. ADR-0072 §7 makes them optional. **No product screen was changed by this task, so there is no new visual evidence to capture.** The screens the guides describe are evidenced in the FE-B and FE-C handbacks: `T-DG7-FE-B-evidence/screenshots/{en,ar}/`, `T-DG7-FE-C-evidence/screenshots/`.

## 3. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, repository root, base `8c204f45f`.

| # | Command | Result | Log |
| --- | --- | --- | --- |
| 1 | `node tools/release/check-handover.mjs --only guides` (T-H5) | exit 0, `guides: PASS` | `check-handover-guides.log` |
| 2 | the same with `LC_ALL=C.UTF-8` | exit 0 | `check-handover-guides-C.UTF-8.log` |
| 3 | `node tools/release/check-handover.mjs --protocol-audit docs/delivery/handbacks/DG7/T-DG7-DO-I-evidence/protocol-audit-all.json` (all checks) | **exit 2 BLOCKED**. Only `index` is BLOCKED: `release-notes.md does not exist yet` (DO-J, written at the freeze; ADR-0072 PENDING). deployment, summaries, security-links, guides and generated: PASS | `check-handover-full.log` |
| 4 | `check-handover.mjs --only guides,generated,summaries,deployment,security-links --protocol-audit …` | exit 0 (run before the last Arabic wording fix; check 1 re-confirms guides afterwards) | `check-handover-non-index.log` |
| 5 | `LANG= LC_ALL= node --test tools/release/tests/check-handover.test.mjs tools/release/tests/role-matrix.test.mjs tools/release/tests/automation-guide.test.mjs` (H.4) | **exit 1**: 67 tests, 66 pass, **1 fail**: "no guides yet → BLOCKED (exit 2), never a pass". This is a defect in DOC-B's test, exposed by the guides existing (§4 gap 3). An earlier run also failed the claims scan on one Arabic word of mine; I reworded it, and the scan now passes | `h-tests.log` |
| 6 | the proposed one-line fix to that test, applied in a `$TMPDIR` copy of `tools/` (repository untouched): `node --test --test-name-pattern 'T-H5\|no guides yet\|matching en/ar' tools/release/tests/check-handover.test.mjs` | exit 0, 4/4 | `proposed-fix-verification.log`, `proposed-check-handover-test-fix.patch` |
| 7 | `node tools/release/known-limitations.mjs --protocol-audit <DO-I fixture> --write` | exit 0 | `known-limitations-write.log`, `known-limitations.diff` |
| 8 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `prettier-check.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG6` | exit 0, `PASS gate DG6 (historical)` | `validate-historical-DG6.log` |
| 10 | `pnpm -r typecheck` | exit 0 | `typecheck.log` |
| 11 | `pnpm lint` | exit 0 | `lint.log` |
| 12 | `pnpm openapi:lint` | exit 0 | `openapi-lint.log` |
| 13 | `pnpm test` | exit 0 (unit-node 202 files / 2992 tests; unit-web 130 / 2175; formula 3 files, 259 passed, 2 skipped) | `pnpm-test.log` |
| 14 | `QA_PG_PORT=27611 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | exit 0, 111/111 | `contract-test-pg.log` |

**Interaction checks.** None. This task changed no screen. The guide contents were checked against the shipped i18n files, the route tables and the FE-B screenshots, as listed in §2.

## 4. Known gaps / not done

1. **The Retention screens are not built in this release** (FE-C handback gap 1; no decision covers them).
   - `/admin/retention` and its sub-pages show FE-A's "not available yet" placeholder.
   - The admin guide's `retention` section says so plainly. It then describes the retention behaviour the API applies, using the §E.6 texts and including the inbox effect.
   - If the screens land before the freeze, that section's first paragraph must be rewritten, or the guide becomes untrue.
2. **The deployment status has no screen** (`router.tsx` l.598–599: "no screen is assigned in P7"). ADR-0072 §7 lists "deployment status" for the admin guide, so the guide states that it is API-only (`operations.read`) and what it reports.
3. **The DOC-B test `check-handover.test.mjs` "no guides yet → BLOCKED" fails now that guides exist.**
   - Cause: its fixture copies the real `docs/handover/`, including `guides/`.
   - CI runs `tools/release/tests/*.test.mjs` (`deploy/ci/ci.yml` l.316), so CI will be red until this is fixed.
   - I did not edit the file: it is DOC-B's, and H.1 gives DOC-A read-only access to the checker.
   - The fix is one line (`rmSync` of the fixture's `guides/`), verified in a scratch copy (check 6): `proposed-check-handover-test-fix.patch`.
4. **`docs/handover/README.md` lines 57–58 are now stale.** They say the `guides/` folders "are written later in this release". That is DOC-B's file, and the text must be true for the release (§2 rule 2).
5. **The claims scan forbids the UI's own Arabic label.**
   - The UI label for a configuration item's "Identical, nothing to do" action is "مطابق، لا إجراء" (`ar/transfer.json`).
   - In a guide document, the K2 claims rule flags "مطابق" (root ط-ب-ق).
   - The Arabic guide therefore says "بلا تغيير (لا إجراء)", which does not quote the screen label.
6. **All Arabic is provisional.** No qualified Arabic reviewer checked it, and the provisional line says so.
7. **Protocol deviation (disclosed).** `validate.mjs --historical --stage DG6` was run at the end of the run (exit 0), not before writing, as the protocol asks.
8. **`check-handover.mjs` as a whole exits 2 (BLOCKED)** until DO-J's `release-notes.md` exists. That file is outside this task. Every other check, guides included, passes.

## 5. Open questions and merge instructions

**Open questions:**

1. **Q1, test fix (gap 3).** Should the orchestrator apply `proposed-check-handover-test-fix.patch` to `tools/release/tests/check-handover.test.mjs`, or route it to a DOC-B repair?
2. **Q2, README (gap 4).** Should the README sentence about the `guides/` folders be updated by DOC-B or the orchestrator?
3. **Q3, Retention screens (gap 1).** Will they be built in DG7? If they are, DOC-A (or its successor) must rewrite the `retention` section on the built screens.
4. **Q4, `known-limitations.md`.** I regenerated its generated block with the tool (not by hand), because the guides' existence changes it. Accept this as an integration step, or redo it at the freeze with the orchestrator's own protocol-audit report? It must be regenerated then in any case.

**Merge instructions:**

- There is no migration and no API change.
- The new files are only under `docs/handover/guides/`.
- `docs/handover/known-limitations.md` changes only inside `<!-- generated:provisional-arabic -->`. Any other change to the handover tree before the freeze needs `known-limitations.mjs --write` again.
