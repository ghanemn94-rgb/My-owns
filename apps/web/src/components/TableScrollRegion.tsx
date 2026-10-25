// The scroll container of a table (T-DG5-FE-X1, F-DG5-142; REQ-S15-012, REQ-S02-001; axe
// 'scrollable-region-focusable'). A table wider than its column scrolls horizontally inside `.table-wrap`; this makes
// that container reachable by keyboard (tabIndex 0, so the arrow keys scroll it) and a region named by the table's
// localized caption plus "(scrollable table)" (common.table.scrollRegion), in en and ar. It is the markup T-DG5-FE-V1
// gave the shared DataTable and RegisterTable; every page that renders its own <table> wraps it in this component.
import type { HTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface TableScrollRegionProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "role" | "tabIndex" | "aria-label"
> {
  /** The table's caption, as shown (or visually hidden) in its <caption>; names the region. */
  caption: string;
  children: ReactNode;
}

export function TableScrollRegion({ caption, children, className, ...rest }: TableScrollRegionProps) {
  const { t } = useTranslation();
  return (
    <div
      {...rest}
      className={className ? `table-wrap ${className}` : "table-wrap"}
      tabIndex={0}
      role="region"
      aria-label={t("common.table.scrollRegion", { caption })}
    >
      {children}
    </div>
  );
}
