// Shared helpers for the administration screens.
import { useTranslation } from "react-i18next";
import { LOCALES } from "@mth/shared";
import type { UseFormRegisterReturn } from "react-hook-form";
import { ConflictPanel, type ConflictRow } from "../../components/States.tsx";
import type { Conflict } from "../../components/useVersionedSave.ts";
import { Field } from "../../components/Form.tsx";

/** Changed fields between two flat string forms; "" -> null for the nullable keys given. */
export function diffForm<V extends Record<string, string>>(
  base: V,
  values: V,
  nullable: readonly (keyof V)[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(values) as (keyof V)[]) {
    const a = (base[key] ?? "").trim();
    const b = (values[key] ?? "").trim();
    if (a !== b) out[key as string] = b === "" && nullable.includes(key) ? null : b;
  }
  return out;
}

export function conflictRowsFor<V extends Record<string, string>>(
  labels: Record<keyof V & string, string>,
  mine: Record<string, unknown>,
  latest: V | null,
  none: string,
  unknown: string,
): ConflictRow[] {
  return Object.entries(mine).map(([field, value]) => ({
    field,
    label: labels[field as keyof V & string] ?? field,
    mine: value === null || value === "" ? none : String(value),
    current: latest ? latest[field as keyof V] || none : unknown,
  }));
}

export function AdminConflict<V extends Record<string, string>>({
  conflict,
  baseVersion,
  labels,
  mine,
  latestValues,
  busy,
  onReapply,
  onDiscard,
}: {
  conflict: Conflict<unknown>;
  baseVersion: number;
  labels: Record<keyof V & string, string>;
  mine: Record<string, unknown>;
  latestValues: V | null;
  busy: boolean;
  onReapply: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ConflictPanel
      yourVersion={baseVersion}
      currentVersion={conflict.currentVersion}
      rows={conflictRowsFor(labels, mine, latestValues, t("common.value.none"), t("common.value.unknown"))}
      busy={busy}
      {...(conflict.latest ? { onReapply } : {})}
      onDiscard={onDiscard}
    />
  );
}

export function LocaleSelect({
  label,
  error,
  registration,
}: {
  label: string;
  error?: string;
  registration: UseFormRegisterReturn;
}) {
  const { t } = useTranslation();
  return (
    <Field label={label} error={error}>
      {(c) => (
        <select {...c} {...registration}>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {t(`common.language.name.${l}`)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
