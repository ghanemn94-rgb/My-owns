'use client';

import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import { INTL_LOCALE } from '@/i18n/config';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { btn, card, cx } from '../ui';

export interface GanttRow {
  id: string;
  type: 'task' | 'milestone';
  code: string;
  title: string;
  start: string | null;
  finish: string | null;
  baselineFinish: string | null;
  critical: boolean | null;
  /** Draft (not yet confirmed into the plan). */
  proposed: boolean;
  href: string;
}

const DAY = 86_400_000;
const ROW = 32;
const HEAD = 40;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Timeline (Gantt) in plain SVG — no charting dependency. Business dates are calendar days (UTC arithmetic, no time-zone
 * shift). In Arabic the time axis runs right-to-left (bars and labels are mirrored), matching the reading direction.
 * The chart is decorative for assistive tech beyond its summary: every row is a link in the label column and each bar
 * has a text title; the WBS table is the accessible equivalent.
 */
export function Gantt({ rows, today, caption, testId }: { rows: GanttRow[]; today: string; caption: string; testId?: string }) {
  const { t, dir, locale, formatDate } = useI18n();
  const rtl = dir === 'rtl';
  const titleId = useId();
  const [zoom, setZoom] = useState<'auto' | 'week' | 'month'>('auto');

  const range = useMemo(() => {
    const dates: number[] = [toMs(today)];
    for (const r of rows) for (const d of [r.start, r.finish, r.baselineFinish]) if (d) dates.push(toMs(d));
    const min = Math.min(...dates) - 3 * DAY;
    const max = Math.max(...dates) + 4 * DAY;
    return { min, max, days: Math.max(14, Math.round((max - min) / DAY)) };
  }, [rows, today]);

  const effectiveZoom = zoom === 'auto' ? (range.days > 150 ? 'month' : 'week') : zoom;
  const px = effectiveZoom === 'week' ? 16 : 4;
  const W = range.days * px;
  const H = HEAD + rows.length * ROW;
  const x = (d: string, endOfDay = false) => ((toMs(d) - range.min) / DAY + (endOfDay ? 1 : 0)) * px;
  const mx = (xx: number, w = 0) => (rtl ? W - xx - w : xx);

  const monthFmt = useMemo(() => new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: 'short', year: 'numeric', timeZone: 'UTC' }), [locale]);
  const dayFmt = useMemo(() => new Intl.DateTimeFormat(INTL_LOCALE[locale], { day: 'numeric', month: 'short', timeZone: 'UTC' }), [locale]);

  const ticks = useMemo(() => {
    const out: { x: number; label: string | null; major: boolean }[] = [];
    for (let ms = range.min; ms <= range.max; ms += DAY) {
      const d = new Date(ms);
      const first = d.getUTCDate() === 1;
      const weekStart = d.getUTCDay() === 0; // Sunday: first working day of the Sun–Thu week
      if (effectiveZoom === 'week' && weekStart) out.push({ x: ((ms - range.min) / DAY) * px, label: dayFmt.format(d), major: first });
      else if (first) out.push({ x: ((ms - range.min) / DAY) * px, label: effectiveZoom === 'month' ? monthFmt.format(d) : null, major: true });
    }
    return out;
  }, [range, px, effectiveZoom, dayFmt, monthFmt]);

  const dated = rows.filter((r) => r.finish).length;
  const summary = t('planning.gantt.summary', { count: rows.length, dated, from: formatDate(iso(range.min + 3 * DAY)), to: formatDate(iso(range.max - 4 * DAY)) });

  return (
    <div className={cx(card, 'overflow-hidden')} data-testid={testId} data-dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-sm text-muted">{summary}</p>
        <div className="flex gap-1" role="group" aria-label={t('planning.gantt.zoom')}>
          {(['auto', 'week', 'month'] as const).map((z) => (
            <button key={z} type="button" aria-pressed={zoom === z} className={cx(btn.secondary, 'min-h-8 px-2 py-1 text-xs', zoom === z && 'border-primary bg-primary-soft text-primary')} onClick={() => setZoom(z)}>
              {t(`planning.gantt.zoom_${z}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex">
        {/* Label column (links) — stays put while the chart scrolls horizontally. */}
        <ol className="w-36 shrink-0 border-e border-line sm:w-60" aria-label={caption}>
          <li style={{ blockSize: HEAD }} className="flex items-end border-b border-line px-2 pb-1 text-xs font-semibold text-muted">
            {t('planning.gantt.activity')}
          </li>
          {rows.map((r) => (
            <li key={r.id} style={{ blockSize: ROW }} className="flex items-center border-b border-line/60 px-2">
              <Link href={r.href} className="flex min-w-0 items-baseline gap-1.5 text-xs hover:text-primary" title={`${r.code} ${r.title}`}>
                <span className="shrink-0 font-medium text-primary" dir="ltr">
                  {r.code}
                </span>
                <span className="truncate text-ink" dir="auto">
                  {r.title}
                </span>
              </Link>
            </li>
          ))}
        </ol>
        <div className="min-w-0 flex-1 overflow-x-auto" data-testid="gantt-scroll">
          <svg width={W} height={H} role="img" aria-labelledby={titleId} className="block" style={{ minInlineSize: W }}>
            <title id={titleId}>{`${caption}. ${summary}`}</title>
            <defs>
              <pattern id={`${titleId}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="var(--hub-primary-soft)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--hub-primary)" strokeWidth="2" strokeOpacity="0.5" />
              </pattern>
            </defs>
            {/* grid + header */}
            {ticks.map((tk, i) => (
              <g key={i}>
                <line x1={mx(tk.x)} x2={mx(tk.x)} y1={tk.major ? 0 : HEAD - 10} y2={H} stroke="var(--hub-border)" strokeWidth={tk.major ? 1 : 0.5} />
                {tk.label ? (
                  <text x={mx(tk.x) + (rtl ? -3 : 3)} y={tk.major && effectiveZoom === 'week' ? 14 : HEAD - 14} fontSize="10" fill="var(--hub-text-muted)" textAnchor={rtl ? 'end' : 'start'}>
                    {tk.label}
                  </text>
                ) : null}
              </g>
            ))}
            <line x1={0} x2={W} y1={HEAD} y2={HEAD} stroke="var(--hub-border-strong)" />
            {rows.map((r, i) => {
              const y = HEAD + i * ROW;
              const mid = y + ROW / 2;
              const tip = `${r.code} ${r.title}: ${r.start ? formatDate(r.start) : EM_DASH} – ${r.finish ? formatDate(r.finish) : EM_DASH}${r.critical ? ` · ${t('planning.gantt.critical')}` : ''}${r.proposed ? ` · ${t('planning.gantt.proposed')}` : ''}`;
              const colour = r.critical ? 'var(--hub-danger)' : 'var(--hub-primary)';
              let shape = null;
              if (r.type === 'milestone' && r.finish) {
                const cx0 = mx(x(r.finish, true));
                shape = (
                  <polygon points={`${cx0},${mid - 7} ${cx0 + 7},${mid} ${cx0},${mid + 7} ${cx0 - 7},${mid}`} fill={colour} data-node={r.id}>
                    <title>{tip}</title>
                  </polygon>
                );
              } else if (r.finish) {
                const xs = x(r.start ?? r.finish);
                const xe = x(r.finish, true);
                const w = Math.max(3, xe - xs);
                shape = (
                  <rect
                    x={mx(xs, w)}
                    y={mid - 7}
                    width={w}
                    height={14}
                    rx={3}
                    fill={r.proposed ? `url(#${titleId}-hatch)` : colour}
                    stroke={r.proposed ? 'var(--hub-primary)' : 'none'}
                    strokeDasharray={r.proposed ? '3 2' : undefined}
                    data-node={r.id}
                    data-critical={r.critical ? 'true' : 'false'}
                  >
                    <title>{tip}</title>
                  </rect>
                );
              } else {
                shape = (
                  <text x={rtl ? W - 6 : 6} y={mid + 4} fontSize="11" fill="var(--hub-text-muted)" textAnchor={rtl ? 'end' : 'start'}>
                    {t('planning.gantt.noDates')}
                  </text>
                );
              }
              return (
                <g key={r.id}>
                  <line x1={0} x2={W} y1={y + ROW} y2={y + ROW} stroke="var(--hub-border)" strokeOpacity="0.5" />
                  {shape}
                  {r.baselineFinish ? (
                    <g>
                      <line x1={mx(x(r.baselineFinish, true))} x2={mx(x(r.baselineFinish, true))} y1={y + 4} y2={y + ROW - 4} stroke="var(--hub-neutral)" strokeWidth={2} strokeDasharray="2 2" />
                      <title>{`${t('planning.gantt.baseline')}: ${formatDate(r.baselineFinish)}`}</title>
                    </g>
                  ) : null}
                </g>
              );
            })}
            <line x1={mx(x(today))} x2={mx(x(today))} y1={HEAD - 6} y2={H} stroke="var(--hub-warning)" strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={mx(x(today)) + (rtl ? -3 : 3)} y={HEAD - 2} fontSize="10" fontWeight="600" fill="var(--hub-warning)" textAnchor={rtl ? 'end' : 'start'}>
              {t('planning.gantt.today')}
            </text>
          </svg>
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-xs text-muted" aria-label={t('planning.gantt.legend')}>
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-5 rounded-sm bg-primary" aria-hidden="true" />
          {t('planning.gantt.activityBar')}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-5 rounded-sm bg-danger" aria-hidden="true" />
          {t('planning.gantt.critical')}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-5 rounded-sm border border-dashed border-primary bg-primary-soft" aria-hidden="true" />
          {t('planning.gantt.proposed')}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rotate-45 bg-primary" aria-hidden="true" />
          {t('planning.gantt.milestone')}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-0 border-s-2 border-dashed border-neutral" aria-hidden="true" />
          {t('planning.gantt.baseline')}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-0 border-s-2 border-dashed border-warning" aria-hidden="true" />
          {t('planning.gantt.today')}
        </li>
      </ul>
    </div>
  );
}
