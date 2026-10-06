# DG2 round 9: domain-reviewer narrative

**Verdict: PASS. No new findings.**

| Item | Value |
|---|---|
| Candidate | `sha256:45ebccc04d8efc0c4fdc6a842eb3c9ec330bab2ec517b1c592af60b05a066294` (544 files) |
| Source | `7854770e` |
| Freeze | `041478cb` |

## What I did
- **Candidate.** I recomputed the candidate ID in the repository and in a disposable clone; both match. `validate.mjs --historical --stage DG1` passes.
- **Build and test.** I ran typecheck, build, lint, test (718/718) and the contrast check on Node 22.22.2 and Node 24.21.0. All exit 0.
- **Live API checks.** I ran three fresh disposable stacks: PostgreSQL 16 with a UTF8 database, a dev-auth API and synthetic seed data. Results:
  - Full Diagnose→Define→Design walk: 101/101. The G1, G2 and G3 demo decisions advance diagnose→define→design→mobilize, out-of-sequence submissions are refused, and the B0023 names are verbatim.
  - Design registers: 11/11.
  - D-068, D-067 and D-066 regressions: 21, 11 and 16, all PASS.
- **D-069 (new probes).**
  - Evidence upload: a binary file holding every byte value plus invalid UTF-8 is uploaded as `application/octet-stream`. Through the API (both framings) and through the Upload dialog in EN and AR, it downloads byte-identical. The sha256 and Digest match, and the Arabic file name is kept.
  - Undeclared media types: `text/plain` and JSON sent to the upload route, and `text/plain`, octet-stream, form-urlencoded and multipart sent to the charter route, all get 400 `validation.content_type` with nothing stored. The message is localized in EN and AR.
  - Arabic text: Arabic, emoji and RLM JSON is still stored verbatim, and invisible-only text is still `validation.blank`.
  - Form-level error: a form-level `validation.json` problem appears exactly once, in a single `role=alert`, in EN (LTR) and AR (RTL). Nothing is saved.
- **UI regressions.** I reran the UI regressions: blank and invisible charter fields, B0009 mode guidance, lone surrogate and NUL refusals, all in both locales.
- **Static invariants.** D-069 touches no i18n, seed, migration or methodology file. The PMI disclaimers are honest. `#0078FF` is provisional and the wordmark is marked provisional. There are no float money columns, and no DGx code is used as a product gate.

## Notes
- **My own probe error.** The first r9-ui attempt in stack-run-2 failed on my probe's button selector, before any upload. I fixed it to text locators and re-ran it on a fresh stack (stack-run-3). This was not a product defect.
- **Environmental residuals.** D-057, D-058 and D-049 were checked on their offline or config surface only. They are not gate checks.
- **Synthetic data.** All data is synthetic. The demo G1–G3 decisions approve nothing real and have no relation to DG0–DG7.
