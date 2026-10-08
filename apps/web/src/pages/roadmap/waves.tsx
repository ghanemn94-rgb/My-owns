// Wave editing on the roadmap (T-DG3-FE-E; ADR-0023 §1; REQ-PB-050). SYNTHETIC data in tests.
//  - Edit a wave's planned start and end, owner and notes (`roadmap.edit`, If-Match, 409 conflict panel). These are
//    the editable columns the API accepts (contract `RoadmapWaveUpdate`).
//  - The verbatim B0079 source text of a seeded wave (name, purpose, horizon, entry criteria, exit evidence) is NEVER
//    editable: it is shown read-only in the dialog. ADR-0023 §1 also names EN/AR label overrides, but neither the
//    contract nor the API accepts them yet (reported in the T-DG3-FE-E handback), so no override control is offered.
//  - Add a non-source wave (`isSourceSeeded = false`) with its bilingual texts and horizon weeks.
//  - Overlapping planned dates and horizons are accepted (planning horizons, not deadlines). A planned end before the
//    planned start is 422 `roadmap_wave.planned_range` at /plannedEnd, shown inline and translated.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useP3Refresh } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { usePeople } from "../../components/People.tsx";
import { RecordDialog, type FieldSpec } from "../../components/RecordForm.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import type { RoadmapWave } from "./api.ts";

/** Wave problem codes (`roadmap.problem.roadmap_wave__*`) are translated from the roadmap namespace first. */
export const ROADMAP_NS: readonly string[] = ["roadmap"];

const waveUrl = (tid: string, id: string) => `/api/v1/transformations/${tid}/waves/${id}`;

export function useWaveEditing() {
  const { tid, can } = useWorkspace();
  return { canEdit: can("roadmap.edit"), tid };
}

export function AddWaveButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="button button--secondary button--small" data-action="add-wave" onClick={onClick}>
      <Icon name="plus" /> {t("roadmap.waves.add")}
    </button>
  );
}

export function EditWaveDialog({ wave, onClose }: { wave: RoadmapWave; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { tid } = useWorkspace();
  const { people } = usePeople(tid);
  const refresh = useP3Refresh(tid);
  const fields: FieldSpec[] = [
    { name: "plannedStart", kind: "date", label: t("roadmap.waves.plannedStart") },
    {
      name: "plannedEnd",
      kind: "date",
      label: t("roadmap.waves.plannedEnd"),
      hint: t("roadmap.waves.overlapHint"),
    },
    { name: "ownerUserId", kind: "person", label: t("roadmap.waves.owner") },
    { name: "notes", kind: "textarea", label: t("roadmap.waves.notes"), maxLength: 4000 },
  ];
  const name = locale === "ar" ? wave.nameAr : wave.nameEn;
  return (
    <RecordDialog<RoadmapWave>
      title={t("roadmap.waves.editTitle", { name })}
      fields={fields}
      record={wave}
      updateUrl={(w) => waveUrl(tid, w.id)}
      people={people}
      namespaces={ROADMAP_NS}
      submitLabel={t("common.action.save")}
      onSaved={async () => {
        if (!(await refresh())) return;
        onClose();
      }}
      onCancel={onClose}
    >
      <section className="banner banner--info" role="note" data-state="wave-source" aria-labelledby="wave-source-title">
        <h3 id="wave-source-title" className="card__subtitle">
          <Icon name="lock" />{" "}
          {wave.isSourceSeeded ? t("roadmap.waves.sourceReadOnly") : t("roadmap.waves.textReadOnly")}
        </h3>
        <dl className="summary-list">
          {(["name", "purpose", "horizon", "entryCriteria", "exitEvidence"] as const).map((f) => (
            <div key={f}>
              <dt>{t(`roadmap.waves.field.${f}`)}</dt>
              <dd>
                <span lang="en" dir="ltr" className="block">
                  {wave[`${f}En`]}
                </span>
                <span lang="ar" dir="rtl" className="block muted">
                  {wave[`${f}Ar`]}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </RecordDialog>
  );
}

export function AddWaveDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { tid } = useWorkspace();
  const { people } = usePeople(tid);
  const refresh = useP3Refresh(tid);
  const text = (name: string, max: number, lang: "en" | "ar", kind: "text" | "textarea" = "text"): FieldSpec => ({
    name,
    kind,
    label: t(`roadmap.waves.create.${name}`),
    required: true,
    maxLength: max,
    dir: lang === "en" ? "ltr" : "rtl",
  });
  const fields: FieldSpec[] = [
    {
      name: "code",
      kind: "text",
      label: t("roadmap.waves.create.code"),
      hint: t("roadmap.waves.create.codeHint"),
      required: true,
      maxLength: 48,
      dir: "ltr",
    },
    text("nameEn", 200, "en"),
    text("nameAr", 200, "ar"),
    text("purposeEn", 500, "en", "textarea"),
    text("purposeAr", 500, "ar", "textarea"),
    text("horizonEn", 100, "en"),
    text("horizonAr", 100, "ar"),
    {
      name: "horizonFromWeeks",
      kind: "integer",
      label: t("roadmap.waves.create.horizonFromWeeks"),
      required: true,
      min: 0,
      max: 520,
    },
    {
      name: "horizonToWeeks",
      kind: "integer",
      label: t("roadmap.waves.create.horizonToWeeks"),
      required: true,
      min: 0,
      max: 520,
    },
    text("entryCriteriaEn", 500, "en", "textarea"),
    text("entryCriteriaAr", 500, "ar", "textarea"),
    text("exitEvidenceEn", 500, "en", "textarea"),
    text("exitEvidenceAr", 500, "ar", "textarea"),
    { name: "plannedStart", kind: "date", label: t("roadmap.waves.plannedStart") },
    { name: "plannedEnd", kind: "date", label: t("roadmap.waves.plannedEnd"), hint: t("roadmap.waves.overlapHint") },
    { name: "ownerUserId", kind: "person", label: t("roadmap.waves.owner") },
  ];
  return (
    <RecordDialog
      title={t("roadmap.waves.addTitle")}
      description={t("roadmap.waves.addBody")}
      fields={fields}
      record={null}
      createUrl={`/api/v1/transformations/${tid}/waves`}
      people={people}
      namespaces={ROADMAP_NS}
      submitLabel={t("roadmap.waves.add")}
      onSaved={async () => {
        if (!(await refresh())) return;
        onClose();
      }}
      onCancel={onClose}
    />
  );
}

/** State of the waves section's dialogs (edit one wave, or add a non-source wave). */
export function useWaveDialogs() {
  const [editing, setEditing] = useState<RoadmapWave | null>(null);
  const [adding, setAdding] = useState(false);
  return { editing, setEditing, adding, setAdding };
}
