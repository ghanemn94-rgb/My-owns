// Investment and benefit lines of one business case (REQ-PB-053, REQ-S05-005; ADR-0024 §2). A line has EXACTLY ONE
// class: the dialog picks the kind first and then one class of that kind from a single select, so two classes can
// never be sent; the value basis is limited to what the class allows (revenue uplift apart from margin, avoided cost
// apart from cash savings, non-cash investment apart from cash). Amounts are decimal strings in the case currency;
// an empty amount is Unknown (never 0) and a strategic/non-financial benefit is never monetised.
import {
  BENEFIT_CLASSES,
  INVESTMENT_CLASSES,
  VALUE_BASIS_BY_CLASS,
  businessCaseLineCreate,
  businessCaseLineUpdate,
  lineClassProblem,
  type BusinessCase,
  type BusinessCaseLine,
  type BusinessCaseLineClass,
  type LineKind,
  type ValueBasis,
} from "@mth/shared/schemas";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { api, ApiError, newIdempotencyKey } from "../../api/client.ts";
import { useP3Refresh } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Amount } from "../../components/Amount.tsx";
import { BLANK_CODE, Dialog, Field, isBlankText, issueCode, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { RecordStatus } from "../../components/P2Badges.tsx";
import { PersonName, usePeople, type Person } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { ArchiveAction } from "../../components/RowActions.tsx";
import { Section } from "../../components/Section.tsx";
import { ConflictPanel, QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { formatBusinessDate } from "../../lib/format.ts";
import { useBenefitFormulas } from "../benefit-formulas/api.ts";
import { caseUrl, useCaseLines } from "./api.ts";
import { caseFieldMessage, FormAlert, Money, splitProblem } from "./formKit.tsx";

const classesOf = (kind: LineKind): readonly BusinessCaseLineClass[] =>
  kind === "investment" ? INVESTMENT_CLASSES : BENEFIT_CLASSES;

/** A strategic or non-financial benefit has no amount (no monetisation without an approved valuation method). */
export function NotMonetised() {
  const { t } = useTranslation();
  return (
    <span className="status-chip status-chip--unknown" data-amount="not-monetised">
      <Icon name="info" /> {t("businessCases.line.notMonetised")}
    </span>
  );
}

export function CaseLines({ bc, editable }: { bc: BusinessCase; editable: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const lines = useCaseLines(ws.tid, bc.id);
  const formulas = useBenefitFormulas(ws.tid);
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP3Refresh(ws.tid);
  const [dialog, setDialog] = useState<{ kind: LineKind; line: BusinessCaseLine | null } | null>(null);
  const formulaCode = (id: string | null) => formulas.data?.find((f) => f.id === id)?.code ?? null;

  const columns = (kind: LineKind): RegisterColumn<BusinessCaseLine>[] => [
    {
      id: "title",
      header: t("businessCases.line.title"),
      cell: (l) => <span className="text-cell">{l.title}</span>,
      sortValue: (l) => l.title,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "class",
      header: t("businessCases.line.class"),
      cell: (l) => <span data-class={l.class}>{t(`businessCases.class.${l.class}`)}</span>,
      sortValue: (l) => t(`businessCases.class.${l.class}`),
    },
    {
      id: "valueBasis",
      header: t("businessCases.line.valueBasis"),
      cell: (l) => t(`businessCases.valueBasis.${l.valueBasis}`),
      sortValue: (l) => t(`businessCases.valueBasis.${l.valueBasis}`),
    },
    {
      id: "amount",
      header: t("businessCases.line.amount"),
      cell: (l) =>
        l.class === "strategic_non_financial" ? <NotMonetised /> : <Money value={l.amount} currency={l.currency} />,
      sortValue: (l) => l.amount,
    },
    ...(kind === "investment"
      ? [
          {
            id: "fte",
            header: t("businessCases.line.fte"),
            cell: (l: BusinessCaseLine) =>
              l.class === "internal_fte" ? (
                <Amount value={l.fte} />
              ) : (
                <span className="muted">{t("businessCases.notApplicable")}</span>
              ),
          },
        ]
      : [
          {
            id: "formula",
            header: t("businessCases.line.formula"),
            cell: (l: BusinessCaseLine) =>
              l.benefitFormulaId ? (
                <Link className="link" to={`/transformations/${ws.tid}/benefit-formulas/${l.benefitFormulaId}`}>
                  <bdi dir="ltr" className="code">
                    {formulaCode(l.benefitFormulaId) ?? t("businessCases.line.formulaLinked")}
                  </bdi>
                </Link>
              ) : (
                <span className="muted">{t("common.value.none")}</span>
              ),
          },
        ]),
    {
      id: "period",
      header: t("businessCases.line.period"),
      cell: (l) =>
        l.periodStart || l.periodEnd ? (
          <span>
            {formatBusinessDate(l.periodStart, locale) ?? t("common.value.unknown")} –{" "}
            {formatBusinessDate(l.periodEnd, locale) ?? t("common.value.unknown")}
          </span>
        ) : (
          <span className="muted">{t("common.value.none")}</span>
        ),
      sortValue: (l) => l.periodStart,
    },
    {
      id: "recurrence",
      header: t("businessCases.line.recurrence"),
      cell: (l) =>
        l.recurrence ? (
          t(`businessCases.recurrence.${l.recurrence}`)
        ) : (
          <span className="muted">{t("common.value.none")}</span>
        ),
    },
    {
      id: "owner",
      header: t("businessCases.line.owner"),
      cell: (l) => <PersonName id={l.ownerUserId} people={byId} />,
    },
    {
      id: "status",
      header: t("common.field.status"),
      cell: (l) => <RecordStatus status={l.status} />,
      sortValue: (l) => l.status,
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (l) =>
        editable && l.status === "active" ? (
          <span className="row-actions">
            <button
              type="button"
              className="button button--link button--small"
              onClick={() => setDialog({ kind: l.lineKind, line: l })}
            >
              <Icon name="pencil" /> {t("common.action.edit")}
              <span className="visually-hidden">: {l.title}</span>
            </button>
            <ArchiveAction
              url={`${caseUrl(bc.id)}/lines/${l.id}`}
              version={l.version}
              name={l.title}
              onDone={refresh}
            />
          </span>
        ) : (
          <span className="muted small">{t("common.readOnly")}</span>
        ),
    },
  ];

  return (
    <>
      {(["investment", "benefit"] as const).map((kind) => (
        <Section
          key={kind}
          id={`lines-${kind}`}
          title={t(`businessCases.lineKind.${kind}Lines`)}
          intro={
            <>
              {t(`businessCases.line.${kind}Intro`)}
              {bc.level === "transformation" ? (
                <span className="block">{t("businessCases.line.rollUpNote")}</span>
              ) : null}
            </>
          }
          actions={
            editable ? (
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => setDialog({ kind, line: null })}
              >
                <Icon name="plus" /> {t(`businessCases.line.add.${kind}`)}
              </button>
            ) : null
          }
        >
          <QueryState query={lines}>
            {(all) => (
              <RegisterTable
                id={`p3-case-lines-${kind}`}
                caption={t(`businessCases.lineKind.${kind}Lines`)}
                rows={all.filter((l) => l.lineKind === kind)}
                columns={columns(kind)}
                getRowId={(l) => l.id}
                emptyTitle={t(`businessCases.line.empty.${kind}`)}
                defaultSort={{ id: "title", dir: "asc" }}
              />
            )}
          </QueryState>
        </Section>
      ))}
      {dialog ? (
        <LineDialog
          bc={bc}
          kind={dialog.kind}
          line={dialog.line}
          people={people}
          formulas={(formulas.data ?? [])
            .filter((f) => f.status === "active")
            .map((f) => ({ id: f.id, label: `${f.code} ${f.benefitName}` }))}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ line dialog

type LineValues = {
  cls: string;
  valueBasis: string;
  title: string;
  description: string;
  amount: string;
  currency: string;
  fte: string;
  periodStart: string;
  periodEnd: string;
  recurrence: string;
  benefitFormulaId: string;
  ownerUserId: string;
};

const UPDATABLE = [
  "title",
  "description",
  "amount",
  "fte",
  "periodStart",
  "periodEnd",
  "recurrence",
  "benefitFormulaId",
  "ownerUserId",
] as const;
const FREE_TEXT = ["title", "description"] as const;

function valuesOf(line: BusinessCaseLine | null, bc: BusinessCase, kind: LineKind): LineValues {
  const cls = line?.class ?? classesOf(kind)[0]!;
  return {
    cls,
    valueBasis: line?.valueBasis ?? VALUE_BASIS_BY_CLASS[cls][0]!,
    title: line?.title ?? "",
    description: line?.description ?? "",
    amount: line?.amount ?? "",
    currency: line?.currency ?? bc.currency,
    fte: line?.fte ?? "",
    periodStart: line?.periodStart ?? "",
    periodEnd: line?.periodEnd ?? "",
    recurrence: line?.recurrence ?? "",
    benefitFormulaId: line?.benefitFormulaId ?? "",
    ownerUserId: line?.ownerUserId ?? "",
  };
}

/** The update body: only changed fields; "" clears a nullable field (null). */
function lineDiff(before: LineValues, now: LineValues): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of UPDATABLE) if (before[f] !== now[f]) body[f] = now[f] === "" && f !== "title" ? null : now[f];
  return body;
}

const POINTER_FIELD: Record<string, keyof LineValues> = {
  "/class": "cls",
  "/lineKind": "cls",
  "/valueBasis": "valueBasis",
  "/title": "title",
  "/description": "description",
  "/amount": "amount",
  "/currency": "currency",
  "/fte": "fte",
  "/periodStart": "periodStart",
  "/periodEnd": "periodEnd",
  "/recurrence": "recurrence",
  "/benefitFormulaId": "benefitFormulaId",
  "/ownerUserId": "ownerUserId",
};

function LineDialog({
  bc,
  kind,
  line,
  people,
  formulas,
  onDone,
  onClose,
}: {
  bc: BusinessCase;
  kind: LineKind;
  line: BusinessCaseLine | null;
  people: readonly Person[];
  formulas: readonly { id: string; label: string }[];
  onDone: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [base, setBase] = useState(line);
  const [values, setValues] = useState<LineValues>(() => valuesOf(line, bc, kind));
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [formCodes, setFormCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<unknown>(null);
  const [conflict, setConflict] = useState<{ latest: BusinessCaseLine | null; currentVersion: number | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(dialogRef);
  /** Stable for this dialog, so a retried create can never add the line twice. */
  const idempotencyKey = useRef(newIdempotencyKey());
  const isEdit = base !== null;
  const cls = values.cls as BusinessCaseLineClass;
  const nonFinancial = cls === "strategic_non_financial";
  const set = (name: keyof LineValues, value: string) => setValues((v) => ({ ...v, [name]: value }));
  const err = (name: keyof LineValues) => (codes[name] ? caseFieldMessage(t, codes[name]) : undefined);

  const chooseClass = (next: string) => {
    const allowed = VALUE_BASIS_BY_CLASS[next as BusinessCaseLineClass];
    setValues((v) => ({
      ...v,
      cls: next,
      valueBasis: allowed.includes(v.valueBasis as ValueBasis) ? v.valueBasis : allowed[0]!,
      ...(next === "strategic_non_financial" ? { amount: "" } : {}),
      ...(next !== "internal_fte" ? { fte: "" } : {}),
    }));
  };

  const send = async (vals: LineValues, against: BusinessCaseLine | null) => {
    setServerError(null);
    const next: Record<string, string> = {};
    const other: string[] = [];
    for (const f of FREE_TEXT) if (isBlankText(vals[f])) next[f] = BLANK_CODE;
    let body: Record<string, unknown>;
    if (against === null) {
      const mismatch = lineClassProblem(kind, vals.cls as BusinessCaseLineClass, vals.valueBasis as ValueBasis);
      if (mismatch) next[mismatch.pointer === "/class" ? "cls" : "valueBasis"] = mismatch.code;
      body = {
        lineKind: kind,
        class: vals.cls,
        valueBasis: vals.valueBasis,
        title: vals.title,
        currency: vals.currency,
      };
      for (const f of [
        "description",
        "amount",
        "fte",
        "periodStart",
        "periodEnd",
        "recurrence",
        "ownerUserId",
      ] as const)
        if (vals[f] !== "") body[f] = vals[f];
      if (kind === "benefit" && vals.benefitFormulaId) body["benefitFormulaId"] = vals.benefitFormulaId;
    } else {
      body = lineDiff(valuesOf(against, bc, kind), vals);
      if (Object.keys(body).length === 0 && Object.keys(next).length === 0) {
        setCodes({});
        setFormCodes(["validation.empty_update"]);
        return;
      }
    }
    const parsed = (against === null ? businessCaseLineCreate : businessCaseLineUpdate).safeParse(body);
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const field = POINTER_FIELD[`/${String(issue.path[0] ?? "")}`];
        if (field) next[field] ??= issueCode(issue);
        else other.push(issueCode(issue));
      }
    setCodes(next);
    setFormCodes(other);
    if (Object.keys(next).length > 0 || other.length > 0) {
      focusInvalid();
      return;
    }
    const action = beginSessionGuard(); // F-DG2-530: every effect below belongs to this session generation
    setBusy(true);
    try {
      if (against === null)
        await api.send(`${caseUrl(bc.id)}/lines`, { method: "POST", body, idempotencyKey: idempotencyKey.current });
      else
        await api.send(`${caseUrl(bc.id)}/lines/${against.id}`, {
          method: "PATCH",
          body,
          ifMatch: against.version,
        });
      if (action.stale()) return;
      if (!(await onDone())) return;
      onClose();
    } catch (e) {
      if (action.stale(e)) return;
      if (e instanceof ApiError && e.isConflict && against !== null) {
        // Nothing was saved: load the current line so the user can compare, re-apply or discard (A14).
        let latest: BusinessCaseLine | null = null;
        try {
          const list = await api.get<{ items: BusinessCaseLine[] }>(`${caseUrl(bc.id)}/lines`, {
            includeArchived: "true",
          });
          latest = list.items.find((l) => l.id === against.id) ?? null;
        } catch (ge) {
          if (action.stale(ge)) return;
        }
        if (action.stale()) return;
        setConflict({ latest, currentVersion: e.currentVersion ?? latest?.version ?? null });
        await onDone();
        return;
      }
      const split = splitProblem(e, (p) => POINTER_FIELD[p] ?? null);
      setCodes(split.fields);
      if (split.formLevel) setServerError(e);
      if (Object.keys(split.fields).length > 0) focusInvalid();
    } finally {
      if (!action.stale()) setBusy(false);
    }
  };

  const conflictRows = (() => {
    if (!conflict?.latest) return [];
    const latestValues = valuesOf(conflict.latest, bc, kind);
    return UPDATABLE.filter((f) => latestValues[f] !== values[f]).map((f) => ({
      field: f,
      label: t(`businessCases.line.${f}`),
      mine: values[f] || t("common.value.none"),
      current: latestValues[f] || t("common.value.none"),
    }));
  })();

  return (
    <Dialog
      title={isEdit ? t("businessCases.line.editTitle", { name: base.title }) : t(`businessCases.line.add.${kind}`)}
      onClose={onClose}
      dialogRef={dialogRef}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void send(values, base)}
            disabled={busy || conflict !== null}
          >
            {busy ? t("common.state.saving") : isEdit ? t("common.action.save") : t("common.action.create")}
          </button>
        </>
      }
    >
      {conflict && base ? (
        <ConflictPanel
          yourVersion={base.version}
          currentVersion={conflict.currentVersion}
          rows={conflictRows}
          busy={busy}
          {...(conflict.latest
            ? {
                onReapply: () => {
                  const latest = conflict.latest!;
                  const mine = lineDiff(valuesOf(base, bc, kind), values);
                  const merged = { ...valuesOf(latest, bc, kind) };
                  for (const f of UPDATABLE) if (f in mine) merged[f] = values[f];
                  setBase(latest);
                  setValues(merged);
                  setConflict(null);
                  void send(merged, latest);
                },
              }
            : {})}
          onDiscard={() => {
            const latest = conflict.latest ?? base;
            setBase(latest);
            setValues(valuesOf(latest, bc, kind));
            setConflict(null);
          }}
        />
      ) : null}
      <FormAlert error={serverError} codes={formCodes} />
      <form
        className="form form--dialog"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void send(values, base);
        }}
      >
        <p className="muted">
          {t("businessCases.line.kindLabel")}: <strong>{t(`businessCases.lineKind.${kind}`)}</strong>
        </p>
        <Field
          label={t("businessCases.line.class")}
          hint={t("businessCases.line.classHint")}
          error={err("cls")}
          required
        >
          {(control) => (
            <select {...control} value={values.cls} disabled={isEdit} onChange={(e) => chooseClass(e.target.value)}>
              {classesOf(kind).map((c) => (
                <option key={c} value={c}>
                  {t(`businessCases.class.${c}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label={t("businessCases.line.valueBasis")}
          hint={t("businessCases.line.valueBasisHint")}
          error={err("valueBasis")}
          required
        >
          {(control) => (
            <select
              {...control}
              value={values.valueBasis}
              disabled={isEdit}
              onChange={(e) => set("valueBasis", e.target.value)}
            >
              {VALUE_BASIS_BY_CLASS[cls].map((b) => (
                <option key={b} value={b}>
                  {t(`businessCases.valueBasis.${b}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("businessCases.line.title")} error={err("title")} required>
          {(control) => (
            <input
              {...control}
              type="text"
              maxLength={300}
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
            />
          )}
        </Field>
        <Field label={t("businessCases.line.description")} error={err("description")}>
          {(control) => (
            <textarea
              {...control}
              rows={2}
              maxLength={4000}
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t("businessCases.line.amountIn", { currency: values.currency })}
          hint={nonFinancial ? t("businessCases.line.amountNonFinancialHint") : t("businessCases.line.amountHint")}
          error={err("amount")}
        >
          {(control) => (
            <input
              {...control}
              type="text"
              inputMode="decimal"
              dir="ltr"
              autoComplete="off"
              disabled={nonFinancial}
              value={values.amount}
              onChange={(e) => set("amount", e.target.value.trim())}
            />
          )}
        </Field>
        {!isEdit ? (
          <Field
            label={t("businessCases.field.currency")}
            hint={t("businessCases.line.currencyHint")}
            error={err("currency")}
            required
          >
            {(control) => (
              <input
                {...control}
                type="text"
                dir="ltr"
                maxLength={3}
                autoComplete="off"
                value={values.currency}
                onChange={(e) => set("currency", e.target.value.toUpperCase())}
              />
            )}
          </Field>
        ) : null}
        {cls === "internal_fte" ? (
          <Field label={t("businessCases.line.fte")} hint={t("businessCases.line.fteHint")} error={err("fte")}>
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="decimal"
                dir="ltr"
                autoComplete="off"
                value={values.fte}
                onChange={(e) => set("fte", e.target.value.trim())}
              />
            )}
          </Field>
        ) : null}
        <div className="grid grid--2">
          <Field label={t("businessCases.line.periodStart")} error={err("periodStart")}>
            {(control) => (
              <input
                {...control}
                type="date"
                value={values.periodStart}
                onChange={(e) => set("periodStart", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("businessCases.line.periodEnd")} error={err("periodEnd")}>
            {(control) => (
              <input
                {...control}
                type="date"
                value={values.periodEnd}
                onChange={(e) => set("periodEnd", e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label={t("businessCases.line.recurrence")} error={err("recurrence")}>
          {(control) => (
            <select {...control} value={values.recurrence} onChange={(e) => set("recurrence", e.target.value)}>
              <option value="">{t("common.value.none")}</option>
              {(["one_off", "recurring"] as const).map((r) => (
                <option key={r} value={r}>
                  {t(`businessCases.recurrence.${r}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        {kind === "benefit" ? (
          <Field
            label={t("businessCases.line.benefitFormulaId")}
            hint={t("businessCases.line.formulaHint")}
            error={err("benefitFormulaId")}
          >
            {(control) => (
              <select
                {...control}
                value={values.benefitFormulaId}
                onChange={(e) => set("benefitFormulaId", e.target.value)}
              >
                <option value="">{t("common.value.none")}</option>
                {formulas.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        <Field label={t("businessCases.line.owner")} error={err("ownerUserId")}>
          {(control) => (
            <select {...control} value={values.ownerUserId} onChange={(e) => set("ownerUserId", e.target.value)}>
              <option value="">{t("common.value.none")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </form>
    </Dialog>
  );
}
