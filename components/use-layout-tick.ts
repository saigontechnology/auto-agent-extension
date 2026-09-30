import { useEffect, useState } from 'react';

/**
 * Re-renders the caller when on-page geometry may have changed. `layout` bumps on scroll,
 * resize and DOM mutation; `dom` bumps only on DOM mutation. Updates are coalesced per frame.
 */
export function useLayoutTick(): { layout: number; dom: number } {
  const [tick, setTick] = useState({ layout: 0, dom: 0 });

  useEffect(() => {
    let frame = 0;
    let domChanged = false;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const bumpDom = domChanged;
        domChanged = false;
        setTick((t) => ({ layout: t.layout + 1, dom: bumpDom ? t.dom + 1 : t.dom }));
      });
    };
    const onMutation = () => {
      domChanged = true;
      schedule();
    };

    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    const observer = new MutationObserver(onMutation);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
  }, []);

  return tick;
}
