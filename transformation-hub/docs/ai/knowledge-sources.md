# AI runtime — knowledge sources and retrieval (spec §12.1, ADR-0008)

## Sources used

| Source | Read through | ACL applied in SQL | Notes |
|---|---|---|---|
| Documents (text of the CURRENT version) | `document_chunk` built by the documents module's `documents.index_version` job (txt/md/csv/DOCX). The AI module has **no ingestion pipeline of its own**. | chunk classification + room AND live `document` classification + room, `deleted_at is null`, `current_version_id`, scan status `clean`/`not_scanned` | Clean-team rooms are not indexed (documents module, D-09). Chunks flagged `suspicious_instructions` (or re-detected at read time) are passed as quoted data with a warning. |
| Tasks, milestones, workstreams, status updates, dependencies | planning tables (read-only) | project scope + `reachSql(planning.plan.read)` | template tasks start as drafts without owners/dates |
| Decisions, action items, approval requests | governance tables (read-only) | decision classification | titles of approval subjects are not exposed |
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
| Partner-room / clean-team item | never sent to any provider (conservative until AIQ-04 is decided) |
| E-mail, IBAN, national-id-like, phone patterns | redacted (secondary DLP control) |
| Per-run token limit | lowest-ranked items dropped with a warning |

## Derived data and invalidation

* Runs are per user and never shared (`GET …/ai/runs/:id` → 404 for anyone else).
* Derived artefacts (`ai_derived_artifact`: briefing summaries, executed drafts) are keyed by the ACL fingerprint
  (SHA-256 of user, clearance, sorted room ids, project/workstream/room roles). They are served only to their owner,
  only while the owner's current fingerprint is identical and every source is still visible.
* `ai.invalidate_derived` (worker) subscribes to `permission.changed`, `document.changed`, `evidence.changed` and marks
  affected artefacts invalidated (user → the user's artefacts; document/evidence → artefacts citing it; unclear scope →
  all artefacts of the project).
* No conversation memory exists: each question is answered from a fresh retrieval in one project.

## Answer contract

Every answer states: sourced findings (claims with citations `{type, id, version?, location?}`), missing inputs with the
owning role, conflicts (conflicting evidence links, conflicting verification status), freshness (as-of, oldest/newest
source, sources older than 90 days), warnings, withheld counts, refused tool calls, prepared requests, and a disclaimer
("Simulated" for the mock). The headline is composed deterministically by the runtime, not by the model.
