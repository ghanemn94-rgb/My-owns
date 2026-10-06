# DG2 round 10: domain-reviewer narrative

**Verdict: PASS.** The candidate is `sha256:7fd1a89ca090dbdea5ae9f014853684239cbf80e89dc5cce50914155cb9d484a` (544 files, source `fe22d759`). I raised no new findings, and I had no open findings to verify.

## What changed and why it has no domain effect
D-070 changes seven files, all in the API platform layer: `media-types.ts`, `hooks.ts`, `framework-errors.ts`, `index.ts` and their tests. It does not touch:
- i18n;
- web UI;
- seeds or migrations;
- gate criteria;
- register columns;
- methodology text.

The web client still sends `application/json` and `application/octet-stream` (`apps/web/src/api/client.ts:106-107`).

## What I exercised live (disposable PG16 + API, SYNTHETIC data)
- **Gate logic.** The full Diagnose→Define→Design walk gave 101/101 PASS. G1, G2 and G3 advance sequentially with the B0023 names, and out-of-sequence submissions get 422. The design registers gave 11/11 PASS.
- **D-070 media types** (17/17 PASS):
  - Unknown addresses get 404 for every media type.
  - Refusals name the operation's own media type: octet-stream on the upload, JSON on the charter. They carry the localized `validation.content_type` (EN "The request format is not supported.", AR "صيغة الطلب غير مدعومة.") and store nothing.
  - OWS/HTAB before `;` is accepted.
  - A non-UTF-8 charset on JSON is refused.
  - A duplicate Content-Type is refused.
- **Bilingual behaviour.** Arabic+emoji+RLM charter text is stored verbatim through both the API and the UI. Invisible-only values still get `validation.blank`, with the localized inline message in EN (LTR) and AR (RTL).
- **Evidence upload.** Files uploaded through the API and through the Evidence page come back byte-identical, with the Arabic file name kept. The item shows as Unverified.
- **Regressions.** My D-066 to D-069 probes all still pass.

## Invariants
- B0009 and B0023 text is verbatim.
- PMI and official wording appears only in the disclaimers.
- `#0078FF` is marked provisional, and the AR header shows the "مؤقت" wordmark.
- Migrations contain no float types.
- Product gates are only G1..G6; DG0-DG7 appears only in comments and notes.

## Notes
- The repository HEAD moved from 68fe3394 to 6dd71477 during my run (the orchestrator changed two stages.json timestamps). The candidate ID did not change.
- The environmental residuals D-057, D-058 and D-049 were checked on their offline or config surface only.
- The reused round-9 probe labels ("Synthetic R9 …") still appear in the data and screenshots.
