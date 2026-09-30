export const POPOVER = { width: 320, height: 200, gap: 8, margin: 8 };

type Box = { top: number; bottom: number; left: number };
type Size = { width: number; height: number };

/** Places the popover below the element, above it when there is no room, always on screen. */
export function popoverPosition(rect: Box, viewport: Size): { top: number; left: number } {
  const { width, height, gap, margin } = POPOVER;
  const below = rect.bottom + gap;
  const above = rect.top - gap - height;

  let top: number;
  if (below + height + margin <= viewport.height) top = below;
  else if (above >= margin) top = above;
  else top = Math.max(margin, viewport.height - height - margin);

  const maxLeft = Math.max(margin, viewport.width - width - margin);
  const left = Math.min(Math.max(rect.left, margin), maxLeft);
  return { top, left };
}
