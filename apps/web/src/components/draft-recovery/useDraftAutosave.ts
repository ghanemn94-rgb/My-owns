// Autosave of a form record editor's body to the server draft (T-DG6-FE-D2; ADR-0057 §6: "autosaves its body with
// createFormDraft then updateFormDraft (If-Match) at most every 10 seconds and on blur"; REQ-S15-010 "unsaved drafts
// are recoverable"; REQ-S02-006).
//  - `schedule(payload)` keeps the latest body; one write happens at most every `intervalMs` (default 10 s) after the
//    previous one (or after the editor opened). `flush()` (on blur, on close) writes the pending body now.
//  - The first write creates the draft (POST, with the record's version as its base); later writes update it with
//    If-Match of the draft's version. Writes never overlap (one chain), so versions stay in order.
//  - A 409 on update (the same user's draft changed in another tab, or it was closed) reloads the draft and writes the
//    latest body once more on its version; a closed draft is replaced by a new one. A create answered 409
//    `form_draft.open_exists` adopts the open draft and updates it. Other failures show the error state; the user's
//    values stay in the form (nothing is lost on the screen).
//  - Every effect belongs to the session generation it began under (F-DG2-530).
// A draft approves nothing and is never counted in a total; the badge says "Draft - not submitted".
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { closeDraft, createDraft, getDraft, updateDraft, type DraftPayload, type FormDraft } from "./api.ts";
import { p5Paths } from "../../api/p5.ts";
import { fetchAllPages } from "../../api/queries.ts";

export const AUTOSAVE_INTERVAL_MS = 10_000;

export type AutosaveState = "idle" | "saving" | "saved" | "error";

export interface DraftRef {
  readonly id: string;
  readonly version: number;
}

export interface DraftAutosave {
  readonly state: AutosaveState;
  /** The server time of the last successful draft write (ISO), or null. */
  readonly savedAt: string | null;
  readonly error: unknown;
  /** The draft being written (null until the first write). */
  readonly draft: DraftRef | null;
  schedule(payload: DraftPayload): void;
  flush(): Promise<void>;
  /** Closes the draft ("saved" after the record write succeeded, or "discarded"). Pending writes are dropped. */
  close(reason: "saved" | "discarded"): Promise<boolean>;
}

export function useDraftAutosave(options: {
  tid: string;
  recordType: string;
  recordId: string | null;
  baseRecordVersion: number | null;
  /** The open draft the editor was opened from (restored), if any. */
  existing: FormDraft | null;
  enabled: boolean;
  intervalMs?: number;
  /** Called after each successful draft write or close (refresh the draft reads). */
  onWritten?: () => void;
}): DraftAutosave {
  const interval = options.intervalMs ?? AUTOSAVE_INTERVAL_MS;
  const [state, setState] = useState<AutosaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(options.existing?.updatedAt ?? null);
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState<DraftRef | null>(
    options.existing ? { id: options.existing.id, version: options.existing.version } : null,
  );
  const draftRef = useRef<DraftRef | null>(draft);
  const pending = useRef<DraftPayload | null>(null);
  const lastWrite = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const closed = useRef(false);
  const opts = useRef(options);
  opts.current = options;

  const adopt = (d: FormDraft) => {
    draftRef.current = { id: d.id, version: d.version };
    setDraft(draftRef.current);
    setSavedAt(d.updatedAt);
  };

  const openDraftOfRecord = async (): Promise<FormDraft | null> => {
    const o = opts.current;
    const items = await fetchAllPages<FormDraft>(p5Paths.formDrafts(o.tid), {
      recordType: o.recordType,
      status: "open",
    });
    return items.find((d) => d.recordId === o.recordId && d.status === "open") ?? null;
  };

  const writeOnce = async (payload: DraftPayload): Promise<FormDraft> => {
    const o = opts.current;
    const current = draftRef.current;
    if (!current) {
      try {
        return await createDraft(o.tid, {
          recordType: o.recordType,
          recordId: o.recordId,
          baseRecordVersion: o.recordId ? o.baseRecordVersion : null,
          payload,
        });
      } catch (e) {
        // One open draft per user and record: adopt it and write on top of it.
        if (e instanceof ApiError && e.status === 409) {
          const open = await openDraftOfRecord();
          if (open) {
            adopt(open);
            return updateDraft(o.tid, open, payload);
          }
        }
        throw e;
      }
    }
    try {
      return await updateDraft(o.tid, current, payload);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) throw e;
      const latest = await getDraft(o.tid, current.id).catch(() => null);
      if (latest && latest.status === "open") {
        adopt(latest);
        return updateDraft(o.tid, latest, payload);
      }
      // The draft was closed elsewhere: this body becomes a new draft.
      draftRef.current = null;
      setDraft(null);
      return writeOnce(payload);
    }
  };

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const run = async () => {
      const payload = pending.current;
      if (!payload || closed.current || !opts.current.enabled) return;
      pending.current = null;
      const guard = beginSessionGuard();
      setState("saving");
      try {
        const saved = await writeOnce(payload);
        if (guard.stale()) return;
        adopt(saved);
        lastWrite.current = Date.now();
        setError(null);
        setState("saved");
        opts.current.onWritten?.();
      } catch (e) {
        if (guard.stale(e)) return;
        // Keep the body so the next change or blur tries again; the form still holds the user's values.
        pending.current ??= payload;
        setError(e);
        setState("error");
      }
    };
    chain.current = chain.current.then(run, run);
    return chain.current;
    // writeOnce reads everything through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const schedule = useCallback(
    (payload: DraftPayload) => {
      if (closed.current || !opts.current.enabled) return;
      pending.current = payload;
      if (timer.current) return;
      const wait = Math.max(0, lastWrite.current + interval - Date.now());
      timer.current = setTimeout(() => {
        timer.current = null;
        void flush();
      }, wait);
    },
    [flush, interval],
  );

  const close = useCallback(async (reason: "saved" | "discarded") => {
    closed.current = true;
    pending.current = null;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    await chain.current.catch(() => undefined);
    const current = draftRef.current;
    if (!current) return true;
    const guard = beginSessionGuard();
    try {
      await closeDraft(opts.current.tid, current, reason);
    } catch (e) {
      if (guard.stale(e)) return false;
      // A stale version: reload once and close that version (a close is idempotent in intent).
      if (e instanceof ApiError && e.status === 409) {
        const latest = await getDraft(opts.current.tid, current.id).catch(() => null);
        if (latest?.status !== "open") return true;
        try {
          await closeDraft(opts.current.tid, latest, reason);
        } catch {
          return false;
        }
      } else return false;
    }
    if (guard.stale()) return false;
    draftRef.current = null;
    setDraft(null);
    opts.current.onWritten?.();
    return true;
  }, []);

  // Leaving the editor (unmount) writes the pending body; the draft stays open for recovery.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      void flush();
    },
    [flush],
  );

  return { state, savedAt, error, draft, schedule, flush, close };
}
