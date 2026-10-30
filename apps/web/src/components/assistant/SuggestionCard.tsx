// One suggestion of an answer (T-DG6-FE-E; ADR-0059 §6). It is rendered inside the reply's labelled container
// (AssistantOutput), never in a record's field area. A charter or decision-brief suggestion offers "Take to draft":
//  1. `takeAssistantSuggestionToDraft` (If-Match = the suggestion) marks it taken and returns a form-draft prefill; it
//     writes nothing outside the assistant's own table;
//  2. the web client then calls the P5 `createFormDraft` with the user's own session, which applies the record type's
//     own validation and permission. The result is a draft, labelled "Draft - not submitted": a person edits, saves
//     and submits it in the normal editor. Nothing is submitted or approved here (REQ-S17-008).
// Advice kinds (recovery action, missing evidence) show their text only. Both requests belong to the session the click
// started under (auth/sessionBound.ts): after each await, a stale action renders nothing.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { apiRequest, ApiError } from "../../api/client.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { errorMessage } from "../../lib/problem.ts";
import { Icon } from "../Icon.tsx";
import { Citations, PlainText } from "./AssistantOutput.tsx";
import {
  assistantKeys,
  assistantPaths,
  draftEditorHref,
  type AssistantSuggestion,
  type AssistantTakeToDraftResult,
  type CreatedFormDraft,
} from "./api.ts";

const TARGET_PERMISSION = { charter: "charter.edit", T16: "executive_decision.create" } as const;

type Outcome =
  | { kind: "created"; target: "charter" | "T16"; transformationId: string }
  | { kind: "takenNoDraft"; target: "charter" | "T16"; transformationId: string; error: unknown };

export function SuggestionCard({
  suggestion,
  focusTransformationId,
}: {
  suggestion: AssistantSuggestion;
  focusTransformationId: string | null;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const target = suggestion.targetRecordType;
  const draftable =
    target !== null && (suggestion.kind === "charter_draft" || suggestion.kind === "decision_brief_draft");
  const mayWriteTarget = target !== null && canAnywhere(me, TARGET_PERMISSION[target]);
  const taken = suggestion.status === "taken_to_draft" || outcome !== null;

  const takeToDraft = async () => {
    if (!target) return;
    const action = beginSessionGuard();
    setBusy(true);
    setError(null);
    let taken: AssistantTakeToDraftResult;
    try {
      taken = (
        await apiRequest<AssistantTakeToDraftResult>(assistantPaths.toDraft(suggestion.id), {
          method: "POST",
          ifMatch: suggestion.version,
        })
      ).data;
    } catch (err) {
      if (action.stale(err)) return;
      setBusy(false);
      setError(err);
      // A stale version or an already-taken suggestion: reload the conversation so the card shows its real state.
      if (err instanceof ApiError && (err.status === 409 || err.code === "assistant.suggestion_already_taken"))
        void queryClient.invalidateQueries({ queryKey: assistantKeys.conversation(suggestion.conversationId) });
      return;
    }
    if (action.stale()) return;
    try {
      await apiRequest<CreatedFormDraft>(assistantPaths.formDrafts(taken.transformationId), {
        method: "POST",
        body: taken.draft,
      });
      if (action.stale()) return;
      setOutcome({ kind: "created", target, transformationId: taken.transformationId });
    } catch (err) {
      if (action.stale(err)) return;
      setOutcome({ kind: "takenNoDraft", target, transformationId: taken.transformationId, error: err });
    }
    setBusy(false);
    void queryClient.invalidateQueries({ queryKey: assistantKeys.conversation(suggestion.conversationId) });
  };

  return (
    <article className="assistant-suggestion" data-suggestion-kind={suggestion.kind} data-status={suggestion.status}>
      <h4 className="assistant-suggestion__title">
        {t("assistant.suggestion.title", { ordinal: suggestion.ordinal })}
        <span className="badge">{t(`assistant.suggestion.kind.${suggestion.kind}`)}</span>
      </h4>
      {suggestion.contentWithheld ? (
        <p className="banner banner--info" data-withheld>
          <Icon name="lock" /> <span>{t("assistant.suggestion.withheld")}</span>
        </p>
      ) : (
        <>
          {suggestion.fields ? (
            <dl className="assistant-fields">
              {Object.entries(suggestion.fields).map(([key, value]) => (
                <div key={key}>
                  <dt>{t(`assistant.suggestion.field.${key}`, { defaultValue: key })}</dt>
                  <dd>
                    <PlainText text={value} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {suggestion.textContent ? <PlainText text={suggestion.textContent} /> : null}
          <Citations
            citations={suggestion.citations}
            focusTransformationId={suggestion.transformationId || focusTransformationId}
          />
        </>
      )}
      {!draftable ? <p className="small muted">{t("assistant.suggestion.adviceNote")}</p> : null}
      {draftable && !suggestion.contentWithheld ? (
        <div className="assistant-suggestion__actions">
          {error ? (
            <p className="banner banner--error" role="alert">
              <Icon name="alert" /> <span>{errorMessage(t, error)}</span>
            </p>
          ) : null}
          {outcome?.kind === "created" ? (
            <div className="banner banner--info" role="status" data-draft-created>
              <span className="lifecycle-chip lifecycle-chip--draft small">{t("dashboards.myWork.draftLabel")}</span>
              <p>{t("assistant.suggestion.draftCreated")}</p>
              <p>
                <Link to={draftEditorHref(outcome.target, outcome.transformationId)}>
                  {t("assistant.suggestion.openEditor")}
                </Link>{" "}
                · <Link to="/my-work">{t("assistant.suggestion.openDrafts")}</Link>
              </p>
            </div>
          ) : null}
          {outcome?.kind === "takenNoDraft" ? (
            <div className="banner banner--warning" role="alert">
              <p>{t("assistant.suggestion.draftCreatedNoDraft")}</p>
              <p>{errorMessage(t, outcome.error)}</p>
              <p>
                <Link to={draftEditorHref(outcome.target, outcome.transformationId)}>
                  {t("assistant.suggestion.openEditor")}
                </Link>
              </p>
            </div>
          ) : null}
          {taken ? (
            outcome === null ? (
              <p className="small" data-taken>
                <Icon name="check" /> {t("assistant.suggestion.taken")}
              </p>
            ) : null
          ) : mayWriteTarget ? (
            <>
              <p className="small muted">{t("assistant.suggestion.draftNote")}</p>
              <button
                type="button"
                className="button button--secondary button--small"
                onClick={() => void takeToDraft()}
                disabled={busy}
              >
                {busy ? t("assistant.suggestion.taking") : t("assistant.suggestion.takeToDraft")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
