// The explanation panel (T-DG6-FE-F; ADR-0061 §8; REQ-S15-014 "every calculated value offers an explanation panel with
// inputs, formula in words and period"). One component for every calculated value: a disclosure button with an
// accessible name that names the value, and, when open, the formula in words, the period, the version, the inputs table
// and the state. It is read-only for every role (the AUD user sees exactly what others see; nothing in it writes).
//
// It never computes a business number: the rows are the server's decimals and the KBE-B view models
// (`@mth/shared/calc` explain*), formatted for display only. Unknown, incomplete, not computable and n/a are states with a
// text label and an icon, never 0 and never a favourable (green) status; "Calculated" is a neutral chip, not a status.
import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../Icon.tsx";
import "./explanation.css";

export type ExplanationState = "complete" | "incomplete" | "unknown" | "notComputable" | "disabled";

/** The state chip: neutral when calculated; the Unknown status token (with its icon and label) otherwise. */
export function ExplanationStateChip({ state }: { state: ExplanationState }) {
  const { t } = useTranslation();
  const label = t(`explanations.panel.state.${state}`);
  if (state === "complete")
    return (
      <span className="lifecycle-chip lifecycle-chip--active" data-explanation-state={state}>
        <Icon name="dot" /> {label}
      </span>
    );
  return (
    <span className="status-chip status-chip--unknown" data-health="unknown" data-explanation-state={state}>
      <Icon name="question" /> {label}
    </span>
  );
}

export interface ExplanationColumn {
  readonly key: string;
  readonly label: string;
  /** Numbers are right-aligned in the reading direction and isolated as LTR runs. */
  readonly numeric?: boolean;
}

export interface ExplanationTable {
  readonly caption: string;
  readonly columns: readonly ExplanationColumn[];
  readonly rows: readonly { readonly key: string; readonly cells: Readonly<Record<string, ReactNode>> }[];
  readonly foot?: { readonly key: string; readonly cells: Readonly<Record<string, ReactNode>> } | undefined;
}

export interface ExplanationPanelProps {
  /** A stable id for test hooks and `data-explanation`: e1 … e5. */
  readonly kind: string;
  /** The value's name inside a sentence ("weighted score"); used in the button and heading. */
  readonly valueName: string;
  readonly state: ExplanationState;
  /** The formula in words: one paragraph per sentence block. */
  readonly formula: readonly string[];
  readonly period: ReactNode;
  /** The version the value was calculated with; null when the value has none (E2: each line has its own period). */
  readonly version: ReactNode | null;
  /** One sentence about the state when it is not complete (incomplete criteria, the unknown reason). */
  readonly stateText?: string | null | undefined;
  readonly tables?: readonly ExplanationTable[] | undefined;
  /** Facts below the tables (totals, the score, the band). */
  readonly facts?: readonly { readonly key: string; readonly node: ReactNode }[] | undefined;
  readonly defaultOpen?: boolean | undefined;
}

export function ExplanationPanel(props: ExplanationPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const id = useId();
  const panelId = `explanation-${props.kind}-${id}`;
  const headingId = `${panelId}-title`;
  return (
    <div className="explanation" data-explanation={props.kind} data-explanation-state={props.state}>
      <button
        type="button"
        className="button button--small button--secondary explanation__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="info" />{" "}
        {open
          ? t("explanations.panel.hide", { value: props.valueName })
          : t("explanations.panel.show", { value: props.valueName })}
      </button>
      <div id={panelId} role="region" aria-labelledby={headingId} className="explanation__panel" hidden={!open}>
        {open ? (
          <>
            <h3 id={headingId} className="explanation__title">
              {t("explanations.panel.title", { value: props.valueName })} <ExplanationStateChip state={props.state} />
            </h3>
            {props.stateText ? (
              <p className="explanation__state" data-explanation-state-text="">
                {props.stateText}
              </p>
            ) : null}
            <dl className="explanation__facts">
              <dt>{t("explanations.panel.formula")}</dt>
              <dd data-explanation-formula="">
                {props.formula.map((sentence, i) => (
                  <p key={i}>{sentence}</p>
                ))}
              </dd>
              <dt>{t("explanations.panel.period")}</dt>
              <dd data-explanation-period="">{props.period}</dd>
              {props.version !== null ? (
                <>
                  <dt>{t("explanations.panel.version")}</dt>
                  <dd data-explanation-version="">{props.version}</dd>
                </>
              ) : null}
            </dl>
            {(props.tables ?? []).map((table) => (
              <div key={table.caption} className="table-wrap" tabIndex={0} role="region" aria-label={table.caption}>
                <table className="table table--compact" data-explanation-inputs="">
                  <caption>{table.caption}</caption>
                  <thead>
                    <tr>
                      {table.columns.map((c) => (
                        <th key={c.key} scope="col" className={c.numeric ? "num" : undefined}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((r) => (
                      <tr key={r.key} data-row={r.key}>
                        {table.columns.map((c, i) =>
                          i === 0 ? (
                            <th key={c.key} scope="row">
                              {r.cells[c.key]}
                            </th>
                          ) : (
                            <td key={c.key} className={c.numeric ? "num" : undefined}>
                              {r.cells[c.key]}
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                  {table.foot ? (
                    <tfoot>
                      <tr data-row={table.foot.key}>
                        {table.columns.map((c, i) =>
                          i === 0 ? (
                            <th key={c.key} scope="row">
                              {table.foot!.cells[c.key]}
                            </th>
                          ) : (
                            <td key={c.key} className={c.numeric ? "num" : undefined}>
                              {table.foot!.cells[c.key]}
                            </td>
                          ),
                        )}
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
            ))}
            {props.facts && props.facts.length > 0 ? (
              <ul className="plain-list explanation__list">
                {props.facts.map((f) => (
                  <li key={f.key} data-fact={f.key}>
                    {f.node}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="small muted">{t("explanations.panel.readOnly")}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** A number (already formatted for display) as an LTR isolate, so digits and signs keep their order in Arabic. */
export function Num({ children }: { children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}

/** A missing value: an explicit label and icon, never 0 or a blank. */
export function NoValue({ label }: { label: string }) {
  return (
    <span className="status-chip status-chip--unknown" data-health="unknown">
      <Icon name="question" /> {label}
    </span>
  );
}
