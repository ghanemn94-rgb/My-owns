// The saved-view bar of a list (T-DG6-FE-D; ADR-0057 §4, §10; REQ-S15-010 "saved views", REQ-S15-013): pick a view,
// save the current columns, filters and sort (a new view or the active one), rename, set or clear the default, delete,
// and share or stop sharing for holders of `saved_view.share`. The auditor (no `saved_view.manage`) sees and applies
// views only. What it OFFERS follows the GET /me hints; the server re-checks ownership and the share right at commit.
// One form-level alert (rule 7); each write is bound to the session its click started under (auth/sessionBound.ts).
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { errorMessage } from "../../lib/problem.ts";
import { Icon } from "../Icon.tsx";
import {
  createSavedView,
  deleteSavedView,
  putSavedView,
  savedViewKeys,
  shareSavedView,
  type SavedView,
} from "./api.ts";
import type { ListView } from "./useListView.ts";
import "./productivity.css";

type Dialog = { kind: "saveAs" } | { kind: "rename"; view: SavedView } | { kind: "delete"; view: SavedView } | null;

export function SavedViewBar({ view, label }: { view: ListView; label: string }) {
  const { t } = useTranslation();
  const me = useMe();
  const queryClient = useQueryClient();
  const selectId = useId();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canManage = canAnywhere(me, "saved_view.manage");
  const canShare = canAnywhere(me, "saved_view.share");
  const { list, active, dirty } = view;
  const mine = list.filter((v) => v.isOwner);
  const shared = list.filter((v) => !v.isOwner);
  const ownActive = active && active.isOwner && canManage ? active : null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: savedViewKeys.all });

  /** Runs one write; a 409 reloads the list so the next attempt starts from the current versions. */
  const run = async (work: () => Promise<SavedView | null>, done: (saved: SavedView | null) => void, msg: string) => {
    const guard = beginSessionGuard();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await work();
      if (guard.stale()) return;
      await refresh();
      if (guard.stale()) return;
      done(saved);
      setNotice(msg);
    } catch (err) {
      if (guard.stale(err)) return;
      setError(err);
      if (err instanceof ApiError && err.status === 409) void refresh();
    } finally {
      if (guard.current()) setBusy(false);
    }
  };

  const onPick = (id: string) => {
    setError(null);
    setNotice(null);
    view.apply(list.find((v) => v.id === id) ?? null);
  };

  return (
    <div className="saved-views" role="group" aria-label={t("productivity.views.groupLabel", { list: label })}>
      <div className="saved-views__row">
        <label htmlFor={selectId}>{t("productivity.views.label")}</label>
        <select
          id={selectId}
          value={active?.id ?? ""}
          onChange={(e) => onPick(e.target.value)}
          data-saved-view-select
          aria-busy={view.views.isPending}
        >
          <option value="">{t("productivity.views.none")}</option>
          {mine.length > 0 ? (
            <optgroup label={t("productivity.views.mine")}>
              {mine.map((v) => (
                <option key={v.id} value={v.id}>
                  {optionLabel(t, v)}
                </option>
              ))}
            </optgroup>
          ) : null}
          {shared.length > 0 ? (
            <optgroup label={t("productivity.views.sharedWithMe")}>
              {shared.map((v) => (
                <option key={v.id} value={v.id}>
                  {t("productivity.views.sharedBy", { name: v.name, owner: v.ownerDisplayName })}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        <span className="saved-views__state" data-view-state={active ? (dirty ? "changed" : "saved") : "unsaved"}>
          {active ? (
            dirty ? (
              <span className="status-chip">
                <Icon name="pencil" /> {t("productivity.views.changed")}
              </span>
            ) : (
              <span className="status-chip">
                <Icon name="check" /> {t("productivity.views.saved")}
              </span>
            )
          ) : (
            <span className="status-chip">{t("productivity.views.unsaved")}</span>
          )}
          {active?.visibility === "shared" ? (
            <span className="status-chip" data-view-shared>
              <Icon name="dot" /> {t("productivity.views.shared")}
            </span>
          ) : null}
          {active?.isDefault ? (
            <span className="status-chip" data-view-default>
              {t("productivity.views.default")}
            </span>
          ) : null}
        </span>
        {canManage ? (
          <span className="saved-views__actions">
            {ownActive && dirty ? (
              <button
                type="button"
                className="button button--secondary button--small"
                disabled={busy}
                data-view-action="save"
                onClick={() =>
                  void run(
                    () =>
                      putSavedView(ownActive, { ...view.body, name: ownActive.name, isDefault: ownActive.isDefault }),
                    (saved) => saved && view.markActive(saved),
                    t("productivity.views.savedNotice", { name: ownActive.name }),
                  )
                }
              >
                <Icon name="check" /> {t("productivity.views.save")}
              </button>
            ) : null}
            <button
              type="button"
              className="button button--secondary button--small"
              disabled={busy}
              data-view-action="save-as"
              onClick={() => setDialog({ kind: "saveAs" })}
            >
              <Icon name="plus" /> {t("productivity.views.saveAs")}
            </button>
            {ownActive ? (
              <>
                <button
                  type="button"
                  className="button button--secondary button--small"
                  disabled={busy}
                  data-view-action="rename"
                  onClick={() => setDialog({ kind: "rename", view: ownActive })}
                >
                  {t("productivity.views.rename")}
                </button>
                <button
                  type="button"
                  className="button button--secondary button--small"
                  disabled={busy}
                  data-view-action="default"
                  aria-pressed={ownActive.isDefault}
                  onClick={() =>
                    void run(
                      () =>
                        putSavedView(ownActive, {
                          ...view.body,
                          name: ownActive.name,
                          isDefault: !ownActive.isDefault,
                        }),
                      (saved) => saved && view.markActive(saved),
                      ownActive.isDefault
                        ? t("productivity.views.defaultCleared", { name: ownActive.name })
                        : t("productivity.views.defaultSet", { name: ownActive.name }),
                    )
                  }
                >
                  {ownActive.isDefault ? t("productivity.views.clearDefault") : t("productivity.views.setDefault")}
                </button>
                {ownActive.visibility === "shared" || canShare ? (
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    disabled={busy}
                    data-view-action="share"
                    aria-pressed={ownActive.visibility === "shared"}
                    onClick={() => {
                      const share = ownActive.visibility !== "shared";
                      void run(
                        () => shareSavedView(ownActive, share),
                        (saved) => saved && view.markActive(saved),
                        share
                          ? t("productivity.views.sharedNotice", { name: ownActive.name })
                          : t("productivity.views.unsharedNotice", { name: ownActive.name }),
                      );
                    }}
                  >
                    <Icon name="dot" />{" "}
                    {ownActive.visibility === "shared"
                      ? t("productivity.views.unshare")
                      : t("productivity.views.share")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button button--secondary button--small"
                  disabled={busy}
                  data-view-action="delete"
                  onClick={() => setDialog({ kind: "delete", view: ownActive })}
                >
                  <Icon name="cross" /> {t("productivity.views.delete")}
                </button>
              </>
            ) : null}
          </span>
        ) : (
          <span className="small muted" data-view-readonly>
            {t("productivity.views.applyOnly")}
          </span>
        )}
      </div>
      {view.ignoredKeys.length > 0 ? (
        <p className="banner banner--info small" role="status" data-view-ignored>
          <Icon name="info" /> {t("productivity.views.ignoredNotice")}
        </p>
      ) : null}
      {view.views.isError ? (
        <p className="small muted" data-view-list-error>
          <Icon name="alert" /> {t("productivity.views.listUnavailable")}
        </p>
      ) : null}
      {error ? (
        <div className="banner banner--error small" role="alert" data-view-error>
          <Icon name="alert" /> {errorMessage(t, error)}
        </div>
      ) : null}
      {notice && !error ? (
        <p className="small" role="status" data-view-notice>
          {notice}
        </p>
      ) : null}
      {dialog?.kind === "saveAs" || dialog?.kind === "rename" ? (
        <NameDialog
          title={dialog.kind === "saveAs" ? t("productivity.views.saveAsTitle") : t("productivity.views.renameTitle")}
          initialName={dialog.kind === "rename" ? dialog.view.name : ""}
          withDefault={dialog.kind === "saveAs"}
          busy={busy}
          onCancel={() => setDialog(null)}
          onSubmit={(name, isDefault) =>
            void run(
              () =>
                dialog.kind === "saveAs"
                  ? createSavedView({
                      listKey: view.listKey,
                      transformationId: view.transformationId,
                      name,
                      body: view.body,
                      isDefault,
                    })
                  : putSavedView(dialog.view, { ...view.body, name, isDefault: dialog.view.isDefault }),
              (saved) => {
                if (saved) view.markActive(saved);
                setDialog(null);
              },
              t("productivity.views.savedNotice", { name }),
            )
          }
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <div className="dialog-inline" role="alertdialog" aria-labelledby={`${selectId}-del`} data-view-delete-confirm>
          <p id={`${selectId}-del`}>{t("productivity.views.deleteConfirm", { name: dialog.view.name })}</p>
          <div className="form__actions">
            <button
              type="button"
              className="button button--danger button--small"
              disabled={busy}
              onClick={() =>
                void run(
                  () => deleteSavedView(dialog.view),
                  () => {
                    view.apply(null);
                    setDialog(null);
                  },
                  t("productivity.views.deletedNotice", { name: dialog.view.name }),
                )
              }
            >
              {t("productivity.views.delete")}
            </button>
            <button type="button" className="button button--secondary button--small" onClick={() => setDialog(null)}>
              {t("common.action.cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function optionLabel(t: TFunction, v: SavedView): string {
  const tags = [
    v.isDefault ? t("productivity.views.default") : null,
    v.visibility === "shared" ? t("productivity.views.shared") : null,
  ].filter(Boolean);
  return tags.length > 0 ? `${v.name} (${tags.join(", ")})` : v.name;
}

function NameDialog({
  title,
  initialName,
  withDefault,
  busy,
  onCancel,
  onSubmit,
}: {
  title: string;
  initialName: string;
  withDefault: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string, isDefault: boolean) => void;
}) {
  const { t } = useTranslation();
  const nameId = useId();
  const titleId = useId();
  const [name, setName] = useState(initialName);
  const [isDefault, setIsDefault] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 120) {
      setInvalid(true);
      return;
    }
    onSubmit(trimmed, isDefault);
  };
  return (
    <form className="dialog-inline form" aria-labelledby={titleId} onSubmit={submit} data-view-name-dialog noValidate>
      <p id={titleId} className="state__title">
        {title}
      </p>
      <div className="field">
        <label htmlFor={nameId}>{t("productivity.views.name")}</label>
        <input
          id={nameId}
          type="text"
          value={name}
          maxLength={120}
          required
          aria-invalid={invalid}
          aria-describedby={invalid ? `${nameId}-err` : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setInvalid(false);
          }}
          autoFocus
        />
        {invalid ? (
          <p id={`${nameId}-err`} className="field__error">
            {t("productivity.views.nameInvalid")}
          </p>
        ) : null}
      </div>
      {withDefault ? (
        <label className="checkbox">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          {t("productivity.views.makeDefault")}
        </label>
      ) : null}
      <div className="form__actions">
        <button type="submit" className="button button--primary button--small" disabled={busy}>
          {t("productivity.views.saveSubmit")}
        </button>
        <button type="button" className="button button--secondary button--small" onClick={onCancel}>
          {t("common.action.cancel")}
        </button>
      </div>
    </form>
  );
}
