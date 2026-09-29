# ADR-0012 — Money, time and calendars

- Status: Accepted · Date: 2026-09-29
- Requirements: spec §9, §14, AT-15, AT-29

## Decision
- Money: `numeric(20,4)` + ISO currency + `unit_scale` (1/1000/1000000); arithmetic with decimal.js in
  `packages/domain/money`. Aggregation across currencies requires an explicit conversion basis (rate, source, as-of);
  otherwise it is rejected (AT-29).
- Instants: `timestamptz`, UTC. Business dates: `date`, interpreted in the project timezone (default Asia/Riyadh).
- Working calendar: proposed Sunday–Thursday week, editable holidays per project; schedule engine uses working-day
  boundaries; FS + lag only until SS/FF/SF are individually tested; missing durations → "Incomplete schedule".
