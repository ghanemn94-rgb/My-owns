# ADR-0008 — Retrieval for the AI PM: PostgreSQL full-text search with in-SQL ACL; pgvector optional

- Status: Accepted · Date: 2026-09-29
- Requirements: spec §12.1 (ACL before retrieval, per chunk, before output), AT-03, AT-17, AT-19

## Decision
- `document_chunk` stores chunk text with a generated `tsvector` (`simple` configuration — language-neutral for
  Arabic + English) and denormalized ACL attributes (`project_id`, `room_id`, `classification`).
- Retrieval is a single SQL query whose WHERE clause applies project scope, classification ≤ caller clearance and room
  grants *before* ranking (`ts_rank`), in a transaction that also carries RLS context. There is no fetch-then-filter.
- Structured records (tasks, CPs, TSAs, decisions…) are retrieved through typed tools that call the normal authorized
  services, not through the text index.
- pgvector was not available in the build environment; a `SemanticIndex` adapter interface is reserved for optional
  embeddings (P5+) and must apply the same in-SQL ACL.
- Index invalidation: chunk rows are deleted/rebuilt on document version, classification or room changes (outbox
  `document.changed`); derived AI artifacts are keyed by ACL fingerprint and invalidated on `permission.changed`.
