/*
 * Stroke icons drawn with mitred corners, so they share the hard angles of the company mark
 * instead of the rounded look of a stock icon set.
 */
const PATHS = {
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13 7l4 4'],
  delete: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v5', 'M14 11v5'],
  resolve: ['M5 12.5l4.5 4.5L19 7'],
  reopen: ['M4 4v5h5', 'M4.6 9A8 8 0 1 1 4 13'],
  flag: ['M6 21V4', 'M6 4h12l-3 4.5L18 13H6'],
  goto: ['M4 12h14', 'M13 6l6 6-6 6'],
  external: ['M14 4h6v6', 'M20 4l-8 8', 'M17 14v6H4V7h6'],
  workflow: ['M5 6h4v4H5z', 'M15 14h4v4h-4z', 'M9 8h3v8h3'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

type IconButtonProps = {
  icon: IconName;
  label: string;
  tone?: 'danger' | 'confirm';
  onClick: () => void;
};

/** A square button that shows only an icon; its label is the accessible name and the tooltip. */
export function IconButton({ icon, label, tone, onClick }: IconButtonProps) {
  return (
    <button
      type="button"
      className={tone ? `icon-button icon-button--${tone}` : 'icon-button'}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}
