// What the assistant says, always inside one labelled container (T-DG6-FE-E; ADR-0059 §1: "rendered under the label
// 'Suggestion from the assistant - not an approved fact', in a visually distinct container, never in a record's own
// field area, and never counted in any total").
//  - Text is rendered as plain text: a React text node inside a pre-wrapped paragraph. No HTML is parsed, no markdown,
//    and no link is made from the content (a URL in an answer stays text). Links come only from citations, which are
//    structured ids the server re-checked (ADR-0059 §9).
//  - Reply kinds other than `answer` render the ADR §8 texts at read time in the user's language, from their codes.
//  - Withheld content (a cited record is no longer readable) shows its notice instead of the text.
//  - Unknown is never shown as zero or as an empty answer (ADR-0059 §11): `no_sources` says nothing matched,
//    `unavailable` names its code.
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Icon } from "../Icon.tsx";
import {
  citationHref,
  REFUSAL_CODES,
  type AssistantCitation,
  type AssistantMessage,
  type AssistantReplyKind,
} from "./api.ts";

/** The one container every assistant output is rendered in, with its visible label (ADR-0059 §1). */
export function AssistantOutput({ children, kind }: { children: ReactNode; kind: "reply" | "suggestion" }) {
  const { t } = useTranslation();
  return (
    <section className="assistant-output" data-assistant-output={kind} aria-label={t("assistant.label")}>
      <p className="assistant-output__label">
        <Icon name="info" /> <span>{t("assistant.label")}</span>
      </p>
      {children}
    </section>
  );
}

/** Plain text, never markup (no raw-HTML property anywhere in the assistant components; tested). */
export function PlainText({ text }: { text: string }) {
  return (
    // dir="auto": a prompt or answer in the other script keeps its own direction (an English question in Arabic RTL).
    <p className="assistant-text" data-plain-text dir="auto">
      {text}
    </p>
  );
}

const flat = (code: string) => code.replace(/\./g, "__");

/** The read-time text of a non-answer reply (ADR-0059 §4 item 5, §8). */
export function replyKindText(
  t: TFunction,
  message: Pick<AssistantMessage, "replyKind" | "refusalCode" | "errorCode">,
): string | null {
  switch (message.replyKind as AssistantReplyKind | null) {
    case "refusal":
      return message.refusalCode && (REFUSAL_CODES as readonly string[]).includes(message.refusalCode)
        ? t(`assistant.reply.refusal.${flat(message.refusalCode)}`)
        : t("assistant.reply.refusalUnknown");
    case "no_sources":
      return t("assistant.reply.noSources");
    case "unavailable":
      return message.errorCode
        ? t("assistant.reply.unavailable", { code: message.errorCode })
        : t("assistant.reply.unavailableNoCode");
    case "interrupted":
      return t("assistant.reply.interrupted");
    default:
      return null;
  }
}

export function Citations({
  citations,
  focusTransformationId,
}: {
  citations: readonly AssistantCitation[];
  focusTransformationId: string | null;
}) {
  const { t } = useTranslation();
  if (citations.length === 0) return null;
  return (
    <div className="assistant-citations">
      <p className="assistant-citations__title small">{t("assistant.citations.title")}</p>
      <ul className="chips" aria-label={t("assistant.citations.title")}>
        {citations.map((c, i) => {
          const href = citationHref(c, focusTransformationId);
          const text =
            c.source === "playbook"
              ? t("assistant.citations.playbook", { blockRef: c.blockRef, version: c.playbookVersion })
              : t(c.readable ? "assistant.citations.record" : "assistant.citations.notReadable", {
                  type: t(`assistant.citations.recordType.${c.recordType}`),
                  version: c.recordVersion,
                });
          const key = c.source === "playbook" ? `p-${c.blockRef}-${i}` : `r-${c.recordId}-${i}`;
          return (
            <li key={key}>
              {href ? (
                <Link className="assistant-chip" to={href} data-citation={c.source}>
                  {text}
                </Link>
              ) : (
                <span
                  className="assistant-chip assistant-chip--static"
                  data-citation={c.source}
                  data-readable={c.source === "record" ? String(c.readable) : undefined}
                  title={t("assistant.citations.noLink")}
                >
                  {c.source === "record" && !c.readable ? <Icon name="lock" /> : null} {text}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One message of a conversation: the user's prompt as typed, or the assistant's reply inside the labelled container. */
export function MessageView({
  message,
  focusTransformationId,
  children,
}: {
  message: AssistantMessage;
  focusTransformationId: string | null;
  /** The reply's suggestions, rendered inside the same labelled container. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  if (message.author === "user")
    return (
      <li className="assistant-message assistant-message--user" data-message-seq={message.seq} data-author="user">
        <p className="assistant-message__author small">{t("assistant.panel.you")}</p>
        {message.content !== null ? <PlainText text={message.content} /> : null}
      </li>
    );
  const kindText = replyKindText(t, message);
  return (
    <li
      className="assistant-message assistant-message--assistant"
      data-message-seq={message.seq}
      data-author="assistant"
      data-reply-kind={message.replyKind ?? ""}
    >
      <AssistantOutput kind="reply">
        <p className="assistant-message__author small">
          {t("assistant.panel.assistant")}
          {message.replyKind ? (
            <span className="badge assistant-kind">{t(`assistant.reply.kind.${message.replyKind}`)}</span>
          ) : null}
        </p>
        {message.contentWithheld ? (
          <p className="banner banner--info" data-withheld>
            <Icon name="lock" /> <span>{t("assistant.reply.withheld")}</span>
          </p>
        ) : message.replyKind === "answer" && message.content !== null ? (
          <PlainText text={message.content} />
        ) : kindText ? (
          <PlainText text={kindText} />
        ) : null}
        <Citations citations={message.citations} focusTransformationId={focusTransformationId} />
        {children}
      </AssistantOutput>
    </li>
  );
}
