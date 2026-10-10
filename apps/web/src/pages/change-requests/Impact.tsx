// Impact preview and frozen impact assessments (T-DG4-FE-F2; ADR-0036 §3, §5, §9; REQ-S04-014, REQ-S07-015). Every item
// is shown translated from its type, effect and structured detail; the server's English sentences are not shown. A gate
// item names the original business approval and states that it is preserved: applying a change never edits a gate
// submission, snapshot or decision (G1-G6 are business approvals; nothing here touches DG0-DG7). An item the caller
// cannot read is counted, never shown as "no impact". Materiality with an Unknown basis is material, never 0.
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { ImpactItem } from "@mth/shared/schemas";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { materialityBasisOf } from "./api.ts";

const EFFECT_ICON: Record<ImpactItem["effect"], IconName> = {
  value_changes: "alert",
  recalculation: "refresh",
  reapproval_required: "lock",
  informational: "info",
};

/** "Material" / "Not material" with the basis (shift, ratio, threshold) or the reason it is material. */
export function MaterialityText({
  materiality,
  basis,
}: {
  materiality: "material" | "not_material" | null;
  basis: Record<string, unknown> | null;
}) {
  const { t } = useTranslation();
  if (materiality === null)
    return (
      <span className="status-chip status-chip--unknown" data-materiality="unknown">
        <Icon name="question" /> {t("changeRequestsP4.materiality.notAssessed")}
      </span>
    );
  const b = materialityBasisOf(basis);
  const unknown = t("common.value.unknown");
  const parts: string[] = [];
  if (b.rule === "date_shift")
    parts.push(
      t("changeRequestsP4.materiality.shift", {
        days: b.shiftWorkingDays === null ? unknown : String(b.shiftWorkingDays),
      }),
    );
  if (b.rule === "budget_ratio") parts.push(t("changeRequestsP4.materiality.ratio", { ratio: b.ratio ?? unknown }));
  if (b.rule === "date_shift" || b.rule === "budget_ratio")
    parts.push(
      b.threshold === null
        ? t("changeRequestsP4.materiality.noThreshold")
        : t("changeRequestsP4.materiality.threshold", { threshold: b.threshold }),
    );
  if (b.reason && b.reason !== "no_threshold")
    parts.push(
      t(`changeRequestsP4.materiality.reason.${b.reason}`, {
        defaultValue: t("changeRequestsP4.materiality.reason.other"),
      }),
    );
  if (!b.rule) parts.push(t("changeRequestsP4.materiality.kindMaterial"));
  return (
    <span className="chip-row" data-materiality={materiality}>
      <Icon name={materiality === "material" ? "alert" : "info"} />{" "}
      <strong>{t(`changeRequestsP4.materiality.${materiality}`)}</strong>
      {parts.length > 0 ? <span className="small"> — {parts.join(" · ")}</span> : null}
    </span>
  );
}

const LABEL_PREFIXES = ["KPI formula: ", "TOM gap: ", "Decision: "];
const stripPrefix = (label: string) => {
  for (const p of LABEL_PREFIXES) if (label.startsWith(p)) return label.slice(p.length);
  return label;
};

function ItemText({ item }: { item: ImpactItem }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const d = item.detail;
  if (item.itemType === "gate") {
    const gate = typeof d["gateCode"] === "string" ? d["gateCode"] : (item.recordCode ?? "");
    const no = typeof d["submissionNo"] === "number" ? d["submissionNo"] : null;
    const preserved = item.gateDecisionId !== null || item.effect === "reapproval_required";
    const pinned = typeof d["pinnedFormulaVersionNo"] === "number" ? d["pinnedFormulaVersionNo"] : null;
    return (
      <span data-gate-item={gate} data-preserved={preserved ? "true" : "false"}>
        {preserved
          ? t("changeRequestsP4.impact.gatePreserved", { gate, no: no ?? "?" })
          : t("changeRequestsP4.impact.gatePending", { gate, no: no ?? "?" })}
        {pinned !== null ? (
          <span className="block small muted">{t("changeRequestsP4.impact.pinnedVersion", { n: pinned })}</span>
        ) : null}{" "}
        <Link className="link small" to={`/transformations/${ws.tid}/gates/${gate}`}>
          {t("changeRequestsP4.impact.openGate", { gate })}
        </Link>
      </span>
    );
  }
  if (item.itemType === "report") {
    const area = typeof d["area"] === "string" ? d["area"] : "";
    return (
      <span data-report-area={area}>
        {t(`changeRequestsP4.impact.area.${area.replace(/\./g, "_")}`, { defaultValue: area })}
      </span>
    );
  }
  return (
    <span>
      {item.recordCode ? (
        <bdi dir="ltr" className="code">
          {item.recordCode}
        </bdi>
      ) : null}{" "}
      <bdi>{stripPrefix(item.label)}</bdi>
      {d["relation"] === "dependent" ? (
        <span className="block small muted">{t("changeRequestsP4.impact.dependent")}</span>
      ) : null}
    </span>
  );
}

/** The items of a preview or an assessment, grouped by type in server order. */
export function ImpactItemsTable({
  items,
  hiddenItemCount = 0,
  live = false,
}: {
  items: readonly ImpactItem[];
  hiddenItemCount?: number;
  live?: boolean;
}) {
  const { t } = useTranslation();
  if (items.length === 0 && hiddenItemCount === 0)
    return (
      <p className="small muted" data-impact-items="0">
        {t("changeRequestsP4.impact.none")}
      </p>
    );
  return (
    <>
      <div
        className="table-wrap"
        tabIndex={0}
        role="region"
        aria-label={live ? t("changeRequestsP4.tableRegion.preview") : t("changeRequestsP4.tableRegion.assessment")}
      >
        <table className="table table--compact" data-impact-items={items.length}>
          <caption className="visually-hidden">
            {live ? t("changeRequestsP4.preview.title") : t("changeRequestsP4.assessments.title")}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("changeRequestsP4.impact.type")}</th>
              <th scope="col">{t("changeRequestsP4.impact.record")}</th>
              <th scope="col">{t("changeRequestsP4.impact.effect")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr
                key={`${i.ordinal}-${i.itemType}-${i.recordId ?? ""}`}
                data-impact-type={i.itemType}
                data-effect={i.effect}
              >
                <th scope="row">{t(`changeRequestsP4.impact.itemType.${i.itemType}`)}</th>
                <td>
                  <ItemText item={i} />
                </td>
                <td>
                  <span className="chip-row">
                    <Icon name={EFFECT_ICON[i.effect]} /> {t(`changeRequestsP4.impact.effectText.${i.effect}`)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenItemCount > 0 ? (
        <p className="small" data-hidden-items={hiddenItemCount}>
          <Icon name="lock" /> {t("changeRequestsP4.impact.hidden", { n: hiddenItemCount })}
        </p>
      ) : null}
    </>
  );
}
