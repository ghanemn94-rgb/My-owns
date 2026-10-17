// GET /me/navigation in the shell (T-DG5-FE-G, T-DG5-FE-G2; REQ-S03-007; ADR-0049 §9; p5-work-split §I.5 item 4; D-163
// option (a)). The server decides which of the fourteen areas the caller may see and omits the others; the
// authenticated shell shows exactly the areas it returns, in nav.ts order. There is no client-side fallback: while the
// read is pending the shell shows no area list, and a failed read (or a body that is not the contract's shape) is an
// error state, never "all areas" and never a guess from the client's permission hints.
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
    queryFn: async () => {
      const body = await api.get<MeNavigation>(meNavigationPath);
      // A body that is not the contract's shape is an error, never an empty or a full navigation.
      if (!body || !Array.isArray(body.areas)) throw new Error("navigation.invalid_body");
      return body;
    },
    retry: shouldRetry,
  });
}

/** The web area ids the server returned, or null while there is no answer (pending or failed: no area list). */
export function visibleAreaIds(nav: MeNavigation | undefined): ReadonlySet<string> | null {
  return nav && Array.isArray(nav.areas) ? new Set(nav.areas.map((a) => a.webId)) : null;
}
