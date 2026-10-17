// Completing a procedure step whose output is `create` or `link` (T-DG5-FE-D4; D-166; REQ-S06-002, REQ-S06-003,
// REQ-S18-004; ADR-0042 §3; `ProcedureStepComplete`). The person chooses the output record among the eligible records of
// the step's record type in the instance's transformation, read through that record type's OWN list operation
// (outputs.ts). When none exists yet, the form links to the native screen where it is produced (with that module's
// own permissions, rules and audit event). The choice is sent as `outputRecordId`. The server re-checks every rule; a
// refusal is shown by its code in English and Arabic in the page's one form-level alert (useRunner). A completion is
// never a business approval.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ApiError, api } from "../../api/client.ts";
import { p5Paths } from "../../api/p5.ts";
import { fetchAllPages } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { errorMessage } from "../../lib/problem.ts";
import type { Runner } from "../automation/ui.tsx";
import type { ProcedureInstance, ProcedureStepInstance } from "./api.ts";
import {
  OUTPUT_SOURCES,
  completeBody,
  eligibleRecords,
  gateCodeOf,
  scopeTransformationOf,
  type OutputRecordType,
  type OutputRow,
} from "./outputs.ts";

type ChosenType = Exclude<OutputRecordType, "approval">;

/** Reads the records of one output record type through its own list operation (null resource: not listable yet). */
async function loadRecords(recordType: ChosenType, tid: string | null, gateCode: string | null): Promise<OutputRow[]> {
  const source = OUTPUT_SOURCES[recordType];
  if (source.kind === "transformations") return fetchAllPages<OutputRow>("/api/v1/transformations");
  const resource = source.resource(gateCode);
  if (tid === null || resource === null) return [];
  const base = `/api/v1/transformations/${tid}/${resource}`;
  if (source.kind === "charter") {
    try {
      const view = await api.get<{ charter: OutputRow }>(base);
      return [view.charter];
    } catch (e) {
      // No charter yet is an empty choice (the native screen drafts it), never an error.
      if (e instanceof ApiError && e.code === "charter_not_found") return [];
      throw e;
    }
  }
  if (source.kind === "tomCanvas") return (await api.get<{ cells: OutputRow[] }>(base)).cells;
  return fetchAllPages<OutputRow>(base);
}

export function useOutputRecords(recordType: ChosenType, tid: string | null, gateCode: string | null) {
  const listable =
    OUTPUT_SOURCES[recordType].kind === "transformations" ||
    (tid !== null && OUTPUT_SOURCES[recordType].resource(gateCode) !== null);
  return useQuery({
    // Under the P2 key of the transformation, so the native screens' refreshes also refresh this choice.
    queryKey:
      OUTPUT_SOURCES[recordType].kind === "transformations"
        ? (["procedure-output", recordType] as const)
        : (["p2", tid ?? "", "procedure-output", recordType, gateCode ?? ""] as const),
    queryFn: () => loadRecords(recordType, tid, gateCode),
    enabled: listable,
    retry: false,
  });
}

export function CompleteWithOutput({
  instance: i,
  step: s,
  recordType,
  mode,
  runner,
}: {
  instance: ProcedureInstance;
  step: ProcedureStepInstance;
  recordType: ChosenType;
  mode: "create" | "link";
  runner: Runner;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const tid = scopeTransformationOf(i);
  const gateCode = gateCodeOf(i);
  const source = OUTPUT_SOURCES[recordType];
  const records = useOutputRecords(recordType, tid, gateCode);
  const [recordId, setRecordId] = useState("");
  const [note, setNote] = useState("");
  const [invalid, setInvalid] = useState(false);
  const typeLabel = t(`workflowsP5.recordType.${recordType}`);
  const eligible = records.data ? eligibleRecords(records.data, recordType, mode, i) : [];
  const native = source.native(tid, gateCode);
  const notListable = source.kind !== "transformations" && (tid === null || source.resource(gateCode) === null);
  const id = `complete-${s.stepKey}`;
  const chosen = eligible.some((r) => r["id"] === recordId) ? recordId : "";
  return (
    <form
      className="form form--inset"
      noValidate
      data-form={id}
      data-output-record-type={recordType}
      data-output-mode={mode}
      onSubmit={(e) => {
        e.preventDefault();
        const v = note.trim();
        if (v.length > 2000) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        // No client-side block on a missing record: the server is the authority and answers
        // 422 procedure_step.output_required by code (shown in en/ar by the page's alert).
        void runner.run(p5Paths.completeProcedureStep(i.id, s.stepKey), {
          body: completeBody(v, chosen || null),
          ifMatch: i.version,
        });
      }}
    >
      <h3>{t("workflowsP5.procedureOutput.title", { type: typeLabel })}</h3>
      <p className="small muted" data-output-intro={mode}>
        {mode === "create"
          ? t("workflowsP5.procedureOutput.createIntro", { type: typeLabel })
          : t("workflowsP5.procedureOutput.linkIntro", { type: typeLabel })}
      </p>
      <Field
        label={t("workflowsP5.procedureOutput.recordLabel", { type: typeLabel })}
        hint={
          mode === "create" ? t("workflowsP5.procedureOutput.createHint") : t("workflowsP5.procedureOutput.linkHint")
        }
      >
        {(p) => (
          <select
            {...p}
            value={chosen}
            disabled={records.isLoading || eligible.length === 0}
            data-output-select={recordType}
            onChange={(e) => setRecordId(e.target.value)}
          >
            <option value="">
              {records.isLoading ? t("workflowsP5.procedureOutput.loading") : t("workflowsP5.choose")}
            </option>
            {eligible.map((r) => {
              const rid = String(r["id"]);
              const when = source.producedAt(r);
              return (
                <option key={rid} value={rid}>
                  {source.label(r) || rid.slice(0, 8)}
                  {when ? ` — ${formatDateTime(when, locale)}` : ""}
                </option>
              );
            })}
          </select>
        )}
      </Field>
      <div data-output-state={stateOf(records, eligible.length, notListable)}>
        {notListable ? (
          <p className="small" role="note">
            <Icon name="info" />{" "}
            {tid === null
              ? t("workflowsP5.procedureOutput.noTransformation")
              : t("workflowsP5.procedureOutput.gateNotNamed")}
          </p>
        ) : records.isError ? (
          <p className="small" data-problem={records.error instanceof ApiError ? (records.error.code ?? "") : ""}>
            <Icon name="alert" /> {t("workflowsP5.procedureOutput.loadFailed")} {errorMessage(t, records.error)}
          </p>
        ) : records.isSuccess && eligible.length === 0 ? (
          <p className="small" role="note">
            <Icon name="info" /> {t("workflowsP5.procedureOutput.none", { type: typeLabel })}
          </p>
        ) : null}
        <p className="small">
          {native ? (
            <Link className="link" to={native} data-output-native={recordType}>
              {mode === "create"
                ? t("workflowsP5.procedureOutput.produceNative", { type: typeLabel })
                : t("workflowsP5.procedureOutput.openNative", { type: typeLabel })}
            </Link>
          ) : null}{" "}
          {!notListable ? (
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => void records.refetch()}
              disabled={records.isFetching}
            >
              <Icon name="refresh" /> {t("workflowsP5.procedureOutput.reload")}
            </button>
          ) : null}
        </p>
      </div>
      <div className={`field${invalid ? " field--invalid" : ""}`}>
        <label className="field__label" htmlFor={`${id}-text`}>
          {t("workflowsP5.field.note")}
        </label>
        <textarea
          id={`${id}-text`}
          rows={2}
          maxLength={2000}
          value={note}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(e) => setNote(e.target.value)}
        />
        {invalid ? (
          <span id={`${id}-error`} className="field__error">
            {t("workflowsP5.textLength", { min: 1, max: 2000 })}
          </span>
        ) : null}
      </div>
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={runner.busy}>
          {t("workflowsP5.procedures.complete")}
        </button>
      </div>
    </form>
  );
}

function stateOf(
  q: { isLoading: boolean; isError: boolean; isSuccess: boolean },
  count: number,
  notListable: boolean,
): string {
  if (notListable) return "not-listable";
  if (q.isLoading) return "loading";
  if (q.isError) return "error";
  if (q.isSuccess && count === 0) return "empty";
  return "ready";
}
