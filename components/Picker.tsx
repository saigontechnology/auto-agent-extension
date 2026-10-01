import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { SOURCE_ATTR } from '@/lib/element-descriptor';
import { eventElement, firstChildOf, isOwnUi, parentOf } from '@/lib/picker';
import { HighlightBox } from './HighlightBox';
import { usePageCursor } from './use-page-cursor';

/** A key forwarded from the review panel; `at` makes repeated presses distinct. */
export type RemoteKey = { key: string; at: number };

type Props = {
  host: HTMLElement;
  remoteKey: RemoteKey | null;
  onPick: (element: Element) => void;
  onExit: () => void;
};

const BLOCKED = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu', 'auxclick'];

function block(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function labelFor(element: Element): ReactNode {
  const source = element.getAttribute(SOURCE_ATTR);
  return (
    <>
      <b>{element.localName}</b>
      {source && ` ${source}`}
    </>
  );
}

export function Picker({ host, remoteKey, onPick, onExit }: Props) {
  const [target, setTarget] = useState<Element | null>(null);
  const targetRef = useRef<Element | null>(null);
  const hoveredRef = useRef<Element | null>(null);
  const callbacks = useRef({ onPick, onExit });
  callbacks.current = { onPick, onExit };
  usePageCursor('crosshair');

  const select = useCallback((element: Element | null) => {
    targetRef.current = element;
    setTarget(element);
  }, []);

  /** Applies a picker key and reports whether it did anything. */
  const applyKey = useCallback(
    (key: string): boolean => {
      if (key === 'Escape') {
        callbacks.current.onExit();
        return true;
      }
      const current = targetRef.current;
      if (!current) return false;
      if (key === 'ArrowUp') select(parentOf(current) ?? current);
      else if (key === 'ArrowDown') select(firstChildOf(current) ?? current);
      else if (key === 'Enter') callbacks.current.onPick(current);
      else return false;
      return true;
    },
    [select],
  );

  useEffect(() => {
    if (remoteKey) applyKey(remoteKey.key);
  }, [remoteKey, applyKey]);

  useEffect(() => {

    // Only a move onto a different element changes the target, so a keyboard
    // adjustment (ArrowUp/ArrowDown) survives small mouse jitters.
    const onMove = (event: MouseEvent) => {
      const element = eventElement(event, host);
      if (element === hoveredRef.current) return;
      hoveredRef.current = element;
      if (element) select(element);
    };

    const onBlocked = (event: Event) => {
      if (!isOwnUi(event, host)) block(event);
    };

    const onClick = (event: MouseEvent) => {
      if (isOwnUi(event, host)) return;
      block(event);
      // Pick what is highlighted, which the keyboard may have moved away from the cursor.
      const current = targetRef.current;
      const chosen = current?.isConnected ? current : eventElement(event, host);
      if (chosen) callbacks.current.onPick(chosen);
    };

    const onKey = (event: KeyboardEvent) => {
      if (isOwnUi(event, host)) return;
      if (applyKey(event.key)) block(event);
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    for (const type of BLOCKED) document.addEventListener(type, onBlocked, true);
    return () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      for (const type of BLOCKED) document.removeEventListener(type, onBlocked, true);
    };
  }, [host, select, applyKey]);

  return target ? <HighlightBox element={target} label={labelFor(target)} /> : null;
}
