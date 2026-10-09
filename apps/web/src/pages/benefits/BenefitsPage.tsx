// Benefits and Finance > Benefits register (T14) (T-DG4-FE-C; p4-work-split §B.5; ADR-0029 §4, ADR-0030 §6-§7).
// SYNTHETIC data only.
//  - The ten T14 columns of `listBenefits`: Benefit (code, title), Type (type and value class), Baseline, Target,
//    Value (SAR), Realized, Owner, Evidence, Status, Lifecycle, plus the initiatives of the current allocation set
//    (`initiatives[]`, ADR-0038 §8) and whether the benefit is counted in totals.
//  - Value (SAR): "n/a" for a non-financial benefit without an approved valuation method, Unknown with its reason for a
//    financial one without a planned value; never 0 (REQ-PB-076).
//  - Realized: validated, sustained and pending as separate labelled amounts with their counts; pending is labelled
//    "pending Finance validation" and never added to validated (REQ-PB-075, REQ-S08-016). A non-financial benefit shows
//    its latest accepted KPI actual, or Unknown.
//  - Status: label + icon; Unknown is never green.
//  - Totals by class and state, gross, implementation cost and net (ADR-0030 §7).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BENEFIT_LIFECYCLE_STEPS } from "@mth/shared/schemas";
import { useP4Refresh } from "../../api/p4.ts";
import { useSessionNavigate } from "../../auth/sessionBound.ts";
import { usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { Icon } from "../../components/Icon.tsx";
import { useBenefitFormulas } from "../benefit-formulas/api.ts";
import { useKpiDictionary } from "../kpi/api.ts";
import { P4FormDialog, ReadOnlyNote, type P4Values } from "../my-work/p4ui.tsx";
import {
  benefitPaths,
  useBenefitGroups,
  useBenefitRegister,
  useBenefitTotals,
  useValuationMethods,
  type BenefitRegisterRow,
} from "./api.ts";
import { profileBody, profileFields } from "./form.tsx";
import { TotalsView } from "./Totals.tsx";
import {
  Amount,
  BenefitLink,
  BenefitRagChip,
  BenefitSubNav,
  Code,
  Measure,
  NS,
  RealizationChip,
  StepChip,
  UnknownChip,
} from "./ui.tsx";

export const BENEFIT_WRITE_PERMISSIONS = [
  "benefit.edit",
  "benefit.advance",
  "benefit.allocate",
  "benefit.measure",
  "benefit_scenario.edit",
  "benefit_group.manage",
  "finance.validate",
] as const;

export function BenefitsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="business-cases"
      title={t("benefitsP4.register.title")}
      subtitle={t("benefitsP4.register.intro")}
      writePermissions={BENEFIT_WRITE_PERMISSIONS}
    >
      <BenefitsBody />
    </WorkspaceFrame>
  );
}

function BenefitsBody() {
  const ws = useWorkspace();
  return (
    <>
      <BenefitSubNav tid={ws.tid} />
      <Register />
      <TotalsSection />
    </>
  );
}

/** Realized (T14): validated, sustained and pending kept apart; a non-financial benefit shows its KPI actual. */
export function RealizedCell({ row }: { row: BenefitRegisterRow }) {
  const { t } = useTranslation();
  const r = row.realized;
  const nonFinancial = row.valueSar.status === "not_applicable";
  return (
    <dl className="details details--compact" data-realized={row.code}>
      {nonFinancial ? (
        <div data-part="kpi">
          <dt>{t("benefitsP4.realized.kpiActual")}</dt>
          <dd>
            {r.kpiActual.status === "known" ? (
              <Measure value={r.kpiActual.value} />
            ) : r.kpiActual.status === "stale" ? (
              <span className="status-chip status-chip--stale status-chip--wrap" data-value-status="stale">
                <Icon name="clock" /> <span>{t("benefitsP4.amount.stale")}</span>
              </span>
            ) : r.kpiActual.status === "not_applicable" ? (
              <span className="muted">{t("benefitsP4.amount.na")}</span>
            ) : (
              <UnknownChip reason={r.kpiActual.reason} />
            )}
          </dd>
        </div>
      ) : null}
      <div data-part="validated">
        <dt>{t("benefitsP4.realized.validated")}</dt>
        <dd>
          <Amount amount={r.validated} /> <span className="small muted">({r.validatedCount})</span>
        </dd>
      </div>
      <div data-part="sustained">
        <dt>{t("benefitsP4.realized.sustained")}</dt>
        <dd>
          <Amount amount={r.sustained} /> <span className="small muted">({r.sustainedCount})</span>
        </dd>
      </div>
      <div data-part="pending">
        <dt>
          <Icon name="clock" /> {t("benefitsP4.realized.pending")}
        </dt>
        <dd>
          {r.pendingCount > 0 ? (
            <>
              <Amount amount={r.pending} />{" "}
              <span className="status-chip status-chip--unknown" data-state="pending-label">
                {t("benefitsP4.realized.pendingLabel")}
              </span>
            </>
          ) : (
            <span className="muted">{t("benefitsP4.realized.nonePending")}</span>
          )}
        </dd>
      </div>
    </dl>
  );
}

function Register() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const navigate = useSessionNavigate();
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [step, setStep] = useState("");
  const query = { status, ...(step ? { lifecycleStep: step } : {}) };
  const register = useBenefitRegister(ws.tid, query);
  const { byId } = usePeople(ws.tid);
  const [creating, setCreating] = useState(false);
  const canCreate = ws.can("benefit.edit");
  const columns: RegisterColumn<BenefitRegisterRow>[] = [
    {
      id: "benefit",
      header: t("benefitsP4.col.benefit"),
      rowHeader: true,
      hideable: false,
      cell: (b) => (
        <BenefitLink tid={ws.tid} id={b.id}>
          <Code>{b.code}</Code> {b.title}
        </BenefitLink>
      ),
      sortValue: (b) => b.code,
      filterText: (b) => `${b.code} ${b.title}`,
    },
    {
      id: "type",
      header: t("benefitsP4.col.type"),
      cell: (b) => (
        <span className="block">
          {t(`benefitsP4.type.${b.benefitType}`)}
          <span className="block small muted">{t(`benefitsP4.valueClass.${b.valueClass}`)}</span>
        </span>
      ),
      sortValue: (b) => b.benefitType,
      filterText: (b) => `${t(`benefitsP4.type.${b.benefitType}`)} ${t(`benefitsP4.valueClass.${b.valueClass}`)}`,
    },
    {
      id: "baseline",
      header: t("benefitsP4.col.baseline"),
      cell: (b) => (
        <span className="block">
          <Measure value={b.baseline.value} unit={b.baseline.unit} />
          <span className="block small muted" data-baseline-status={b.baseline.validationStatus}>
            {t(`benefitsP4.baselineStatus.${b.baseline.validationStatus}`)}
          </span>
        </span>
      ),
    },
    {
      id: "target",
      header: t("benefitsP4.col.target"),
      cell: (b) => <Measure value={b.target.value} unit={b.baseline.unit} />,
    },
    {
      id: "valueSar",
      header: t("benefitsP4.col.valueSar"),
      cell: (b) => <Amount amount={b.valueSar} />,
    },
    { id: "realized", header: t("benefitsP4.col.realized"), cell: (b) => <RealizedCell row={b} /> },
    {
      id: "owner",
      header: t("benefitsP4.col.owner"),
      cell: (b) => byId.get(b.ownerUserId)?.label ?? t("benefitsP4.person", { ref: b.ownerUserId.slice(-4) }),
      sortValue: (b) => byId.get(b.ownerUserId)?.label ?? b.ownerUserId,
    },
    {
      id: "evidence",
      header: t("benefitsP4.col.evidence"),
      cell: (b) => (
        <span data-evidence-count={b.evidenceCount}>{t("benefitsP4.evidenceCount", { count: b.evidenceCount })}</span>
      ),
      sortValue: (b) => b.evidenceCount,
    },
    {
      id: "status",
      header: t("benefitsP4.col.status"),
      cell: (b) => <BenefitRagChip rag={b.status} />,
      sortValue: (b) => b.status,
      filterText: (b) => t(`benefitsP4.rag.${b.status}`),
    },
    {
      id: "lifecycle",
      header: t("benefitsP4.col.lifecycle"),
      cell: (b) => (
        <span className="chip-row">
          <StepChip step={b.lifecycleStep} />
          <RealizationChip state={b.realizationState} />
        </span>
      ),
      sortValue: (b) => BENEFIT_LIFECYCLE_STEPS.indexOf(b.lifecycleStep),
      filterText: (b) => t(`benefitsP4.step.${b.lifecycleStep}`),
    },
    {
      id: "initiatives",
      header: t("benefitsP4.col.initiatives"),
      cell: (b) =>
        (b.initiatives ?? []).length === 0 ? (
          <span className="muted" data-initiatives="none">
            {t("benefitsP4.register.noInitiatives")}
          </span>
        ) : (
          <ul className="plain-list" data-initiatives={(b.initiatives ?? []).length}>
            {(b.initiatives ?? []).map((i) => (
              <li key={i.id}>
                <Code>{i.code}</Code> {i.name}
              </li>
            ))}
          </ul>
        ),
      filterText: (b) => (b.initiatives ?? []).map((i) => `${i.code} ${i.name}`).join(" "),
    },
    {
      id: "counted",
      header: t("benefitsP4.col.counted"),
      cell: (b) =>
        b.counting.counted && !b.counting.overlapOpen ? (
          <span data-counted="true">{t("benefitsP4.counting.counted")}</span>
        ) : (
          <span className="block" data-counted="false">
            {b.counting.overlapOpen ? (
              <span className="block">
                <Icon name="alert" /> {t("benefitsP4.counting.overlapOpen")}
              </span>
            ) : null}
            {b.counting.exclusionReason ? (
              <span className="block">{t(`benefitsP4.exclusion.${b.counting.exclusionReason}`)}</span>
            ) : null}
          </span>
        ),
    },
  ];
  return (
    <Section
      id="benefit-register"
      title={t("benefitsP4.register.tableTitle")}
      intro={t("benefitsP4.register.tableIntro")}
      actions={
        canCreate ? (
          <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> {t("benefitsP4.register.create")}
          </button>
        ) : null
      }
    >
      {!canCreate && ws.canAny(...BENEFIT_WRITE_PERMISSIONS) ? <ReadOnlyNote /> : null}
      <div className="filters" role="group" aria-label={t("benefitsP4.register.filters")}>
        <div className="filters__select">
          <label htmlFor="benefit-filter-status">{t("benefitsP4.register.filterStatus")}</label>
          <select
            id="benefit-filter-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as "active" | "archived")}
          >
            <option value="active">{t("benefitsP4.register.active")}</option>
            <option value="archived">{t("benefitsP4.register.archived")}</option>
          </select>
        </div>
        <div className="filters__select">
          <label htmlFor="benefit-filter-step">{t("benefitsP4.register.filterStep")}</label>
          <select id="benefit-filter-step" value={step} onChange={(e) => setStep(e.target.value)}>
            <option value="">{t("benefitsP4.register.allSteps")}</option>
            {BENEFIT_LIFECYCLE_STEPS.map((s) => (
              <option key={s} value={s}>
                {t(`benefitsP4.step.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <QueryState query={register}>
        {(rows) => (
          <RegisterTable
            id="benefit-register"
            caption={t("benefitsP4.register.tableTitle")}
            rows={rows}
            columns={columns}
            getRowId={(b) => b.id}
            emptyTitle={t("benefitsP4.register.empty")}
            emptyBody={t("benefitsP4.register.emptyBody")}
            defaultSort={{ id: "benefit", dir: "asc" }}
          />
        )}
      </QueryState>
      {creating ? (
        <CreateBenefitDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/transformations/${ws.tid}/benefits/${id}`)}
        />
      ) : null}
    </Section>
  );
}

/** Options of the profile form: team, KPIs, formulas, approved valuation methods, groups. */
export function useProfileOptions(tid: string) {
  const { people } = usePeople(tid);
  const kpis = useKpiDictionary(tid);
  const formulas = useBenefitFormulas(tid);
  const methods = useValuationMethods(tid);
  const groups = useBenefitGroups(tid);
  return {
    people,
    kpis: (kpis.data ?? []).map((k) => ({ id: k.definition.id, label: k.definition.name })),
    formulas: (formulas.data ?? []).map((f) => ({ id: f.id, label: `${f.code} · ${f.benefitName}` })),
    methods: methods.data ?? [],
    groups: (groups.data ?? [])
      .filter((g) => g.status === "active")
      .map((g) => ({ id: g.id, label: `${g.code} · ${g.title}` })),
  };
}

function CreateBenefitDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const options = useProfileOptions(ws.tid);
  const initial: P4Values = { currency: ws.tr.currency ?? "SAR", ownerUserId: "" };
  const [values, setValues] = useState<P4Values>(initial);
  const fields = profileFields(t, values, options, "create");
  return (
    <P4FormDialog
      title={t("benefitsP4.register.create")}
      description={t("benefitsP4.form.createIntro")}
      fields={fields}
      initial={initial}
      submitLabel={t("benefitsP4.register.createSubmit")}
      url={benefitPaths.benefits(ws.tid)}
      namespaces={NS}
      onValuesChange={setValues}
      toBody={(v) =>
        profileBody(
          v,
          fields.filter((f) => !f.when || f.when(v)).map((f) => f.name),
        )
      }
      onDone={async (result) => {
        const ok = await refresh();
        if (ok && result && typeof result === "object" && "id" in result) onCreated((result as { id: string }).id);
        return ok;
      }}
      onClose={onClose}
    />
  );
}

function TotalsSection() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const totals = useBenefitTotals(ws.tid);
  return (
    <Section id="benefit-totals" title={t("benefitsP4.totals.title")} intro={t("benefitsP4.totals.intro")}>
      <QueryState query={totals}>{(data) => <TotalsView totals={data} tid={ws.tid} />}</QueryState>
    </Section>
  );
}
