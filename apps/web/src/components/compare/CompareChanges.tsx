// The compare-and-reapply panel of a 409 (T-DG6-FE-D2; ADR-0057 §7, §9; REQ-S16-026 A14, REQ-S15-011 "conflict").
// Nothing was saved. One compare table lists, field by field, the value when the user opened the record (B), the
// user's unsaved value (M) and the current saved value (C), and what happens to the field:
//  - "my change" (M ≠ B only): saved when the user re-applies;
//  - "their change" (C ≠ B only): kept as it is and never sent, so the first change stays intact;
//  - "changed by both" (both, different values): the user picks "keep mine" or "keep theirs"; re-apply waits until
//    every such field has a choice; "keep theirs" leaves the field out of the request;
//  - "same value on both sides": nothing to send.
// Re-apply sends a PATCH with If-Match of the current version (the caller does it, with the keys given). Text labels
// and icons carry every state; nothing relies on colour. Values are text; an empty value is "None", never 0.
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../Icon.tsx";
import { TableScrollRegion } from "../TableScrollRegion.tsx";
import {
  allResolved,
  reapplyKeys,
  threeWay,
  type FieldValues,
  type Resolution,
  type ThreeWayResult,
} from "./threeWay.ts";
import "./compare.css";

export interface CompareField {
  readonly key: string;
  readonly label: string;
  /** The value as display text; the panel shows "None" for an empty text. */
  readonly display?: (value: unknown) => string;
}

export interface CompareChangesProps {
  readonly fields: readonly CompareField[];
  /** B: the record as the user loaded it. */
  readonly base: FieldValues;
  /** M: the user's edited values. */
  readonly mine: FieldValues;
  /** C: the current record (fresh GET); null when it could not be loaded (only discard is offered). */
  readonly current: FieldValues | null;
  readonly yourVersion: number | null;
  readonly currentVersion: number | null;
  readonly busy?: boolean;
  /** Called with the field keys to send (my changes plus the conflicts resolved "mine"). */
  readonly onReapply: (keys: string[], result: ThreeWayResult) => void;
  readonly onDiscard: () => void;
  /** Heading level of the panel title (2 on a page, 3 inside a dialog or a section). */
  readonly headingLevel?: 2 | 3 | 4;
  /** A note for fields outside this panel (e.g. the inline editor: "other fields they changed are kept"). */
  readonly note?: string;
}

type Group = "mine" | "theirs" | "conflict" | "agreed";

export function CompareChanges(props: CompareChangesProps) {
  const { t } = useTranslation();
  const id = useId();
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const keys = props.fields.map((f) => f.key);
  const result = props.current ? threeWay(keys, props.base, props.mine, props.current) : null;
  const groupOf = new Map<string, Group>();
  if (result) {
    for (const k of result.mine) groupOf.set(k, "mine");
    for (const k of result.theirs) groupOf.set(k, "theirs");
    for (const k of result.conflicts) groupOf.set(k, "conflict");
    for (const k of result.agreed) groupOf.set(k, "agreed");
  }
  const rows = props.fields.filter((f) => groupOf.has(f.key));
  const text = (f: CompareField, v: unknown): string => {
    const s = f.display ? f.display(v) : v === null || v === undefined ? "" : String(v);
    return s === "" ? t("common.value.none") : s;
  };
  const send = result ? reapplyKeys(result, resolutions) : null;
  const Heading = `h${props.headingLevel ?? 3}` as "h2" | "h3" | "h4";
  const caption = t("common.conflict.compareCaption");

  const outcome = (f: CompareField, group: Group) => {
    if (group !== "conflict")
      return (
        <span className="compare__outcome">
          <Icon name={group === "mine" ? "pencil" : group === "theirs" ? "lock" : "check"} />{" "}
          {t(`productivity.compare.outcome_${group}`)}
        </span>
      );
    return (
      <fieldset className="compare__choice">
        <legend>
          <Icon name="alert" /> {t("productivity.compare.choose", { field: f.label })}
        </legend>
        {(["mine", "theirs"] as const).map((side) => (
          <label key={side} className="compare__option">
            <input
              type="radio"
              name={`${id}-${f.key}`}
              value={side}
              checked={resolutions[f.key] === side}
              onChange={() => setResolutions((r) => ({ ...r, [f.key]: side }))}
              disabled={props.busy}
            />
            <span>{side === "mine" ? t("productivity.compare.keepMine") : t("productivity.compare.keepTheirs")}</span>
          </label>
        ))}
      </fieldset>
    );
  };

  return (
    <section
      className="banner banner--warning conflict compare"
      role="alert"
      aria-labelledby={`${id}-title`}
      data-state="conflict"
    >
      <Heading id={`${id}-title`} className="conflict__title">
        <Icon name="alert" /> {t("common.conflict.title")}
      </Heading>
      <p>{t("common.conflict.lead")}</p>
      <p className="small">
        {t("common.conflict.body", {
          yours: props.yourVersion ?? t("common.value.unknown"),
          current: props.currentVersion ?? t("common.value.unknown"),
        })}
      </p>
      {props.note ? <p className="small">{props.note}</p> : null}
      {!result ? (
        <p data-compare="no-latest">{t("productivity.compare.noLatest")}</p>
      ) : rows.length > 0 ? (
        <TableScrollRegion caption={caption}>
          <table className="table table--compact">
            <caption>{caption}</caption>
            <thead>
              <tr>
                <th scope="col">{t("common.conflict.field")}</th>
                <th scope="col">{t("productivity.compare.before")}</th>
                <th scope="col">{t("common.conflict.mine")}</th>
                <th scope="col">{t("common.conflict.current")}</th>
                <th scope="col">{t("productivity.compare.outcome")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const group = groupOf.get(f.key)!;
                return (
                  <tr key={f.key} data-field={f.key} data-compare-group={group}>
                    <th scope="row">{f.label}</th>
                    <td>{text(f, props.base[f.key])}</td>
                    <td>{text(f, props.mine[f.key])}</td>
                    <td>{text(f, props.current?.[f.key])}</td>
                    <td>{outcome(f, group)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScrollRegion>
      ) : null}
      {result && !allResolved(result, resolutions) ? (
        <p className="small" data-compare="unresolved">
          <Icon name="info" /> {t("productivity.compare.unresolved")}
        </p>
      ) : send !== null && send.length === 0 ? (
        <p className="small" data-compare="nothing-to-send">
          <Icon name="info" /> {t("productivity.compare.nothingToSend")}
        </p>
      ) : null}
      <div className="form__actions">
        {result ? (
          <button
            type="button"
            className="button button--primary"
            onClick={() => send && send.length > 0 && props.onReapply(send, result)}
            disabled={props.busy || send === null || send.length === 0}
          >
            {t("common.conflict.reapply")}
          </button>
        ) : null}
        <button type="button" className="button button--secondary" onClick={props.onDiscard} disabled={props.busy}>
          {t("common.conflict.discard")}
        </button>
      </div>
    </section>
  );
}
