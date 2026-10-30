// Inline edit of one cell (T-DG6-FE-D2; ADR-0057 §8 "a cell edit is one PATCH of that record through its existing
// route, with If-Match from the row's ETag, so validation, authorization at commit, audit and the 409 path are the
// single edit's. A 409 shows the conflict state in the row and opens compare (§7)"; REQ-S15-010 "bulk and inline edits
// go through the same validation, authorization and concurrency checks as single edits"; REQ-S16-026).
//  - View: the value and an "Edit" button named "Edit <field> of <record>" (keyboard reachable, visible focus).
//  - Edit: a labelled input; Enter saves, Escape cancels. A required text without visible content is refused in the
//    browser with the shared `hasText` rule (the server's own predicate); nothing is sent.
//  - Save: PATCH { <field>: value } with If-Match of the row's version. Errors (400/403/422) are the cell's one
//    translated alert. 409: nothing was saved; the cell shows "Conflict: not saved" with an icon and "Compare changes",
//    which opens the three-way compare (components/compare/**) on a fresh GET; reapply sends the field with If-Match of
//    the current version only if the user keeps their value; other fields someone else changed are never sent.
// Only offered to holders of the record's write permission (the page decides); the AUD user sees the plain value.
import { hasText } from "@mth/shared/schemas";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../api/client.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { errorMessage, fieldErrorMessage } from "../../lib/problem.ts";
import { CompareChanges } from "../compare/CompareChanges.tsx";
import { Dialog } from "../Form.tsx";
import { Icon } from "../Icon.tsx";
import "../compare/compare.css";

type Mode = "view" | "edit" | "saving" | "conflict";

export interface InlineEditCellProps<R extends { id: string; version: number }> {
  readonly record: R;
  /** The PATCH body key (and the GET field after a 409). */
  readonly field: string;
  readonly value: string;
  readonly fieldLabel: string;
  /** The row's name for screen readers ("INI-0001 Synthetic initiative"). */
  readonly recordLabel: string;
  readonly url: (record: R) => string;
  readonly required?: boolean;
  readonly maxLength?: number;
  /** What the cell shows in view mode (defaults to the value as text). */
  readonly display?: ReactNode;
  /** Called with the saved record (or the latest after a discard): refresh the list. */
  readonly onSaved: (record: R) => unknown;
}

export function InlineEditCell<R extends { id: string; version: number }>(props: InlineEditCellProps<R>) {
  const { t } = useTranslation();
  const id = useId();
  const [mode, setMode] = useState<Mode>("view");
  const [text, setText] = useState(props.value);
  const [error, setError] = useState<{ kind: "problem"; error: unknown } | { kind: "code"; code: string } | null>(null);
  const [latest, setLatest] = useState<R | null>(null);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [comparing, setComparing] = useState(false);
  /** The record the edit started from (B): kept through a 409, so the compare is against what the user saw. */
  const startedFrom = useRef<{ record: R; value: string }>({ record: props.record, value: props.value });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editButton = useRef<HTMLButtonElement | null>(null);
  const focusEdit = useRef(false);

  useEffect(() => {
    if (mode === "edit") inputRef.current?.focus();
    if (mode === "view" && focusEdit.current) {
      focusEdit.current = false;
      editButton.current?.focus();
    }
  }, [mode]);

  const begin = () => {
    startedFrom.current = { record: props.record, value: props.value };
    setText(props.value);
    setError(null);
    setMode("edit");
  };
  const cancel = () => {
    focusEdit.current = true;
    setError(null);
    setMode("view");
  };

  const patch = async (value: string, against: R): Promise<void> => {
    const guard = beginSessionGuard();
    setMode("saving");
    setError(null);
    try {
      const saved = await api.send<R>(props.url(against), {
        method: "PATCH",
        body: { [props.field]: value },
        ifMatch: against.version,
      });
      if (guard.stale()) return;
      focusEdit.current = true;
      setLatest(null);
      setComparing(false);
      setMode("view");
      await props.onSaved(saved);
    } catch (e) {
      if (guard.stale(e)) return;
      if (e instanceof ApiError && e.isConflict) {
        let fresh: R | null = null;
        try {
          fresh = await api.get<R>(props.url(against));
        } catch (ge) {
          if (guard.stale(ge)) return;
        }
        if (guard.stale()) return;
        setLatest(fresh);
        setCurrentVersion(e.currentVersion ?? fresh?.version ?? null);
        setMode("conflict");
        return;
      }
      setError({ kind: "problem", error: e });
      setMode("edit");
    }
  };

  const submit = () => {
    if (text === startedFrom.current.value) return cancel();
    if (props.required && !hasText(text)) {
      setError({ kind: "code", code: text === "" ? "validation.required" : "validation.blank" });
      inputRef.current?.focus();
      return;
    }
    void patch(text, startedFrom.current.record);
  };

  const fieldValue = (r: R | null): unknown =>
    r ? ((r as unknown as Record<string, unknown>)[props.field] ?? null) : null;
  const labelParams = { field: props.fieldLabel, record: props.recordLabel };
  const errorText = error
    ? error.kind === "code"
      ? fieldErrorMessage(t, error.code)
      : errorMessage(t, error.error)
    : null;

  if (mode === "view") {
    return (
      <span className="inline-edit" data-inline-edit={props.field} data-state="view">
        {props.display ?? <span className="text-cell">{props.value}</span>}
        <button
          ref={editButton}
          type="button"
          className="button button--ghost button--small"
          onClick={begin}
          aria-label={t("productivity.inlineEdit.editLabel", labelParams)}
        >
          <Icon name="pencil" /> <span className="visually-hidden">{t("productivity.inlineEdit.edit")}</span>
        </button>
      </span>
    );
  }

  if (mode === "conflict") {
    return (
      <span className="inline-edit" data-inline-edit={props.field} data-state="conflict" data-row-state="conflict">
        <span className="inline-edit__state" role="alert">
          <Icon name="alert" /> {t("productivity.inlineEdit.conflict")}
        </span>
        <button type="button" className="button button--secondary button--small" onClick={() => setComparing(true)}>
          {t("productivity.inlineEdit.compare")}
        </button>
        {comparing ? (
          <Dialog
            title={t("productivity.inlineEdit.compareTitle", { record: props.recordLabel })}
            onClose={() => setComparing(false)}
          >
            <CompareChanges
              fields={[{ key: props.field, label: props.fieldLabel }]}
              base={{ [props.field]: startedFrom.current.value }}
              mine={{ [props.field]: text }}
              current={latest ? { [props.field]: fieldValue(latest) } : null}
              yourVersion={startedFrom.current.record.version}
              currentVersion={currentVersion}
              note={t("productivity.inlineEdit.otherFields", { field: props.fieldLabel })}
              onReapply={(keys) => {
                if (!latest || !keys.includes(props.field)) return;
                startedFrom.current = { record: latest, value: String(fieldValue(latest) ?? "") };
                void patch(text, latest);
              }}
              onDiscard={() => {
                focusEdit.current = true;
                setComparing(false);
                setMode("view");
                if (latest) void props.onSaved(latest);
              }}
            />
          </Dialog>
        ) : null}
      </span>
    );
  }

  return (
    <form
      className="inline-edit__form"
      data-inline-edit={props.field}
      data-state={mode}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
    >
      <label htmlFor={`${id}-input`} className="visually-hidden">
        {t("productivity.inlineEdit.inputLabel", labelParams)}
      </label>
      <input
        ref={inputRef}
        id={`${id}-input`}
        type="text"
        value={text}
        maxLength={props.maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => setText(e.target.value)}
        disabled={mode === "saving"}
      />
      <button type="submit" className="button button--primary button--small" disabled={mode === "saving"}>
        {mode === "saving" ? t("productivity.inlineEdit.saving") : t("productivity.inlineEdit.save")}
      </button>
      <button
        type="button"
        className="button button--secondary button--small"
        onClick={cancel}
        disabled={mode === "saving"}
      >
        {t("productivity.inlineEdit.cancel")}
      </button>
      {errorText ? (
        <p id={`${id}-error`} className="inline-edit__error" role="alert">
          <Icon name="alert" /> {errorText}
        </p>
      ) : null}
    </form>
  );
}
