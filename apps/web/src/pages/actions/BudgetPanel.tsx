// Budget lines of one initiative (T-DG4-FE-D2; p4-work-split §E.5; ADR-0031 §7, §9, §11; REQ-S09-007 UI half).
// SYNTHETIC data only in tests and demos.
//  - Budget, actual and forecast are decimal strings in the line's own currency (never a JavaScript number; formatted
//    by @mth/shared). An empty amount is Unknown, never 0.
//  - Totals come from getInitiativeExecution, one block per currency, never converted between currencies. A total is a
//    number only when every active line of that currency has the amount; otherwise it is Unknown with its reason, the
//    known part and the count of lines without it. No active line: Unknown "No budget lines", never a total of 0.
//  - Writes (create, edit, archive) need `budget.edit` (TL, FIN). Edits and archives send If-Match with the version of
//    the line the user saw; a stale version answers 409 and nothing is saved (the lines are re-read). Every refusal
//    code (ADR-0031 §11) is translated. The AUD user sees the panel read-only (no write control).
//  - Variances are shown as signed amounts in neutral styling: blue or green never means favourable here.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useP4Refresh } from "../../api/p4.ts";
import { Amount } from "../../components/Amount.tsx";
import { Unknown } from "../../components/Badges.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { ReasonDialog } from "../../components/ReasonDialog.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { api } from "../../api/client.ts";
import { P4FormDialog, textOf, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import {
  BUDGET_AMOUNT_INPUT,
  EXECUTION_NS,
  executionPaths,
  monthToPeriod,
  periodToMonth,
  useBudgetLines,
  useInitiativeExecution,
  type BudgetLine,
  type ExecutionAmount,
  type ExecutionBudgetTotal,
  type InitiativeExecution,
} from "./executionApi.ts";

/** Amounts are numeric(20,4): shown with up to 4 fraction digits so a stored 0.3000 is never rounded away. */
const FRACTION_DIGITS = 4;
const AMOUNT_FIELDS = ["budgetAmount", "actualAmount", "forecastAmount"] as const;
const MONTH_INPUT = /^\d{4}-(0[1-9]|1[0-2])$/;

export function BudgetPanel({ initiativeId }: { initiativeId: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [view, setView] = useState<"active" | "archived">("active");
  const [dialog, setDialog] = useState<"create" | { edit: BudgetLine } | { archive: BudgetLine } | null>(null);
  const lines = useBudgetLines(ws.tid, initiativeId, view);
  const execution = useInitiativeExecution(ws.tid, initiativeId);
  const { byId } = usePeople(ws.tid);
  const canEdit = ws.can("budget.edit");

  const columns: RegisterColumn<BudgetLine>[] = [
    {
      id: "label",
      header: t("executionP4.budget.col.label"),
      cell: (l) => <span data-budget-line={l.label}>{l.label}</span>,
      sortValue: (l) => l.label,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "period",
      header: t("executionP4.budget.col.period"),
      cell: (l) =>
        l.periodMonth === null ? (
          <span className="muted">{t("executionP4.budget.wholeInitiative")}</span>
        ) : (
          <bdi dir="ltr">{periodToMonth(l.periodMonth)}</bdi>
        ),
      sortValue: (l) => l.periodMonth,
    },
    {
      id: "currency",
      header: t("executionP4.budget.col.currency"),
      cell: (l) => (
        <bdi dir="ltr" className="code">
          {l.currency}
        </bdi>
      ),
      sortValue: (l) => l.currency,
    },
    ...(["budget", "actual", "forecast"] as const).map(
      (k): RegisterColumn<BudgetLine> => ({
        id: k,
        header: t(`executionP4.budget.col.${k}`),
        cell: (l) => (
          <span data-amount-of={k}>
            <Amount value={l[`${k}Amount`]} currency={l.currency} maxFractionDigits={FRACTION_DIGITS} />
          </span>
        ),
        sortValue: (l) => (l[`${k}Amount`] === null ? null : Number(l[`${k}Amount`])),
        filterText: (l) => l[`${k}Amount`],
      }),
    ),
    {
      id: "owner",
      header: t("executionP4.budget.col.owner"),
      cell: (l) => <PersonName id={l.ownerUserId} people={byId} />,
      sortValue: (l) => (l.ownerUserId ? (byId.get(l.ownerUserId)?.label ?? l.ownerUserId) : null),
    },
    {
      id: "status",
      header: t("executionP4.budget.col.status"),
      cell: (l) => (
        <span className={`lifecycle-chip lifecycle-chip--${l.status === "archived" ? "archived" : "draft"}`}>
          <Icon name={l.status === "archived" ? "archive" : "dot"} /> {t(`executionP4.budget.status.${l.status}`)}
          {l.archiveReason ? <span className="block small muted">{l.archiveReason}</span> : null}
        </span>
      ),
      sortValue: (l) => l.status,
    },
    ...(canEdit && view === "active"
      ? [
          {
            id: "actions",
            header: t("executionP4.budget.col.actions"),
            hideable: false,
            cell: (l: BudgetLine) => (
              <div
                className="row-actions"
                role="group"
                aria-label={t("executionP4.budget.rowActions", { label: l.label })}
              >
                <button
                  type="button"
                  className="button button--secondary button--small"
                  data-action="edit-budget-line"
                  onClick={() => setDialog({ edit: l })}
                >
                  {t("executionP4.budget.edit")}
                  <span className="visually-hidden"> {l.label}</span>
                </button>{" "}
                <button
                  type="button"
                  className="button button--secondary button--small"
                  data-action="archive-budget-line"
                  onClick={() => setDialog({ archive: l })}
                >
                  {t("executionP4.budget.archive")}
                  <span className="visually-hidden"> {l.label}</span>
                </button>
              </div>
            ),
          } satisfies RegisterColumn<BudgetLine>,
        ]
      : []),
  ];

  return (
    <Section
      id="budget-lines"
      title={t("executionP4.budget.title")}
      intro={t("executionP4.budget.intro")}
      actions={
        canEdit ? (
          <button
            type="button"
            className="button button--primary"
            data-action="add-budget-line"
            onClick={() => setDialog("create")}
          >
            <Icon name="plus" /> {t("executionP4.budget.add")}
          </button>
        ) : null
      }
    >
      {canEdit ? null : (
        <p className="banner banner--info" role="note" data-state="panel-read-only">
          <Icon name="lock" /> {t("executionP4.readOnly")}
        </p>
      )}
      <QueryState query={execution}>{(x) => <BudgetTotals execution={x} />}</QueryState>
      <div className="filters" role="group" aria-label={t("executionP4.budget.view")}>
        <div className="filters__select">
          <label htmlFor={`budget-view-${initiativeId}`}>{t("executionP4.budget.view")}</label>
          <select
            id={`budget-view-${initiativeId}`}
            value={view}
            data-field="budget-view"
            onChange={(e) => setView(e.target.value === "archived" ? "archived" : "active")}
          >
            <option value="active">{t("executionP4.budget.viewActive")}</option>
            <option value="archived">{t("executionP4.budget.viewArchived")}</option>
          </select>
        </div>
      </div>
      <QueryState query={lines}>
        {(rows) => (
          <RegisterTable
            id={`budget-lines-${view}`}
            caption={t("executionP4.budget.tableTitle")}
            rows={rows}
            columns={columns}
            getRowId={(l) => l.id}
            emptyTitle={view === "active" ? t("executionP4.budget.empty") : t("executionP4.budget.emptyArchived")}
            {...(view === "active" ? { emptyBody: t("executionP4.budget.emptyBody") } : {})}
            defaultSort={{ id: "label", dir: "asc" }}
          />
        )}
      </QueryState>
      {dialog === "create" ? (
        <BudgetLineDialog initiativeId={initiativeId} line={null} onClose={() => setDialog(null)} />
      ) : dialog && "edit" in dialog ? (
        <BudgetLineDialog initiativeId={initiativeId} line={dialog.edit} onClose={() => setDialog(null)} />
      ) : dialog && "archive" in dialog ? (
        <ArchiveDialog line={dialog.archive} onClose={() => setDialog(null)} />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ totals

/** The per-currency totals of the execution view (ADR-0031 §7): Unknown with its reason, never 0. */
export function BudgetTotals({ execution: x }: { execution: InitiativeExecution }) {
  const { t } = useTranslation();
  if (x.budgetUnknownReason === "no_budget_lines" || x.budgetTotals.length === 0) {
    return (
      <div className="budget-totals" data-budget-totals="none" data-reason={x.budgetUnknownReason ?? ""}>
        <h3>{t("executionP4.budget.totals.title")}</h3>
        <p>
          <Unknown hint={t("executionP4.budget.totals.noLines")} />{" "}
          <span data-unknown-reason="no_budget_lines">{t("executionP4.budget.totals.noLinesBody")}</span>
        </p>
      </div>
    );
  }
  return (
    <div className="budget-totals" data-budget-totals={x.budgetTotals.length}>
      <h3>{t("executionP4.budget.totals.title")}</h3>
      {x.budgetTotals.map((total) => (
        <CurrencyTotals key={total.currency} total={total} />
      ))}
    </div>
  );
}

const TOTAL_ROWS = ["budget", "actual", "forecast", "forecastVariance", "actualVariance"] as const;

function CurrencyTotals({ total }: { total: ExecutionBudgetTotal }) {
  const { t } = useTranslation();
  const caption = t("executionP4.budget.totals.caption", { currency: total.currency });
  return (
    <div className="table-wrap" role="region" tabIndex={0} aria-label={caption}>
      <table className="table" data-total-currency={total.currency}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t("executionP4.budget.totals.measure")}</th>
            <th scope="col">{t("executionP4.budget.totals.total")}</th>
          </tr>
        </thead>
        <tbody>
          {TOTAL_ROWS.map((k) => (
            <tr key={k} data-total={k} data-status={total[k].status}>
              <th scope="row">{t(`executionP4.budget.totals.${k}`)}</th>
              <td>
                <TotalAmount value={total[k]} currency={total.currency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A known total, or Unknown with the reason, the known part and the count of lines without the amount. */
export function TotalAmount({ value, currency }: { value: ExecutionAmount; currency: string }) {
  const { t } = useTranslation();
  if (value.status === "known" && value.amount !== null)
    return <Amount value={value.amount} currency={currency} maxFractionDigits={FRACTION_DIGITS} />;
  return (
    <span data-unknown-reason={value.reason ?? "unknown"}>
      <Unknown />
      <span className="block small">{t("executionP4.budget.totals.missing", { n: value.missingCount ?? 0 })}</span>
      <span className="block small muted" data-known-part={value.knownAmount ?? ""}>
        {value.knownAmount === null ? (
          t("executionP4.budget.totals.noneKnown")
        ) : (
          <>
            {t("executionP4.budget.totals.known")}{" "}
            <Amount value={value.knownAmount} currency={currency} maxFractionDigits={FRACTION_DIGITS} />
          </>
        )}
      </span>
    </span>
  );
}

// ------------------------------------------------------------------------------------------------ dialogs

function fields(t: (k: string) => string, people: readonly { id: string; label: string }[]): P4FieldSpec[] {
  return [
    { name: "label", label: t("executionP4.budget.field.label"), kind: "text", required: true, max: 200 },
    {
      name: "periodMonth",
      label: t("executionP4.budget.field.periodMonth"),
      kind: "text",
      ltr: true,
      max: 7,
      hint: t("executionP4.budget.field.periodMonthHint"),
    },
    ...AMOUNT_FIELDS.map(
      (name): P4FieldSpec => ({
        name,
        label: t(`executionP4.budget.field.${name}`),
        kind: "text",
        ltr: true,
        max: 21,
        hint: t("executionP4.budget.field.amountHint"),
      }),
    ),
    {
      name: "ownerUserId",
      label: t("executionP4.budget.field.ownerUserId"),
      kind: "select",
      options: people.map((p) => ({ value: p.id, label: p.label })),
    },
    { name: "note", label: t("executionP4.budget.field.note"), kind: "textarea", max: 2000 },
  ];
}

/**
 * The request body of a create (line null) or the PATCH body of an edit: only the members that differ from the line
 * the user saw. An empty amount is sent as null (Unknown). Client-side checks use the ADR-0031 §11 codes, so the
 * inline message is the same translated text as the server's refusal.
 */
export function budgetLineBody(
  v: P4Values,
  line: BudgetLine | null,
): Record<string, unknown> | { fieldErrors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const str = (k: string) => (typeof v[k] === "string" ? (v[k] as string).trim() : "");
  const month = str("periodMonth");
  if (month !== "" && !MONTH_INPUT.test(month)) errors["periodMonth"] = "budget_line.period_invalid";
  for (const k of AMOUNT_FIELDS)
    if (str(k) !== "" && !BUDGET_AMOUNT_INPUT.test(str(k))) errors[k] = "budget_line.amount_invalid";
  if (Object.keys(errors).length > 0) return { fieldErrors: errors };
  const next: Record<string, unknown> = {
    label: v["label"],
    periodMonth: monthToPeriod(month),
    budgetAmount: str("budgetAmount") === "" ? null : str("budgetAmount"),
    actualAmount: str("actualAmount") === "" ? null : str("actualAmount"),
    forecastAmount: str("forecastAmount") === "" ? null : str("forecastAmount"),
    ownerUserId: str("ownerUserId") === "" ? null : str("ownerUserId"),
    note: textOf(v["note"]) ?? null,
  };
  if (line === null) {
    // A create omits what is empty (the API's defaults are null = Unknown).
    return Object.fromEntries(Object.entries(next).filter(([, value]) => value !== null));
  }
  const body: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(next)) if (value !== (line as Record<string, unknown>)[k]) body[k] = value;
  if (Object.keys(body).length === 0) return { fieldErrors: { label: "validation.empty_patch" } };
  return body;
}

function BudgetLineDialog({
  initiativeId,
  line,
  onClose,
}: {
  initiativeId: string;
  line: BudgetLine | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  // The version and values the user saw, pinned: a refetch after a 409 must not move If-Match under typed values.
  const [seen] = useState(line);
  return (
    <P4FormDialog
      title={seen ? t("executionP4.budget.editTitle", { label: seen.label }) : t("executionP4.budget.addTitle")}
      description={
        seen ? (
          <p className="small muted" data-edit-version={seen.version}>
            {t("executionP4.budget.editVersion", { version: seen.version })} ·{" "}
            <bdi dir="ltr" className="code">
              {seen.currency}
            </bdi>
          </p>
        ) : (
          <p>{t("executionP4.budget.addIntro")}</p>
        )
      }
      fields={fields(t, people)}
      initial={
        seen
          ? {
              label: seen.label,
              periodMonth: periodToMonth(seen.periodMonth),
              budgetAmount: seen.budgetAmount ?? "",
              actualAmount: seen.actualAmount ?? "",
              forecastAmount: seen.forecastAmount ?? "",
              ownerUserId: seen.ownerUserId ?? "",
              note: seen.note ?? "",
            }
          : { ownerUserId: ws.meId }
      }
      submitLabel={seen ? t("common.action.save") : t("executionP4.budget.add")}
      {...(seen
        ? { method: "PATCH" as const, url: executionPaths.budgetLine(seen.id), version: seen.version }
        : { url: executionPaths.budgetLines(initiativeId) })}
      namespaces={EXECUTION_NS}
      toBody={(v) => budgetLineBody(v, seen)}
      onDone={() => refresh()}
      onClose={onClose}
    />
  );
}

function ArchiveDialog({ line, onClose }: { line: BudgetLine; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const [seen] = useState(line);
  return (
    <ReasonDialog
      title={t("executionP4.budget.archiveTitle", { label: seen.label })}
      description={t("executionP4.budget.archiveBody")}
      confirmLabel={t("executionP4.budget.archiveConfirm")}
      onConfirm={async (reason) => {
        try {
          await api.send(executionPaths.budgetLineArchive(seen.id), {
            method: "POST",
            body: { reason },
            ifMatch: seen.version,
          });
        } finally {
          // Success, a 409 (stale version) or a 422 (already archived): the lines are re-read either way.
          await refresh();
        }
        onClose();
      }}
      onClose={onClose}
    />
  );
}
