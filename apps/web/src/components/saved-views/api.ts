// Saved views of a list (P6 slice H; T-DG6-FE-D; ADR-0057 §4; REQ-S15-010 "saved views", REQ-S15-013 "persist column
// choices in saved views"). The six operations of the contract (docs/api/openapi.yaml, tag `search`):
// listSavedViews, createSavedView, getSavedView (not needed by the bar: the list carries every field), putSavedView,
// deleteSavedView and shareSavedView. Every write carries If-Match (creates an Idempotency-Key); the server re-checks
// ownership and `saved_view.share` at commit time, so the client only decides what it OFFERS.
// A view grants no data: applying it only sets the list's own query parameters (ADR-0057 §4).
import { useQuery } from "@tanstack/react-query";
import type { SavedViewListKey } from "@mth/shared";
import { api, apiRequest, newIdempotencyKey } from "../../api/client.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type SavedViewFilters = Readonly<Record<string, string | readonly string[]>>;
export interface SavedViewSortItem {
  readonly key: string;
  readonly direction: "asc" | "desc";
}

/** `SavedView` of the contract. */
export interface SavedView {
  readonly id: string;
  readonly organizationId: string;
  readonly ownerUserId: string;
  readonly ownerDisplayName: string;
  readonly isOwner: boolean;
  readonly listKey: SavedViewListKey;
  readonly transformationId: string | null;
  readonly name: string;
  readonly visibility: "personal" | "shared";
  readonly columns: readonly string[];
  readonly filters: SavedViewFilters;
  readonly sort: readonly SavedViewSortItem[];
  readonly isDefault: boolean;
  readonly sharedAt: string | null;
  readonly sharedBy: string | null;
  readonly status: "active" | "deleted";
  readonly deletedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The configurable body (SavedViewUpdate without the name and default flag). */
export interface SavedViewBody {
  readonly columns: readonly string[];
  readonly filters: SavedViewFilters;
  readonly sort: readonly SavedViewSortItem[];
}

export const savedViewKeys = {
  all: ["saved-views"] as const,
  list: (listKey: SavedViewListKey, transformationId: string | null) =>
    ["saved-views", listKey, transformationId ?? "any"] as const,
};

/** The caller's views of one list plus the organization's shared views (owner's first, then shared, by name). */
export function useSavedViews(listKey: SavedViewListKey, transformationId: string | null) {
  return useQuery({
    queryKey: savedViewKeys.list(listKey, transformationId),
    queryFn: () =>
      fetchAllPages<SavedView>("/api/v1/saved-views", {
        listKey,
        ...(transformationId ? { transformationId } : {}),
      }),
    retry: shouldRetry,
  });
}

export function createSavedView(input: {
  readonly listKey: SavedViewListKey;
  readonly transformationId: string | null;
  readonly name: string;
  readonly body: SavedViewBody;
  readonly isDefault: boolean;
  readonly idempotencyKey?: string;
}): Promise<SavedView> {
  return api.send<SavedView>("/api/v1/saved-views", {
    method: "POST",
    idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(),
    body: {
      listKey: input.listKey,
      transformationId: input.transformationId,
      name: input.name,
      columns: input.body.columns,
      filters: input.body.filters,
      sort: input.body.sort,
      isDefault: input.isDefault,
    },
  });
}

export function putSavedView(
  view: Pick<SavedView, "id" | "version">,
  next: SavedViewBody & { readonly name: string; readonly isDefault: boolean },
): Promise<SavedView> {
  return api.send<SavedView>(`/api/v1/saved-views/${view.id}`, {
    method: "PUT",
    ifMatch: view.version,
    body: {
      name: next.name,
      columns: next.columns,
      filters: next.filters,
      sort: next.sort,
      isDefault: next.isDefault,
    },
  });
}

export async function deleteSavedView(view: Pick<SavedView, "id" | "version">): Promise<SavedView> {
  return (await apiRequest<SavedView>(`/api/v1/saved-views/${view.id}`, { method: "DELETE", ifMatch: view.version }))
    .data;
}

export function shareSavedView(view: Pick<SavedView, "id" | "version">, shared: boolean): Promise<SavedView> {
  return api.send<SavedView>(`/api/v1/saved-views/${view.id}/share`, {
    method: "POST",
    ifMatch: view.version,
    body: { shared },
  });
}
