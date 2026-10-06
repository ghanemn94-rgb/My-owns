# DG2 round 6: domain review (T-DG2-REV-DOM-R6)

**Verdict: PASS. No new findings.** I reviewed candidate `sha256:bb3e75811631cbabef8f807972f36396e0be2cf7b1d1b1281fa2fdf16f52eb1f` (528 files, source 51a692b1). I had no open finding to verify, so there is no verifications sidecar.

## What D-066 changed, and whether it is still faithful
- **U+0000 is refused.** It is checked in two places: in the shared `freeText`/`trimmedText` schemas, and centrally in a `preHandler` that runs after auth and CSRF.
  - **Live API:** the name, a charter field (on create and update), an outcome, a query and a path parameter each returned 400 `validation.invalid_character` at the field's pointer. There was exactly one error, never `blank` as well. Nothing was stored, and the version did not change.
  - **UI, EN (LTR):** "Remove the unsupported invisible character from this text."
  - **UI, AR (RTL):** "أزِل الحرف غير المدعوم من هذا النص."
  - In both languages the message appeared inline under the field, with no request sent and no 5xx.
- **Placeholders.** U+16FE4 and U+1D159 alone are now `validation.blank`, in the API and in both UI languages. Mixed into Arabic text they still count as content and are stored verbatim.
- **Arabic with RLM marks.** Charter name, case for change, in-scope and out-of-scope text was stored code point for code point, and B0041 passes. This was true through the API and through the EN and AR forms.
- **Contract and pointers.** A malformed id now points at `/params/transformationId` or `/params/outcomeId`. This is plumbing only and has no effect on the methodology.
- **What did not change:** no seed, methodology text, gate criterion or register column. The only new i18n key, `problems.validation__invalid_character`, exists in both EN and AR.

## Source fidelity (full re-review, live)
- **Live scenario: 99/99 checks passed.**
  - B0009 modes, B0018 roles and B0023 gate names are verbatim.
  - G2 and G3 before G1, and G3 before G2, are refused with 422.
  - A separate demo Sponsor decided G1, G2 and G3. The phase advanced Diagnose → Define → Design → Mobilize, and G4-G6 were untouched.
  - The charter has its 14 fields, with versions. The four-part B0037 thesis is flagged incomplete when a part is blank or invisible. The five B0039-B0043 checks are verbatim.
  - The 3-5 top-outcome warning works. There is exactly one current North Star. The good outcome test fails "Launch new app". G2 is blocked when there are zero guardrails.
  - The T01 and T02 rules hold, there are 10 TOM dimensions with the B0056 questions, the B0029 workstreams and B0062 canvas prompts are verbatim, and an unquantified value pool has a null amount, not 0.
- **Design registers: 11/11.** Heatmap → T03 sourcing need, journey cycle time as a decimal, pain points → T01, T04 D-nn ids, workshop item → T04, and the per-dimension TOM view.
- **Charter blank-input UI: 14/14** in EN and AR.
- **Mode guidance screens** (EN and AR) show the verbatim B0009 text with its source attribution and the Provisional badge.

## Invariants
- The brand is provisional (`#0078FF` provisional:true, Provisional / مؤقت badge).
- PMI is mentioned only in disclaimers.
- Money is numeric.
- Product gates are G1-G6 only, and DG0-DG7 appear only in "unrelated" comments.

## Checks
- **Static checks on Node 22 and Node 24:** typecheck, build, lint, tests (656/656) and contrast all exit 0.
- **Environmental residuals:** D-057 (registry), D-058 (CI) and D-049 (Keycloak) are recorded as PASS on the offline/config surface.

All data is synthetic. The G1-G3 decisions here are demo decisions that approve nothing real and have no bearing on DG2.
