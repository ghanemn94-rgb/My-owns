#!/usr/bin/env bash
# domain-reviewer DG4 round 9: file:line of each re-verified fix in the frozen candidate (clone at f2ae717).
set -u
cd "$TMPDIR/review-r9"; echo "### HEAD $(git rev-parse HEAD)"
g() { echo "--- $1"; shift; grep -nE "$@" | head -6; }
g "F-DG4-120 T11 provisional-Arabic notice" "decision-rights-ar-provisional|lang=\"en\"" apps/web/src/pages/decision-rights/DecisionRightsPage.tsx
g "F-DG4-120 AR notice text" "B0099" apps/web/src/i18n/ar/*.json
g "F-DG4-121 gross on the profit-and-cash basis (API)" "profit_and_cash|revenue_uplift|avoided_cost" apps/api/src/modules/benefits/totals.ts
g "F-DG4-121 gross labels EN" "Gross benefit \(profit and cash\)|not in gross or net" -r apps/web/src/i18n/en
g "F-DG4-122 ratio -> percent formatting" "ratio" apps/web/src/pages/dashboards/ui.tsx
g "F-DG4-123 headline basis (API)" "headlineBasis|top_line|non_cash" apps/api/src/modules/reporting/dashboards/engine.ts
g "F-DG4-124 stages.json DG4 FIXING after round 1" '"FIXING"' docs/delivery/stages.json
g "F-DG4-125 kpiUnit.kind formatting (web)" "kpiUnit" apps/web/src/pages/dashboards/ui.tsx
g "F-DG4-125 kpiUnit on API emitters" "kpiUnit" apps/api/src/modules/reporting/dashboards/areas.ts
g "F-DG4-126 value RAG per basis and currency" "valueRagLines|perBasis|byBasis" apps/api/src/modules/reporting/dashboards/areas.ts apps/api/src/modules/reporting/dashboards/engine.ts
g "F-DG4-127 portfolio value on profit-and-cash, n/a otherwise" "no_profit_and_cash_allocation|value_amount_missing" -r apps/api/src/modules/reporting/dashboards
g "F-DG4-128 bounded supervise cadence" "superviseIntervalSeconds|SUPERVISE_INTERVAL_SECONDS" apps/worker/src/queues/platform.ts apps/worker/src/main.ts packages/config/src/load.ts
g "F-DG4-126 (b) Value RAG lines per basis and currency" "ruleParams.lines|valueLinesOf|basisClasses" apps/api/src/modules/reporting/dashboards/areas.ts
g "F-DG4-127 (b) portfolio n/a reason constant" "NO_PROFIT_AND_CASH_ALLOCATION|value_amount_missing" apps/api/src/modules/reporting/dashboards/engine.ts apps/api/src/modules/reporting/dashboards/areas.ts
g "F-DG4-128 (b) config loader" "WORKER_SUPERVISE_INTERVAL_SECONDS|SUPERVISE_INTERVAL_SECONDS" packages/config/src/load.ts packages/config/src/index.ts apps/worker/src/main.ts
