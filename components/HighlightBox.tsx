import { useLayoutTick } from './use-layout-tick';

type Props = { element: Element; label?: string; tone?: 'hover' | 'selected' | 'edit' };

export function HighlightBox({ element, label, tone = 'hover' }: Props) {
  useLayoutTick();
  const rect = element.getBoundingClientRect();
  return (
    <div
      className={`vf-highlight vf-highlight--${tone}`}
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
    >
      {label && <span className="vf-highlight__label">{label}</span>}
    </div>
  );
}
