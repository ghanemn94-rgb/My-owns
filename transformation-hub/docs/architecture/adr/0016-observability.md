# ADR-0016 — Observability: structured logs, OpenTelemetry to an internal collector

- Status: Accepted (design; implementation P7) · Date: 2026-09-29
- Requirements: spec §13 ("OpenTelemetry directed to an internal collector"), §16 (monitoring runbooks), ARCH-20

## Decision
- Structured logs (JSON in production) with correlation id (`x-correlation-id`) on every request and job; never SQL
  parameters, secrets, tokens or document content (enforced in the problem filter).
- Traces/metrics via the OpenTelemetry Node SDK exporting OTLP to an **internal** collector endpoint configured by Mobily
  (`OTEL_EXPORTER_OTLP_ENDPOINT`); disabled when unset. No vendor SaaS and no public telemetry (Next.js telemetry off).
- Security events (denied/rejected mutations, sensitive reads, session revocations) go to the audit log and are exportable
  to Mobily's SIEM.
- Health: `/healthz` (liveness), `/readyz` (DB reachability). Worker health: last tick time + queue depth exposed via a
  metrics endpoint in P7.
