import { useEffect, useRef, useState } from 'react';
import { describeElement } from '@/lib/element-descriptor';
import { eventElement, isEditableText, isOwnUi } from '@/lib/picker';
import { collapseText } from '@/lib/text';
import type { Anchor } from '@/lib/types';
import { HighlightBox } from './HighlightBox';
import { usePageCursor } from './use-page-cursor';

export type TextEditResult = { element: HTMLElement; anchor: Anchor; before: string; after: string };

type Props = {
  host: HTMLElement;
  onEdited: (result: TextEditResult) => void;
  onExit: () => void;
};

type Session = {
  element: HTMLElement;
  anchor: Anchor;
  before: string;
  originalText: string;
  previousAttr: string | null;
  detach: () => void;
};

const BLOCKED = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu', 'auxclick'];

function block(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

export function TextEditor({ host, onEdited, onExit }: Props) {
  const [hovered, setHovered] = useState<Element | null>(null);
  const [editing, setEditing] = useState<HTMLElement | null>(null);
  const session = useRef<Session | null>(null);
  const callbacks = useRef({ onEdited, onExit });
  callbacks.current = { onEdited, onExit };
  usePageCursor('text');

  useEffect(() => {
    const finish = (commit: boolean) => {
      const current = session.current;
      if (!current) return;
      session.current = null;
      current.detach();
      const { element } = current;
      if (current.previousAttr === null) element.removeAttribute('contenteditable');
      else element.setAttribute('contenteditable', current.previousAttr);
      setEditing(null);

      if (!commit) {
        element.textContent = current.originalText;
        return;
      }
      const after = collapseText(element.textContent ?? '');
      callbacks.current.onEdited({ element, anchor: current.anchor, before: current.before, after });
    };

    const begin = (element: HTMLElement) => {
      // Describe the element before touching it, so the anchor holds the original text and markup.
      const anchor = describeElement(element);
      const originalText = element.textContent ?? '';
      const previousAttr = element.getAttribute('contenteditable');

      const onKeyDown = (event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      };
      const onBlur = () => finish(true);
      element.addEventListener('keydown', onKeyDown);
      element.addEventListener('blur', onBlur);

      session.current = {
        element,
        anchor,
        before: collapseText(originalText),
        originalText,
        previousAttr,
        detach: () => {
          element.removeEventListener('keydown', onKeyDown);
          element.removeEventListener('blur', onBlur);
        },
      };
      element.setAttribute('contenteditable', 'plaintext-only');
      element.focus();
      setHovered(null);
      setEditing(element);
    };

    const insideEdit = (event: Event) => {
      const target = event.composedPath()[0];
      return target instanceof Node && session.current?.element.contains(target) === true;
    };

    const onMove = (event: MouseEvent) => {
      if (session.current) return;
      const element = eventElement(event, host);
      setHovered(element && isEditableText(element) ? element : null);
    };

    const onBlocked = (event: Event) => {
      if (isOwnUi(event, host)) return;
      // Inside the element being edited the default must run so the caret can be placed.
      if (insideEdit(event)) event.stopPropagation();
      else block(event);
    };

    const onClick = (event: MouseEvent) => {
      if (isOwnUi(event, host)) return;
      block(event);
      if (session.current) {
        if (!insideEdit(event)) finish(true);
        return;
      }
      const element = eventElement(event, host);
      if (element instanceof HTMLElement && isEditableText(element)) begin(element);
    };

    const onKey = (event: KeyboardEvent) => {
      if (isOwnUi(event, host) || session.current) return;
      if (event.key === 'Escape') {
        block(event);
        callbacks.current.onExit();
      }
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    for (const type of BLOCKED) document.addEventListener(type, onBlocked, true);
    return () => {
      finish(true);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      for (const type of BLOCKED) document.removeEventListener(type, onBlocked, true);
    };
  }, [host]);

  if (editing) {
    return <HighlightBox element={editing} tone="edit" label="Enter to save · Esc to cancel" />;
  }
  return hovered ? <HighlightBox element={hovered} label="Click to edit text" /> : null;
}
