// Formula preview (T-DG5-FE-F; REQ-S08-005; ADR-0047 §4; Benefits and Finance > Formula builder > Preview): before a
// benefit formula is published or used, the evaluated examples, the resulting unit and the edge cases (zero, missing,
// negative) of each input. The preview calls the DG3 formula engine unchanged and stores nothing.
//  - The unit is the result's kind, currency and period: the revenue-uplift total is "SAR" (per year), never the
//    engine's propagated "SAR per customer" (KBE-F §5.6 d; D-156 i).
//  - An outcome the engine cannot compute is "Not computable" with its reason (e.g. a missing ARPU), never 0.
//  - A formula seeded from a playbook example (B0087) can also be previewed from the seeded example itself.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { FormulaPreviewRequest } from "@mth/shared/schemas";
import { useTransformation } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { formatDecimal, formatMoney } from "../../lib/format.ts";
import { Chip } from "../automation/ui.tsx";
import { useBenefitFormula } from "../benefit-formulas/api.ts";
import { NotComputable, Notice } from "../launch-plan/ui.tsx";
import { useFormulaPreview, type FormulaPreviewResult } from "../financial-metrics/api.ts";

type Mode = "version" | "example";

export function FormulaPreviewPage() {
  const { t } = useTranslation();
  const { id = "", formulaId = "" } = useParams();
  usePageTitle(t("launchHealthP5.preview.title"));
  const transformation = useTransformation(id);
  const formula = useBenefitFormula(id, formulaId);
  const [mode, setMode] = useState<Mode | null>(null);
  const f = formula.data;
  const effective: Mode | null = mode ?? (f?.currentVersion ? "version" : f?.exampleCode ? "example" : null);
  const body: FormulaPreviewRequest | null = !f
    ? null
    : effective === "example" && f.exampleCode
      ? { exampleCode: f.exampleCode, edgeCases: true }
      : effective === "version" && f.currentVersion
        ? {
            expression: f.currentVersion.expression,
            variables: f.currentVersion.variables.map((v) => ({
              name: v.name,
              kind: v.kind,
              unit: v.unit,
              currency: v.currency,
              period: v.period,
              value: v.value,
            })),
            edgeCases: true,
          }
        : null;
  const preview = useFormulaPreview(body);
  return (
    <div className="page" data-p5-screen="formula-preview">
      <PageHeader
        title={t("launchHealthP5.preview.title")}
        subtitle={f ? `${f.code} · ${f.benefitName}` : undefined}
        crumbs={[
          { label: transformation.data?.name ?? t("launchHealthP5.transformation"), to: `/transformations/${id}` },
          { label: t("launchHealthP5.preview.formulas"), to: `/transformations/${id}/benefit-formulas` },
          {
            label: f?.code ?? t("launchHealthP5.preview.formula"),
            to: `/transformations/${id}/benefit-formulas/${formulaId}`,
          },
          { label: t("launchHealthP5.preview.title") },
        ]}
      />
      <Notice state="preview-only">{t("launchHealthP5.preview.nothingStored")}</Notice>
      <QueryState query={formula}>
        {(fm) => (
          <>
            {fm.currentVersion && fm.exampleCode ? (
              <fieldset className="field" data-preview-mode={effective ?? ""}>
                <legend className="field__label">{t("launchHealthP5.preview.source")}</legend>
                {(["version", "example"] as const).map((m) => (
                  <label key={m} className="radio">
                    <input type="radio" name="preview-mode" checked={effective === m} onChange={() => setMode(m)} />{" "}
                    {m === "version"
                      ? t("launchHealthP5.preview.fromVersion", { n: fm.currentVersionNo ?? 0 })
                      : t(`launchHealthP5.preview.fromExample.${fm.exampleCode}`)}
                  </label>
                ))}
              </fieldset>
            ) : null}
            {body === null ? (
              <p className="muted" data-state="no-version">
                {t("launchHealthP5.preview.noVersion")}{" "}
                <Link className="link" to={`/transformations/${id}/benefit-formulas/${formulaId}`}>
                  {t("launchHealthP5.preview.openFormula")}
                </Link>
              </p>
            ) : (
              <QueryState query={preview}>{(r) => <PreviewResult r={r} />}</QueryState>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}

function useResultFormatter(r: FormulaPreviewResult) {
  const locale = useLocale();
  return (v: string | null) =>
    v === null
      ? null
      : r.unit.kind === "currency" && r.unit.currency
        ? formatMoney(v, r.unit.currency, locale)
        : formatDecimal(v, locale, { maxFractionDigits: 6 });
}

function ReasonText({ code }: { code: string | null }) {
  const { t } = useTranslation();
  if (!code) return null;
  const key = code.replace(/\./g, "__");
  return (
    <span className="block small" data-reason={code}>
      {t(`benefitFormulas.problems.${key}`, {
        defaultValue: t(`problems.${key}`, { defaultValue: t("launchHealthP5.notComputable") }),
      })}
    </span>
  );
}

/** The unit of the result: kind, currency (e.g. SAR) and period; the engine's propagated unit label is not shown. */
export function UnitText({ unit }: { unit: FormulaPreviewResult["unit"] }) {
  const { t } = useTranslation();
  if (!unit.kind) return <span className="muted">{t("common.value.unknown")}</span>;
  const kind = t(`benefitFormulas.kind.${unit.kind}`, { defaultValue: unit.kind });
  const period = unit.period && unit.period !== "none" ? t(`launchHealthP5.preview.period.${unit.period}`) : null;
  return (
    <span data-unit-kind={unit.kind} data-unit-currency={unit.currency ?? ""}>
      {unit.kind === "currency" && unit.currency ? (
        <strong>
          <bdi dir="ltr">{unit.currency}</bdi>
        </strong>
      ) : (
        <strong>{kind}</strong>
      )}
      {period ? ` · ${period}` : ""}
    </span>
  );
}

function PreviewResult({ r }: { r: FormulaPreviewResult }) {
  const { t } = useTranslation();
  const fmt = useResultFormatter(r);
  return (
    <>
      <section className="card" aria-labelledby="preview-unit" data-valid={String(r.valid)}>
        <h2 id="preview-unit" className="card__title">
          {r.valid ? (
            <Chip tone="good" icon="check" label={t("launchHealthP5.preview.valid")} data="valid" />
          ) : (
            <Chip tone="bad" icon="cross" label={t("launchHealthP5.preview.invalid")} data="invalid" />
          )}
        </h2>
        <dl className="workspace-header__grid">
          <dt>{t("launchHealthP5.preview.unit")}</dt>
          <dd data-field="unit">
            <UnitText unit={r.unit} />
          </dd>
          <dt>{t("launchHealthP5.preview.engine")}</dt>
          <dd>
            <bdi dir="ltr">{r.engineVersion}</bdi>
          </dd>
        </dl>
        {r.errors.length > 0 ? (
          <ul className="plain-list" data-errors={r.errors.length}>
            {r.errors.map((e, i) => (
              <li key={`${e.code}-${i}`}>
                <ReasonText code={e.code} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <Section id="examples" title={t("launchHealthP5.preview.examples")}>
        {r.examples.length === 0 ? (
          <p className="muted">{t("launchHealthP5.preview.noExamples")}</p>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("launchHealthP5.preview.examples")}>
            <table className="table" data-table="preview-examples">
              <caption className="visually-hidden">{t("launchHealthP5.preview.examples")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("launchHealthP5.preview.example")}</th>
                  <th scope="col">{t("launchHealthP5.preview.inputs")}</th>
                  <th scope="col">{t("launchHealthP5.preview.result")}</th>
                </tr>
              </thead>
              <tbody>
                {r.examples.map((x) => (
                  <tr key={x.label} data-example={x.label} data-status={x.status}>
                    <th scope="row">{x.label}</th>
                    <td className="small">
                      {Object.entries(x.inputs)
                        .map(([k, v]) => `${k} = ${v ?? t("common.value.unknown")}`)
                        .join("; ")}
                    </td>
                    <td>
                      {x.status === "ok" && x.result !== null ? (
                        <span data-result={x.result}>{fmt(x.result)}</span>
                      ) : (
                        <>
                          <NotComputable />
                          <ReasonText code={x.reasonCode} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Section
        id="edge-cases"
        title={t("launchHealthP5.preview.edgeCases")}
        intro={t("launchHealthP5.preview.edgeCasesIntro")}
      >
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t("launchHealthP5.preview.edgeCases")}>
          <table className="table" data-table="preview-edge-cases">
            <caption className="visually-hidden">{t("launchHealthP5.preview.edgeCases")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("launchHealthP5.preview.variable")}</th>
                <th scope="col">{t("launchHealthP5.preview.case")}</th>
                <th scope="col">{t("launchHealthP5.preview.result")}</th>
              </tr>
            </thead>
            <tbody>
              {r.edgeCases.map((e) => (
                <tr key={`${e.variable}:${e.case}`} data-edge={`${e.variable}:${e.case}`} data-status={e.status}>
                  <th scope="row">
                    <bdi dir="ltr" className="code">
                      {e.variable}
                    </bdi>
                  </th>
                  <td>{t(`launchHealthP5.preview.caseKind.${e.case}`)}</td>
                  <td>
                    {e.status === "ok" && e.result !== null ? (
                      <span data-result={e.result}>{fmt(e.result)}</span>
                    ) : (
                      <>
                        <NotComputable />
                        <ReasonText code={e.reasonCode} />
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
