# DG5 review round 1: qa-verifier (T-DG5-REV-QA-R1C)

- **Candidate:** `sha256:8e7d23a3ec0218717a8333e81a1fb59493ad2ddd70f76cdd0257af8b2af8f67b` (2172 files), source `601d7d2`. It was recomputed at the start and at the end, on a disposable clone and on the working tree.
- **Assignment:** `docs/delivery/assignments/DG5/round-1/qa-verifier-rerun2.md` (sha256 `5465d363…`).
- **Invocation:** `DG5-T-DG5-REV-QA-R1C-qa-verifier-20261018T020226Z-328f7e13`.
- **Verdict: FAIL.**
  - Two new Medium findings, F-DG5-140 and F-DG5-141, fail the assignment's required "390 px and 200 % text on the P5 screens / axe no serious or critical" check.
  - Everything else ran and passed, or failed only for an explained environmental reason and passed when re-run.
  - I formed this verdict without reading any other reviewer's record for this round.

## Environment

- **The clone.** A disposable clone under `$TMPDIR` (`git clone --shared`).
  - Free disk was about 2.4 GB, shared by three concurrent reviewers. So the clone uses a sparse checkout that omits only `META_EXCLUDES` directories (test-evidence, runs, handbacks, reviews, assignments) and `trading_agent/`.
  - `candidate.mjs` skips files missing from the working tree, so the matching id (2172 files) proves that every candidate file is present.
- **Install.** `pnpm install --offline --frozen-lockfile` against a copy of the read-only pnpm store.
  - The clone's `node_modules` is writable, so Vitest's default config loader works there and `--configLoader runner` was not needed.
  - `E2E_SCREENSHOT_DIR` and `QA_EVIDENCE_DIR` pointed into my evidence directory.
- **Node.** 24.21.0, and 22.22.2 for the second unit pass.
- **PostgreSQL.** 16.13, disposable clusters on ports 26610–26665.
- **Load.** Load and free disk were sampled every 15 s for each run (`*-samples.log`).

## Results

| Area | Result |
|---|---|
| Static | `pnpm -r build`, `pnpm -r typecheck`, `pnpm lint`, `openapi:lint` (OpenAPI 3.1.1, 846 operations), `check:no-cdn`, `format:check` and contrast (50 pairs pass; the 3 prohibited pairs fail as documented) all exit 0. |
| Unit | Node 24 and Node 22, locale unset and `C.UTF-8`: 2335 / 1689 / 259 + 2 skipped, exit 0 in each of the 4 runs. The 2 skips are `fuzz.test.ts` `it.skipIf(NOCODEGEN)`. |
| Integration run 1 | 312 files, 3030 passed + 1 skipped (`presentation.test.ts` `it.runIf(!hasMeetingPackAssembler)`), exit 0. Migrations: 88 files `0001`→`0096`; the gaps are the reserved P5 ranges in p5-plan. `contract.test.ts` asserts 846 operations. 43 `p5-pending-*.ts` files have 0 entries. |
| Integration run 2 | Identical: 3030 + 1 skipped, exit 0. |
| `tests/qa` alone | **First run: 1 failed file**, `a15-outputs-every-definition`, whose setup got a 500 from `createBaseline` at about 04:13Z, when the shared disk was down to 40 MB free. Re-run: 31/31 files, 336/336, exit 0. |
| Product e2e, locale unset | 440/440 (56.3 min). |
| Product e2e, `C.UTF-8` | **8 failed + 12 did not run** (420 passed). The failures are explained below. The 7 affected files, re-run alone: 96/96. |
| Root acceptance specs (production stack) | 30/30 with the locale unset and 30/30 with `C.UTF-8`. |
| Demo specs (`with-demo-stack.sh`) | 12/12 with the locale unset and 12/12 with `C.UTF-8`. |
| REQ-DLV-037 suites | A06 27/27, A07 12/12, A15 34/34 (15 + 5 + 7 + 7), A16 30/30 (13 + 11 + 6) in both integration runs and the `tests/qa` re-run. Root e2e: A06 2, A07 1, A15 1 and A16 2 tests per project, all passing. |
| Validators | `--register DG5`, `--pipeline` and `--historical --stage DG4`, `DG3`, `DG2` and `DG1`: all PASS, exit 0. |

### The `C.UTF-8` product failures, explained

- **Three 30 s timeouts under load.** They happened while my own unit and integration runs overlapped with the other reviewers, at a load of 9–11 on 4 CPUs:
  - en `p2-journeys:828` (30.9 s);
  - en `p4-change-phases:364` (30.1 s);
  - ar `p4-raid-governance:290` (30.1 s).
- **Five non-timeout failures.** ar `p2-journeys:1157`, `p3-business-cases:87`, `p3-inherited-approval:160 @1920`, `p4-dashboards:295` and `p4-execution:344`.
  - Two of them are "Unable to capture screenshot"; the others are elements not found within 5 s.
  - All five fall in 03:59–04:10Z, which matches the disk-sample minima (41 MB and 80 MB free on the shared disk).
- **The 12 tests that did not run** are serial dependents of those failures.
- **The re-run.** All 7 files were re-run alone with `C.UTF-8`: 96/96. AUD took 17.3 s in en and 14.4 s in ar. In the locale-unset full run AUD took 22.7 s. So D-169's AUD timeout did not recur without concurrent load, and I accept that disclosure.
- **Observation, not a finding:** `p2-journeys:828` (Define → G2, unchanged since DG3) takes 29.5 s and 27.1 s in a *passing* full run, against its 30 s limit, so it has little headroom under reviewer-level load.

## Independent probes (not in the candidate)

My probe sources are in `docs/delivery/test-evidence/DG5/qa/tests/round-1/`.

1. **P-S13-008: the executive pack** (`zz-qa-dg5r1c-packs-provisional-samples.test.ts`). The register notes say no test stages an executive-pack PDF holding a pending benefit value. On the real demo dataset, `executive_pack` holds 6 provisional values (submitted value, pending Finance). Its PDF prints "Provisional" (en) and "مؤقت" (ar) on each of those 6 lines, plus the legend. **PASS.**
   - Runs 1 and 2 failed on my own probe defects: period 2026-09 already exists in the dataset, and I read Arabic in visual instead of logical order. I fixed the probe; run 3 passed 6/6.
2. **Samples** (REQ-DLV-037): 20 files (executive pack and G1 gate pack as PDF/DOCX/PPTX; the RAID register as PDF/XLSX/CSV; the benefits register as XLSX; each in en and ar).
   - I inspected them at reader level: the package's PDF reader, plus my own `unzip`/XML read of the OOXML files.
   - **What each file has:**
     - the B0004 provenance and the demo illustrative label;
     - the "Provisional" legend;
     - no DG0–DG7 reference;
     - RTL markers in every Arabic file (`w:bidi`/`w:rtl`, `rtl="1"` on 8/8 slides, `rightToLeft` on every sheet) and LTR in every English file.
   - The Arabic text in the *English* gate-pack files is the deliberate "Criterion (Arabic)" column.
   - **Limitation:** I could not render the files visually. LibreOffice cannot open its pipe under the read-only `/tmp`, and full Chromium does not start in the sandbox.
3. **P-PB-093: the Studio UI** (`zz-qa-dg5r1c-studio-weights.spec.ts`; the notes say the exact browser path is not driven). In the Studio UI, en and ar, on its own production stack:
   - 25/20/20/15/15 = 95 % goes through preview and review. Publish shows "Default weights must total exactly 100% …" (ar translated) and the version stays a draft.
   - 30/20/20/15/15 plus a new Feasibility rubric text publishes.
   - A transformation created afterwards gets the new version, the weights and the rubric text.
   - The existing transformation keeps its version, weights and rubric.
   - **PASS.** Run 1 raced on a non-waiting `count()` in my probe and never clicked Publish. Run 2 waits and passes 2/2.
4. **P-PB-090: the rendered traceability screen.** All 15 labels of the three verbatim B0147 chains render on the demo transformation's traceability screen, in en and ar and in both locale settings. **PASS.**
5. **P-S21-001.** An approval opened from roaming.user.bo's inbox shows "Synthetic demonstration - approves nothing real" and its ar text. **PASS.**
6. **P-REFLOW: 31 P5 screens on the demo stack, en and ar, both locale settings.** At 390 px and with 200 % text I checked page-level overflow, ran axe at 390 px and checked the demo banner. **FAIL:**
   - **F-DG5-140 (Medium):** `/admin/studio/scoring-defaults` overflows: 49 px at 390 px (en), and 130 px (en) / 16 px (ar) with 200 % text. The rubric `<fieldset>`s keep the UA default `min-inline-size: min-content`, and there is no `.fieldset` CSS rule.
   - **F-DG5-141 (Medium):** `/admin/source-coverage` has a serious axe violation at 390 px in en and ar: `scrollable-region-focusable` on `.table-wrap` (`SourceCoveragePage.tsx:127` has no `tabIndex={0} role="region" aria-label`; 51 other table wraps do).
   - The other 29 screens: 0 px overflow, no serious or critical axe violation, and the banner on every screen.

## D-169 disclosures

- **The AUD timeout:** accepted. It did not recur without concurrent load (see above).
- **Unit stderr (1), (2) and (4):** as described in D-169, identical in all 4 unit runs. (4) also contains an Ajv `unknown format "uuid"` line, which is the same kind of warning.
- **Unit stderr (3), traced here.** It is a test-fixture artefact, not a product defect:
  - `p4fixtures.ts:53` answers every unscripted GET with `page([])`.
  - So `GET …/north-star` returns a list body with no `id`.
  - `CharterPage`'s North Star option then has `value` undefined, and `RecordForm.tsx`'s `key={o.value}` is undefined.
  - The production API returns a North Star with an id, or 404 `north_star_not_found`.
- **ARCH-R3 residuals: accepted.**
  - (a) A SQL `--` comment of the applied `0075`, not a catalogue `COMMENT ON`. ADR-0044 §7 states the merged key, `slip-events.ts:202`, which satisfies `0075`'s length and uniqueness constraints.
  - (b) ADR-0044 B2's shorthand; B4 and §7 say the schema governs.
  - (c) The D-168 demo wording point: off the chain line, and my rendered-screen probe shows the five chain labels.

## Disclosures in the register notes

All of them are judged acceptable, with these specifics:

- **REQ-PB-093:** closed by my UI probe.
- **REQ-PB-090:** closed by my rendered-screen probe.
- **REQ-S13-008:** closed by my executive-pack probe.
- **REQ-S21-001:** the inbox label is closed by my probe.
- **REQ-S12-004:** "one set" is enforced by `UNIQUE (transformation_id, step_key)` on `phase_step` and by unique role tasks.
- **REQ-PB-087:** the Day-90 screen is asserted only in the `fef.test.tsx` component test (en and ar), and my probe loads it in both languages.
- **REQ-S05-006:** the twelve creates and reads are DG2–DG4 operations covered by `contract.test.ts`, which passed twice.
- **REQ-S14-003:** the v2 pin migration is outside the acceptance text.
- **REQ-PB-001:** the Arabic linguistic review is not a QA-testable clause.

## Environmental residuals

These are PASS on the offline and configuration surface, with the residual noted:

- the live registry (D-057) and live CI (D-058);
- Keycloak and the demo IdP (D-049, ADR-0050 §1; the dev-mode binding of D-165 is the tested path);
- AI and external notification adapters: none ships (D-142 Q11). A21 passes with the shipped configuration.

## What is needed to pass

- Repair F-DG5-140, for example `min-width: 0` / `min-inline-size: 0` on the rubric fieldsets.
- Repair F-DG5-141: `tabIndex={0} role="region" aria-label` on the coverage `.table-wrap`.
- Re-run the P5 reflow and axe probe. Its spec is in my tests directory.
