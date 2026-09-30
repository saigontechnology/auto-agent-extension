import { useEffect } from 'react';

/** Forces a cursor on the whole page while a picking mode is active. */
export function usePageCursor(cursor: 'crosshair' | 'text'): void {
  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-vibe-feedback', 'cursor');
    style.textContent = `* { cursor: ${cursor} !important; }`;
    document.head.append(style);
    return () => style.remove();
  }, [cursor]);
}
