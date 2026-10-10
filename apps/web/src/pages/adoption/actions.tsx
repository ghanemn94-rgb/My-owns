// Bodiless versioned actions of the slice F and G screens (T-DG4-FE-E): publish, retire, remove, cancel, submit.
// `run(key, url, version)` sends POST with If-Match in a session guard (S-7: actions are session-bound); the section
// renders `alert` once (one form-level alert per section). A 409 or 422 reloads the data.
import { useState } from "react";
import { ApiError, api } from "../../api/client.ts";
import { useP4Refresh } from "../../api/p4.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { FormAlert } from "../my-work/p4ui.tsx";

export function useActionRunner(tid: string, namespaces: readonly string[] = ["adoptionP4", "sustainP4"]) {
  const refresh = useP4Refresh(tid);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, url: string, version?: number): Promise<boolean> => {
    setError(null);
    const action = beginSessionGuard();
    setBusy(key);
    try {
      await api.send(url, { method: "POST", ...(version === undefined ? {} : { ifMatch: version }) });
      if (action.stale()) return false;
      await refresh();
      return true;
    } catch (e) {
      if (action.stale(e)) return false;
      setError(e);
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await refresh();
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { run, busy, error, alert: <FormAlert error={error} namespaces={namespaces} /> };
}
