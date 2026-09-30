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

export function Wordmark({ productName, linkTo = "/" }: { productName?: string | null; linkTo?: string }) {
  const { t } = useTranslation();
  const name = useProductName(productName);
  return (
    <Link to={linkTo} className="wordmark" data-testid="wordmark">
      <span className="wordmark__name">{name}</span>
      <span
        className="badge badge--provisional"
        title={t("common.brand.provisionalHint")}
        data-testid="provisional-badge"
      >
        {t("common.brand.provisional")}
      </span>
      <span className="visually-hidden">{t("common.brand.provisionalHint")}</span>
    </Link>
  );
}
