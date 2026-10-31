// The optional assistant panel (T-DG6-FE-E; p6-work-split §D.3; ADR-0059 §1, §9). `AssistantLauncher` is the shell's
// slot: it renders NOTHING unless the caller holds assistant.use and the server says the assistant is on for them
// (`assistantEnabled` of listAssistantConversations, T-DG6-BE-X5; off, a pending or a failed read all hide it;
// ADR-0059 §3, §11). AUD holds no assistant.use, so AUD never sees the panel.
//
// The panel is a non-modal region beside the page: the conversation list, a new-conversation form (optionally focused
// on the transformation of the current page), and a conversation with its messages, citations and suggestions. Every
// assistant output is inside the labelled container of AssistantOutput.tsx. Each form has one form-level alert; each
// write belongs to the session its click started under (auth/sessionBound.ts).
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { hasText } from "@mth/shared/schemas";
import { apiRequest, ApiError } from "../../api/client.ts";
import { useMe } from "../../auth/session.tsx";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { useLocale } from "../../app/locale.ts";
import { formatDateTime } from "../../lib/format.ts";
import { errorMessage } from "../../lib/problem.ts";
import { Field } from "../Form.tsx";
import { Icon } from "../Icon.tsx";
import { EmptyState, ErrorState, LoadingState } from "../States.tsx";
import "./assistant.css";
import { MessageView } from "./AssistantOutput.tsx";
import { SuggestionCard } from "./SuggestionCard.tsx";
import {
  assistantKeys,
  assistantPaths,
  isAssistantDisabledError,
  useAssistantAvailability,
  useAssistantConversation,
  useAssistantConversations,
  type AssistantConversation,
  type AssistantMessagePostResult,
} from "./api.ts";

const UUID_IN_PATH = /^\/transformations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** The transformation of the current page, if any: the optional focus of a new conversation. */
export function focusFromPath(pathname: string): string | null {
  return UUID_IN_PATH.exec(pathname)?.[1] ?? null;
}

/** The shell slot: the launcher button and, when open, the panel. Hidden unless the assistant is on. */
export function AssistantLauncher() {
  const { t } = useTranslation();
  const me = useMe();
  const availability = useAssistantAvailability(me);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const queryClient = useQueryClient();
  const launcher = useRef<HTMLButtonElement>(null);
  if (availability !== "on") return null;
  const close = () => {
    setOpen(false);
    launcher.current?.focus();
    // The panel may have learned that the assistant was turned off: read the availability again (its key is under the
    // setting's) so the slot follows it.
    void queryClient.invalidateQueries({ queryKey: assistantKeys.setting });
  };
  return (
    <>
      <button
        ref={launcher}
        type="button"
        className="button button--ghost-inverse button--small assistant-launcher"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={t("assistant.panel.openHint")}
        onClick={() => (open ? close() : setOpen(true))}
        data-assistant-launcher
      >
        <Icon name="question" /> <span className="app-header__label">{t("assistant.panel.open")}</span>
      </button>
      {open ? <AssistantPanel id={panelId} onClose={close} /> : null}
    </>
  );
}

export function AssistantPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const focusTid = focusFromPath(location.pathname);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turnedOff, setTurnedOff] = useState(false);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [conversationId]);

  return (
    <aside
      id={id}
      className="assistant-panel"
      aria-labelledby={headingId}
      data-assistant-panel
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="assistant-panel__header">
        <h2 id={headingId} ref={heading} tabIndex={-1} className="assistant-panel__title">
          {t("assistant.panel.title")}
        </h2>
        <button type="button" className="button button--secondary button--small" onClick={onClose}>
          <Icon name="cross" /> <span>{t("assistant.panel.close")}</span>
        </button>
      </div>
      <p className="small muted">{t("assistant.panel.intro")}</p>
      {turnedOff ? (
        <p className="banner banner--info" role="status" data-turned-off>
          <Icon name="info" /> <span>{t("assistant.panel.turnedOff")}</span>
        </p>
      ) : null}
      {conversationId === null ? (
        <>
          <NewConversationForm
            focusTid={focusTid}
            onCreated={(c) => setConversationId(c.id)}
            onTurnedOff={() => setTurnedOff(true)}
          />
          <ConversationList focusTid={null} onOpen={setConversationId} />
        </>
      ) : (
        <ConversationView
          conversationId={conversationId}
          onBack={() => setConversationId(null)}
          onTurnedOff={() => setTurnedOff(true)}
        />
      )}
    </aside>
  );
}

function NewConversationForm({
  focusTid,
  onCreated,
  onTurnedOff,
}: {
  focusTid: string | null;
  onCreated: (c: AssistantConversation) => void;
  onTurnedOff: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [focus, setFocus] = useState(focusTid !== null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!hasText(title)) {
      setFieldError(t(title === "" ? "problems.validation__required" : "problems.validation__blank"));
      return;
    }
    setFieldError(undefined);
    const action = beginSessionGuard();
    setBusy(true);
    try {
      const created = await apiRequest<AssistantConversation>(assistantPaths.conversations, {
        method: "POST",
        body: { title, transformationId: focus && focusTid ? focusTid : null },
      });
      if (action.stale()) return;
      setBusy(false);
      setTitle("");
      void queryClient.invalidateQueries({ queryKey: ["p6", "assistant", "conversations"] });
      onCreated(created.data);
    } catch (err) {
      if (action.stale(err)) return;
      setBusy(false);
      if (isAssistantDisabledError(err)) onTurnedOff();
      setError(err);
    }
  };

  return (
    <form className="assistant-new" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy}>
      <h3 className="assistant-panel__subtitle">{t("assistant.panel.newConversation")}</h3>
      {error ? (
        <p className="banner banner--error" role="alert">
          <Icon name="alert" /> <span>{errorMessage(t, error)}</span>
        </p>
      ) : null}
      <Field label={t("assistant.panel.titleField")} hint={t("assistant.panel.titleHint")} error={fieldError} required>
        {(control) => <input {...control} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      {focusTid ? (
        <div className="field">
          <label className="checkbox">
            <input type="checkbox" checked={focus} onChange={(e) => setFocus(e.target.checked)} />{" "}
            {t("assistant.panel.focusField")}
          </label>
          <p className="field__hint">{focus ? t("assistant.panel.focusHint") : t("assistant.panel.noFocus")}</p>
        </div>
      ) : (
        <p className="field__hint">{t("assistant.panel.noFocus")}</p>
      )}
      <button type="submit" className="button button--primary button--small" disabled={busy}>
        {busy ? t("assistant.panel.starting") : t("assistant.panel.start")}
      </button>
    </form>
  );
}

function ConversationList({ focusTid, onOpen }: { focusTid: string | null; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const q = useAssistantConversations(focusTid);
  return (
    <section className="assistant-list" aria-label={t("assistant.panel.conversations")}>
      <h3 className="assistant-panel__subtitle">{t("assistant.panel.conversations")}</h3>
      {q.isPending ? <LoadingState /> : null}
      {q.isError && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data && q.data.items.length === 0 ? (
        <EmptyState title={t("assistant.panel.noConversations")} body={t("assistant.panel.noConversationsBody")} />
      ) : null}
      {q.data && q.data.items.length > 0 ? (
        <ul className="assistant-list__items">
          {q.data.items.map((c) => (
            <li key={c.id}>
              <button type="button" className="assistant-list__item" onClick={() => onOpen(c.id)}>
                <span className="assistant-list__title" dir="auto">
                  {c.title}
                </span>
                <span className="small muted">
                  {t("assistant.panel.messageCount", { count: c.messageCount })} ·{" "}
                  {t("assistant.panel.updated", { date: formatDateTime(c.updatedAt, locale) })}
                  {c.transformationId ? ` · ${t("assistant.panel.focused")}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ConversationView({
  conversationId,
  onBack,
  onTurnedOff,
}: {
  conversationId: string;
  onBack: () => void;
  onTurnedOff: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const q = useAssistantConversation(conversationId);
  const [content, setContent] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // The send button is disabled while the answer is awaited, which drops the focus; it returns to the question box
  // when the answer (or a refusal of the post) arrives, so the keyboard user stays in the panel (Escape still closes it).
  const box = useRef<HTMLTextAreaElement>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: assistantKeys.conversation(conversationId) }),
      queryClient.invalidateQueries({ queryKey: ["p6", "assistant", "conversations"] }),
    ]);

  if (q.isPending) return <LoadingState />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const detail = q.data!;
  const conversation = detail.conversation;
  const focusTid = conversation.transformationId;
  const full = conversation.messageCount >= 99;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!hasText(content)) {
      setFieldError(t(content === "" ? "problems.validation__required" : "problems.validation__blank"));
      return;
    }
    setFieldError(undefined);
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await apiRequest<AssistantMessagePostResult>(assistantPaths.messages(conversationId), {
        method: "POST",
        body: { content },
        ifMatch: conversation.version,
      });
      if (action.stale()) return;
      setContent("");
      setBusy(false);
      await refresh();
      if (action.current()) box.current?.focus();
    } catch (err) {
      if (action.stale(err)) return;
      setBusy(false);
      if (isAssistantDisabledError(err)) onTurnedOff();
      setError(err);
      // A stale version or a reply still pending: show the conversation as it is now (the typed text is kept).
      if (err instanceof ApiError && (err.status === 409 || err.status === 422)) await refresh();
      if (action.current()) box.current?.focus();
    }
  };

  return (
    <section className="assistant-conversation" aria-label={conversation.title}>
      <div className="assistant-conversation__header">
        <button type="button" className="button button--secondary button--small" onClick={onBack}>
          {t("assistant.panel.back")}
        </button>
        <h3 className="assistant-panel__subtitle" dir="auto">
          {conversation.title}
        </h3>
        <p className="small muted">
          {t("assistant.panel.messageCount", { count: conversation.messageCount })}
          {focusTid ? ` · ${t("assistant.panel.focused")}` : ""}
        </p>
      </div>
      {detail.messages.length === 0 ? <p className="muted">{t("assistant.panel.noMessages")}</p> : null}
      <ol className="assistant-messages" aria-live="polite">
        {detail.messages.map((m) => (
          <MessageView key={m.id} message={m} focusTransformationId={focusTid}>
            {detail.suggestions
              .filter((s) => s.messageId === m.id)
              .sort((a, b) => a.ordinal - b.ordinal)
              .map((s) => (
                <SuggestionCard key={s.id} suggestion={s} focusTransformationId={focusTid} />
              ))}
          </MessageView>
        ))}
      </ol>
      {conversation.awaitingReply || busy ? (
        <p className="state state--loading" role="status" data-awaiting>
          <span className="spinner" aria-hidden="true" /> <span>{t("assistant.panel.sending")}</span>
        </p>
      ) : null}
      {full ? (
        <p className="banner banner--info" role="status">
          {t("assistant.panel.full")}
        </p>
      ) : (
        <form className="assistant-composer" onSubmit={(e) => void send(e)} noValidate aria-busy={busy}>
          {error ? (
            <p className="banner banner--error" role="alert">
              <Icon name="alert" /> <span>{errorMessage(t, error)}</span>
            </p>
          ) : null}
          <Field
            label={t("assistant.panel.messageField")}
            hint={t("assistant.panel.messageHint")}
            error={fieldError}
            required
          >
            {(control) => (
              <textarea
                {...control}
                ref={box}
                rows={3}
                value={content}
                maxLength={4000}
                onChange={(e) => setContent(e.target.value)}
              />
            )}
          </Field>
          <button type="submit" className="button button--primary button--small" disabled={busy}>
            {busy ? t("assistant.panel.sending") : t("assistant.panel.send")}
          </button>
        </form>
      )}
    </section>
  );
}
