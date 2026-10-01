import { describe, expect, it } from 'vitest';
import { clickStep, makeFlowItem, makeItem, networkStep } from '../test-helpers';
import { MAX_DESCRIPTION, feedbackMarkdown } from './feedback-markdown';

const FILE = 'auto-agent-feedback-shop-1.json';

describe('feedbackMarkdown', () => {
  it('opens with a count and points to the attached file', () => {
    const text = feedbackMarkdown([makeItem()], FILE);
    expect(text.startsWith('# Feedback from the Auto Agent extension\n\n1 item.')).toBe(true);
    expect(text).toContain(`\`${FILE}\``);
  });

  it('describes an element comment with its source line', () => {
    const text = feedbackMarkdown([makeItem({ comment: 'Make this bigger' })], FILE);
    expect(text).toContain('## 1. Comment on h1 "Welcome" on /home');
    expect(text).toContain('Source: `src/pages/Home.tsx:12`');
    expect(text).toContain('Make this bigger');
  });

  it('falls back to the nearest source', () => {
    const item = makeItem();
    item.anchor = { ...item.anchor!, source: undefined, nearestSource: 'src/App.tsx:3' };
    expect(feedbackMarkdown([item], FILE)).toContain('Nearest source: `src/App.tsx:3`');
  });

  it('quotes both sides of a text change', () => {
    const item = makeItem({ kind: 'text-edit', comment: '', textEdit: { before: 'Fresh fruit', after: 'Fruit' } });
    const text = feedbackMarkdown([item], FILE);
    expect(text).toContain('## 1. Text change on /home');
    expect(text).toContain('Replace:\n> Fresh fruit\n\nWith:\n> Fruit');
  });

  it('describes a page comment', () => {
    const item = makeItem({ kind: 'page', anchor: undefined, comment: 'Needs a back button' });
    expect(feedbackMarkdown([item], FILE)).toContain('## 1. Comment on the page /home\n\nNeeds a back button');
  });

  it('lists a workflow’s steps and marks the failing one', () => {
    const item = makeFlowItem();
    item.flow = { ...item.flow!, steps: [clickStep('s1'), networkStep('s2', 500)], failedStepId: 's2' };
    const text = feedbackMarkdown([item], FILE);
    expect(text).toContain('## 1. Workflow: Sign-in fails (starts on /login)');
    expect(text).toContain('**Expected:** I land on the dashboard');
    expect(text).toContain('**Actual:** Nothing happens');
    expect(text).toContain('1. Click button "Sign in" (`src/pages/Login.tsx:48`)');
    expect(text).toMatch(/2\. POST \/api\/login → 500 \*\*← fails here\*\*/);
  });

  it('stops at a whole item and says so when the text would be too long', () => {
    const items = Array.from({ length: 30 }, (_, i) => makeItem({ id: `i${i}`, comment: 'x'.repeat(500) }));
    const text = feedbackMarkdown(items, FILE);
    expect(text.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
    expect(text).toContain('## 1.');
    expect(text).not.toContain('## 30.');
    expect(text.endsWith(`_Truncated: the attached file \`${FILE}\` has all 30 items._`)).toBe(true);
  });

  it('cuts a single item that alone is too long', () => {
    const text = feedbackMarkdown([makeItem({ comment: 'y'.repeat(20_000) })], FILE);
    expect(text.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
    expect(text).toContain('## 1. Comment on');
    expect(text).toContain('_Truncated:');
  });
});
