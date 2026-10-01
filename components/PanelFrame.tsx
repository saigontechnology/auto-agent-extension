import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { storage } from '#imports';
import { BrandMark } from './BrandMark';

/** Distance of the window from the viewport's right and bottom edges, and whether it is folded. */
type PanelLayout = { right: number; bottom: number; minimized: boolean };

const DEFAULT_LAYOUT: PanelLayout = { right: 16, bottom: 16, minimized: false };
const EDGE = 8;

const layoutItem = storage.defineItem<PanelLayout>('local:panel-layout', {
  fallback: DEFAULT_LAYOUT,
});

/** Keeps the whole window on screen, however the viewport or the window size changed. */
function clamp(layout: PanelLayout, element: HTMLElement | null): PanelLayout {
  if (!element) return layout;
  const { width, height } = element.getBoundingClientRect();
  const maxRight = Math.max(EDGE, window.innerWidth - width - EDGE);
  const maxBottom = Math.max(EDGE, window.innerHeight - height - EDGE);
  return {
    ...layout,
    right: Math.min(Math.max(layout.right, EDGE), maxRight),
    bottom: Math.min(Math.max(layout.bottom, EDGE), maxBottom),
  };
}

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

type Props = { drafts: number; onClose: () => void };

/**
 * The review panel as a window floating over the page, so the page keeps its own layout.
 * Its title bar moves it and folds it down to a small bar that shows the number of drafts.
 */
export function PanelFrame({ drafts, onClose }: Props) {
  const [layout, setLayout] = useState<PanelLayout | null>(null);
  const [dragging, setDragging] = useState(false);
  const windowRef = useRef<HTMLElement | null>(null);
  const drag = useRef<{ x: number; y: number; right: number; bottom: number } | null>(null);

  useEffect(() => {
    void layoutItem.getValue().then(setLayout);
  }, []);

  // Folding, unfolding and resizing the viewport can all push the window past an edge.
  useEffect(() => {
    if (!layout) return;
    const fit = () => setLayout((current) => current && clamp(current, windowRef.current));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [layout?.minimized]);

  if (!layout) return null;

  const save = (next: PanelLayout) => {
    setLayout(next);
    void layoutItem.setValue(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, right: layout.right, bottom: layout.bottom };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const start = drag.current;
    if (!start) return;
    const moved = {
      ...layout,
      right: start.right - (event.clientX - start.x),
      bottom: start.bottom - (event.clientY - start.y),
    };
    setLayout(clamp(moved, windowRef.current));
  };

  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    save(layout);
  };

  const { minimized } = layout;
  const classes = ['vf-panel', minimized && 'vf-panel--minimized', dragging && 'vf-panel--dragging'];

  return (
    <section
      ref={windowRef}
      className={classes.filter(Boolean).join(' ')}
      style={{ right: layout.right, bottom: layout.bottom }}
      aria-label="Auto Agent"
    >
      <header
        className="vf-panel__bar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => {
          if (!(event.target as Element).closest('button')) save({ ...layout, minimized: !minimized });
        }}
      >
        <BrandMark className="vf-panel__mark" />
        <span className="vf-panel__title">Auto Agent</span>
        {minimized && drafts > 0 && (
          <span className="vf-panel__count" aria-label={`${drafts} ${drafts === 1 ? 'draft' : 'drafts'}`}>
            {drafts}
          </span>
        )}
        <button
          type="button"
          className="vf-panel__button"
          aria-label={minimized ? 'Expand' : 'Minimize'}
          title={minimized ? 'Expand' : 'Minimize'}
          onClick={() => save({ ...layout, minimized: !minimized })}
        >
          <Glyph d={minimized ? 'M3.5 10l4.5-4.5 4.5 4.5' : 'M3.5 6l4.5 4.5 4.5-4.5'} />
        </button>
        <button
          type="button"
          className="vf-panel__button"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <Glyph d="M4 4l8 8M12 4l-8 8" />
        </button>
      </header>
      {/* Folding only hides the frame, so pins and the connection to the page stay alive. */}
      <iframe className="vf-panel__frame" src={browser.runtime.getURL('/panel.html')} title="Auto Agent panel" />
    </section>
  );
}
