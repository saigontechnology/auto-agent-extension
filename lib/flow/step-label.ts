import type { Anchor, FlowStep } from '../types';

const FIELD_TAGS: ReadonlySet<string> = new Set(['input', 'select', 'textarea']);

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** An attribute of the element's own opening tag, ignoring its children. */
function ownAttribute(html: string, name: string): string | undefined {
  const openingTag = /^<[^>]*>/.exec(html)?.[0] ?? '';
  return new RegExp(`\\s${name}="([^"]*)"`).exec(openingTag)?.[1]?.trim() || undefined;
}

/** A short, human name for an element, for the step list. */
export function elementName(anchor: Anchor): string {
  const field = FIELD_TAGS.has(anchor.tag);
  const name =
    ownAttribute(anchor.html, 'aria-label') ??
    (field ? (ownAttribute(anchor.html, 'placeholder') ?? ownAttribute(anchor.html, 'name')) : undefined) ??
    (anchor.text || undefined);
  return name ? `${anchor.tag} "${shorten(name, 40)}"` : anchor.selector;
}

function times(count: number): string {
  return count > 1 ? ` ×${count}` : '';
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return shorten(parsed.pathname + parsed.search, 80);
  } catch {
    return shorten(url, 80);
  }
}

const CONSOLE_LABELS = {
  error: 'Console error',
  exception: 'Uncaught exception',
  rejection: 'Unhandled rejection',
} as const;

function labelText(step: FlowStep): string {
  switch (step.type) {
    case 'click':
      return `Click ${elementName(step.anchor)}`;
    case 'input':
      return `Type "${shorten(step.value, 40)}" into ${elementName(step.anchor)}`;
    case 'select':
      return `Select "${shorten(step.label, 40)}" in ${elementName(step.anchor)}`;
    case 'check':
      return `${step.checked ? 'Check' : 'Uncheck'} ${elementName(step.anchor)}`;
    case 'key':
      return step.anchor ? `Press ${step.key} in ${elementName(step.anchor)}` : `Press ${step.key}`;
    case 'navigate':
      if (step.cause === 'reload') return `Reload ${step.path}`;
      if (step.cause === 'history') return `Back or forward to ${step.path}`;
      return `Go to ${step.path}`;
    case 'left':
      return `Left the preview for ${step.url}`;
    case 'new-tab':
      return `Opened a new tab: ${step.url}`;
    case 'note':
      return `Note: ${step.text}`;
    case 'console': {
      const firstLine = step.message.split('\n')[0] ?? '';
      return `${CONSOLE_LABELS[step.source]}: ${shorten(firstLine, 120)}${times(step.count)}`;
    }
    case 'network':
      return `${step.method} ${shortUrl(step.url)} → ${step.status ?? 'failed'}${times(step.count)}`;
  }
}

export function stepAnchor(step: FlowStep): Anchor | undefined {
  return 'anchor' in step ? step.anchor : undefined;
}

export function stepLabel(step: FlowStep): { text: string; source?: string } {
  const anchor = stepAnchor(step);
  const source = anchor?.source ?? anchor?.nearestSource;
  return { text: labelText(step), ...(source ? { source } : {}) };
}

export function stepTone(step: FlowStep): 'error' | 'warning' | 'note' | null {
  if (step.type === 'console') return 'error';
  if (step.type === 'network') return 'warning';
  if (step.type === 'note') return 'note';
  return null;
}

/** The value the reviewer may correct on the review screen, or null when there is none. */
export function editableValue(step: FlowStep): string | null {
  if (step.type === 'input') return step.value;
  if (step.type === 'note') return step.text;
  return null;
}

export function errorCount(steps: FlowStep[]): number {
  return steps.filter((step) => step.type === 'console' || step.type === 'network').length;
}

export function flowSummary(steps: FlowStep[]): string {
  const errors = errorCount(steps);
  return `${steps.length} ${steps.length === 1 ? 'step' : 'steps'} · ${errors} ${errors === 1 ? 'error' : 'errors'}`;
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
