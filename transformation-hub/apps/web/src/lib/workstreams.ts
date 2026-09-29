import type { RouteResponse, portfolioRoutes } from '@hub/contracts';
import type { Locale } from '@/i18n/config';

export type Workstream = RouteResponse<typeof portfolioRoutes.listWorkstreams>['items'][number];

/** Arabic name when the template provides one, otherwise the default name. */
export function workstreamName(w: Pick<Workstream, 'name' | 'nameAr'>, locale: Locale): string {
  return locale === 'ar' && w.nameAr ? w.nameAr : w.name;
}

/** The function holding "A" (accountable) in the template RACI, if any. */
export function accountableFunction(w: Pick<Workstream, 'raci'>): string | null {
  return w.raci.find((r) => r.raci === 'A')?.function ?? null;
}
