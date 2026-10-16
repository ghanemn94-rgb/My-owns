// GET /me/navigation in the shell (T-DG5-FE-G; REQ-S03-007; ADR-0049 §9; p5-work-split §I.5 item 4). The server decides
// which of the fourteen areas the caller may see and omits the others; the authenticated shell shows exactly the areas
// it returns, in nav.ts order. `NAV_AREAS` stays the static fallback (before the answer, or if the read fails), with
// its client-side permission hint, so the shell never shows an empty navigation.
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.ts";
import { SHELL_READ } from "./shell-read.ts";
import { shouldRetry } from "../api/queries.ts";

export interface MeNavigationItem {
  readonly code: string;
  readonly labelKey: string;
  readonly path: string;
  readonly availability: "working" | "planned";
}

export interface MeNavigationArea {
  readonly code: string;
  readonly webId: string;
  readonly labelKey: string;
  readonly path: string;
  readonly items: readonly MeNavigationItem[];
}

export interface MeNavigation {
  readonly areas: readonly MeNavigationArea[];
}

export const meNavigationPath = "/api/v1/me/navigation"; // getMyNavigation
export const meNavigationKey = ["p5", "feg", "me-navigation"] as const;

export function useMyNavigation() {
  return useQuery({
    queryKey: meNavigationKey,
    ...SHELL_READ,
    queryFn: () => api.get<MeNavigation>(meNavigationPath),
    retry: shouldRetry,
  });
}

/** The web area ids the server returned, or null while there is no answer (the shell then uses its fallback). */
export function visibleAreaIds(nav: MeNavigation | undefined): ReadonlySet<string> | null {
  // A body that is not the contract's shape is treated like no answer: the fallback, never an empty navigation.
  return nav && Array.isArray(nav.areas) ? new Set(nav.areas.map((a) => a.webId)) : null;
}
