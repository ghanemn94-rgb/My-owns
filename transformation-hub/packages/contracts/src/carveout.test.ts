import { describe, expect, it } from 'vitest';
import {
  AgreementStageBody,
  ClassifyPerimeterItemBody,
  CreateAgreementBody,
  CreateConsentBody,
  CreatePerimeterItemBody,
  RecordTransferBody,
  UpdateConsentBody,
  UpdatePerimeterItemBody,
  carveoutRoutes,
} from './carveout';
import { CreateRegulatoryBody, RecordIncorporationBody, UpdateRegulatoryBody, newcoRoutes } from './newco';

const U = '0190a0b0-0000-7000-8000-000000000001';

describe('REQ-PER-001 — perimeter item contract validation', () => {
  it('accepts the §7.1 attributes with typed values and defaults the disposition to Pending', () => {
    const b = CreatePerimeterItemBody.parse({
      type: 'contract',
      name: 'Customer contract (synthetic)',
      siteId: U,
      currentEntityId: U,
      targetEntityId: U,
      legalOwner: 'Parent (synthetic)',
      operator: 'TBD',
      economicBeneficiary: 'TBD',
      plannedEffectiveDate: '2026-12-01',
      economicPlannedEffectiveDate: '2026-11-01',
      transferMechanism: 'Assignment (proposed)',
      agreementId: U,
      referenceValue: { amount: '10.5000', currency: 'SAR', unitScale: 1000 },
      consentRequired: true,
      dependencies: 'x',
      risks: 'y',
    });
    expect(b.disposition).toBe('pending');
  });
  it('rejects unknown types, float/exponent money, non-ISO dates and invalid gate keys', () => {
    expect(() => CreatePerimeterItemBody.parse({ type: 'building', name: 'x' })).toThrow();
    expect(() => CreatePerimeterItemBody.parse({ type: 'asset', name: 'x', referenceValue: { amount: '1e6', currency: 'SAR', unitScale: 1 } })).toThrow();
    expect(() => CreatePerimeterItemBody.parse({ type: 'asset', name: 'x', referenceValue: { amount: '1', currency: 'SAR', unitScale: 10 } })).toThrow();
    expect(() => CreatePerimeterItemBody.parse({ type: 'asset', name: 'x', plannedEffectiveDate: '01/12/2026' })).toThrow();
    expect(() => CreatePerimeterItemBody.parse({ type: 'asset', name: 'x', targetGateKey: 'Gate 1' })).toThrow();
  });
  it('no body can set a status: transfer statuses, disposition via PATCH, stages and consent status are rejected (strict)', () => {
    expect(() => CreatePerimeterItemBody.parse({ type: 'asset', name: 'x', transferStatus: 'transferred_verified' })).toThrow();
    expect(() => UpdatePerimeterItemBody.parse({ expectedVersion: 1, disposition: 'included' })).toThrow();
    expect(() => UpdatePerimeterItemBody.parse({ expectedVersion: 1, transferClass: 'transferable' })).toThrow();
    expect(() => UpdatePerimeterItemBody.parse({ expectedVersion: 1, pendingChangeRequestId: U })).toThrow();
    expect(() => UpdateConsentBody.parse({ expectedVersion: 1, status: 'granted' })).toThrow();
    expect(() => CreateAgreementBody.parse({ kindLabel: 'ATA', title: 'x', stage: 'signed' })).toThrow();
    expect(() => CreateAgreementBody.parse({ kindLabel: 'ATA', title: 'x', kindExpansionConfirmed: true })).toThrow();
    expect(() => UpdateRegulatoryBody.parse({ expectedVersion: 1, applicability: 'applicable' })).toThrow();
    expect(() => CreateRegulatoryBody.parse({ category: 'regulatory', authority: 'CST', title: 'x', status: 'granted' })).toThrow();
  });
  it('commands carry expectedVersion and their mandatory justification', () => {
    expect(() => ClassifyPerimeterItemBody.parse({ expectedVersion: 1, disposition: 'included' })).toThrow();
    expect(ClassifyPerimeterItemBody.parse({ expectedVersion: 1, disposition: 'included', justification: 'why' }).disposition).toBe('included');
    expect(() => RecordTransferBody.parse({ perimeterItemId: U, aspect: 'operational', command: 'plan', expectedVersion: 1 })).toThrow();
    expect(() => RecordTransferBody.parse({ perimeterItemId: U, aspect: 'legal', command: 'verify', expectedVersion: 1 })).toThrow(); // verify is its own route
    expect(() => AgreementStageBody.parse({ command: 'record_signing' })).toThrow();
    expect(() => RecordIncorporationBody.parse({ status: 'incorporated' })).toThrow();
    expect(() => CreateConsentBody.parse({ counterparty: 'x' })).toThrow(); // needs an item or agreement
  });
  it('every route declares a permission key and status changes are commands', () => {
    for (const r of [...Object.values(carveoutRoutes), ...Object.values(newcoRoutes)]) {
      expect(typeof r.access === 'string' && /^(carveout|newco)\./.test(r.access), r.id).toBe(true);
      if (/verify|stage|classify|record-response|transferability|approve|reject|apply-change|incorporation$|status$|record-outcome|assess-applicability|conditions-satisfied/.test(r.path) && r.method === 'POST') {
        expect(r.command, r.id).toBe(true);
      }
    }
  });
});
