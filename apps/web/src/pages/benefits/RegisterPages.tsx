// Benefits and Finance > shared-benefit groups, overlap warnings, scenarios and valuation methods (T-DG4-FE-C;
// p4-work-split §B.5; ADR-0029 §6-§8, §10). SYNTHETIC data only.
//  - Groups (REQ-PB-058): exactly one counted member; until it is named NO member is counted (never a double count).
//  - Overlaps (REQ-S08-014): an open warning keeps both benefits out of validated and sustained totals until Finance
//    resolves it (FIN only; not an owner of either benefit; "Finance validation", never DG0-DG7).
//  - Scenarios (REQ-S08-018): every value is labelled with its scenario kind; scenario values never enter realized or
//    validated totals.
//  - Valuation methods (REQ-S08-010): proposed by benefit editors, decided by Finance (not the proposer); a
//    non-financial benefit has a SAR value only with an approved method.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import {
  BENEFIT_OVERLAP_DIMENSIONS,
  BENEFIT_SCENARIO_KINDS,
  VALUATION_METHOD_TYPES,
  valuationDecisionAllowed,
  type ValuationMethodDecision,
} from "@mth/shared/schemas";
import { useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { useMe } from "../../auth/session.tsx";
import { Icon } from "../../components/Icon.tsx";
import { usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { P4FormDialog, ReadOnlyNote, textOf, type P4Values } from "../my-work/p4ui.tsx";
import {
  benefitPaths,
  useBenefitGroups,
  useBenefitOverlap,
  useBenefitOverlaps,
  useBenefitRegister,
  useBenefitScenarios,
  useValuationMethods,
  type BenefitGroup,
  type BenefitOverlap,
  type BenefitScenario,
  type BenefitScenarioValue,
  type BenefitValuationMethod,
} from "./api.ts";
import { BENEFIT_WRITE_PERMISSIONS } from "./BenefitsPage.tsx";
import {
  BenefitLink,
  BenefitSubNav,
  Code,
  FinanceValidationNote,
  MEASURE_INPUT,
  MONEY_INPUT,
  Measure,
  Money,
  NS,
  Period,
  RecordChip,
  UnknownChip,
  vocabOptions,
} from "./ui.tsx";

function Frame({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <WorkspaceFrame tab="business-cases" title={title} subtitle={intro} writePermissions={BENEFIT_WRITE_PERMISSIONS}>
      <SubNav />
      {children}
    </WorkspaceFrame>
  );
}

function SubNav() {
  const ws = useWorkspace();
  return <BenefitSubNav tid={ws.tid} />;
}

/** Benefit codes by id (from the register, active and archived), for labels and selects. */
function useBenefitIndex(tid: string) {
  const active = useBenefitRegister(tid, { status: "active" });
  const rows = active.data ?? [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    rows,
    label: (id: string | null | undefined) => {
      if (!id) return null;
      const r = byId.get(id);
      return r ? `${r.code} · ${r.title}` : null;
    },
    options: rows.map((r) => ({ value: r.id, label: `${r.code} · ${r.title}` })),
  };
}

function BenefitRef({ tid, id, label }: { tid: string; id: string; label: string | null }) {
  const { t } = useTranslation();
  return (
    <BenefitLink tid={tid} id={id}>
      {label ?? t("benefitsP4.benefitRef", { ref: id.slice(-4) })}
    </BenefitLink>
  );
}

// ------------------------------------------------------------------------------------------------ groups

export function BenefitGroupsPage() {
  const { t } = useTranslation();
  return (
    <Frame title={t("benefitsP4.groups.title")} intro={t("benefitsP4.groups.intro")}>
      <Groups />
    </Frame>
  );
}

function Groups() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const groups = useBenefitGroups(ws.tid);
  const index = useBenefitIndex(ws.tid);
  const canManage = ws.can("benefit_group.manage");
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "edit"; g: BenefitGroup } | null>(null);
  const columns: RegisterColumn<BenefitGroup>[] = [
    {
      id: "group",
      header: t("benefitsP4.groups.group"),
      rowHeader: true,
      hideable: false,
      cell: (g) => (
        <span className="block">
          <Code>{g.code}</Code> {g.title}
          {g.description ? <span className="block small muted">{g.description}</span> : null}
        </span>
      ),
      sortValue: (g) => g.code,
      filterText: (g) => `${g.code} ${g.title}`,
    },
    {
      id: "members",
      header: t("benefitsP4.groups.members"),
      cell: (g) =>
        g.memberBenefitIds.length === 0 ? (
          <span className="muted">{t("benefitsP4.groups.noMembers")}</span>
        ) : (
          <ul className="plain-list">
            {g.memberBenefitIds.map((id) => (
              <li key={id}>
                <BenefitRef tid={ws.tid} id={id} label={index.label(id)} />
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: "counted",
      header: t("benefitsP4.groups.counted"),
      cell: (g) =>
        g.countedBenefitId ? (
          <span data-counted-member={g.countedBenefitId}>
            <BenefitRef tid={ws.tid} id={g.countedBenefitId} label={index.label(g.countedBenefitId)} />
          </span>
        ) : (
          <span className="status-chip status-chip--unknown status-chip--wrap" data-counted-member="none">
            <Icon name="alert" /> <span>{t("benefitsP4.groups.noneCounted")}</span>
          </span>
        ),
    },
    {
      id: "status",
      header: t("benefitsP4.groups.statusCol"),
      cell: (g) => <RecordChip group="groups" status={g.status} />,
    },
    {
      id: "actions",
      header: t("benefitsP4.measurements.actions"),
      hideable: false,
      cell: (g) =>
        canManage && g.status === "active" ? (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => setDialog({ kind: "edit", g })}
          >
            {t("benefitsP4.groups.edit")}
          </button>
        ) : null,
    },
  ];
  return (
    <Section
      id="benefit-groups"
      title={t("benefitsP4.groups.title")}
      intro={t("benefitsP4.groups.rule")}
      actions={
        canManage ? (
          <button type="button" className="button button--primary" onClick={() => setDialog({ kind: "create" })}>
            <Icon name="plus" /> {t("benefitsP4.groups.create")}
          </button>
        ) : null
      }
    >
      {!canManage && ws.canAny(...BENEFIT_WRITE_PERMISSIONS) ? <ReadOnlyNote /> : null}
      <QueryState query={groups}>
        {(rows) => (
          <RegisterTable
            id="benefit-groups"
            caption={t("benefitsP4.groups.title")}
            rows={rows}
            columns={columns}
            getRowId={(g) => g.id}
            emptyTitle={t("benefitsP4.groups.empty")}
            emptyBody={t("benefitsP4.groups.emptyBody")}
            defaultSort={{ id: "group", dir: "asc" }}
          />
        )}
      </QueryState>
      {dialog?.kind === "create" ? (
        <P4FormDialog
          title={t("benefitsP4.groups.create")}
          fields={[
            { name: "title", label: t("benefitsP4.field.title"), kind: "text", required: true, max: 300 },
            { name: "description", label: t("benefitsP4.field.description"), kind: "textarea", max: 4000 },
          ]}
          submitLabel={t("benefitsP4.groups.create")}
          url={benefitPaths.groups(ws.tid)}
          namespaces={NS}
          toBody={(v) => ({
            title: textOf(v["title"]),
            ...(textOf(v["description"]) ? { description: textOf(v["description"]) } : {}),
          })}
          onDone={() => refresh()}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <P4FormDialog
          title={t("benefitsP4.groups.edit")}
          description={t("benefitsP4.groups.membersHint")}
          fields={[
            { name: "title", label: t("benefitsP4.field.title"), kind: "text", required: true, max: 300 },
            { name: "description", label: t("benefitsP4.field.description"), kind: "textarea", max: 4000 },
            {
              name: "countedBenefitId",
              label: t("benefitsP4.groups.counted"),
              kind: "select",
              hint: t("benefitsP4.groups.countedHint"),
              options: dialog.g.memberBenefitIds.map((id) => ({ value: id, label: index.label(id) ?? id.slice(-4) })),
            },
          ]}
          initial={{
            title: dialog.g.title,
            description: dialog.g.description ?? "",
            countedBenefitId: dialog.g.countedBenefitId ?? "",
          }}
          submitLabel={t("common.action.save")}
          method="PATCH"
          url={benefitPaths.group(ws.tid, dialog.g.id)}
          version={dialog.g.version}
          namespaces={NS}
          toBody={(v) => {
            const g = dialog.g;
            const body: Record<string, unknown> = {};
            if (textOf(v["title"]) !== g.title) body["title"] = textOf(v["title"]);
            if ((textOf(v["description"]) ?? null) !== g.description)
              body["description"] = textOf(v["description"]) ?? null;
            if (((v["countedBenefitId"] as string) || null) !== g.countedBenefitId)
              body["countedBenefitId"] = (v["countedBenefitId"] as string) || null;
            return Object.keys(body).length === 0 ? { fieldErrors: { title: "validation.empty_patch" } } : body;
          }}
          onDone={() => refresh()}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ overlaps

export function BenefitOverlapsPage() {
  const { t } = useTranslation();
  return (
    <Frame title={t("benefitsP4.overlaps.title")} intro={t("benefitsP4.overlaps.intro")}>
      <Overlaps />
    </Frame>
  );
}

function OverlapDims({ o }: { o: BenefitOverlap }) {
  const { t } = useTranslation();
  return (
    <span data-dimensions={o.dimensions.join(",")}>
      {o.dimensions.map((d) => t(`benefitsP4.dimension.${d}`)).join(t("benefitsP4.listSeparator"))}
    </span>
  );
}

function Overlaps() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const [status, setStatus] = useState<"" | "open" | "resolved">("open");
  const overlaps = useBenefitOverlaps(ws.tid, status ? { status } : {});
  const index = useBenefitIndex(ws.tid);
  const canRaise = ws.can("benefit.edit");
  const [raising, setRaising] = useState(false);
  const columns: RegisterColumn<BenefitOverlap>[] = [
    {
      id: "pair",
      header: t("benefitsP4.overlaps.pair"),
      rowHeader: true,
      hideable: false,
      cell: (o) => (
        <Link className="link" to={`/transformations/${ws.tid}/benefit-overlaps/${o.id}`} data-overlap={o.id}>
          {index.label(o.benefitAId) ?? o.benefitAId.slice(-4)} ↔ {index.label(o.benefitBId) ?? o.benefitBId.slice(-4)}
        </Link>
      ),
      filterText: (o) => `${index.label(o.benefitAId) ?? ""} ${index.label(o.benefitBId) ?? ""}`,
    },
    { id: "dimensions", header: t("benefitsP4.overlaps.dimensions"), cell: (o) => <OverlapDims o={o} /> },
    {
      id: "window",
      header: t("benefitsP4.overlaps.window"),
      cell: (o) => <Period start={o.overlapStart} end={o.overlapEnd} />,
    },
    {
      id: "detectedBy",
      header: t("benefitsP4.overlaps.detectedBy"),
      cell: (o) => t(`benefitsP4.overlaps.detected.${o.detectedBy}`),
    },
    {
      id: "status",
      header: t("benefitsP4.overlaps.statusCol"),
      cell: (o) => (
        <span className="block">
          <RecordChip group="overlaps" status={o.status} />
          {o.resolution ? (
            <span className="block small">{t(`benefitsP4.overlaps.resolution.${o.resolution}`)}</span>
          ) : null}
          {o.status === "open" ? (
            <span className="block small">{t("benefitsP4.overlaps.excludedWhileOpen")}</span>
          ) : null}
        </span>
      ),
      sortValue: (o) => o.status,
    },
  ];
  return (
    <Section
      id="benefit-overlaps"
      title={t("benefitsP4.overlaps.title")}
      intro={t("benefitsP4.overlaps.rule")}
      actions={
        canRaise ? (
          <button type="button" className="button button--secondary" onClick={() => setRaising(true)}>
            <Icon name="plus" /> {t("benefitsP4.overlaps.raise")}
          </button>
        ) : null
      }
    >
      <div className="filters" role="group" aria-label={t("benefitsP4.register.filters")}>
        <div className="filters__select">
          <label htmlFor="overlap-filter-status">{t("benefitsP4.overlaps.statusCol")}</label>
          <select
            id="overlap-filter-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="">{t("benefitsP4.overlaps.all")}</option>
            <option value="open">{t("benefitsP4.overlaps.status.open")}</option>
            <option value="resolved">{t("benefitsP4.overlaps.status.resolved")}</option>
          </select>
        </div>
      </div>
      <QueryState query={overlaps}>
        {(rows) => (
          <RegisterTable
            id="benefit-overlaps"
            caption={t("benefitsP4.overlaps.title")}
            rows={rows}
            columns={columns}
            getRowId={(o) => o.id}
            emptyTitle={t("benefitsP4.overlaps.empty")}
            emptyBody={t("benefitsP4.overlaps.emptyBody")}
          />
        )}
      </QueryState>
      {raising ? (
        <RaiseOverlapDialog options={index.options} onClose={() => setRaising(false)} onDone={() => refresh()} />
      ) : null}
    </Section>
  );
}

function RaiseOverlapDialog({
  options,
  onClose,
  onDone,
}: {
  options: { value: string; label: string }[];
  onClose: () => void;
  onDone: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  return (
    <P4FormDialog
      title={t("benefitsP4.overlaps.raise")}
      description={t("benefitsP4.overlaps.raiseIntro")}
      fields={[
        { name: "benefitAId", label: t("benefitsP4.overlaps.benefitA"), kind: "select", required: true, options },
        { name: "benefitBId", label: t("benefitsP4.overlaps.benefitB"), kind: "select", required: true, options },
        ...BENEFIT_OVERLAP_DIMENSIONS.map((d) => ({
          name: `dim_${d}`,
          label: t(`benefitsP4.dimension.${d}`),
          kind: "checkbox" as const,
        })),
      ]}
      submitLabel={t("benefitsP4.overlaps.raise")}
      url={benefitPaths.overlaps(ws.tid)}
      namespaces={NS}
      toBody={(v: P4Values) => {
        const dimensions = BENEFIT_OVERLAP_DIMENSIONS.filter((d) => v[`dim_${d}`] === true);
        if (dimensions.length === 0) return { fieldErrors: { benefitAId: "validation.dimensions_required" } };
        if (v["benefitAId"] === v["benefitBId"]) return { fieldErrors: { benefitBId: "benefit_overlap.same_benefit" } };
        return { benefitAId: v["benefitAId"], benefitBId: v["benefitBId"], dimensions };
      }}
      onDone={onDone}
      onClose={onClose}
    />
  );
}

export function BenefitOverlapPage() {
  const { t } = useTranslation();
  return (
    <Frame title={t("benefitsP4.overlaps.detailTitle")} intro={t("benefitsP4.overlaps.intro")}>
      <OverlapDetail />
    </Frame>
  );
}

function OverlapDetail() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const me = useMe();
  const locale = useLocale();
  const refresh = useP4Refresh(ws.tid);
  const { overlapId = "" } = useParams();
  const overlap = useBenefitOverlap(ws.tid, overlapId);
  const index = useBenefitIndex(ws.tid);
  const { byId } = usePeople(ws.tid);
  const [resolving, setResolving] = useState(false);
  return (
    <QueryState query={overlap}>
      {(o) => {
        const owners = [
          index.rows.find((r) => r.id === o.benefitAId)?.ownerUserId,
          index.rows.find((r) => r.id === o.benefitBId)?.ownerUserId,
        ];
        const isOwner = owners.includes(me.user.id);
        const canResolve = ws.can("finance.validate") && o.status === "open";
        const pair = [
          { value: o.benefitAId, label: index.label(o.benefitAId) ?? o.benefitAId.slice(-4) },
          { value: o.benefitBId, label: index.label(o.benefitBId) ?? o.benefitBId.slice(-4) },
        ];
        return (
          <Section
            id="benefit-overlap"
            title={t("benefitsP4.overlaps.detailTitle")}
            actions={
              canResolve && !isOwner ? (
                <button type="button" className="button button--primary" onClick={() => setResolving(true)}>
                  <Icon name="lock" /> {t("benefitsP4.overlaps.resolve")}
                </button>
              ) : null
            }
          >
            <div className="chip-row">
              <RecordChip group="overlaps" status={o.status} />
            </div>
            {o.status === "open" ? (
              <p className="banner banner--warning" role="note" data-state="overlap-open">
                <Icon name="alert" /> {t("benefitsP4.overlaps.excludedWhileOpenLong")}
              </p>
            ) : null}
            {canResolve && isOwner ? (
              <p className="banner banner--info" role="note" data-state="owner-cannot-resolve">
                <Icon name="lock" /> {t("benefitsP4.overlaps.ownerCannotResolve")}
              </p>
            ) : null}
            <dl className="details">
              <div>
                <dt>{t("benefitsP4.overlaps.benefitA")}</dt>
                <dd>
                  <BenefitRef tid={ws.tid} id={o.benefitAId} label={index.label(o.benefitAId)} />
                </dd>
              </div>
              <div>
                <dt>{t("benefitsP4.overlaps.benefitB")}</dt>
                <dd>
                  <BenefitRef tid={ws.tid} id={o.benefitBId} label={index.label(o.benefitBId)} />
                </dd>
              </div>
              <div>
                <dt>{t("benefitsP4.overlaps.dimensions")}</dt>
                <dd>
                  <OverlapDims o={o} />
                  {o.driverKey ? (
                    <span className="block small">
                      {t("benefitsP4.field.driverKey")}: <Code>{o.driverKey}</Code>
                    </span>
                  ) : null}
                  {o.populationKey ? (
                    <span className="block small">
                      {t("benefitsP4.field.populationKey")}: <Code>{o.populationKey}</Code>
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>{t("benefitsP4.overlaps.window")}</dt>
                <dd>
                  <Period start={o.overlapStart} end={o.overlapEnd} />
                </dd>
              </div>
              <div>
                <dt>{t("benefitsP4.overlaps.detectedBy")}</dt>
                <dd>{t(`benefitsP4.overlaps.detected.${o.detectedBy}`)}</dd>
              </div>
              {o.status === "resolved" ? (
                <div>
                  <dt>{t("benefitsP4.overlaps.resolutionTitle")}</dt>
                  <dd data-resolution={o.resolution ?? ""}>
                    {o.resolution ? t(`benefitsP4.overlaps.resolution.${o.resolution}`) : null}
                    {o.excludedBenefitId ? (
                      <span className="block">
                        {t("benefitsP4.overlaps.excluded")}:{" "}
                        <BenefitRef tid={ws.tid} id={o.excludedBenefitId} label={index.label(o.excludedBenefitId)} />
                      </span>
                    ) : null}
                    {o.resolutionNote ? <span className="block small">{o.resolutionNote}</span> : null}
                    <span className="block small muted">
                      {o.resolvedBy
                        ? (byId.get(o.resolvedBy)?.label ?? t("benefitsP4.person", { ref: o.resolvedBy.slice(-4) }))
                        : ""}{" "}
                      · {formatDateTime(o.resolvedAt, locale) ?? ""}
                    </span>
                  </dd>
                </div>
              ) : null}
            </dl>
            {resolving ? (
              <P4FormDialog
                title={t("benefitsP4.overlaps.resolve")}
                note={<FinanceValidationNote body={t("benefitsP4.overlaps.resolveNote")} />}
                fields={[
                  {
                    name: "resolution",
                    label: t("benefitsP4.overlaps.resolutionTitle"),
                    kind: "select",
                    required: true,
                    options: [
                      { value: "no_economic_overlap", label: t("benefitsP4.overlaps.resolution.no_economic_overlap") },
                      { value: "duplicate", label: t("benefitsP4.overlaps.resolution.duplicate") },
                    ],
                  },
                  {
                    name: "excludedBenefitId",
                    label: t("benefitsP4.overlaps.excluded"),
                    kind: "select",
                    required: true,
                    options: pair,
                    when: (v) => v["resolution"] === "duplicate",
                  },
                  {
                    name: "note",
                    label: t("benefitsP4.field.note"),
                    kind: "textarea",
                    required: true,
                    min: 3,
                    max: 4000,
                  },
                ]}
                submitLabel={t("benefitsP4.overlaps.resolve")}
                url={benefitPaths.resolveOverlap(ws.tid, o.id)}
                version={o.version}
                namespaces={NS}
                toBody={(v) => ({
                  resolution: v["resolution"],
                  ...(v["resolution"] === "duplicate" ? { excludedBenefitId: v["excludedBenefitId"] } : {}),
                  note: textOf(v["note"]),
                })}
                onDone={() => refresh()}
                onClose={() => setResolving(false)}
              />
            ) : null}
          </Section>
        );
      }}
    </QueryState>
  );
}

// ------------------------------------------------------------------------------------------------ scenarios

export function BenefitScenariosPage() {
  const { t } = useTranslation();
  return (
    <Frame title={t("benefitsP4.scenarios.title")} intro={t("benefitsP4.scenarios.intro")}>
      <Scenarios />
    </Frame>
  );
}

function scenarioValueFields(t: (k: string) => string, benefits: { value: string; label: string }[] | null) {
  return [
    ...(benefits
      ? [
          {
            name: "benefitId",
            label: t("benefitsP4.scenarios.benefit"),
            kind: "select" as const,
            required: true,
            options: benefits,
          },
        ]
      : []),
    { name: "periodStart", label: t("benefitsP4.field.periodStart"), kind: "date" as const, required: true },
    { name: "periodEnd", label: t("benefitsP4.field.periodEnd"), kind: "date" as const, required: true },
    {
      name: "amount",
      label: t("benefitsP4.field.amount"),
      kind: "text" as const,
      ltr: true,
      hint: t("benefitsP4.form.moneyHint"),
    },
    {
      name: "kpiValue",
      label: t("benefitsP4.field.kpiValue"),
      kind: "text" as const,
      ltr: true,
      hint: t("benefitsP4.form.decimalHint"),
    },
    { name: "note", label: t("benefitsP4.field.note"), kind: "textarea" as const, max: 2000 },
  ];
}

function scenarioValueBody(v: P4Values, before?: BenefitScenarioValue) {
  const amount = ((v["amount"] as string) ?? "").trim();
  const kpiValue = ((v["kpiValue"] as string) ?? "").trim();
  const errors: Record<string, string> = {};
  if (amount !== "" && !MONEY_INPUT.test(amount)) errors["amount"] = "validation.decimal";
  if (kpiValue !== "" && !MEASURE_INPUT.test(kpiValue)) errors["kpiValue"] = "validation.decimal";
  if (amount === "" && kpiValue === "") errors["amount"] = "benefit_value.value_required";
  const s = v["periodStart"] as string;
  const e = v["periodEnd"] as string;
  if (s && e && e < s) errors["periodEnd"] = "benefit_value.period_range";
  if (Object.keys(errors).length > 0) return { fieldErrors: errors };
  const body: Record<string, unknown> = {};
  const put = (k: string, val: string | null, old: string | null | undefined) => {
    if (before ? val !== (old ?? null) : val !== null) body[k] = val;
  };
  if (!before) body["benefitId"] = v["benefitId"];
  put("periodStart", s || null, before?.periodStart);
  put("periodEnd", e || null, before?.periodEnd);
  put("amount", amount || null, before?.amount);
  put("kpiValue", kpiValue || null, before?.kpiValue);
  put("note", textOf(v["note"]) ?? null, before?.note);
  if (before && Object.keys(body).length === 0) return { fieldErrors: { amount: "validation.empty_patch" } };
  return body;
}

function Scenarios() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const scenarios = useBenefitScenarios(ws.tid);
  const index = useBenefitIndex(ws.tid);
  const canEdit = ws.can("benefit_scenario.edit");
  const [dialog, setDialog] = useState<
    | { kind: "create" }
    | { kind: "edit"; s: BenefitScenario }
    | { kind: "value"; s: BenefitScenario }
    | { kind: "editValue"; s: BenefitScenario; v: BenefitScenarioValue }
    | null
  >(null);
  return (
    <Section
      id="benefit-scenarios"
      title={t("benefitsP4.scenarios.title")}
      intro={t("benefitsP4.scenarios.rule")}
      actions={
        canEdit ? (
          <button type="button" className="button button--primary" onClick={() => setDialog({ kind: "create" })}>
            <Icon name="plus" /> {t("benefitsP4.scenarios.create")}
          </button>
        ) : null
      }
    >
      {!canEdit && ws.canAny(...BENEFIT_WRITE_PERMISSIONS) ? <ReadOnlyNote /> : null}
      <QueryState query={scenarios}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="muted" data-state="no-scenarios">
              {t("benefitsP4.scenarios.empty")}
            </p>
          ) : (
            <>
              {rows.map((s) => (
                <div key={s.id} className="card" data-scenario={s.kind} data-status={s.status}>
                  <div className="card__header section__header">
                    <h3 className="card__subtitle">
                      <span className="status-chip status-chip--unknown" data-scenario-kind={s.kind}>
                        {t(`benefitsP4.scenarioKind.${s.kind}`)}
                      </span>{" "}
                      {s.title}
                    </h3>
                    {canEdit && s.status === "active" ? (
                      <div className="section__actions">
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          onClick={() => setDialog({ kind: "edit", s })}
                        >
                          {t("benefitsP4.scenarios.edit")}
                        </button>
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          onClick={() => setDialog({ kind: "value", s })}
                        >
                          <Icon name="plus" /> {t("benefitsP4.scenarios.addValue")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <RecordChip group="scenarios" status={s.status} />
                  {s.assumptions ? <p className="small">{s.assumptions}</p> : null}
                  {s.values.length === 0 ? (
                    <p className="muted">{t("benefitsP4.scenarios.noValues")}</p>
                  ) : (
                    <div
                      className="table-wrap"
                      role="region"
                      tabIndex={0}
                      aria-label={t("benefitsP4.scenarios.valuesOf", { kind: t(`benefitsP4.scenarioKind.${s.kind}`) })}
                    >
                      <table className="table">
                        <caption className="visually-hidden">
                          {t("benefitsP4.scenarios.valuesOf", { kind: t(`benefitsP4.scenarioKind.${s.kind}`) })}
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">{t("benefitsP4.scenarios.benefit")}</th>
                            <th scope="col">{t("benefitsP4.measurements.period")}</th>
                            <th scope="col">{t("benefitsP4.scenarios.value")}</th>
                            <th scope="col">{t("benefitsP4.measurements.actions")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.values.map((v) => (
                            <tr key={v.id} data-scenario-value={v.scenarioKind}>
                              <th scope="row">
                                <BenefitRef tid={ws.tid} id={v.benefitId} label={index.label(v.benefitId)} />
                              </th>
                              <td>
                                <Period start={v.periodStart} end={v.periodEnd} />
                              </td>
                              <td>
                                <span className="block">
                                  <span className="small muted" data-value-kind={v.scenarioKind}>
                                    {t("benefitsP4.scenarios.valueLabel", {
                                      kind: t(`benefitsP4.scenarioKind.${v.scenarioKind}`),
                                    })}
                                    :
                                  </span>{" "}
                                  {v.amount !== null ? <Money value={v.amount} currency={v.currency} /> : null}
                                  {v.kpiValue !== null ? <Measure value={v.kpiValue} /> : null}
                                  {v.amount === null && v.kpiValue === null ? <UnknownChip /> : null}
                                </span>
                              </td>
                              <td>
                                {canEdit && s.status === "active" ? (
                                  <button
                                    type="button"
                                    className="button button--secondary button--small"
                                    onClick={() => setDialog({ kind: "editValue", s, v })}
                                  >
                                    {t("benefitsP4.scenarios.editValue")}
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </>
          )
        }
      </QueryState>
      {dialog?.kind === "create" ? (
        <P4FormDialog
          title={t("benefitsP4.scenarios.create")}
          fields={[
            {
              name: "kind",
              label: t("benefitsP4.scenarios.kind"),
              kind: "select",
              required: true,
              options: vocabOptions(t, "scenarioKind", BENEFIT_SCENARIO_KINDS),
            },
            { name: "title", label: t("benefitsP4.field.title"), kind: "text", required: true, max: 300 },
            { name: "assumptions", label: t("benefitsP4.field.assumptions"), kind: "textarea", max: 8000 },
          ]}
          submitLabel={t("benefitsP4.scenarios.create")}
          url={benefitPaths.scenarios(ws.tid)}
          namespaces={NS}
          toBody={(v) => ({
            kind: v["kind"],
            title: textOf(v["title"]),
            ...(textOf(v["assumptions"]) ? { assumptions: textOf(v["assumptions"]) } : {}),
          })}
          onDone={() => refresh()}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <P4FormDialog
          title={t("benefitsP4.scenarios.edit")}
          fields={[
            { name: "title", label: t("benefitsP4.field.title"), kind: "text", required: true, max: 300 },
            { name: "assumptions", label: t("benefitsP4.field.assumptions"), kind: "textarea", max: 8000 },
            {
              name: "archiveReason",
              label: t("benefitsP4.scenarios.archiveReason"),
              kind: "textarea",
              max: 1000,
              hint: t("benefitsP4.scenarios.archiveHint"),
            },
          ]}
          initial={{ title: dialog.s.title, assumptions: dialog.s.assumptions ?? "" }}
          submitLabel={t("common.action.save")}
          method="PATCH"
          url={benefitPaths.scenario(ws.tid, dialog.s.id)}
          version={dialog.s.version}
          namespaces={NS}
          toBody={(v) => {
            const body: Record<string, unknown> = {};
            if (textOf(v["title"]) !== dialog.s.title) body["title"] = textOf(v["title"]);
            if ((textOf(v["assumptions"]) ?? null) !== dialog.s.assumptions)
              body["assumptions"] = textOf(v["assumptions"]) ?? null;
            if (textOf(v["archiveReason"])) body["archiveReason"] = textOf(v["archiveReason"]);
            return Object.keys(body).length === 0 ? { fieldErrors: { title: "validation.empty_patch" } } : body;
          }}
          onDone={() => refresh()}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "value" ? (
        <P4FormDialog
          title={t("benefitsP4.scenarios.addValue")}
          description={t("benefitsP4.scenarios.valueIntro", { kind: t(`benefitsP4.scenarioKind.${dialog.s.kind}`) })}
          fields={scenarioValueFields(t, index.options)}
          submitLabel={t("benefitsP4.scenarios.addValue")}
          url={benefitPaths.scenarioValues(ws.tid, dialog.s.id)}
          namespaces={NS}
          toBody={(v) => scenarioValueBody(v)}
          onDone={() => refresh()}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "editValue" ? (
        <P4FormDialog
          title={t("benefitsP4.scenarios.editValue")}
          fields={scenarioValueFields(t, null)}
          initial={{
            periodStart: dialog.v.periodStart,
            periodEnd: dialog.v.periodEnd,
            amount: dialog.v.amount ?? "",
            kpiValue: dialog.v.kpiValue ?? "",
            note: dialog.v.note ?? "",
          }}
          submitLabel={t("common.action.save")}
          method="PATCH"
          url={benefitPaths.scenarioValue(ws.tid, dialog.v.id)}
          version={dialog.v.version}
          namespaces={NS}
          toBody={(v) => scenarioValueBody(v, dialog.v)}
          onDone={() => refresh()}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ valuation methods

export function ValuationMethodsPage() {
  const { t } = useTranslation();
  return (
    <Frame title={t("benefitsP4.methods.title")} intro={t("benefitsP4.methods.intro")}>
      <Methods />
    </Frame>
  );
}

function Methods() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const me = useMe();
  const refresh = useP4Refresh(ws.tid);
  const methods = useValuationMethods(ws.tid);
  const canPropose = ws.can("benefit.edit");
  const canDecide = ws.can("finance.validate");
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "decide"; m: BenefitValuationMethod } | null>(null);
  const columns: RegisterColumn<BenefitValuationMethod>[] = [
    {
      id: "method",
      header: t("benefitsP4.methods.method"),
      rowHeader: true,
      hideable: false,
      cell: (m) => (
        <span className="block">
          <Code>{m.code}</Code> {m.name}
          <span className="block small muted">{m.method}</span>
        </span>
      ),
      sortValue: (m) => m.code,
      filterText: (m) => `${m.code} ${m.name}`,
    },
    { id: "type", header: t("benefitsP4.methods.appliesTo"), cell: (m) => t(`benefitsP4.type.${m.appliesToType}`) },
    {
      id: "unitValue",
      header: t("benefitsP4.methods.unitValue"),
      cell: (m) =>
        m.unitValue === null ? <span className="muted">—</span> : <Money value={m.unitValue} currency={m.currency} />,
    },
    {
      id: "status",
      header: t("benefitsP4.methods.statusCol"),
      cell: (m) => (
        <span className="block">
          <RecordChip group="methods" status={m.status} />
          {m.decisionNote ? <span className="block small">{m.decisionNote}</span> : null}
        </span>
      ),
      sortValue: (m) => m.status,
    },
    {
      id: "actions",
      header: t("benefitsP4.measurements.actions"),
      hideable: false,
      cell: (m) =>
        canDecide && (m.status === "proposed" || m.status === "approved") ? (
          m.createdBy === me.user.id && m.status === "proposed" ? (
            <span className="small muted">{t("benefitsP4.methods.proposerCannotDecide")}</span>
          ) : (
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => setDialog({ kind: "decide", m })}
            >
              {t("benefitsP4.methods.decide")}
            </button>
          )
        ) : null,
    },
  ];
  return (
    <Section
      id="benefit-valuation-methods"
      title={t("benefitsP4.methods.title")}
      intro={t("benefitsP4.methods.rule")}
      actions={
        canPropose ? (
          <button type="button" className="button button--primary" onClick={() => setDialog({ kind: "create" })}>
            <Icon name="plus" /> {t("benefitsP4.methods.propose")}
          </button>
        ) : null
      }
    >
      <QueryState query={methods}>
        {(rows) => (
          <RegisterTable
            id="benefit-valuation-methods"
            caption={t("benefitsP4.methods.title")}
            rows={rows}
            columns={columns}
            getRowId={(m) => m.id}
            emptyTitle={t("benefitsP4.methods.empty")}
            emptyBody={t("benefitsP4.methods.emptyBody")}
          />
        )}
      </QueryState>
      {dialog?.kind === "create" ? (
        <P4FormDialog
          title={t("benefitsP4.methods.propose")}
          fields={[
            { name: "name", label: t("benefitsP4.methods.name"), kind: "text", required: true, max: 300 },
            { name: "method", label: t("benefitsP4.methods.method"), kind: "textarea", required: true, max: 8000 },
            {
              name: "appliesToType",
              label: t("benefitsP4.methods.appliesTo"),
              kind: "select",
              required: true,
              options: vocabOptions(t, "type", VALUATION_METHOD_TYPES),
            },
            {
              name: "unitValue",
              label: t("benefitsP4.methods.unitValue"),
              kind: "text",
              ltr: true,
              hint: t("benefitsP4.form.moneyHint"),
            },
            {
              name: "currency",
              label: t("benefitsP4.field.currency"),
              kind: "text",
              required: true,
              max: 3,
              ltr: true,
            },
          ]}
          initial={{ currency: ws.tr.currency ?? "SAR" }}
          submitLabel={t("benefitsP4.methods.propose")}
          url={benefitPaths.valuationMethods(ws.tid)}
          namespaces={NS}
          toBody={(v) => {
            const unit = ((v["unitValue"] as string) ?? "").trim();
            if (unit !== "" && (!MONEY_INPUT.test(unit) || unit.startsWith("-")))
              return { fieldErrors: { unitValue: "validation.decimal_non_negative" } };
            const currency = ((v["currency"] as string) ?? "").trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(currency)) return { fieldErrors: { currency: "validation.currency" } };
            return {
              name: textOf(v["name"]),
              method: textOf(v["method"]),
              appliesToType: v["appliesToType"],
              ...(unit !== "" ? { unitValue: unit } : {}),
              currency,
            };
          }}
          onDone={() => refresh()}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "decide" ? (
        <P4FormDialog
          title={t("benefitsP4.methods.decide")}
          note={<FinanceValidationNote body={t("benefitsP4.methods.decideNote")} />}
          fields={[
            {
              name: "decision",
              label: t("benefitsP4.methods.decision"),
              kind: "select",
              required: true,
              options: (["approved", "rejected", "retired"] as ValuationMethodDecision[])
                .filter((d) => valuationDecisionAllowed(dialog.m.status, d))
                .map((d) => ({ value: d, label: t(`benefitsP4.methods.status.${d}`) })),
            },
            {
              name: "note",
              label: t("benefitsP4.field.note"),
              kind: "textarea",
              max: 2000,
              hint: t("benefitsP4.methods.noteHint"),
            },
          ]}
          submitLabel={t("benefitsP4.methods.decide")}
          url={benefitPaths.valuationDecision(ws.tid, dialog.m.id)}
          version={dialog.m.version}
          namespaces={NS}
          toBody={(v) => ({ decision: v["decision"], ...(textOf(v["note"]) ? { note: textOf(v["note"]) } : {}) })}
          onDone={() => refresh()}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Section>
  );
}
