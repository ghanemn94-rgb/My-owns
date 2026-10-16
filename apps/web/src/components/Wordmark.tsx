// Provisional TEXT wordmark (REQ-S15-006, ADR-0009 §5). No official Mobily logo has been supplied, so the header
// shows the configurable product name as plain text with a visible "Provisional" badge. No logo image, glyph or
// imitation of Mobily marks exists in this repository.
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { DEFAULTS } from "@mth/shared";

/** The configured name (REQ-S01-002); the default name is shown in the current language. */
export function useProductName(configured?: string | null): string {
  const { t } = useTranslation();
  return !configured || configured === DEFAULTS.productName ? t("common.brand.productName") : configured;
}

export function Wordmark({
  productName,
  linkTo = "/",
  logo = null,
}: {
  productName?: string | null;
  linkTo?: string;
  /** T-DG5-FE-G (ADR-0049 §8): the uploaded PNG logo of the current branding version; none = the provisional wordmark. */
  logo?: { readonly url: string; readonly alt: string } | null;
}) {
  const { t } = useTranslation();
  const name = useProductName(productName);
  return (
    <Link to={linkTo} className="wordmark" data-testid="wordmark">
      {logo ? <img className="wordmark__logo" src={logo.url} alt={logo.alt} style={{ maxBlockSize: "2rem" }} /> : null}
      <span className="wordmark__name">{name}</span>
      {logo ? null : (
        <span
          className="badge badge--provisional"
          title={t("common.brand.provisionalHint")}
          data-testid="provisional-badge"
        >
          {t("common.brand.provisional")}
        </span>
      )}
      {logo ? null : <span className="visually-hidden">{t("common.brand.provisionalHint")}</span>}
    </Link>
  );
}
