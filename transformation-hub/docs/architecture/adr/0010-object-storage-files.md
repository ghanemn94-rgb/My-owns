# ADR-0010 — Object storage adapter and safe file pipeline

- Status: Accepted · Date: 2026-09-29
- Requirements: spec §13, §15 (file validation, quarantine, path traversal, SSRF), §17, AT-25

## Decision
`ObjectStorage` interface with `LocalFsStorage` (dev/test; keys are UUID-derived, never user-supplied paths) and
`S3CompatibleStorage` (production; MinIO/Ceph/on-prem S3 or an internal provider). Files are never publicly linked;
downloads stream through `GET /api/v1/projects/:pid/documents/:id/versions/:vid/download` after authorization and are
audited. Upload pipeline: size limit → magic-byte type detection (allowlist) → SHA-256 → quarantine state
(`scan_status=pending`) → scanner adapter (`ClamAV`/enterprise scanner; `not_scanned` when none is configured, which
blocks extraction/indexing) → extraction → indexing. No URL fetching from imported content.

## Amendment (P2 documents merge)
- `not_scanned` means "no enterprise malware scanner is configured; the built-in signature check (EICAR, executables,
  scripts) found nothing" — never "clean". Whether such files may be downloaded and indexed is a deployment decision:
  `HUB_ALLOW_UNSCANNED_FILES` (default **false in production**, true in development/demo). Enabling it in production is
  an explicit risk acceptance to be recorded by Mobily security; connecting the enterprise scanner (Q-10) is the
  intended production path. `quarantined`, `rejected` and `pending` versions are never downloadable or indexed.
- Clean-team room material is never indexed for AI retrieval (D-09).
- `document_version.room_id` and `evidence_link.room_id` are derived from the document by trigger and follow room moves,
  so clean-team/partner principals work with their room's versions and evidence under RLS.
