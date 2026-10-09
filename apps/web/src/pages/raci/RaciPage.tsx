// Governance > RACI (T12) of a transformation (T-DG4-FE-A; ADR-0026 §7; REQ-PB-067, REQ-S10-009, REQ-S10-007
// display side). SYNTHETIC data only in tests and demos.
//  - Deliverables x governance roles (B0101 columns: Sponsor, Transformation Lead, Business Owner, Workstream Lead,
//    Finance, Tech/Data). The cell editor accepts EXACTLY A, R, C, I, A/R or empty: it is a select of those values, so
//    no other value (e.g. "X") can be entered; the server refuses any other value too (422 raci.invalid_value).
//  - Each deliverable needs exactly one accountable (A or A/R counts as one). The count is shown per row (with text,
//    not colour alone), and the server refuses a save with two (422 raci.accountable_count) unless a documented
//    accountability exception (at least 10 characters) is recorded.
//  - All cells of a row are saved as ONE change with If-Match; a 409 says nothing was saved and reloads the matrix.
//  - Edits by raci.edit holders (TL, TO); the matrix goes to a business approval and is frozen while it waits.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RACI_VALUES } from "@mth/shared/schemas";
import { ApiError, api } from "../../api/client.ts";
import {
  p4Paths,
  useGovernanceMatrices,
  useGovernanceParties,
  useP4Refresh,
  useRaci,
  type GovernanceParty,
  type Raci,
} from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Icon } from "../../components/Icon.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { MatrixStatus, SubmitMatrixDialog } from "../decision-rights/DecisionRightsPage.tsx";
import { FormAlert, P4FormDialog, textOf } from "../my-work/p4ui.tsx";

const NS = ["raci"] as const;
type Deliverable = Raci["deliverables"][number];

/** The values a RACI cell may hold (B0101): A, R, C, I, A/R; "" = empty. */
export const RACI_CELL_OPTIONS: readonly string[] = ["", ...RACI_VALUES];

/** Accountable count of a row: A and A/R each count once (REQ-S10-009). */
export function accountableCount(cells: readonly { value: string | null }[]): number {
  return cells.filter((c) => c.value === "A" || c.value === "A/R").length;
}

export function RaciPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame tab="raci" title={t("raci.title")} subtitle={t("raci.intro")} writePermissions={["raci.edit"]}>
      <RaciBody />
    </WorkspaceFrame>
  );
}

function RaciBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const raci = useRaci(ws.tid);
  const matrices = useGovernanceMatrices(ws.tid);
  const parties = useGovernanceParties();
  const refresh = useP4Refresh(ws.tid);
  const matrix = (matrices.data ?? []).find((m) => m.kind === "raci");
  const canEdit = ws.can("raci.edit") && matrix?.status !== "in_approval";
  const [dialog, setDialog] = useState<"add" | "submit" | null>(null);
  const partyMap = new Map((parties.data ?? []).map((p) => [p.code, p]));
  return (
    <>
      <MatrixStatus matrix={matrix} canSubmit={ws.can("raci.edit")} onSubmit={() => setDialog("submit")} />
      <p className="banner banner--info" role="note">
        <Icon name="info" /> {t("raci.legend")}
      </p>
      <Section
        id="raci"
        title={t("raci.listTitle")}
        intro={t("raci.rule")}
        actions={
          canEdit ? (
            <button type="button" className="button button--primary button--small" onClick={() => setDialog("add")}>
              <Icon name="plus" /> {t("raci.add.action")}
            </button>
          ) : null
        }
      >
        <QueryState query={raci}>
          {(r) => <RaciGrid raci={r} parties={partyMap} canEdit={canEdit} onDone={refresh} />}
        </QueryState>
      </Section>
      {dialog === "submit" && matrix ? (
        <SubmitMatrixDialog matrix={matrix} onDone={refresh} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "add" && raci.data ? (
        <AddDeliverableDialog parties={raci.data.parties} onDone={refresh} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}

function partyHeader(code: string, parties: ReadonlyMap<string, GovernanceParty>, locale: "ar" | "en"): string {
  const p = parties.get(code);
  return p ? (locale === "ar" ? p.labelAr : p.labelEn) : code;
}

function RaciGrid({
  raci,
  parties,
  canEdit,
  onDone,
}: {
  raci: Raci;
  parties: ReadonlyMap<string, GovernanceParty>;
  canEdit: boolean;
  onDone: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const rows = [...raci.deliverables].sort((a, b) => a.ordinal - b.ordinal);
  if (rows.length === 0) return <p className="muted">{t("raci.empty")}</p>;
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={t("raci.listTitle")}>
      <table className="table raci-grid" data-table="raci">
        <caption className="visually-hidden">{t("raci.listTitle")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("raci.deliverable")}</th>
            {raci.parties.map((p) => (
              <th scope="col" key={p} data-party={p}>
                {partyHeader(p, parties, locale)}{" "}
                <bdi dir="ltr" className="small">
                  {p}
                </bdi>
              </th>
            ))}
            <th scope="col">{t("raci.accountable")}</th>
            {canEdit ? <th scope="col">{t("common.field.actions")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <RaciRow
              key={`${d.id}:${d.version}`}
              deliverable={d}
              parties={raci.parties}
              partyMap={parties}
              canEdit={canEdit}
              onDone={onDone}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RaciRow({
  deliverable: d,
  parties,
  partyMap,
  canEdit,
  onDone,
}: {
  deliverable: Deliverable;
  parties: readonly string[];
  partyMap: ReadonlyMap<string, GovernanceParty>;
  canEdit: boolean;
  onDone: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const saved = new Map(d.cells.map((c) => [c.partyCode, c.value ?? ""]));
  const [cells, setCells] = useState<Map<string, string>>(new Map(saved));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const label = locale === "ar" ? d.labelAr : d.labelEn;
  const dirty = parties.some((p) => (cells.get(p) ?? "") !== (saved.get(p) ?? ""));
  const count = accountableCount(parties.map((p) => ({ value: cells.get(p) ?? null })));

  const save = async () => {
    setError(null);
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await api.send(p4Paths.raciDeliverable(ws.tid, d.id), {
        method: "PATCH",
        ifMatch: d.version,
        body: {
          cells: parties.map((p) => ({ partyCode: p, value: (cells.get(p) ?? "") === "" ? null : cells.get(p) })),
        },
      });
      if (action.stale()) return;
      await onDone();
    } catch (e) {
      if (action.stale(e)) return;
      setError(e);
      if (e instanceof ApiError && e.status === 409) await onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <tr data-deliverable={d.templateKey ?? d.id} data-status={d.status}>
        <th scope="row">
          {label}
          {d.status === "retired" ? <span className="block small muted">{t("raci.retired")}</span> : null}
          {d.accountabilityException ? (
            <span className="block small muted">
              {t("raci.exception")}: {d.accountabilityException}
            </span>
          ) : null}
        </th>
        {parties.map((p) => {
          const v = cells.get(p) ?? "";
          return (
            <td key={p} data-cell={p} data-value={v}>
              {canEdit && d.status === "active" ? (
                <select
                  aria-label={t("raci.cellLabel", { deliverable: label, party: partyHeader(p, partyMap, locale) })}
                  value={RACI_CELL_OPTIONS.includes(v) ? v : ""}
                  onChange={(e) => setCells((prev) => new Map(prev).set(p, e.target.value))}
                >
                  {RACI_CELL_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o === "" ? t("raci.emptyCell") : o}
                    </option>
                  ))}
                </select>
              ) : (
                <span dir="ltr">{v === "" ? <span className="muted">{t("raci.emptyCellShort")}</span> : v}</span>
              )}
            </td>
          );
        })}
        <td data-accountable-count={count}>
          {count === 1 ? (
            <span className="status-chip status-chip--on-track">
              <Icon name="check" /> {t("raci.accountableOne")}
            </span>
          ) : (
            <span className="status-chip status-chip--off-track status-chip--wrap">
              <Icon name="alert" /> <span>{t("raci.accountableCount", { count })}</span>
            </span>
          )}
        </td>
        {canEdit ? (
          <td>
            {d.status === "active" ? (
              <span className="p4-chips">
                <button
                  type="button"
                  className="button button--primary button--small"
                  data-action="save-row"
                  disabled={!dirty || busy}
                  onClick={() => void save()}
                >
                  {busy ? t("common.state.saving") : t("raci.saveRow")}
                  <span className="visually-hidden">: {label}</span>
                </button>
                <button
                  type="button"
                  className="button button--secondary button--small"
                  disabled={!dirty || busy}
                  onClick={() => {
                    setCells(new Map(saved));
                    setError(null);
                  }}
                >
                  {t("raci.discard")}
                  <span className="visually-hidden">: {label}</span>
                </button>
              </span>
            ) : null}
          </td>
        ) : null}
      </tr>
      {error ? (
        <tr>
          <td colSpan={parties.length + (canEdit ? 3 : 2)}>
            <FormAlert error={error} namespaces={NS} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function AddDeliverableDialog({
  parties,
  onDone,
  onClose,
}: {
  parties: readonly string[];
  onDone: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  return (
    <P4FormDialog
      title={t("raci.add.title")}
      description={<p>{t("raci.add.description")}</p>}
      fields={[
        { name: "labelEn", label: t("raci.add.labelEn"), kind: "text", required: true, max: 300 },
        { name: "labelAr", label: t("raci.add.labelAr"), kind: "text", required: true, max: 300 },
        ...parties.map((p) => ({
          name: `cell_${p}`,
          label: t("raci.add.cell", { party: p }),
          kind: "select" as const,
          options: RACI_VALUES.map((v) => ({ value: v, label: v })),
        })),
        {
          name: "accountabilityException",
          label: t("raci.exception"),
          kind: "textarea",
          max: 2000,
          min: 10,
          hint: t("raci.add.exceptionHint"),
        },
      ]}
      submitLabel={t("raci.add.submit")}
      url={p4Paths.raciDeliverables(ws.tid)}
      toBody={(v) => {
        const exception = textOf(v["accountabilityException"]);
        return {
          labelEn: textOf(v["labelEn"]),
          labelAr: textOf(v["labelAr"]),
          cells: parties.map((p) => ({ partyCode: p, value: String(v[`cell_${p}`] ?? "") || null })),
          ...(exception ? { accountabilityException: exception } : {}),
        };
      }}
      namespaces={NS}
      onDone={onDone}
      onClose={onClose}
    />
  );
}
