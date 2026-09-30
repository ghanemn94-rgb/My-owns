'use client';

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';

/**
 * A container whose content may scroll (wide tables, the Gantt chart, long preformatted text). When — and only
 * when — the content overflows, the container becomes a named, focusable group so keyboard users can reach it and
 * scroll it with the arrow keys (WCAG 2.1.1 Keyboard; axe rule `scrollable-region-focusable`). Without overflow it
 * adds no tab stop. It is a `group`, not a `region` landmark: the enclosing section usually already is a landmark
 * with the same name, and one landmark per wide table would clutter landmark navigation.
 */
export function ScrollRegion({
  label,
  as = 'div',
  className,
  children,
  ...rest
}: {
  /** Accessible name announced on focus (e.g. the table caption). */
  label: string;
  as?: 'div' | 'pre';
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, 'className' | 'children' | 'role' | 'tabIndex'>) {
  const ref = useRef<HTMLElement | null>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrollable(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    check();
    // Size changes (viewport, fonts) and content changes (rows loaded, page changed) can both create or remove overflow.
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    resize?.observe(el);
    const mutation = new MutationObserver(check);
    mutation.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      resize?.disconnect();
      mutation.disconnect();
    };
  }, []);

  const props = {
    ...rest,
    ref: (node: HTMLElement | null) => {
      ref.current = node;
    },
    className,
    // data-scroll-region: focus ring drawn inside (globals.css) — these regions often sit in cards with overflow hidden.
    ...(scrollable ? { tabIndex: 0, role: 'group', 'aria-label': label, 'data-scroll-region': '' } : {}),
  };
  return as === 'pre' ? <pre {...props}>{children}</pre> : <div {...props}>{children}</div>;
}
