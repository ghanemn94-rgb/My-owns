# DG2 round 2: code-security-reviewer narrative

Candidate `sha256:089a2a2f…9be69` (517 files), source `eb8163e2`, recomputed in the working tree at HEAD `f5a72b4`.
The two later commits touch only delivery metadata. Verdict: **PASS**.

## Round-1 findings: verified on this candidate

| Finding | Result | Key evidence |
|---|---|---|
| F-DG2-140 (High) evidence SoD | **CLOSED_VERIFIED** | A foreign edit or upload now gets 403. When the owner edits a note, URL or file, then tries to verify it, the result is 403 `evidence.reviewer_is_author` with a denied audit. Title-only laundering is also refused. As mth_app, a DB bypass by the author or uploader, including one with a spoofed `content_authored_by`, fails with 23514 `evidence_review_separation`. Independent controls pass. |
| F-DG2-141 (High) trajectory SoD | **CLOSED_VERIFIED** | The round-1 repro now gets 403 `kpi.target_author_cannot_approve` with an audit. The targetDate, trajectoryPoints, baselineValue and BO-then-TL variants, and an edit after approval, also get 403. The controls still return 200. |
| F-DG2-142 (Medium) link removal | **CLOSED_VERIFIED** | WL removing TL's link gets 403 with an audit, and the link stays active. TL gets 200, AUD gets 403, and an unknown link gets 404. |

The round-1 probe was re-run verbatim. Its SEC-1 assertions now fail with 400 instead of 403. That is an artefact of the fix: the first
step is refused, so the next request sends `If-Match: "undefined"`. Its SEC-5 `owner_delete_evidence_content` committed in
run 2 only, because the table was empty and a row-level trigger can't fire on zero rows. A dedicated probe with a row present
shows the append-only guard refusing. Details are in
`docs/delivery/test-evidence/DG2/code-security/round-2/probes/README.md`.

## Checks

All of these passed: build, typecheck, lint, openapi:lint (161 operations), no-cdn, format, unit tests on Node 24 and on Node 22
(after two clean reruns; see F-DG2-143), two integration runs on fresh PostgreSQL 16 (440/440 each, 19 migrations,
contract test, AUD sweep including `activateKpiDefinition`), and historical validation of DG0 and DG1. Live registry, CI and Keycloak are environmental
residuals (D-057, D-058, D-049). Only their offline and config surfaces were checked.

## New finding

- **F-DG2-143 (Low, non-mandatory, REQ-S16-001):** the `architecture.test.ts` module-boundary test uses about 4.3–4.6 s of
  vitest's default 5 s timeout. It timed out once (5.8 s) under moderate host load. This is a flaky required check.

## Observations (below finding level)

- `content_authored_by` is NULL on rows from before migration 0019 and is read as the creator. There is no production data.
- The T02 author rule is enforced only in the API. The DB CHECK still enforces only the creator rule.
- A user holding both KDS and BO grants could change a referenced baseline record. This predates the repair, and the
  baseline has its own validation workflow.
- Archiving is now limited to the owner or holders of `evidence.review`, which is narrower than round 1.
