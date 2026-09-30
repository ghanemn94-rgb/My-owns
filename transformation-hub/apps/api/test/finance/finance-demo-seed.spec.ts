import { afterAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner, projectIdByCode, DC } from '../helpers';
import { DEMO_BENEFIT, DEMO_BUSINESS_PLAN, DEMO_TSA_LINE, DEMO_VALUATION_MODEL } from '../../src/modules/finance/finance.seed';

/**
 * The finance demo scenario (seeded through the services by the global setup): clearly labelled synthetic records,
 * flagged is_demo, with NO invented amount, valuation, ownership percentage or approval (CLAUDE.md source boundaries;
 * REQ-SET-005 labelling). The Finance persona sees them; nothing is validated, approved or verified.
 */
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('Finance demo seed — labelled synthetic records, nothing invented or approved [REQ-SET-005, REQ-FIN-006]', () => {
  it('registers the demo models without versions or values, a proposed benefit and the TSA-charge line with zero amounts', async () => {
    const pid = await projectIdByCode(DC);
    const models = (await owner().query(`select name, kind, is_demo, classification from financial_model where project_id = $1 order by name`, [pid])).rows;
    expect(models).toEqual(
      expect.arrayContaining([
        { name: DEMO_VALUATION_MODEL, kind: 'valuation', is_demo: true, classification: 'strictly_confidential' },
        { name: DEMO_BUSINESS_PLAN, kind: 'business_plan', is_demo: true, classification: 'restricted' },
      ]),
    );
    const versions = await owner().query(`select count(*)::int n from financial_model_version where project_id = $1`, [pid]);
    expect(versions.rows[0].n).toBe(0);
    const b = (await owner().query(`select status, is_demo, baseline_value, target_value, value_amount, verified_by from benefit where project_id = $1 and title = $2`, [pid, DEMO_BENEFIT])).rows;
    expect(b).toEqual([{ status: 'proposed', is_demo: true, baseline_value: 'TBD', target_value: 'TBD', value_amount: null, verified_by: null }]);
    const l = (await owner().query(`select category, committed_amount, spent_amount, approved_amount, proposed_amount, is_demo, tsa_service_id is not null as linked from budget_line where project_id = $1 and name = $2`, [pid, DEMO_TSA_LINE])).rows;
    expect(l).toEqual([{ category: 'tsa_charge', committed_amount: '0.0000', spent_amount: '0.0000', approved_amount: null, proposed_amount: null, is_demo: true, linked: true }]);
    const approved = await owner().query(
      `select (select count(*) from financial_snapshot where project_id = $1 and (approval_state = 'approved' or validated_by is not null))::int a,
              (select count(*) from budget_line where project_id = $1 and approved_amount is not null)::int b,
              (select count(*) from benefit where project_id = $1 and status in ('approved', 'realized_verified'))::int c`,
      [pid],
    );
    expect(approved.rows[0]).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('the demo Finance persona sees them through the API; the TSA is counted once in the cost view', async () => {
    const pid = await projectIdByCode(DC);
    const fin = await loginAs('finance');
    const models = (await fin.get(`/api/v1/projects/${pid}/financial-models`).expect(200)).body;
    expect(models.items.map((m: { name: string; isDemo: boolean; latest: unknown[] }) => [m.name, m.isDemo, m.latest.length])).toEqual(
      expect.arrayContaining([
        [DEMO_VALUATION_MODEL, true, 0],
        [DEMO_BUSINESS_PLAN, true, 0],
      ]),
    );
    const costs = (await fin.get(`/api/v1/projects/${pid}/finance/separation-costs`).expect(200)).body;
    const demoTsa = costs.tsa.find((t: { budgetLineCode: string | null }) => t.budgetLineCode !== null);
    expect(demoTsa).toMatchObject({ countedIn: 'budget_line', registerCharge: null });
  });
});
