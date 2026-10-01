# AI runtime — knowledge sources and retrieval (spec §12.1, ADR-0008)

## Sources used

| Source | Read through | ACL applied in SQL | Notes |
|---|---|---|---|
| Documents (text of the CURRENT version) | `document_chunk` built by the documents module's `documents.index_version` job (txt/md/csv/DOCX). The AI module has **no ingestion pipeline of its own**. | chunk classification + room AND live `document` classification + room, `deleted_at is null`, `current_version_id`, scan status `clean`/`not_scanned` | Clean-team rooms are not indexed (documents module, D-09). Chunks flagged `suspicious_instructions` (or re-detected at read time) are passed as quoted data with a warning. |
| Tasks, milestones, workstreams, status updates, dependencies | planning tables (read-only) | project scope + `reachSql(planning.plan.read)` | template tasks start as drafts without owners/dates |
| Decisions, action items, approval requests | governance tables (read-only) | decision classification; an action follows its decision; an approval request its subject | titles of approval subjects are not exposed. For the provider ceiling an action carries a **derived classification** = the highest of its decision's, that decision's committee's and its meeting's committee's classification (SEC-P5-03) |
| Gates / criteria / assessments | gates tables (read-only) | project scope | |
| Closing conditions (CPs), partners, deal scenarios | jv tables (read-only) | partner/scenario classification | JV module not implemented yet — only fixture rows in tests |
| TSA services, readiness checks | carve-out tables (read-only) | project scope; readiness `reachSql` | readiness module not implemented yet |
| Approved financials / valuation | finance tables (read-only) | classification | approved rows only; no model arithmetic |
| Status dimensions | gates-owned table | project scope | may be empty until the gates module computes them |

Structured records are authoritative for states and numbers; documents provide context. Numbers in AI claims must appear
verbatim in the cited sources (`ungroundedNumbers`), otherwise the claim is removed.

## Retrieval rules

1. Retrieval runs as the **delegating human** (request context, or `JobContextFactory.forUser` re-resolved in the
   worker) inside a transaction carrying RLS settings; ACL predicates sit in the `WHERE` clause before ranking.
2. Full-text search uses PostgreSQL `simple` configuration with an OR of `plainto_tsquery('simple', term)` per question
   term (EN + AR, stopwords removed, bound parameters). **Limitation:** no cross-lingual matching — an Arabic question
   only matches English documents through shared terms (e.g. code-switched technical words); semantic/multilingual
   embeddings (pgvector) are not available (ADR-0008).
3. The model cannot initiate retrieval or pass ids; project and room scope are bound by the runtime.
4. Before output and on every read of a stored run, every cited item is re-checked for visibility for the current reader;
   claims whose citations are no longer visible are dropped.

## Policy gateway on context (before any provider call)

| Check | Effect |
|---|---|
| Item classification above the project ceiling (`maxClassificationToProvider`) or the provider's hard maximum (external gateway: `internal`; local/mock: `restricted`; never `strictly_confidential`) | withheld from the provider; the reader (who can see it) is told how many |
| Derived item (a committee action: its decision and committees — `derivedClassification`); an item whose classification is unknown or whose parent cannot be read | the derived (highest) classification is compared with the ceiling; unknown → `strictly_confidential`, never sent (fail closed, SEC-P5-03) |
| Partner-room / clean-team item | never sent to any provider (conservative until AIQ-04 is decided) |
| E-mail, IBAN, national-id-like, phone patterns | redacted (secondary DLP control) |
| Per-run token limit | lowest-ranked items dropped with a warning |

## Derived data and invalidation

* Runs are per user and never shared (`GET …/ai/runs/:id` → 404 for anyone else).
* Derived artefacts (`ai_derived_artifact`: briefing summaries, executed drafts) are keyed by the ACL fingerprint
  (SHA-256 of user, clearance, sorted room ids, project/workstream/room roles). They are served only to their owner,
  only while the owner's current fingerprint is identical and every source is still visible. The sources of an executed
  draft are its target **and every record its run sent to the model** (SEC-P5-05), so a reclassified or deleted input
  hides it on read and `document.changed` invalidates it.
* A stored run is re-checked on every read like its claims (SEC-P5-05): a warning that names a source (e.g. "Source …
  was last updated …") is stored with that source and dropped when the reader can no longer see it; prepared-request text
  written by the model is shown only while the reader may still read every record the run gave the model. The headline of
  a run that did not succeed is its status explanation, never a source-naming warning.
* `ai.invalidate_derived` (worker) subscribes to `permission.changed`, `document.changed`, `evidence.changed` and marks
  affected artefacts invalidated (user → the user's artefacts; document/evidence → artefacts citing it; unclear scope →
  all artefacts of the project).
* No conversation memory exists: each question is answered from a fresh retrieval in one project.

## Answer contract

Every answer states: sourced findings (claims with citations `{type, id, version?, location?}`), missing inputs with the
owning role, conflicts (conflicting evidence links, conflicting verification status), freshness (as-of, oldest/newest
source, sources older than 90 days), warnings, withheld counts, refused tool calls, prepared requests, and a disclaimer
("Simulated" for the mock). The headline is composed deterministically by the runtime, not by the model.

**Language (QA-P5-04, module guide §2).** A run has a language (the delegating user's): the model receives its context in
that language and writes its claims in it. For an Arabic run the server renders each record's context from codes — the
record's Arabic template title (`titleAr` / `nameAr`) when it has one, the detection sentence from
`AI_DETECTION_MESSAGES_AR` and every status / area / stage through the Arabic status labels (`AI_STATUS_AR`) — so no
English template title or raw enum value reaches an Arabic answer, briefing or proposal. User-entered titles (decisions,
committee actions, CPs, TSAs) are shown as entered. The structured parts of the output follow the bilingual-data pattern:
citations and detections carry `label` + `labelAr` (only when the record has an Arabic title; a title typed by a
person has none and is shown as entered), detections `detail` (English) + `detailI18n` (codes + parameters),
which the screens render in the UI language (`ai.messages.ai.detection.*`, `statuses.*`). `check-i18n.mjs` keeps the
server's Arabic context texts identical to the Arabic catalogue.

## Content of AI messages and drafts follows the recipient (SEC-P5-01, AIT-07, access-matrix §5.2)

The model writes a message's title and body from the records the runtime gave it. Whatever an imported document instructs
("send the memo / the financials to X"), a message is only proposed, approved or delivered to a recipient who may read
**its target and every record its run sent to the model** — the run's evidence snapshot items with `sentToProvider`, each
under the same per-type rule as retrieval (`AiKnowledgeService.inputsVisible` → `refVisibleSql`: classification,
finance-domain clearance and reach, rooms, workstream reach, project-wide registers). A message without a target is
judged on its inputs alone; inputs that cannot be established (no run, no snapshot) fail closed.

| When | Check | On failure |
|---|---|---|
| Creation (model tool call, in the delegating user's transaction) | recipient = active internal full member; target and every input readable by the recipient | no proposal; audited `DESTINATION_NOT_APPROVED` with reason `recipient_not_cleared_for_content` |
| Approval (`POST …/proposals/:id/approve`) | the same, with the recipient's CURRENT access | 422 `ai.recipient_not_cleared` (content) or `DESTINATION_NOT_APPROVED` (membership / target); the proposal is invalidated (kept although the request is refused) and audited `AI_APPROVAL_INVALIDATED` |
| Revision by the requester | the same for the new recipient | 422 `ai.recipient_not_cleared`; nothing changes |
| Execution (worker, also under autopilot) | the same, again | proposal invalidated (`recipient_not_cleared_for_content` / `recipient_no_longer_authorized`), nothing sent |

A draft (agenda, minutes, paper, status summary, task or risk draft) is delivered only to the delegating user's AI
workspace; at execution the delegating user must still read its target and every input (`requester_not_cleared_for_content`
otherwise). The delegating user's own question text is not a record and is not part of this check.
