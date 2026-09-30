// Self-test fixture for scripts/check-hardcoded-strings.mjs — NOT application code (outside src/, never compiled or bundled).
// The scanner must report exactly the six violations below and nothing else in this file.
type T = (key: string, values?: Record<string, unknown>) => string;

export function Violations({ t, n }: { t: T; n: number }) {
  return (
    <div title="Hard-coded tooltip">
      <h1>Project overview</h1>
      <p>{'Inline literal'}</p>
      <input placeholder="Search projects" />
      <span>مشروع تجريبي</span>
      <button type="button" aria-label="Close dialog">
        ×
      </button>
    </div>
  );
}

export function Allowed({ t, n }: { t: T; n: number }) {
  return (
    <section aria-label={t('common.demo.tooltip')} title={t('common.demo.badge')}>
      <h2>{t('common.demo.badge')}</h2>
      <span>RAG · CSV — {n}%</span>
      <span>G5</span>
      <span>WS06</span>
      <span>{`${n}`}</span>
      <span>{n} / 12</span>
      <img alt={t('common.demo.tooltip')} src="/x.png" />
    </section>
  );
}
