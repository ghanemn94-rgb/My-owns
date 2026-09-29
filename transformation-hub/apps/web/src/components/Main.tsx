import type { ReactNode } from 'react';
import { cx } from './ui';

/** The page's <main> landmark (target of the skip link). */
export function Main({ children, className, narrow = false }: { children: ReactNode; className?: string; narrow?: boolean }) {
  return (
    <main id="main-content" tabIndex={-1} className={cx('mx-auto w-full px-4 py-6 focus:outline-none', narrow ? 'max-w-4xl' : 'max-w-7xl', className)}>
      {children}
    </main>
  );
}
