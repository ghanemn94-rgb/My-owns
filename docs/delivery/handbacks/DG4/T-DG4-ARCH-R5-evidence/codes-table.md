# Code table, continued by T-DG4-ARCH-R5 (rows 207–235)

The consolidated table started in `T-DG4-ARCH-R1-evidence/codes-table.md` (rows 1–163), and T-DG4-ARCH-R3 extended it to row 206. T-DG4-ARCH-R4 added no row. These rows also live in ADR-0037 amendment N3.

- **Columns.** The English text is exact. The Arabic text is a **proposal for FE-R5**, which owns the web keys and their Arabic. Like every Arabic UI string, it is provisional until a native reviewer confirms it. The Arabic follows the terms the web already uses: "الربح والنقد" (`dashboards.json` `gross`), "زيادة الإيرادات (الخط الأعلى)", "تكلفة متجنَّبة (غير نقدية)", and "القيمة المخططة / المتوقعة / المقدَّمة / المعتمدة".
- **Web key form.** The web stores a key with `.` replaced by `__` (for example `dashboard__headline__value_planned_profit_and_cash` in `apps/web/src/i18n/{en,ar}/dashboards.json`).
- **Where.** Every row is to be built by KBE-R6 (the API sends the key) and FE-R5 (renders it), in `reporting/dashboards/engine.ts`, `areas.ts`, `drilldown.ts` and `reporting/workspace-header.ts`.

| # | Code or key | Kind | Owning ADR | Decision | English text (exact) | Arabic (proposed, provisional) |
|---|---|---|---|---|---|---|
| 207 | `dashboard.headline.value_planned_profit_and_cash` | label key | ADR-0037 N3 | **new** | Planned value (profit and cash) | القيمة المخططة (الربح والنقد) |
| 208 | `dashboard.headline.value_forecast_profit_and_cash` | label key | ADR-0037 N3 | **new** | Forecast value (profit and cash) | القيمة المتوقعة (الربح والنقد) |
| 209 | `dashboard.headline.value_submitted_profit_and_cash` | label key | ADR-0037 N3 | **new** | Submitted value (profit and cash) | القيمة المقدَّمة (الربح والنقد) |
| 210 | `dashboard.headline.value_validated_profit_and_cash` | label key | ADR-0037 N3 | **new** | Validated value (profit and cash) | القيمة المعتمدة (الربح والنقد) |
| 211 | `dashboard.headline.value_gap_profit_and_cash` | label key | ADR-0037 N3 | **new** | Value gap (profit and cash) | فجوة القيمة (الربح والنقد) |
| 212 | `dashboard.headline.value_planned_top_line` | label key | ADR-0037 N3 | **new** | Planned revenue uplift (top line; not in profit and cash) | زيادة الإيرادات المخططة (الخط الأعلى؛ لا تدخل في الربح والنقد) |
| 213 | `dashboard.headline.value_forecast_top_line` | label key | ADR-0037 N3 | **new** | Forecast revenue uplift (top line; not in profit and cash) | زيادة الإيرادات المتوقعة (الخط الأعلى؛ لا تدخل في الربح والنقد) |
| 214 | `dashboard.headline.value_submitted_top_line` | label key | ADR-0037 N3 | **new** | Submitted revenue uplift (top line; not in profit and cash) | زيادة الإيرادات المقدَّمة (الخط الأعلى؛ لا تدخل في الربح والنقد) |
| 215 | `dashboard.headline.value_validated_top_line` | label key | ADR-0037 N3 | **new** | Validated revenue uplift (top line; not in profit and cash) | زيادة الإيرادات المعتمدة (الخط الأعلى؛ لا تدخل في الربح والنقد) |
| 216 | `dashboard.headline.value_planned_non_cash` | label key | ADR-0037 N3 | **new** | Planned avoided cost (non-cash; not in profit and cash) | التكلفة المتجنَّبة المخططة (غير نقدية؛ لا تدخل في الربح والنقد) |
| 217 | `dashboard.headline.value_forecast_non_cash` | label key | ADR-0037 N3 | **new** | Forecast avoided cost (non-cash; not in profit and cash) | التكلفة المتجنَّبة المتوقعة (غير نقدية؛ لا تدخل في الربح والنقد) |
| 218 | `dashboard.headline.value_submitted_non_cash` | label key | ADR-0037 N3 | **new** | Submitted avoided cost (non-cash; not in profit and cash) | التكلفة المتجنَّبة المقدَّمة (غير نقدية؛ لا تدخل في الربح والنقد) |
| 219 | `dashboard.headline.value_validated_non_cash` | label key | ADR-0037 N3 | **new** | Validated avoided cost (non-cash; not in profit and cash) | التكلفة المتجنَّبة المعتمدة (غير نقدية؛ لا تدخل في الربح والنقد) |
| 220 | `dashboard.value.no_profit_and_cash_benefit` | reason key | ADR-0037 N3 item 4; ADR-0030 N3 item 4 | **new** | Not applicable: nothing is planned on this basis (no margin uplift, cash saving or working-capital release benefit). | لا ينطبق: لا يوجد شيء مخطط على هذا الأساس (لا توجد منفعة زيادة هامش أو وفر نقدي أو تحرير رأس مال عامل). |
| 221 | `dashboard.rag.value.no_profit_and_cash_benefit` | rule key | ADR-0037 N3 item 4 | **new** | Value: not applicable; there is no margin uplift, cash saving or working-capital release benefit. | القيمة: لا ينطبق؛ لا توجد منفعة زيادة هامش أو وفر نقدي أو تحرير رأس مال عامل. |
| 222 | `dashboard.value.sum_planned_profit_and_cash` | rule key | ADR-0037 N3 | **new** | Planned value (profit and cash) = the sum of the planned margin uplift, cash saving and working-capital release values in the period. | القيمة المخططة (الربح والنقد) = مجموع القيم المخططة لزيادة الهامش والوفر النقدي وتحرير رأس المال العامل في الفترة. |
| 223 | `dashboard.value.sum_forecast_profit_and_cash` | rule key | ADR-0037 N3 | **new** | Forecast value (profit and cash) = the sum of the forecast margin uplift, cash saving and working-capital release values in the period. | القيمة المتوقعة (الربح والنقد) = مجموع القيم المتوقعة لزيادة الهامش والوفر النقدي وتحرير رأس المال العامل في الفترة. |
| 224 | `dashboard.value.sum_submitted_profit_and_cash` | rule key | ADR-0037 N3 | **new** | Submitted value (profit and cash) = the sum of the margin uplift, cash saving and working-capital release values submitted for Finance validation in the period. | القيمة المقدَّمة (الربح والنقد) = مجموع قيم زيادة الهامش والوفر النقدي وتحرير رأس المال العامل المقدَّمة لاعتماد المالية في الفترة. |
| 225 | `dashboard.value.sum_validated_profit_and_cash` | rule key | ADR-0037 N3 | **new** | Validated value (profit and cash) = the sum of the Finance-validated margin uplift, cash saving and working-capital release values in the period. | القيمة المعتمدة (الربح والنقد) = مجموع قيم زيادة الهامش والوفر النقدي وتحرير رأس المال العامل المعتمدة من المالية في الفترة. |
| 226 | `dashboard.value.sum_measured_profit_and_cash` | rule key | ADR-0037 N3 | **new** | Measured value (profit and cash) = the sum of the measured margin uplift, cash saving and working-capital release values in the period. | القيمة المقيسة (الربح والنقد) = مجموع القيم المقيسة لزيادة الهامش والوفر النقدي وتحرير رأس المال العامل في الفترة. |
| 227 | `dashboard.value.sum_rejected_profit_and_cash` | rule key | ADR-0037 N3 | **new** | Rejected value (profit and cash) = the sum of the margin uplift, cash saving and working-capital release values Finance rejected in the period. | القيمة المرفوضة (الربح والنقد) = مجموع قيم زيادة الهامش والوفر النقدي وتحرير رأس المال العامل التي رفضتها المالية في الفترة. |
| 228 | `dashboard.value.sum_sustained_profit_and_cash` | rule key | ADR-0037 N3 | **new** | Sustained value (profit and cash) = the sum of the sustained margin uplift, cash saving and working-capital release values in the period. | القيمة المستدامة (الربح والنقد) = مجموع القيم المستدامة لزيادة الهامش والوفر النقدي وتحرير رأس المال العامل في الفترة. |
| 229 | `dashboard.rag.value.validated_gap` (A2 row) | rule key | ADR-0037 A2, N3 | **text changed**; key unchanged | Value: validated value against the value planned to date, on the profit-and-cash basis (margin uplift, cash saving and working-capital release). | القيمة: القيمة المعتمدة مقابل القيمة المخططة حتى تاريخه، على أساس الربح والنقد (زيادة الهامش والوفر النقدي وتحرير رأس المال العامل). |
| 230 | `dashboard.value.gap_ratio` (A2 row) | rule key | ADR-0037 A2, N3 | **text changed**; key unchanged | Value gap (profit and cash) = (planned due to date - validated) / planned due to date, over margin uplift, cash saving and working-capital release. | فجوة القيمة (الربح والنقد) = (المخطط المستحق حتى تاريخه - المعتمد) / المخطط المستحق حتى تاريخه، على زيادة الهامش والوفر النقدي وتحرير رأس المال العامل. |
| 231 | `dashboard.headline.value_planned` (row 147) | label key | ADR-0037 A2, N3 | **retired** once KBE-R6 lands (no longer sent); the web keeps it until then | Planned value | (existing) |
| 232 | `dashboard.headline.value_forecast` (row 148) | label key | ADR-0037 A2, N3 | **retired**, as row 231 | Forecast value | (existing) |
| 233 | `dashboard.headline.value_submitted` (row 149) | label key | ADR-0037 A2, N3 | **retired**, as row 231 | Submitted value | (existing) |
| 234 | `dashboard.headline.value_validated` (row 150) | label key | ADR-0037 A2, N3 | **retired**, as row 231 | Validated value | (existing) |
| 235 | `dashboard.headline.value_gap` (row 151) | label key | ADR-0037 A2, N3 | **retired**, as row 231 | Value gap | (existing) |

**Not a code, but a contract enum (no text sent by the API):** `HeadlineBasis` = `profit_and_cash`, `top_line`, `non_cash`.
- **Suggested web chip texts (FE-R5's keys):**

  | Value | EN | AR |
  |---|---|---|
  | `profit_and_cash` | Profit and cash | الربح والنقد |
  | `top_line` | Top line | الخط الأعلى |
  | `non_cash` | Non-cash | غير نقدية |

- **Row numbers 147–151** are the R1 table's own (checked: row 147 is `dashboard.headline.value_planned`, and rows 148–151 follow in A2 order).
