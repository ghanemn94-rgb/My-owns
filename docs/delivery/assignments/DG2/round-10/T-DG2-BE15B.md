# Assignment T-DG2-BE15B: complete T-DG2-BE15 after an interrupted run (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. No other agent runs at the same time.
- **Your task is T-DG2-BE15.** Read `docs/delivery/assignments/DG2/round-10/T-DG2-BE15.md` in full. Every requirement, test, self-verification step and handback rule in it applies unchanged.

## What happened
The first T-DG2-BE15 run was killed by a container restart at about 21:59Z. It never wrote `meta.json` or a handback. Following the D-059 precedent:
- **The implementation is salvaged.** Its partial work is committed as WIP at `HEAD`:
  - `media-types.ts`: RFC 9110 `parseContentType`, `canonicalContentType`, `decideMediaType`, header canonicalisation, and unmatched-route handling;
  - `hooks.ts` and `framework-errors.ts`: the refusal names the route's set;
  - the unit tests and `media-types.test.ts` integration cases.
- **The interrupted run is kept for provenance only, under `docs/delivery/test-evidence/DG2/be15-orphaned/`.** That includes its transcript and the partial logs. Do not cite those logs as your evidence.

## Required
1. **Review the salvaged implementation critically, as if it were someone else's, against every point of T-DG2-BE15.** Correct anything unsound or incomplete. Check in particular:
   - **Unmatched routes.** With the Content-Type removed and a body present (Content-Length or chunked), Fastify runs `contentTypeParser.run('')`. Prove the answer is still 404 `not_found` and never a 400/415/500. Prove the connection is closed and the next request on a keep-alive connection is unaffected.
   - **No remaining wrong media type in a refusal.** No refusal path anywhere names the wrong media type. This includes `restrictParserTo` and the `FST_ERR_CTP_INVALID_MEDIA_TYPE` backstop.
   - **Canonicalisation is safe.** It never changes how a body is decoded or stored, and quoted-string parameters survive it.
   - **The JSON charset decision.** A charset other than UTF-8 is refused. State it and justify it in the handback; D-070 will record it.
2. **Finish the tests the BE15 assignment requires.**
3. **Run the complete self-verification from scratch** in both locale settings, with real output, and write the handback `docs/delivery/handbacks/DG2/T-DG2-BE15-backend-workflow-engineer.md` with evidence under `docs/delivery/handbacks/DG2/T-DG2-BE15-evidence/`. Run the negative control against `3b2ab15`, the commit before the WIP.
