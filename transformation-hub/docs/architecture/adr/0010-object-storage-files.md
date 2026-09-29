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
