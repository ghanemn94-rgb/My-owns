import { describe, expect, it } from 'vitest';
import { CONDITION_STATUSES, DECISION_STATUSES, READINESS_AREAS, READINESS_STATUSES, TASK_STATUSES, TSA_STATUSES } from '../enums';
import { AI_DETECTION_DATE_PARAMS, AI_DETECTION_ENUM_PARAMS, AI_DETECTION_MESSAGES_AR, AI_DETECTION_MESSAGES_EN, AI_STATUS_AR, aiMessage, aiStatusLabel, renderAiMessages, type AiDetectionMessageCode } from './detection-messages';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('AI detection messages (QA-P5-04): codes + parameters, English and the Arabic model context', () => {
  it('every code has an English and an Arabic template with the same placeholders, and the ai. prefix', () => {
    const codes = Object.keys(AI_DETECTION_MESSAGES_EN) as AiDetectionMessageCode[];
    expect(codes.length).toBeGreaterThanOrEqual(20);
    expect(Object.keys(AI_DETECTION_MESSAGES_AR).sort()).toEqual([...codes].sort());
    for (const c of codes) {
      expect(c.startsWith('ai.detection.'), c).toBe(true);
      expect(placeholders(AI_DETECTION_MESSAGES_AR[c]), c).toEqual(placeholders(AI_DETECTION_MESSAGES_EN[c]));
      expect(AI_DETECTION_MESSAGES_AR[c], c).toMatch(/[؀-ۿ]/);
    }
  });

  it('enum and date parameters are placeholders of their code; every enum vocabulary covers its domain enum in Arabic', () => {
    for (const [code, params] of Object.entries(AI_DETECTION_ENUM_PARAMS)) for (const p of Object.keys(params!)) expect(placeholders(AI_DETECTION_MESSAGES_EN[code as AiDetectionMessageCode])).toContain(p);
    for (const [code, params] of Object.entries(AI_DETECTION_DATE_PARAMS)) for (const p of params!) expect(placeholders(AI_DETECTION_MESSAGES_EN[code as AiDetectionMessageCode])).toContain(p);
    const enums: [keyof typeof AI_STATUS_AR, readonly string[]][] = [
      ['taskStatuses', TASK_STATUSES],
      ['decisionStatuses', DECISION_STATUSES],
      ['conditionStatuses', CONDITION_STATUSES],
      ['tsaStatuses', TSA_STATUSES],
      ['readinessStatuses', READINESS_STATUSES],
      ['readinessAreas', READINESS_AREAS],
    ];
    for (const [vocabulary, values] of enums) for (const v of values) expect((AI_STATUS_AR[vocabulary] as Record<string, string>)[v], `${vocabulary}.${v}`).toMatch(/[؀-ۿ]/);
  });

  it('renders English as the template and Arabic with translated statuses — never the raw enum value in an Arabic sentence', () => {
    const msgs = [aiMessage('ai.detection.task_overdue', { code: 'WS03-A04', due: '2026-09-28', status: 'not_started' }), aiMessage('ai.detection.no_owner'), aiMessage('ai.detection.gate_link', { gateKey: 'G2' })];
    expect(renderAiMessages(msgs, 'en')).toBe('Task WS03-A04 is overdue (due 2026-09-28, status not_started). It has no accountable owner. Linked gate: G2.');
    const ar = renderAiMessages(msgs, 'ar');
    expect(ar).toBe('المهمة WS03-A04 متأخرة (الاستحقاق 2026-09-28، الحالة لم يبدأ). ليس لها مالك مسؤول. البوابة المرتبطة: G2.');
    expect(ar).not.toMatch(/not_started|draft|in_progress/);
    expect(renderAiMessages([aiMessage('ai.detection.readiness_blocker', { code: 'RC-01', area: 'cooling', status: 'failed' })], 'ar')).toBe('فحص الجاهزية RC-01 (التبريد) حالته لم يجتز وهو مانع للتشغيل.');
  });

  it('an unknown code is a programming error; an unknown enum value is shown as given; English runs keep the value', () => {
    expect(() => renderAiMessages([{ code: 'ai.detection.nope', params: {} }], 'en')).toThrow(/No en template/);
    expect(aiStatusLabel('ar', 'taskStatuses', 'mystery')).toBe('mystery');
    expect(aiStatusLabel('en', 'taskStatuses', 'blocked')).toBe('blocked');
    expect(aiStatusLabel('ar', 'taskStatuses', 'blocked')).toBe('متعثّر');
  });
});
