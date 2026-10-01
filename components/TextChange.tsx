type Props = { before: string; after: string; className?: string };

/** A text replacement: the old text struck through, then the new text. */
export function TextChange({ before, after, className }: Props) {
  return (
    <span className={className}>
      <del>{before}</del> {after ? <ins>{after}</ins> : <em>text removed</em>}
    </span>
  );
}
