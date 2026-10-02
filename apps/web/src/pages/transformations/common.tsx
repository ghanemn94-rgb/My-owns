// Shared bits of the transformation screens.
import { useTranslation } from "react-i18next";
import { PHASES, type Phase } from "@mth/shared";
import { useBusinessUnits, useUser } from "../../api/queries.ts";
import type { BusinessUnit, Transformation } from "../../api/types.ts";
import { localName, useLocale } from "../../app/locale.ts";
import { Unknown } from "../../components/Badges.tsx";
import { useMe } from "../../auth/session.tsx";
import { ancestryOf, type PermissionTarget } from "../../auth/permissions.ts";

/** Business units of the caller's organization, by id (for names and permission ancestry). */
export function useBusinessUnitIndex(): {
  units: readonly BusinessUnit[];
  byId: ReadonlyMap<string, BusinessUnit>;
  loaded: boolean;
} {
  const me = useMe();
  const q = useBusinessUnits(me.organization.id);
  const units = q.data ?? [];
  return { units, byId: new Map(units.map((u) => [u.id, u])), loaded: q.isSuccess };
}

/** The permission target of one transformation (with its business-unit ancestry, for downward-inheriting grants). */
export function useTransformationTarget(t: Transformation | undefined): PermissionTarget | null {
  const bu = useBusinessUnitIndex();
  if (!t) return null;
  return {
    level: "transformation",
    organizationId: t.organizationId,
    businessUnitId: t.businessUnitId,
    transformationId: t.id,
    businessUnitAncestry: ancestryOf(t.businessUnitId, bu.units),
  };
}

export function BusinessUnitName({ id, index }: { id: string; index: ReadonlyMap<string, BusinessUnit> }) {
  const locale = useLocale();
  const unit = index.get(id);
  if (!unit) return <Unknown />;
  return (
    <span>
      {localName(unit, locale)}{" "}
      <bdi dir="ltr" className="code">
        {unit.code}
      </bdi>
    </span>
  );
}

/**
 * A user's display name; "Not assigned" for null, Unknown when the caller may not read the user. The signed-in user's
 * own name comes from the session (no user.read needed), e.g. the creator in a derived-assignment audit event.
 */
export function UserName({ id }: { id: string | null }) {
  const { t } = useTranslation();
  const me = useMe();
  const self = id !== null && id === me.user.id;
  const q = useUser(self ? null : id);
  if (!id) return <span className="muted">{t("common.value.notAssigned")}</span>;
  if (self) return <span>{me.user.displayName}</span>;
  if (q.isPending) return <span className="muted">{t("common.state.loading")}</span>;
  if (q.data) return <span>{q.data.displayName}</span>;
  return <Unknown hint={t("common.value.notVisible")} />;
}

/** The six playbook phases as a stepper; the current phase is marked with aria-current="step" and a text label. */
export function PhaseStepper({ current, entry }: { current: Phase; entry: Phase | null }) {
  const { t } = useTranslation();
  const currentIndex = PHASES.indexOf(current);
  return (
    <ol className="phase-stepper" aria-label={t("transformations.field.currentPhase")}>
      {PHASES.map((p, i) => (
        <li
          key={p}
          className={`phase-stepper__step${i === currentIndex ? " phase-stepper__step--current" : ""}${
            i < currentIndex ? " phase-stepper__step--done" : ""
          }`}
          aria-current={i === currentIndex ? "step" : undefined}
        >
          <span className="phase-stepper__num">{i + 1}</span>
          <span className="phase-stepper__label">{t(`transformations.phase.${p}`)}</span>
          {i === currentIndex ? <span className="visually-hidden"> ({t("transformations.currentMarker")})</span> : null}
          {entry === p ? <span className="phase-stepper__entry">{t("transformations.entryMarker")}</span> : null}
        </li>
      ))}
    </ol>
  );
}
