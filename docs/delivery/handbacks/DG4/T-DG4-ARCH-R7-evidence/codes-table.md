# T-DG4-ARCH-R7 code table (ADR-0037 amendment N5; D-124 items 2 and 3)

This continues the code table of `T-DG4-ARCH-R6-evidence/codes-table.md`, whose last row is 245.

## Server codes and keys: none new, changed or retired

Amendment N5 adds a contract member (`DashboardValue.kpiUnit`, schema `DashboardKpiUnit`) and no code or key:
- no refusal (422/400) is added;
- no rule key, reason key or headline label key is added, changed or retired;
- the reasons a KPI-derived value already carries keep their texts.

| Row | Code or key | Kind | Source | Decision | English (exact, existing) | Arabic |
|---|---|---|---|---|---|---|
| — | `kpi.stale` | reason key | ADR-0028 | **unchanged** (sent on a Stale KPI value, now with `kpiUnit`) | (existing) | (existing) |
| — | `kpi.no_accepted_actual` | reason key | ADR-0028 | **unchanged** | (existing) | (existing) |
| — | `kpi.no_active_version` | reason key | ADR-0028 | **unchanged**: the one KPI value with `kpiUnit` null (an unreadable definition) | (existing) | (existing) |
| — | `dashboard.kpi.no_period_in_window` | reason key | ADR-0037 §4 | **unchanged** | (existing) | (existing) |

So no row 246 is allocated. The translation guard (`problems-slices-hijk.test.ts`) is not affected: `DASHBOARD_REFUSALS` is unchanged.

## Texts the web owns (no text sent by the API): proposed for FE-R7

- **The '%' sign** is a symbol, the same in EN and AR (`formatKpiValue` writes `${n} %` in both locales). It needs no key.
- **The unit label** (`kpiUnit.label`) is the organization's own free text, shown as entered in both locales. It is never translated, and the web must not look it up as a key.
- **Naming the unit kind (optional).** If FE-R7 wants an accessible name or a tooltip for the kind (for example on a ratio KPI with no label, '1.5'), it should reuse the existing KPI texts `kpi.definition.unitKinds.<kind>`. No new key is needed:

  | kind | EN (existing) | AR (existing) |
  |---|---|---|
  | `currency` | Currency | عملة |
  | `percentage` | Percentage | نسبة مئوية |
  | `count` | Count | عدد |
  | `ratio` | Ratio | نسبة |
  | `duration` | Duration | مدة |
  | `score` | Score | درجة |
  | `other` | Other | أخرى |

- **The fixtures' expected texts**, EN and AR, measured with the web's own formatters (handback §4.3): '12 %', '12 % of users', '1.5', '100 %'.
