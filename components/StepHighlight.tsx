import { useEffect, useMemo } from 'react';
import { resolveAnchor } from '@/lib/anchor-resolver';
import type { Anchor } from '@/lib/types';
import { HighlightBox } from './HighlightBox';
import { useLayoutTick } from './use-layout-tick';

export type ShownAnchor = { key: string; anchor: Anchor; scroll: boolean; at: number };

type Props = { shown: ShownAnchor; onMissing: (key: string) => void; onDone: () => void };

/** Outlines the element of a workflow step the reviewer points at in the panel. */
export function StepHighlight({ shown, onMissing, onDone }: Props) {
  const { dom } = useLayoutTick();
  // `dom` is a deliberate dependency: the element may appear after the page re-renders.
  const element = useMemo(() => resolveAnchor(shown.anchor, document), [shown, dom]);
  const found = element !== null;

  useEffect(() => {
    if (!element) {
      onMissing(shown.key);
      return;
    }
    if (!shown.scroll) return;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const timer = setTimeout(onDone, 1500);
    return () => clearTimeout(timer);
    // Once per request: rebuilding `element` on DOM changes must not scroll again.
  }, [shown.at, found]);

  return element ? <HighlightBox element={element} tone="selected" /> : null;
}
