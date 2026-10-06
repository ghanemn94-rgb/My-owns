# DG2 round 3: domain review narrative (T-DG2-REV-DOM-R3)

**Candidate:** `sha256:b98c44db7ef91295eec25a21cbd394a91890b01caeeb6bfd269eb1ee6d132be5` (519 files, source `9e13947e`). I recomputed it in the repository and in a disposable clone.

**Verdict:** PASS. No new findings.

## Round-2 findings
| Finding | Result | Basis |
|---|---|---|
| F-DG2-150 (Medium, mandatory) B0041 exclusions check never fails | CLOSED_VERIFIED | See below. |
| F-DG2-151 (Low) duplicated gate codes | CLOSED_VERIFIED | Cards and headings show "G2 - Direction" / "G2 - التوجّه" once. `gateLabel()` composes every gate title. |
| F-DG2-152 (Low) register endpoint drift | CLOSED_VERIFIED | REQ-S05-003 cites `GET …/tom-canvas` and `GET …/tom-canvas/{dimensionCode}` (live 200; the old path is 404). All 16 changed rows resolve against the OpenAPI document. |

How F-DG2-150 was verified (live):
- A null Out of scope gives `attention`, shown as the amber chip "Not supported by data" / "لا تدعمه البيانات" with the failing detail in EN and AR.
- G1 `initial_charter` is incomplete, naming the scope out.
- Whitespace input (spaces, tab/newline, NBSP/ideographic space) is rejected with 400 `validation.blank`, and nothing is written.
- A blank value planted directly in the DB still fails, in both the pre-check and G1.
- Non-blank text passes.
- ADR-0017 §2 is updated.

## Source fidelity (playbook)
- **Gates and modes**
  - B0009 modes: there are exactly two, and the "How" guidance is verbatim for the selected mode.
  - B0023 gate names, questions and evidence are verbatim.
  - Gates are sequential: G2/G3 before G1 gives 422 `gate.out_of_sequence`, and so does G3 before G2.
  - On synthetic data, G1→G2→G3 demo decisions by the Sponsor (never the submitter) advance diagnose→define→design→mobilize.
- **Roles, registers and charter**
  - B0018: the six roles carry verbatim accountability text.
  - B0029: six workstreams, with verbatim key questions.
  - B0031: T01 has six seeded dimensions and H/M/L confidence.
  - B0035: the charter has 14 fields and is versioned.
  - B0037: the four-part thesis gives an incomplete warning when parts are empty.
  - B0039–B0043: the five scope checks are verbatim.
- **Define and design**
  - Exactly one North Star is current, and the charter shows it.
  - There is a 3-5 top-outcome warning.
  - "Launch new app" fails the good-outcome test and appears in G2 readiness.
  - G2 is blocked with zero guardrails.
  - B0056/B0062: ten dimensions and canvas prompts are verbatim. A canvas cell can be marked `ready` only with a target design and an owner.
  - T03 gaps, the capability heatmap and future journeys feed G3, and the workshop conversion is covered by the e2e journey.

## Judgements requested
- **D-063 (blank-text rejection).** No conflict with the playbook. Every playbook fill-in expects content, so a whitespace-only value is never a meaningful answer. `null` still clears a field, and optional step fields still accept `""`.
- **"Not supported by data" for `attention`.** The label is accurate in all four places that emit `attention` (traceability, exclusions, baseline, executive decisions). The B0039 check is human-only. The pre-check stays a hint and never answers for people.

## Observation (not a finding)
The charter fields card says "Missing fields show Unknown", yet empty free-text fields (In scope, Out of scope, Governance forum, and others) render "None", while structured fields render the Unknown chip. "None" correctly states that nothing is recorded, and nothing is shown as zero or green, so the invariant holds. The helper sentence could be made more precise.

## Environmental residuals
D-057 (live registry), D-058 (live CI) and D-049 (Keycloak) are recorded as PASS on the offline/config surface.

All data was synthetic. Product gates G1-G3 here are demo business decisions; they approve nothing real and are unrelated to DG0-DG7.
