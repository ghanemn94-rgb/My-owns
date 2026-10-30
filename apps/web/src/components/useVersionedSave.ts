// Optimistic-concurrency save for versioned records (ADR-0007 §6, REQ-S16-026): sends only changed fields with
// If-Match; on 409 nothing was written, so the hook loads the latest version and lets the screen offer
// "re-apply my change on the latest version" or "discard". T-DG6-FE-D2 (ADR-0057 §7): `compareSides` and the `keys`
// of `reapply` give the three-way compare and reapply of components/compare/**.
import { useState } from "react";
import { api, ApiError } from "../api/client.ts";
import { useSessionBoundAction, type SessionBoundAction } from "../auth/sessionBound.ts";

export interface Versioned {
  readonly id: string;
  readonly version: number;
}

export interface Conflict<R> {
  readonly latest: R | null;
  readonly currentVersion: number | null;
}

export interface SaveResult {
  /** "session-changed" (F-DG2-530): the answer belonged to a previous session; nothing was stored or shown. */
  readonly outcome: "saved" | "unchanged" | "conflict" | "error" | "session-changed";
  readonly error?: unknown;
}

export function useVersionedSave<R extends Versioned, V>(options: {
  initial: R;
  url: (record: R) => string;
  method?: "PATCH" | "PUT";
  toValues: (record: R) => V;
  diff: (base: V, values: V) => Record<string, unknown>;
  /**
   * Called once the save succeeded, while its session generation is still current. `action` is the save's
   * session-bound action: write the cache and navigate through it (auth/sessionBound.ts), never with the raw APIs.
   */
  onSaved: (updated: R, action: SessionBoundAction) => void | Promise<void>;
}) {
  const begin = useSessionBoundAction();
  const [base, setBase] = useState<R>(options.initial);
  const [conflict, setConflict] = useState<Conflict<R> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const save = async (values: V, on: R = base): Promise<SaveResult> =>
    send(options.diff(options.toValues(on), values), on);

  const send = async (body: Record<string, unknown>, on: R): Promise<SaveResult> => {
    if (Object.keys(body).length === 0) return { outcome: "unchanged" };
    // F-DG2-530: every effect of this save belongs to the session generation it began under.
    const action = begin();
    setBusy(true);
    setError(null);
    try {
      const updated = await api.send<R>(options.url(on), {
        method: options.method ?? "PATCH",
        body,
        ifMatch: on.version,
      });
      if (action.stale()) return { outcome: "session-changed" };
      setBase(updated);
      await options.onSaved(updated, action);
      if (action.stale()) return { outcome: "session-changed" };
      return { outcome: "saved" };
    } catch (e) {
      if (action.stale(e)) return { outcome: "session-changed" }; // F-DG2-530: silent, the session state was already reset
      if (e instanceof ApiError && e.isConflict) {
        let latest: R | null = null;
        try {
          latest = await api.get<R>(options.url(on));
        } catch (ge) {
          if (action.stale(ge)) return { outcome: "session-changed" };
          latest = null;
        }
        if (action.stale()) return { outcome: "session-changed" };
        setConflict({ latest, currentVersion: e.currentVersion ?? latest?.version ?? null });
        return { outcome: "conflict" };
      }
      setError(e);
      return { outcome: "error", error: e };
    } finally {
      setBusy(false);
    }
  };

  return {
    base,
    conflict,
    error,
    busy,
    save,
    /**
     * T-DG6-FE-D2 (ADR-0057 §7): the three sides of the compare panel (components/compare/CompareChanges.tsx): B the
     * record as loaded, M the user's values, C the latest record from the fresh GET (null when it could not be loaded).
     */
    compareSides: (values: V): { base: V; mine: V; current: V | null } | null =>
      conflict
        ? {
            base: options.toValues(base),
            mine: values,
            current: conflict.latest ? options.toValues(conflict.latest) : null,
          }
        : null,
    /**
     * Re-applies the user's values on top of the latest version (a new If-Match). With `keys` (T-DG6-FE-D2, ADR-0057
     * §7: my changes plus the conflicts resolved "mine"), only those fields are sent; a field only the other user
     * changed is never sent, so their change stays intact.
     */
    reapply: async (values: V, keys?: readonly string[]) => {
      const latest = conflict?.latest;
      if (!latest) return { outcome: "error" } as SaveResult;
      // Only the user's own changes (relative to the version they edited) go on top of the latest version.
      const all = options.diff(options.toValues(base), values);
      const mine = keys ? Object.fromEntries(Object.entries(all).filter(([k]) => keys.includes(k))) : all;
      setConflict(null);
      setBase(latest);
      return send(mine, latest);
    },
    /** Drops the user's change; returns the latest values to reset the form with. */
    discard: (): V => {
      const latest = conflict?.latest ?? base;
      setConflict(null);
      setBase(latest);
      return options.toValues(latest);
    },
  };
}
