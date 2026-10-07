# ADR-0022: Prioritization (T06): versioned weight sets, exact decimal scoring, rankings, overrides

- **Status:** Proposed for P3 (DG3). Author: solution-architect (T-DG3-ARCH-01), 2026-10-07.
- **Requirements:** REQ-PB-047, REQ-PB-048, REQ-PB-049, REQ-S09-001, REQ-S09-003, REQ-S09-004 (comparison, ranked tables), REQ-S09-005, REQ-DLV-035 (3.30, 95%).
- **Sources:** playbook B0074–B0077; master prompt §9 (lines ~286–288), M0176, M0177.
- **Builds on:** ADR-0003, ADR-0004, ADR-0014 (configuration versioning), ADR-0016 (guards), ADR-0019 (decimal), ADR-0021 (initiative lifecycle).
- **Physical model:** migration `0021_p3_prioritization.sql`; seed per transformation in `p3_instantiate_transformation()` (`0024`). Module `portfolio` (`prioritization.ts`); pure arithmetic in `packages/shared/src/scoring.ts`.

## Context

T06 (B0076) scores each initiative 1–5 on five criteria with default weights strategic fit 25%, financial value 25%, customer impact 20%, feasibility 15%, time-to-value 15%, and a calculated weighted score. B0077: "Adjust weights to the transformation context. For regulated or safety-critical transformations, risk/compliance can replace part of the weighting." §9 adds: weights total 100%, missing scores mean incomplete (not zero), approved weights are versioned, a 0–100 view must be labelled, and proposed ranking, selection and funding are separate.

## Decision

### 1. Criteria and weight sets

- **Criterion codes** (closed set, CHECK): `strategic_fit`, `financial_value`, `customer_impact`, `feasibility`, `time_to_value` (the five B0076 source criteria) and `risk_compliance` (the B0077 extension). Labels are bilingual in the shared i18n catalogue; the English labels are the source labels without the percentage.
- **`scoring_weight_set`** (per transformation): `version_no` (1, 2, 3… unique per transformation), `status` `proposed` → `active` → `superseded`, or `proposed` → `withdrawn`; `rationale`, `proposed_by`, `approved_by`, `approved_at`, `activated_at`. Exactly one `active` set per transformation (partial unique index).
- **`scoring_weight`** (append-only rows of a set): `criterion_code`, `weight_percent numeric(5,2)` with `0 < weight ≤ 100`; unique per set and criterion; 2–6 criteria per set.
- **Total = 100 exactly.** A deferred constraint trigger (`scoring_weight_set_total`) checks at COMMIT that the weights of every set touched in the transaction sum to exactly `100.00`. The API checks first and answers **422 `urn:mth:problem:validation`**, code `prioritization.weights_total`, detail 'Weights must total 100% (got 95.00%)', pointer `/weights`. 95% and 105% are both rejected, nothing is written.
- **Immutable once created** (stronger than "once used"): weight rows are INSERT/SELECT only (append-only trigger), and the set header's freeze trigger lets only `status`, `approved_*`, `activated_at`, `version`, `updated_*` change. A correction is a new proposal. So a set that any score or ranking references can never change.
- **v1 seeded per transformation** at the source defaults (25/25/20/15/15), `status = 'active'`, by `p3_instantiate_transformation()` (new transformations and the backfill of existing ones), audited as the creating user or `system`. The seed is a configured starting point, not a business approval: its `approved_by` is NULL and `approval_basis = 'source_default'`.
- **Adjusting (REQ-PB-049).** `POST /transformations/{id}/prioritization/weight-sets` (`prioritization.edit`) creates a `proposed` set with the next `version_no`. `POST …/weight-sets/{versionNo}/approve` (`prioritization.approve`, business approval, SP default; approver ≠ proposer, DB CHECK) activates it and supersedes the previous one in one transaction. Example accepted as **version 2**: `strategic_fit 15`, `financial_value 25`, `customer_impact 20`, `feasibility 15`, `time_to_value 15`, `risk_compliance 10`.

### 2. Scores and the weighted score

- **`initiative_score`**: the current 1–5 score per initiative and criterion: `score smallint NULL CHECK (score BETWEEN 1 AND 5)`, `note`, `scored_by`, versioned. NULL means cleared. A score of 6 (or 0, or a decimal) is rejected: API 400 at `/score` (schema `integer`, `minimum 1`, `maximum 5`), DB CHECK. Scores exist per criterion code, independently of the set, so adding `risk_compliance` in v2 needs only the new criterion scored.
- **Formula.** `weighted = Σ (score_c × weight_c) / 100` over the criteria of the set, with decimal.js only (`packages/shared/src/scoring.ts`, `weightedScore(scores, weights)`). With integer scores and weights of two decimals, the result has at most four decimals, so it is **exact** and stored in `numeric(7,4)` without rounding. Example: 5,4,3,2,1 under v1 → (125 + 100 + 60 + 30 + 15) / 100 = **3.3000**, displayed **3.30**.
- **Incomplete.** If any criterion of the set has no score, the result is `{ completeness: "incomplete", weightedScore: null, missingCriteria: [...] }`. The API and web show **'incomplete'** (AR 'غير مكتمل'), never a number, never 0. Incomplete initiatives are listed after the ranked ones with rank null.
- **Read-only result (REQ-PB-047).** The weighted score is never accepted as input: no request schema has a `weightedScore` property (strict objects → 400). It is computed server-side and stored in **`initiative_score_result`** (append-only): `initiative_id`, `weight_set_id`, `weight_set_version_no`, `weighted_score`, `completeness`, `missing_criteria`, `inputs` (jsonb object `{criterion: {score, weightPercent}}`, validated by zod and a `jsonb_typeof` CHECK), `cause` (`initial` | `score_change` | `weight_set_activated`), `computed_at`, `computed_by`. A new row is appended when a score changes (for the active set) and, for every submitted initiative, when a set is activated. **Results computed under v1 keep `weight_set_id` = v1** forever; rescoring under v2 appends v2 rows.
- **Storage vs display.** Storage: exact `numeric(7,4)`. Display: 2 fraction digits, ROUND_HALF_UP, locale digits (`formatDecimal`). Sorting uses the stored exact value.

### 3. The 0–100 view (REQ-S09-001)

`display100 = (weighted − 1) / 4 × 100`, computed at display time in decimal.js from the stored 1–5 value (never stored). Shown with at most 2 fraction digits and trailing zeros removed: 3.30 → **57.5**. The view always shows the label **'0–100 view = (weighted score − 1) ÷ 4 × 100'** (AR provisional 'عرض 0–100 = (النتيجة المرجحة − 1) ÷ 4 × 100'), and the help page documents it. An incomplete row shows 'incomplete' in both views. The API returns `weightedScore` (1–5, string) and `display100` (string) with `conversion: "(score-1)/4*100"`.

### 4. Rankings and history (REQ-S09-005)

- **`ranking_snapshot`**: a *proposed ranking* (`snapshot_no` 1, 2… per transformation; `weight_set_id`; `status` `current` | `superseded`; `proposed_by`, `note`). Frozen except the status columns. Created by `POST /transformations/{id}/prioritization/rankings` (`prioritization.edit`); it supersedes the previous current snapshot.
- **`ranking_entry`** (append-only): `snapshot_id`, `initiative_id`, `rank` (null when incomplete), `weighted_score`, `completeness`, `score_result_id`, `previous_rank`, `causes text[]` ⊆ {`new`, `score`, `weight`, `override`, `relative`, `removed`}, `cause_detail` jsonb (`{weightSetVersionNo, previousWeightSetVersionNo, overrideId, changedCriteria[]}`), `override_id`.
- **Algorithm.** Take every initiative with status `submitted`, `ranked`, `selected`, `funded` or `launched`; use its latest result for the active set. Sort complete ones by `weighted_score` desc, then `code` asc (deterministic tie-break, documented on screen). Apply approved overrides in ascending `override_rank` by moving the initiative to that position (the others shift). Incomplete ones follow, unranked. Compare with the previous snapshot per initiative:
  - absent before → `new`;
  - weight set differs → `weight` (detail names the version);
  - own criterion scores differ → `score` (detail lists the criteria);
  - an approved override placed it → `override`;
  - rank changed with none of the above → `relative` (another initiative moved);
  - in the previous snapshot but no longer eligible → an entry with `removed`.
- **Labels.** `GET …/prioritization/rankings/history` returns per change `causeLabels`, rendered from codes: `weight` → **'weight version {n}'** (e.g. 'weight version 2'), `score` → 'score change ({criteria})', `override` → 'override: {reason}', `new`, `relative`, `removed`. Arabic labels are rendered by the web from the same codes.
- The snapshot moves each included complete `submitted` initiative to `ranked` (ADR-0021 §3), with its own audit event.

### 5. Overrides (REQ-S09-005)

`ranking_override`: `initiative_id`, `override_rank` (≥ 1), `reason` (**required**, free-text rules, 3–2000 visible characters), `status` `proposed` → `approved` | `rejected`, then `approved` → `revoked`; `proposed_by`, `decided_by`, `decided_at`, `decision_note`; CHECK `decided_by <> proposed_by`. An override without a reason (missing, empty or only invisible characters) is rejected: **400** at `/reason` for a missing/empty property, **422** `prioritization.override_reason_required` for whitespace/invisible-only text. Proposing needs `prioritization.edit`; approving/rejecting needs `prioritization.approve` (business approval; "override approver"). An approved override applies from the next ranking snapshot.

### 6. Ranking ≠ selection ≠ funding (REQ-S09-003)

The proposed ranking is advisory. Selection is a separate human decision (`portfolio_selection`, ADR-0021 §3), funding another (`funding_decision`, ADR-0023 §7). The portfolio table shows three separate columns: *Proposed rank*, *Selection* (Selected / Not selected), *Funding* (Funded / **'Selected - unfunded'** / —).

### 7. Comparison and ranked table (REQ-S09-004)

`GET /transformations/{id}/prioritization` returns, per eligible initiative: the latest result for the active set, the 0–100 value, the *value* axis (`financial_value` and `customer_impact` combined as `(fv×w_fv + ci×w_ci)/(w_fv + w_ci)`, documented) and the *feasibility* axis (`feasibility` and `time_to_value` likewise), rank, selection and funding state, wave, sequencing flags (ADR-0023 §5) and capacity flags (ADR-0023 §6). Filters (query): `status`, `waveId`, `completeness`, `funding`, `flag`. Cursor pagination does not apply (one transformation's portfolio, at most 500 initiatives, `limit` refused above that with 422 `prioritization.portfolio_too_large`).

## Alternatives considered

1. **Float arithmetic.** Rejected: 0.1-style weights are inexact in binary floating point; the acceptance needs 3.30 exactly.
2. **Weights as fractions (0.25).** Equivalent; percent with two decimals is what users type and what the source shows.
3. **Mutable weight sets until first use.** Rejected: "immutable from creation" is simpler to guarantee and test, and costs one extra proposal for a typo.
4. **Storing the 0–100 value.** Rejected: it is a view; storing it would create a second result that can drift.

## Consequences

- One shared arithmetic module guarantees API and web compute the same result.
- Activating a weight set appends one result row per eligible initiative; at portfolio sizes (≤ 500) this is one transaction.
- Studio-level default rubrics and weights (REQ-PB-093) remain DG5.

## Verification

- Unit (`packages/shared/src/scoring.test.ts`): 5,4,3,2,1 → `"3.3000"`/display `"3.30"`; 0–100 of 3.30 → `"57.5"`; weights 95 and 105 → total error; a missing score → incomplete with the missing criterion; v2 example sums to 100; property test over all 5^5 score combinations under v1 equals an independent integer computation.
- Integration: score 6 → 400; weight set 95% → 422 and nothing written; v2 proposal + approval → version 2 active, v1 results unchanged, rescoring writes v2 results; ranking history after activation shows `causeLabels` containing 'weight version 2'; override without reason → 400/422; override approved by the proposer → 403/422; AUD gets 403 on every write.
- Probe: the deferred total trigger refuses a 95% set inserted directly in SQL; `scoring_weight` UPDATE/DELETE raise.
