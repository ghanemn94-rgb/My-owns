# Code table, continued by T-DG4-ARCH-R6 (rows 236–245)

The consolidated table started in `T-DG4-ARCH-R1-evidence/codes-table.md` (rows 1–163). T-DG4-ARCH-R3 extended it to row 206, and T-DG4-ARCH-R5 to row 235 (`T-DG4-ARCH-R5-evidence/codes-table.md`). These rows also live in ADR-0037 amendment N4.

- **Columns.** The English text is exact. The Arabic text is a **proposal for FE-R6**, which owns the web keys and their Arabic. Like every Arabic UI string, it is provisional until a native reviewer confirms it. It reuses the ARCH-R5 terms: "الربح والنقد", "الخط الأعلى", "غير نقدية", "زيادة الإيرادات", "التكلفة المتجنَّبة" and "فجوة القيمة".
- **Web key form.** As before, `.` becomes `__`. Label, rule and reason keys go in `apps/web/src/i18n/{en,ar}/dashboards.json`, and the 422 code in `apps/web/src/i18n/{en,ar}/problems.json`. `problems-slices-hijk.test.ts` reads the ADR-0037 amendment row of `dashboard.currency_not_applicable`, so that web test fails until FE-R6 adds both texts.
- **Where.** The API sends every row; KBE-R7 builds them in `reporting/dashboards/areas.ts`, `engine.ts` and `drilldown.ts`, and FE-R6 renders them.

| # | Code or key | Kind | Owning ADR | Decision | English text (exact) | Arabic (proposed, provisional) |
|---|---|---|---|---|---|---|
| 236 | `dashboard.headline.value_gap_top_line` | label key | ADR-0037 N4 item 1 | **new** | Value gap (top line; not in profit and cash) | فجوة القيمة (الخط الأعلى؛ لا تدخل في الربح والنقد) |
| 237 | `dashboard.headline.value_gap_non_cash` | label key | ADR-0037 N4 item 1 | **new** | Value gap (non-cash; not in profit and cash) | فجوة القيمة (غير نقدية؛ لا تدخل في الربح والنقد) |
| 238 | `dashboard.value.gap_ratio_top_line` | rule key | ADR-0037 N4 item 1 | **new** | Value gap (top line) = (planned due to date - validated) / planned due to date, over revenue uplift. | فجوة القيمة (الخط الأعلى) = (المخطط المستحق حتى تاريخه - المعتمد) / المخطط المستحق حتى تاريخه، على زيادة الإيرادات. |
| 239 | `dashboard.value.gap_ratio_non_cash` | rule key | ADR-0037 N4 item 1 | **new** | Value gap (non-cash) = (planned due to date - validated) / planned due to date, over avoided cost. | فجوة القيمة (غير نقدية) = (المخطط المستحق حتى تاريخه - المعتمد) / المخطط المستحق حتى تاريخه، على التكلفة المتجنَّبة. |
| 240 | `dashboard.rag.value.validated_gap` (A2 row; row 229) | rule key | ADR-0037 A2, N3, N4 item 1 | **text changed**; key unchanged | Value: the worst of the validated-gap statuses of each basis and currency (profit and cash, top line, non-cash), each the validated value against the value planned to date on that basis; gaps are never added across bases. | القيمة: أسوأ حالات فجوة القيمة المعتمدة لكل أساس وعملة (الربح والنقد، الخط الأعلى، غير نقدية)، وكلٌّ منها القيمة المعتمدة مقابل القيمة المخططة حتى تاريخه على ذلك الأساس؛ ولا تُجمع الفجوات عبر الأسس. |
| 241 | `dashboard.rag.value.no_profit_and_cash_benefit` (row 221) | rule key | ADR-0037 N3, N4 item 1 | **retired** once KBE-R7 lands (no longer sent); the web keeps it until then | (row 221 text) | (existing) |
| 242 | `dashboard.portfolio.no_profit_and_cash_allocation` | reason key | ADR-0037 N4 item 2; ADR-0030 N4 item 2 | **new** | Not applicable: only revenue uplift or avoided cost is allocated to this initiative; its value is shown on the profit-and-cash basis (margin uplift, cash saving and working-capital release). | لا ينطبق: لم يُخصَّص لهذه المبادرة سوى زيادة الإيرادات أو التكلفة المتجنَّبة؛ وتُعرض قيمتها على أساس الربح والنقد (زيادة الهامش والوفر النقدي وتحرير رأس المال العامل). |
| 243 | `dashboard.value.no_benefit_in_class` | reason key | ADR-0037 N4 item 3 | **new** | Not applicable: there is no benefit of this class in this currency. | لا ينطبق: لا توجد منفعة من هذه الفئة بهذه العملة. |
| 244 | `dashboard.currency_not_applicable` (at `/currency`) | 422 refusal | ADR-0037 N4 item 3 | **new** | A currency narrows only a drill-down of benefit values, the value gap or the investment. | لا تُضيّق العملة إلا تفصيل قيم المنافع أو فجوة القيمة أو الاستثمار. |
| 245 | `dashboard.value.multiple_currencies` (row 141) | reason key | ADR-0037 A2, N4 item 3 | **meaning extended** (text unchanged): also sent by a value-state or `value.gap` drill-down without `currency` in a scope of several value currencies | Not applicable: the values are in more than one currency and are never converted. | (existing) |

**Not a code, but labels the web owns (no text sent by the API).**
- **The Portfolio area's value column.** FE-R6 labels it with the item's `valueBasis`, using the ARCH-R5 chip texts. Suggested column text:

  | EN | AR |
  |---|---|
  | Planned value allocated (profit and cash) | القيمة المخططة المخصَّصة (الربح والنقد) |

- **A Value-area benefit item.** It shows its `valueBasis` chip (`profit_and_cash` / `top_line` / `non_cash`, the ARCH-R5 chip texts).
- **A Value RAG tooltip or detail.** It may list `ruleParams.lines` as "<basis chip> <currency>: <gap as %> <status>", one line per entry. The ratio is a fraction: render it × 100 (`formatPercent` with `fraction: true`, the F-DG4-125 rule).

**Row numbers 221, 229 and 141** are the earlier tables' own. I checked them: row 221 is `dashboard.rag.value.no_profit_and_cash_benefit` and row 229 is `dashboard.rag.value.validated_gap` (both ARCH-R5), and row 141 is `dashboard.value.multiple_currencies` (ARCH-R1).
