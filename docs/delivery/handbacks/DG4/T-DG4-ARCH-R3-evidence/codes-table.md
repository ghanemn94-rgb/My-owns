# T-DG4-ARCH-R3 extended code table (rows 186-206), copied from the handback §4

## 4. Extended code table (continues ARCH-R2's 164–185)

"server" texts are what the API sends, or will send once the named task builds it. "authored" texts are written here, because the server sends only the key. Arabic is for FE to write, and stays provisional until linguistically reviewed.

| # | Code or key | Kind | Owning ADR | Decision | English text | Text origin | Where (as built, or to build) |
|---|---|---|---|---|---|---|---|
| 186 | `dashboard.value_class_not_applicable` (at `/valueClass`) | 422 | ADR-0037 K1, K2 | **new** (item 4) | A value class narrows only a drill-down of benefit values by state. | server (to build) | shared schemas/dashboards.ts (`DASHBOARD_REFUSALS`); api reporting/dashboards/drilldown.ts (`dashboardRefusal`) |
| 187 | `dashboard.value.sum_planned` | rule key | ADR-0037 K2 | accepted (KBE-G, as built; template-built, not in an ADR table before) | Planned value = the sum of the planned values in the period. | authored | api reporting/dashboards/drilldown.ts (`` `dashboard.value.sum_${state}` ``) |
| 188 | `dashboard.value.sum_forecast` | rule key | ADR-0037 K2 | accepted (as row 187) | Forecast value = the sum of the forecast values in the period. | authored | as row 187 |
| 189 | `dashboard.value.sum_submitted` | rule key | ADR-0037 K2 | accepted (as row 187) | Submitted value = the sum of the values submitted for Finance validation in the period. | authored | as row 187 |
| 190 | `dashboard.value.sum_validated` | rule key | ADR-0037 K2 | accepted (as row 187) | Validated value = the sum of the Finance-validated values in the period. | authored | as row 187 |
| 191 | `dashboard.value.sum_measured` | rule key | ADR-0037 K1, K2 | **new** (item 4) | Measured value = the sum of the measured values in the period. | authored | as row 187 (to build) |
| 192 | `dashboard.value.sum_rejected` | rule key | ADR-0037 K1, K2 | **new** (item 4) | Rejected value = the sum of the values Finance rejected in the period. | authored | as row 187 (to build) |
| 193 | `dashboard.value.sum_sustained` | rule key | ADR-0037 K1, K2 | **new** (item 4) | Sustained value = the sum of the sustained values in the period. | authored | as row 187 (to build) |
| 194 | `gate.modular_waiver_revoked` (row 169), now with `params.date` | 422 + problem member | ADR-0038 Q1, Q2 | **changed**: `params` added (item 2); code and text unchanged | The waiver of the missing baseline and outcome links was revoked on {date}; supply them or record a new waiver, then resubmit G3. | server (`params` to build) | api workflows/gates.ts; platform/problem.ts; shared problem.ts and schemas/problem.ts |
| 195 | `gate.modular_waiver_expired` (row 170), now with `params.date` | 422 + problem member | ADR-0038 Q1, Q2 | **changed**: `params` added (item 2); code and text unchanged | The waiver of the missing baseline and outcome links expired on {date}; supply them or record a new waiver, then resubmit G3. | server (`params` to build) | as row 194 |
| 196 | `governance.task.minutes_to_approve` (row 183), params `forum`, `forumAr`, `meetingDate` | work-item message key | ADR-0025 L1; ADR-0032 G3 | **changed**: param `forumAr` added (item 6); text unchanged | Approve the minutes of the {forum} meeting of {meetingDate}. | authored | api governance/minutes.ts |
| 197 | `dashboard.portfolio.slip_approved_date_missing` | reason key | ADR-0037 K2 | accepted (KBE-G, as built; template-built, not in an ADR table before) | Unknown: a milestone has no approved date, so its slip cannot be counted. | authored | api reporting/dashboards/areas.ts (`` `dashboard.portfolio.slip_${slip.reason}` ``) |
| 198 | `dashboard.portfolio.slip_forecast_date_missing` | reason key | ADR-0037 K2 | accepted (as row 197) | Unknown: a milestone has no forecast date, so its slip cannot be counted. | authored | as row 197 |
| 199 | `dashboard.portfolio.slip_calendar_not_configured` | reason key | ADR-0037 K2 | accepted (as row 197) | Unknown: no business calendar is configured, so working-day slip cannot be counted. | authored | as row 197 |
| 200 | `dashboard.portfolio.slip_range_too_long` | reason key | ADR-0037 K2 | accepted (as row 197) | Unknown: the slip spans more working days than can be counted. | authored | as row 197 |
| 201 | `dashboard.kpi.green` | rule key | ADR-0037 K2 | accepted (KBE-G, as built; template-built, not in an ADR table before) | KPI status: the KPI's displayed status is green. | authored | api reporting/dashboards/drilldown.ts (`` `dashboard.kpi.${s.displayedRag}` ``) |
| 202 | `dashboard.kpi.amber` | rule key | ADR-0037 K2 | accepted (as row 201) | KPI status: the KPI's displayed status is amber. | authored | as row 201 |
| 203 | `dashboard.kpi.red` | rule key | ADR-0037 K2 | accepted (as row 201) | KPI status: the KPI's displayed status is red. | authored | as row 201 |
| 204 | `dashboard.kpi.unknown` | rule key | ADR-0037 K2 | accepted (as row 201) | KPI status: Unknown. | authored | as row 201 |
| 205 | `dashboard.kpi.stale` | rule key | ADR-0037 K2 | accepted (as row 201) | KPI status: Stale. | authored | as row 201 |
| 206 | `dashboard.kpi.not_computable` | rule key | ADR-0037 K2 | accepted (as row 201) | KPI status: not computable. | authored | as row 201 |

**Items without a new code:**
- 1 (`getInitiativeSchedule`): the platform 404 `not_found`;
- 3 (`listScaleScopeBusinessUnits`): 404 `not_found` and the existing 400 cursor validation;
- 5 (`getAssessmentFormVersion`): 404 `not_found`;
- 7: the existing `kpi.scope_missing` and `kpi.cumulative_incomplete`.

The rows also live in their ADR amendments (ADR-0037 K2, ADR-0038 Q2, ADR-0025 L1, ADR-0032 G3). `evidence/codes-table.md` is a copy of this table.

