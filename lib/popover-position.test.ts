import { describe, expect, it } from 'vitest';
import { POPOVER, popoverPosition } from './popover-position';

const viewport = { width: 1000, height: 800 };

describe('popoverPosition', () => {
  it('sits below the element when there is room', () => {
    expect(popoverPosition({ top: 100, bottom: 140, left: 50 }, viewport)).toEqual({ top: 148, left: 50 });
  });

  it('flips above the element near the bottom edge', () => {
    const position = popoverPosition({ top: 700, bottom: 760, left: 50 }, viewport);
    expect(position.top).toBe(700 - POPOVER.gap - POPOVER.height);
  });

  it('stays on screen when the element fills the viewport', () => {
    const position = popoverPosition({ top: 0, bottom: 800, left: 0 }, viewport);
    expect(position.top).toBe(800 - POPOVER.height - POPOVER.margin);
    expect(position.left).toBe(POPOVER.margin);
  });

  it('clamps to the right edge', () => {
    const position = popoverPosition({ top: 100, bottom: 140, left: 950 }, viewport);
    expect(position.left).toBe(1000 - POPOVER.width - POPOVER.margin);
  });

  it('stays on screen in a viewport narrower than the popover', () => {
    const position = popoverPosition({ top: 10, bottom: 20, left: 100 }, { width: 200, height: 800 });
    expect(position.left).toBe(POPOVER.margin);
  });
});
