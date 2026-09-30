import type { RouteResponse, portfolioRoutes } from '@hub/contracts';
import type { Locale } from '@/i18n/config';
import { langAttrs, type LangAttrs } from './i18n-data';

export type Workstream = RouteResponse<typeof portfolioRoutes.listWorkstreams>['items'][number];

/** Arabic name when the template provides one, otherwise the default name. */
export function workstreamName(w: Pick<Workstream, 'name' | 'nameAr'>, locale: Locale): string {
  return locale === 'ar' && w.nameAr ? w.nameAr : w.name;
}

/** `lang`/`dir` of {@link workstreamName}: an English fallback in the Arabic UI is marked `lang="en"` (WCAG 3.1.2). */
export function workstreamNameLang(w: Pick<Workstream, 'name' | 'nameAr'>, locale: Locale): LangAttrs {
  return langAttrs(locale, workstreamName(w, locale), !(locale === 'ar' && w.nameAr));
}

/** The function holding "A" (accountable) in the template RACI, if any. */
export function accountableFunction(w: Pick<Workstream, 'raci'>): string | null {
  return w.raci.find((r) => r.raci === 'A')?.function ?? null;
}
