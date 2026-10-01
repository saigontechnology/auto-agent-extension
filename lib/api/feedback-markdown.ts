import { elementName, stepLabel } from '../flow/step-label';
import type { Anchor, FeedbackItem } from '../types';

/** Auto Agent's limit on a feedback run's description. */
export const MAX_DESCRIPTION = 10_000;

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function sourceLines(anchor: Anchor | undefined): string[] {
  if (anchor?.source) return [`Source: \`${anchor.source}\``];
  if (anchor?.nearestSource) return [`Nearest source: \`${anchor.nearestSource}\``];
  return [];
}

function section(item: FeedbackItem, index: number): string {
  const heading = `## ${index + 1}.`;
  const path = item.page.path;
  switch (item.kind) {
    case 'element':
      return [
        `${heading} Comment on ${item.anchor ? elementName(item.anchor) : 'an element'} on ${path}`,
        ...sourceLines(item.anchor),
        '',
        item.comment,
      ].join('\n');
    case 'text-edit':
      return [
        `${heading} Text change on ${path}`,
        ...sourceLines(item.anchor),
        '',
        'Replace:',
        quote(item.textEdit?.before ?? ''),
        '',
        'With:',
        quote(item.textEdit?.after ?? ''),
        ...(item.comment ? ['', item.comment] : []),
      ].join('\n');
    case 'page':
      return [`${heading} Comment on the page ${path}`, '', item.comment].join('\n');
    case 'flow': {
      const lines = [`${heading} Workflow: ${item.comment} (starts on ${path})`];
      const flow = item.flow;
      if (!flow) return lines.join('\n');
      if (flow.expected) lines.push('', `**Expected:** ${flow.expected}`);
      if (flow.actual) lines.push('', `**Actual:** ${flow.actual}`);
      lines.push('', 'Steps:');
      flow.steps.forEach((step, stepIndex) => {
        const { text, source } = stepLabel(step);
        const where = source ? ` (\`${source}\`)` : '';
        const fails = step.id === flow.failedStepId ? ' **← fails here**' : '';
        lines.push(`${stepIndex + 1}. ${text}${where}${fails}`);
      });
      return lines.join('\n');
    }
  }
}

/**
 * The description of a feedback run: a readable summary for Auto Agent's agent. It stops at a
 * whole item when it would pass Auto Agent's limit; the attached JSON file always has everything.
 */
export function feedbackMarkdown(items: FeedbackItem[], fileName: string): string {
  const count = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
  const header = `# Feedback from the Auto Agent extension\n\n${count}. Selectors, HTML and viewport details are in the attached file \`${fileName}\`.`;
  const note = `\n\n_Truncated: the attached file \`${fileName}\` has all ${count}._`;

  let text = header;
  let included = 0;
  for (const [index, item] of items.entries()) {
    const next = `${text}\n\n${section(item, index)}`;
    // Room for the note is kept unless this is the last item, which needs no note.
    const reserve = index === items.length - 1 ? 0 : note.length;
    if (next.length + reserve > MAX_DESCRIPTION) break;
    text = next;
    included += 1;
  }
  if (included === items.length) return text;
  if (included === 0) {
    const room = MAX_DESCRIPTION - text.length - note.length - 3;
    text = `${text}\n\n${section(items[0]!, 0).slice(0, Math.max(0, room))}…`;
  }
  return text + note;
}
