/** Styles that undo the browser's popover defaults, so the host stays a zero-size box at 0,0. */
const HOST_STYLES: Record<string, string> = {
  position: 'fixed',
  inset: '0',
  width: '0',
  height: '0',
  margin: '0',
  padding: '0',
  border: '0',
  background: 'transparent',
  overflow: 'visible',
};

/**
 * Puts the overlay in the browser's top layer. No z-index can beat an element there, so this
 * keeps pins and the comment box above pages that use popovers or dialogs. A page element that
 * enters the top layer later lands above the overlay, so the overlay is lifted back over it.
 * Returns a function that stops the lifting.
 */
export function keepInTopLayer(host: HTMLElement, doc: Document = document): () => void {
  if (typeof host.showPopover !== 'function') return () => undefined;

  host.setAttribute('popover', 'manual');
  for (const [name, value] of Object.entries(HOST_STYLES)) {
    host.style.setProperty(name, value, 'important');
  }

  const raise = () => {
    if (!host.isConnected) return;
    if (host.matches(':popover-open')) host.hidePopover();
    host.showPopover();
  };
  raise();

  // Popovers and dialogs fire a non-bubbling `toggle` when they open; capture sees them all.
  const onToggle = (event: Event) => {
    if (event.target !== host && (event as ToggleEvent).newState === 'open') raise();
  };
  doc.addEventListener('toggle', onToggle, true);
  return () => doc.removeEventListener('toggle', onToggle, true);
}
