// Optimistic-concurrency save for versioned records (ADR-0007 §6, REQ-S16-026): sends only changed fields with
// If-Match; on 409 nothing was written, so the hook loads the latest version and lets the screen offer
// "re-apply my change on the latest version" or "discard".
import { useState } from "react";
import { ApiError, api } from "../api/client.ts";

export interface Versioned {
  readonly id: string;
  readonly version: number;
}

export interface Conflict<R> {
  readonly latest: R | null;
  readonly currentVersion: number | null;
}

export interface SaveResult {
  readonly outcome: "saved" | "unchanged" | "conflict" | "error";
  readonly error?: unknown;
}

export function useVersionedSave<R extends Versioned, V>(options: {
  initial: R;
  url: (record: R) => string;
  method?: "PATCH" | "PUT";
  toValues: (record: R) => V;
  diff: (base: V, values: V) => Record<string, unknown>;
  onSaved: (updated: R) => void | Promise<void>;
}) {
  const [base, setBase] = useState<R>(options.initial);
  const [conflict, setConflict] = useState<Conflict<R> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const save = async (values: V, on: R = base): Promise<SaveResult> =>
    send(options.diff(options.toValues(on), values), on);

  const send = async (body: Record<string, unknown>, on: R): Promise<SaveResult> => {
    if (Object.keys(body).length === 0) return { outcome: "unchanged" };
    setBusy(true);
    setError(null);
    try {
      const updated = await api.send<R>(options.url(on), {
        method: options.method ?? "PATCH",
        body,
        ifMatch: on.version,
      });
      setBase(updated);
      await options.onSaved(updated);
      return { outcome: "saved" };
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) {
        let latest: R | null = null;
        try {
          latest = await api.get<R>(options.url(on));
        } catch {
          latest = null;
        }
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
    /** Re-applies the user's values on top of the latest version (a new If-Match). */
    reapply: async (values: V) => {
      const latest = conflict?.latest;
      if (!latest) return { outcome: "error" } as SaveResult;
      // Only the user's own changes (relative to the version they edited) go on top of the latest version.
      const mine = options.diff(options.toValues(base), values);
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
