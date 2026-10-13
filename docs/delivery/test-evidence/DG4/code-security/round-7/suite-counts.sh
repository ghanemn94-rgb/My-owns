#!/usr/bin/env bash
# code-security-reviewer DG4 round 7: passed (✓) / failed (×) / skipped (↓) test lines per named suite in each integration
# run (exactly-once jobs, D-102 parity, approvals / delegation / handovers / Finance, dashboards scope, contract,
# media types, catalogue, migrations). Read-only over this round's logs.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-7
R1=$EV/integration-run1-lang-unset.log; R2=$EV/integration-run2-lang-c-utf8.log
echo "# exactly-once / parity / authorization / dashboards / contract suites: test lines per file in each integration run"
for s in apps/worker/test/integration/supervise-cadence.test.ts apps/worker/test/integration/restart.test.ts kpi-period-open-restart.test.ts a13-job-idempotency.test.ts benefits-queue.test.ts raid-corrective.test.ts corrective-cases.test.ts corrective-rules.test.ts decision-sla-escalation.test.ts blocker-escalation.test.ts escalation-rules.test.ts a09-decision-escalation.test.ts sustainment-scans.test.ts adoption-below-trajectory.test.ts handovers.test.ts approvals.test.ts delegations.test.ts headline-basis.test.ts drilldown.test.ts finance-drilldown-k1.test.ts workspace-header.test.ts value-basis-n4.test.ts kpi-unit-outcomes.test.ts a04-kpi-propagation.test.ts contract.test.ts media-types.test.ts catalogue.test.ts slice-b-denials.test.ts gate-commit-time.test.ts corrections.test.ts migrate.test.ts; do
  c() { grep -a "$s >" "$1" | grep -acE "^\s*$2"; }
  echo "$s run1=$(c $R1 ✓) run2=$(c $R2 ✓) failed=$(( $(c $R1 '(×|✗)') + $(c $R2 '(×|✗)') )) skipped=$(( $(c $R1 ↓) + $(c $R2 ↓) ))"
done
echo "# D-102 parity tests (lines naming 'parity'), passed per run"
echo "parity run1=$(grep -a '✓' $R1 | grep -ci parity) run2=$(grep -a '✓' $R2 | grep -ci parity)"
echo "# totals"
for l in $R1 $R2; do echo "$(basename $l): $(grep -aE '^\s+(Test Files|Tests)\s' $l | tr -s ' ' | tr '\n' ';') $(tail -1 $l)"; done
