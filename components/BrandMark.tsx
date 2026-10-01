type Props = { className?: string };

/**
 * Saigon Technology's mark. The green strokes are fixed; the other pair takes the current
 * text colour, so the mark works on light and dark surfaces.
 */
export function BrandMark({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 36.2069 48" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M18.1034 0V5.64706L6.03448 16.9412H0L18.1034 0ZM36.2069 31.0588L18.1034 48V42.3529L30.1724 31.0588H36.2069Z"
      />
      <path
        fill="#8DC63F"
        d="M6.03448 16.9407L18.1034 28.2348V33.8819L0 16.9407H6.03448ZM18.1034 14.1172L36.2069 31.0584H30.1724L18.1034 19.7642V14.1172Z"
      />
    </svg>
  );
}
