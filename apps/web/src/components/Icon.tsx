// Small inline SVG icon set (no icon font, no remote assets). Icons are decorative (aria-hidden): every status and
// action also carries a text label, so meaning never depends on colour or shape alone (REQ-S15-012).
const PATHS = {
  check: "M4 10.5l4 4 8-9",
  alert: "M10 3l8 14H2L10 3zm0 5v4m0 3v.5",
  cross: "M5 5l10 10M15 5L5 15",
  question: "M7.5 7.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V12m0 3v.5",
  clock: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm0 3v4l3 2",
  pencil: "M4 16l1-4 8-8 3 3-8 8-4 1zm7-10l3 3",
  pause: "M7 4v12M13 4v12",
  stop: "M5 5h10v10H5z",
  archive: "M3 4h14v3H3zm1 3v9h12V7M8 10h4",
  lock: "M6 9V6a4 4 0 0 1 8 0v3M4 9h12v8H4z",
  dot: "M10 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  plus: "M10 4v12M4 10h12",
  menu: "M3 5h14M3 10h14M3 15h14",
  chevronUp: "M5 12l5-5 5 5",
  chevronDown: "M5 8l5 5 5-5",
  sort: "M6 8l4-4 4 4M6 12l4 4 4-4",
  info: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm0 6v5m0-8v.5",
  refresh: "M16 10a6 6 0 1 1-2-4.5M16 3v4h-4",
  columns: "M3 4h14v12H3zM8 4v12M13 4v12",
  signOut: "M8 4H4v12h4M12 6l4 4-4 4M16 10H8",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      viewBox="0 0 20 20"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
