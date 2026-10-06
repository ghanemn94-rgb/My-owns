# DG2 round 4: domain-reviewer narrative (T-DG2-REV-DOM-R4)

**Verdict: PASS. No new findings.**

- Candidate: `sha256:29ced0ed896ab9bf559e15dbdb39495b3da7a60c170989631ad9caf9a792ce58`, 521 files, recomputed in the repository and in a disposable clone.
- Source commit: `e37f6ea4`.
- Repository HEAD: `bb4dd9c9`. It differs from the source commit only in delivery metadata (round-4 assignments, the manifest and `stages.json`).

## Independence
- I authored no DG2 implementation.
- I formed this verdict from my own runs.
- I did not open any other reviewer's round-4 record.
- The only prior material I reused was my own round-3 tooling.

## What changed since round 3, and whether it still respects the playbook
D-064 replaced `trim()` with one shared predicate, `hasVisibleContent`, which sits behind `hasText` / `freeText` / `name` / `reason`. The web forms now refuse text that has no visible content, inline, and send nothing.

**Does any playbook field legitimately accept text the new rule refuses? No.**
- Every playbook fill-in is placeholder content. Examples: the B0035 charter rows ("[Describe]", "[Explicit exclusions]"), the four-part B0037 thesis, the T01–T04 columns (B0031/B0050/B0058) and the B0039–B0043 evidence answers.
- A value made only of whitespace, format characters (ZWSP, RLM, ALM, word joiner) or invisible fillers carries no meaning in any of them.
- The rule refuses only text with no visible content:
  - Arabic text with a leading RLM, and an emoji ZWJ sequence, are accepted and stored byte-for-byte (live: `R4.visible-arabic-with-marks-accepted-verbatim`).
  - Very short visible values ("-", "N/A", "0") are accepted.
  - `""` still means "no value", and `null` still clears an optional field.
  - Optional fields keep `freeText(0, …)`.
- The rule invents no new source requirement. It only stops non-content from counting as content, which is what B0041 ("explicit exclusions documented") and B0037 (all four parts stated) mean.

**B0041 pre-check and G1 readiness.**
- Invisible-only Out of scope values (RLM, ZWSP ×3, word joiner, NEL, Hangul filler, Braille blank, ALM+NBSP) are refused by the API with 400 `validation.blank` at `/outOfScope`, and no version is written.
- The same kind of values planted straight into the database still give the pre-check result `attention` ("Not supported by data") and leave G1 `initial_charter` incomplete.
- A visible exclusion passes.
- The pre-check remains a hint. The human answer is still recorded separately.

**Thesis "incomplete" flag.**
- `composeThesis` uses `hasText`. An invisible-only benefits part planted in the database raises `charter.thesis_incomplete` (live).
- Restoring visible text clears the flag.
- The UI shows "Incomplete" / "غير مكتملة" until all four parts are stated.

**User guidance in both languages.** The inline message is:
- EN: "Enter some text; spaces alone are not a value."
- AR: "أدخِل نصاً؛ المسافات وحدها ليست قيمة."

The message sits under the field, which is marked `aria-invalid` and gets focus. I checked this live in EN (LTR) and AR (RTL) for the charter create and edit forms with invisible-only input; see `screens/blank/*.png`. The product's own e2e suite also covers the gate note, gate rationale, journey actor and archive reason (`screens/e2e/*/p2-blank-*.png`). For invisible characters the wording says "spaces", but the field looks empty on screen, so the user reads it correctly. I treat that as acceptable wording, not a defect.

A change summary on its own now reads "There are no changes to save." That is consistent with charter versioning: a version is a change of content.

## Full re-review of the 26 requirements
Everything I verified in round 3 still holds on this candidate. I re-ran it live: 83/83 API assertions, 40/40 EN/AR browser journeys including the blank-text journeys, and 12/12 of my own charter blank-text UI checks.
- **Registers:** T01–T04 columns (REQ-PB-026/034/039/043).
- **Charter:** 14 fields with versions (REQ-PB-029); the four-part thesis (REQ-PB-030).
- **Direction:**
  - five B0039–B0043 checks verbatim (REQ-PB-031);
  - one current North Star (REQ-PB-033);
  - the 3–5 top-outcome warning (REQ-PB-035);
  - "Launch new app" fails the good-outcome test, and G2 lists it (REQ-PB-036);
  - zero guardrails block G2 (REQ-PB-037).
- **Diagnose and design:**
  - B0056 ten dimensions (REQ-PB-038);
  - B0029 six workstreams (REQ-PB-023);
  - the capability heatmap (REQ-PB-024) and journeys (REQ-PB-025);
  - the B0062 canvas with the per-dimension view (REQ-PB-041/042, REQ-S05-003).
- **Gates and governance:**
  - G2/G3 are refused before G1, and G3 before G2. G1, G2 and G3 were approved by a non-submitting Sponsor, and the phase moved diagnose→define→design→mobilize (REQ-PB-016/017/018, REQ-S04-003/004/005).
  - The B0009 guidance is verbatim for the selected mode (REQ-PB-003).
  - B0018 roles (REQ-PB-012).

There are no register, OpenAPI or migration changes since round 3, so my round-3 register spot-check still applies.

## Invariants
- No PMI or Mobily certification claims.
- The brand badge reads "Provisional" / "مؤقت".
- The only DG0–DG7 mention in product code is the disclaimer that product gates are unrelated to them.
- Unquantified value pools show a null amount, not 0.
- Money columns are `numeric(20,4)`.
- AR is RTL and EN is LTR.

## Residuals, not gate checks
- Live registry (D-057): only an offline frozen install was run.
- Live CI (D-058): the same pipeline steps were run locally.
- Keycloak (D-049): only dev auth and the OIDC integration tests were run.

## Harness note
My first live run failed G2 with 422 `validation.reference`. My own direct-SQL plant had bumped `charter.version` without a `charter_version` row, which broke the submission's foreign key. That is a reviewer artefact, not a product defect. The corrected re-run passes 83/83; details are in `env.txt`.
