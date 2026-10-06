# DG2 round 2 — domain-reviewer (re-run T-DG2-REV-DOM-R2B)

**Verdict: FAIL.** The verdict is on candidate `sha256:089a2a2f…be69` (517 files, recomputed), source commit `eb8163e2`. It rests on one Medium finding against a mandatory acceptance criterion (F-DG2-150). Two Low findings are also open.

## How I checked
- **Static checks:** I used a disposable clone at `eb8163e2` with an offline frozen-lockfile install. On Node 24.21.0 and Node 22.22.2:
  - typecheck, build, lint and contrast pass;
  - `pnpm test` passes 492/492 on both.
- **Integration:** against a disposable PostgreSQL 16 cluster, 440/440 pass.
- **Live stack:** a fresh database per run, PostgreSQL on :54978 and the API on :3977 (AUTH_MODE=dev, synthetic seed), serving the built SPA.
  1. **Browser journey:** the candidate's P2 journey passed 24/24 in `chromium-en` and `chromium-ar`, with empty axe violations. I looked at the screenshots myself.
  2. **My own API scenario** (`live-scenario.mjs`):
     - The lead creates an End-to-End transformation.
     - G2/G3 submitted early are refused with `gate.out_of_sequence`.
     - With G1 readiness completed natively, a submitter self-decision returns 403.
     - The synthetic Sponsor approves G1 and the phase moves to Define. A G3 submission at that point is refused.
     - Define is completed natively: North Star, a passing outcome, KPI activation, T02 with a target date, Sponsor trajectory approval, a guardrail and the composed thesis.
     - The Sponsor approves G2 and the phase moves to Design.
  3. **Rendering:** I rendered New transformation in EN (ltr) and AR (rtl).

All data is synthetic. The G1/G2/G3 decisions are demo business decisions inside the product. They approve nothing real and have no bearing on DG0–DG7.

## Source fidelity (cited blocks)
- **B0009 modes:**
  - Only `end_to_end` and `modular` are accepted. Modular without an entry phase returns 400 (ADR-0007 maps schema validation to 400).
  - The 'When to use' and 'How' text is verbatim. The AR screen adds a provisional translation and keeps the EN source.
- **B0018 roles:** the six roles carry verbatim accountabilities in `/role-accountabilities` and on the Team screen (AR labelled as a provisional translation).
- **B0023 gates:**
  - API names, decision questions and evidence-required text are verbatim.
  - G1 has six outputs; G2 has North Star, outcome tree, KPI definitions, target trajectory (a master-prompt addition) and guardrails.
  - G3 has TOM, gap matrix, capability gaps, future journeys and design decisions.
  - The UI title duplicates the code (**F-DG2-151**, Low).
- **Diagnose catalogue:**
  - B0029: six workstreams, with key questions and typical outputs verbatim.
  - B0031: six T01 dimensions; confidence outside H/M/L is rejected.
- **Charter:**
  - B0035: 14 fields; a saved change creates a version, and the history is kept.
  - B0037: four-part thesis, flagged incomplete per empty part, and the composed sentence follows the source structure.
  - B0039–B0043: the five scope questions are verbatim.
- **Define:**
  - B0048: exactly one current North Star after a refinement, one sentence (a two-sentence statement is rejected), and the charter shows the current one.
  - B0050: the T02 target date is required.
  - B0051: 'Launch new app' fails, and G2 readiness lists it.
  - B0035: with zero guardrails G2 is refused with `g2.guardrails`; guardrails keep their category.
- **Design:**
  - B0056: 10 TOM dimensions with verbatim design questions.
  - B0062: canvas prompts are verbatim, there are 10 cells, and each cell aggregates its gaps, decisions, dependencies and evidence.
  - B0065: T04 codes run D-01…, with status Open and an owner.
  - The per-dimension readiness flags a box without a target design or owner.

## Prior observations (reproduced independently)
1. **B0041 / REQ-PB-031: confirmed, and it goes further than reported.** With a saved charter and no Out of scope, the pre-check returns `unknown`. With a whitespace-only Out of scope (accepted with 200), it returns `pass`. The check therefore never fails, and the register's acceptance ("an empty Out of scope field makes … fail") is unmet. ADR-0017's rule "missing data → unknown" is sound for derived data. Here, though, the emptiness of a saved charter field *is* the B0041 answer. → **F-DG2-150 (Medium, mandatory)**.
2. **B0023 titles: confirmed.** EN and AR both show "G2 – G2 - Direction": `GatesPage.tsx:70` and `GateDetailPage.tsx:74` prefix the code to a seed name that already contains it. → **F-DG2-151 (Low)**.

## Other
- **F-DG2-152 (Low):** the REQ-S05-003 register entry cites `GET …/tom/dimensions/{dim}`, which returns 404 and is not in the OpenAPI document. The behaviour is delivered through `GET …/tom-canvas`. This is register drift only.
- **Observation, outside these requirements (not raised):** the transformation header badge reads "Draft – not submitted" after G1 and G2 are approved. That badge is the P1 lifecycle status (draft→active is a separate manual transition), but next to gate approvals it may read as a gate state. Worth a UX look in a later stage.
- **Honesty and invariants:**
  - The wordmark and colours are labelled provisional.
  - There are no PMI or Mobily certification claims.
  - Product gate code states that it is unrelated to DG0–DG7.
  - An unquantified value pool has a null amount, not 0.
  - Missing charter fields show Unknown.
  - Money and rates travel as decimal strings.
- **Environmental residuals:** the live registry (D-057), live CI (D-058) and Keycloak (D-049) were recorded as PASS on the offline/config surface, with the residual named in each check.
