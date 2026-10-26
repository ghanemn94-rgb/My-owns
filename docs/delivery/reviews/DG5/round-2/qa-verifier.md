# DG5 round 2 (corrected clean re-gate): qa-verifier narrative

- **Run:** `DG5-T-DG5-RG2-QA-R2-qa-verifier-20261026T003405Z-e008198e`.
- **Candidate:** `sha256:55a411ae9f4e87473478988f3d9909752a934a547ba40acc1479f2b2bc3a24ce` (2207 files).
- **Source:** `660f40c7d141b6fb73c145e0ee7a053ceb5905de`; freeze `7a02e7d`.

**Verdict: PASS.** I raise no new finding. My open finding F-DG5-140 is CLOSED_VERIFIED.

These are business approvals that this review neither grants nor implies. Product gates G1–G6 are untouched, and nothing here implies DG7.

## F-DG5-140 (Low, Arabic product name in Arabic exports at branding version 0)

T-DG5-BE-RG3 changed `apps/worker/src/reports/export-runner.ts`. At version 0 it now prints `DEFAULT_PRODUCT_NAMES[language]`, where it used to print the English `DEFAULTS.productName`. `packages/reporting/src/labels.ts` defines the names, and `labels.test.ts` ties them to the shell's i18n string and to the API's version-0 branding.

I verified the fix three ways:

1. **My round-1 reproduction.** The A15 matrix dumped its files at version 0, and my inspection read all 62 files. Every Arabic file carries «منصة موبايلي للتحوّل» and never the English name. Every English file carries the English name and never the Arabic one. Each header is the name of its file's language.
2. **The real stack.** I ran the demo stack with the *built worker process* (`node apps/worker/dist/main.js`). Exports were requested over HTTP by the synthetic team lead, and I inspected the downloaded DOCX, PPTX and PDF, in both locale settings.
3. **A mutant that reverts the fix.**
   - The candidate's `branding.test.ts` fails.
   - My inspection flags all 31 Arabic files and none of the English files.
   - The real-stack probe fails with exactly six problems, all on Arabic files.

So the fix is what makes the difference, and a regression would be caught. Observation: the A15 matrix in tests/qa passes even under the mutant. The guard for this behaviour is the implementer's test pair, not tests/qa.

## Full review

The register, the acceptance suites and apps/web are unchanged since round 1. The product diff is only the BE-RG3 repair. I re-ran everything on this candidate:

| Area | Result |
|---|---|
| Static checks | 7/7 pass |
| Unit (Node 22 and 24, both locale settings) | 2366 / 1746 / 259 + 2 skipped by design in every run. One Node 22 attempt hit a Vitest-internal RPC timeout at load 25 with all tests passing; it passed on re-run. |
| Integration, run twice | 321 files, 3087 passed + 1 skipped by design, each run. Migrations 0001–0097 (89 files; eight ids retired by design). Contract test 83/83 (846 operations). Every p5-pending list is empty. |
| tests/qa on its own | 336/336 and 22/22 |
| REQ-DLV-037 counts | a06 27, a07 12, a15 34, a16 30, plus the root e2e a06/a07/a15/a16 in both settings |
| Product e2e, C.UTF-8 | 470/470 |
| Product e2e, locale unset | 462 passed; 3 tests hit the 30 s timeout at load about 25, with no assertion failure. They pass alone (42/42). |
| Root acceptance specs | 30/30 in each setting |
| Demo specs | 12/12 in each setting |

My probes cover the partly covered clauses, all on this candidate:

- **REQ-S13-009:** AUD read-only pass, axe, 390 px and 200 % text on 42 P5 screens, 84/84 in each setting.
- **REQ-PB-093:** the Studio UI path, en and ar in both settings.
- **REQ-PB-090, REQ-S21-001, REQ-PB-087, REQ-S18-001:** the demo probes D1–D4, 8/8 in each setting.
- **REQ-S13-008:** the executive-pack provisional label, 3/3.
- **REQ-S05-006:** each of the twelve extension types has create and read operations.
- **REQ-S08-019:** an independent decimal NPV oracle (−21.04 / −19.12).
- **Regression of the round-1 to round-2 diff:** Arabic user text with C0 control characters exports to well-formed DOCX, PPTX and XLSX on the real stack.

All six validators pass (`--register DG5`, `--pipeline`, `--historical` DG4/DG3/DG2/DG1).

Every failure, aborted attempt and probe error is kept, labelled and explained in `docs/delivery/test-evidence/DG5/qa/round-2/RUN-NOTES.md`. The per-requirement judgement is in `15-requirements-matrix.md`.

## Environmental residuals (PASS on the offline/config surface)

| Residual | Reference | Surface checked |
|---|---|---|
| Live registry | REQ-DLV-042 AC-1, D-057 | offline install from the local store |
| Live CI | REQ-DLV-025, D-058 | pipeline validator |
| Keycloak / demo IdP | D-049 | dev binding (D-165) |
| AI and notification adapters | D-142 Q11 | none ships; A21 "disabled" is the shipped configuration |
