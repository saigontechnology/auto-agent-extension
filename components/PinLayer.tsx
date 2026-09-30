import { useEffect, useMemo } from 'react';
import { resolveAnchor } from '@/lib/anchor-resolver';
import { type Pin, locationLabel } from '@/lib/pins';
import { useLayoutTick } from './use-layout-tick';

export type PinFocus = { id: string; at: number };

type Props = {
  pins: Pin[];
  focus: PinFocus | null;
  onUnresolved: (ids: string[]) => void;
  onOpen: (pin: Pin, element: Element) => void;
};

function tooltip(pin: Pin): string {
  const author = 'author' in pin.item ? `${pin.item.author.name}: ` : '';
  return `${author}${pin.item.comment || locationLabel(pin.item)}`;
}

export function PinLayer({ pins, focus, onUnresolved, onOpen }: Props) {
  const { dom } = useLayoutTick();

  // Re-resolve only when the pins or the DOM change; scrolling just re-reads rects below.
  const elements = useMemo(
    () =>
      new Map(
        pins.map((pin) => [pin.id, pin.item.anchor ? resolveAnchor(pin.item.anchor, document) : null]),
      ),
    // `dom` is a deliberate dependency: it changes when the page's DOM does.
    [pins, dom],
  );

  const unresolved = pins.filter((pin) => !elements.get(pin.id)).map((pin) => pin.id);
  const unresolvedKey = unresolved.join('|');
  useEffect(() => {
    onUnresolved(unresolved);
    // Keyed on the joined ids so the panel is told only when the set actually changes.
  }, [unresolvedKey]);

  useEffect(() => {
    if (focus) elements.get(focus.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Scroll once per focus request, not again when the elements map is rebuilt.
  }, [focus]);

  return (
    <>
      {pins.map((pin) => {
        const element = elements.get(pin.id);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return null;
        const focused = focus?.id === pin.id ? ' vf-pin--focused' : '';
        return (
          <button
            key={pin.id}
            type="button"
            data-vf-pin={pin.state}
            className={`vf-pin vf-pin--${pin.state}${focused}`}
            style={{ top: rect.top - 10, left: rect.right - 10 }}
            title={tooltip(pin)}
            onClick={() => onOpen(pin, element)}
          >
            {pin.number}
          </button>
        );
      })}
    </>
  );
}
