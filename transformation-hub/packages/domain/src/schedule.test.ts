import { describe, it, expect } from 'vitest';
import { computeSchedule, delayImpact, findCycle, wouldCreateCycle, ScheduleNode, ScheduleEdge } from './schedule';

const fs = (p: string, s: string, lag = 0): ScheduleEdge => ({ predecessorId: p, successorId: s, type: 'FS', lagDays: lag });

// Project starts Sunday 2026-10-04.
const START = '2026-10-04';

describe('critical path engine (FS + lag, working calendar)', () => {
  const nodes: ScheduleNode[] = [
    { id: 'A', label: 'Perimeter definition', durationDays: 5 },
    { id: 'B', label: 'Legal assessment', durationDays: 3 },
    { id: 'C', label: 'Agreements drafting', durationDays: 4 },
    { id: 'M', label: 'G1 milestone', durationDays: 0 },
  ];
  const edges = [fs('A', 'C'), fs('B', 'C'), fs('C', 'M')];

  it('computes early/late dates, float and critical path', () => {
    const r = computeSchedule(nodes, edges, START);
    expect(r.status).toBe('complete');
    // A: Sun 4 Oct .. Thu 8 Oct (5 working days)
    expect(r.nodes['A']).toMatchObject({ earlyStart: '2026-10-04', earlyFinish: '2026-10-08', totalFloatDays: 0, critical: true });
    // B: 3 days, float 2
    expect(r.nodes['B']).toMatchObject({ earlyStart: '2026-10-04', earlyFinish: '2026-10-06', totalFloatDays: 2, critical: false });
    // C starts next working day after A finishes (Sun 11 Oct), 4 days → Wed 14 Oct
    expect(r.nodes['C']).toMatchObject({ earlyStart: '2026-10-11', earlyFinish: '2026-10-14', critical: true });
    expect(r.nodes['M']!.earlyFinish).toBe('2026-10-14');
    expect(r.criticalPath).toEqual(['A', 'C', 'M']);
    expect(r.projectFinish).toBe('2026-10-14');
  });

  it('applies working-day lag', () => {
    const r = computeSchedule(nodes, [fs('A', 'C', 2), fs('B', 'C'), fs('C', 'M')], START);
    expect(r.nodes['C']!.earlyStart).toBe('2026-10-13');
  });

  it('reports Incomplete schedule (no critical path) when a duration is missing', () => {
    const r = computeSchedule([...nodes, { id: 'X', durationDays: null }], edges, START);
    expect(r.status).toBe('incomplete');
    expect(r.criticalPath).toBeNull();
    expect(r.issues.map((i) => i.code)).toContain('missing_duration');
  });

  it('does not silently compute unsupported dependency types', () => {
    const r = computeSchedule(nodes, [...edges, { predecessorId: 'A', successorId: 'B', type: 'SS', lagDays: 0 }], START);
    expect(r.status).toBe('incomplete');
    expect(r.issues[0]!.code).toBe('unsupported_dependency_type');
  });

  it('detects cycles', () => {
    const r = computeSchedule(nodes, [...edges, fs('M', 'A')], START);
    expect(r.status).toBe('invalid');
    expect(findCycle(['A', 'C', 'M'], [...edges, fs('M', 'A')])).not.toBeNull();
    expect(wouldCreateCycle(edges, fs('M', 'A'))).toBe(true);
    expect(wouldCreateCycle(edges, fs('B', 'A'))).toBe(false);
  });

  it('ignores cancelled activities', () => {
    const r = computeSchedule([...nodes.slice(0, 3).map((n) => (n.id === 'A' ? { ...n, cancelled: true } : n)), nodes[3]!], edges, START);
    expect(r.status).toBe('complete');
    expect(r.nodes['A']).toBeUndefined();
  });

  it('respects actual finish dates', () => {
    const withActual = nodes.map((n) => (n.id === 'A' ? { ...n, actualStart: '2026-10-04', actualFinish: '2026-10-12' } : n));
    const r = computeSchedule(withActual, edges, START);
    expect(r.nodes['C']!.earlyStart).toBe('2026-10-13');
  });
});

describe('AT-15 — delay impact of a critical-path predecessor is reproducible and calendar-based', () => {
  const nodes: ScheduleNode[] = [
    { id: 'A', label: 'Perimeter definition', durationDays: 5 },
    { id: 'B', label: 'Legal assessment', durationDays: 3 },
    { id: 'C', label: 'Agreements drafting', durationDays: 4 },
    { id: 'M', label: 'G1 milestone', durationDays: 0 },
  ];
  const edges = [fs('A', 'C'), fs('B', 'C'), fs('C', 'M')];

  it('propagates a 3-working-day delay on A to C and M and the project finish', () => {
    const a = delayImpact(nodes, edges, START, 'A', 3);
    const b = delayImpact(nodes, edges, START, 'A', 3);
    expect(a).toEqual(b); // reproducible
    expect(a.status).toBe('computed');
    expect(a.projectSlipWorkingDays).toBe(3);
    expect(a.baselineFinish).toBe('2026-10-14');
    expect(a.forecastFinish).toBe('2026-10-19'); // Wed 14 + 3 working days skipping Fri/Sat → Mon 19
    expect(a.affected.map((x) => x.id).sort()).toEqual(['A', 'C', 'M']);
    expect(a.assumptions.join(' ')).toMatch(/not probabilities/);
    expect(JSON.stringify(a)).not.toMatch(/probabilit(y|ies)":/);
  });

  it('absorbs a delay within float on a non-critical predecessor', () => {
    const r = delayImpact(nodes, edges, START, 'B', 2);
    expect(r.projectSlipWorkingDays).toBe(0);
    expect(r.affected.map((x) => x.id)).toEqual(['B']);
  });

  it('refuses to compute impact on an incomplete schedule', () => {
    const r = delayImpact([...nodes, { id: 'Z', durationDays: null }], edges, START, 'A', 3);
    expect(r.status).toBe('incomplete');
    expect(r.projectSlipWorkingDays).toBeNull();
  });
});
