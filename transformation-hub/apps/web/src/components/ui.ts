/** Shared class recipes (Tailwind, logical properties only so RTL mirrors automatically). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 min-h-10';

export const btn = {
  primary: cx(buttonBase, 'bg-primary text-primary-contrast hover:bg-primary-hover'),
  secondary: cx(buttonBase, 'border border-line-strong bg-surface text-ink hover:bg-surface-muted'),
  danger: cx(buttonBase, 'bg-danger text-white hover:opacity-90'),
  ghost: cx(buttonBase, 'text-primary hover:bg-primary-soft'),
  link: 'font-medium text-primary underline-offset-2 hover:underline',
};

export const input =
  'block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted min-h-10 aria-[invalid=true]:border-danger';

export const card = 'rounded-lg border border-line bg-surface';

export const label = 'block text-sm font-medium text-ink';

export const hint = 'mt-1 text-xs text-muted';
