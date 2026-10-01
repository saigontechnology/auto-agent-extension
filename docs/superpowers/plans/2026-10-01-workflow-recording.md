# Workflow Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reviewer record a multi-step workflow on a preview (clicks, entries, page changes, console errors, failed requests), review it, and send it as a `flow` feedback item.

**Architecture:** The background service worker owns one recording per tab in `storage.session`. The content script captures DOM events and forwards console and network failures reported by a small main-world probe; every step goes to the background, which merges and stores it. The review panel (an extension page) watches the recording directly, drives Pause/Note/Stop through background requests, and turns a stopped recording into an ordinary draft, so Send, Export JSON and the Sent list work unchanged. Logic lives in pure modules under `lib/flow/` with unit tests; React layers are covered by Playwright.

**Tech Stack:** WXT 0.21 (Manifest V3), React 19, TypeScript 7 strict, Vitest 5 with happy-dom and WXT's `fakeBrowser`, Playwright 1.63, pnpm 10, Node 22.

**Spec:** `docs/superpowers/specs/2026-10-01-workflow-recording-design.md` (builds on `docs/superpowers/specs/2026-09-30-vibe-feedback-extension-design.md`)

## Global Constraints

- **Node ≥ 22.12.** In a non-interactive shell prefix every command with `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH";`.
- **pnpm only.** If a test fails with `Transform failed` or `tsc` reports errors inside `node_modules`, run `pnpm wxt prepare`.
- Unit tests live next to their module as `lib/**/*.test.ts`; Vitest only collects that pattern. Components and entrypoints are covered by Playwright (`e2e/*.spec.ts`).
- `pnpm test:e2e` builds the extension first; run it after any change under `components/` or `entrypoints/`.
- Import WXT APIs from `#imports` (or `wxt/browser` for `browser` and `Browser` types). Use the `@/` alias from `entrypoints/` and `components/`; use relative imports inside `lib/`.
- `noUncheckedIndexedAccess` is on: indexing an array yields `T | undefined`.
- All code, comments, docs and commit messages are in English. Comments explain why, in the style of the surrounding code.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Only `lib/api/http-feedback-api.ts` may know the real API's URLs and response checks.
- Spec limits, exactly: at most **300** steps per workflow; console `message` and `stack` truncated to **2000** characters each.
- Typed values are recorded verbatim, including password fields (spec section 2). Do not mask anything.
- No new manifest permissions. In particular, do not add `tabs`.

## Review Focus

The spec does not spell these out, but a reviewer using the feature would hit them. Each has a test in the task that owns the code.

1. **A page that logs the same error in a loop.** Expected: one `console` step whose `count` grows; the 300-step limit is not used up. Test: `addStep` error-storm case in Task 2.
2. **Keystrokes arriving faster than storage writes.** Expected: every step that was sent is stored, none is overwritten. Test: concurrent `recordStep` in Task 5.
3. **Pages that log circular objects, BigInts, null-prototype objects, or reject with non-Errors.** Expected: the probe never throws into the page and still reports a readable message. Test: `formatValue` in Task 3.
4. **An auto-saved untitled workflow that the reviewer leaves ticked.** Expected: it is never sent, by the panel or by the background. Tests: `handleRequest` in Task 1, Playwright in Task 9.
5. **Clicks and typing inside the extension's own UI (badge, floating panel, comment box).** Expected: none of it is recorded. Test: `actionFromEvent` own-UI case in Task 4.

## File Structure

```
lib/types.ts                         + FeedbackKind 'flow', Flow, FlowStep, FlowAction, NavigationCause
lib/feedback-factory.ts              createItem passes `flow` through
lib/draft-store.ts                   DraftPatch may replace `flow`
lib/test-helpers.ts                  + makeAnchor, makeFlow, makeFlowItem, step builders
lib/flow/types.ts                    Recording, RecordingState, FlowEdits, recordingState, isRecordingState
lib/flow/flow-item.ts                flowItem, flowFromEdits, flowEditsOf, flowPatch, withValue, isSendable
lib/flow/steps.ts                    addStep, MAX_STEPS, MAX_MESSAGE
lib/flow/step-label.ts               stepLabel, elementName, stepAnchor, stepTone, editableValue, flowSummary, formatElapsed
lib/flow/probe-format.ts             PROBE_TAG, ProbeEvent, formatValue, formatArgs, isFailedStatus, absoluteUrl (main-world safe)
lib/flow/probe-events.ts             isProbeMessage, probeAction
lib/flow/capture.ts                  CAPTURED_EVENTS, actionFromEvent, clickTarget, navigationCause
lib/flow/recording-store.ts          per-tab recordings in storage.session
lib/flow/flow-handlers.ts            createFlowHandlers: content messages, panel requests, tab events
lib/messages.ts                      + flow messages and requests
lib/background-handlers.ts           delegates flow requests; skips unsendable drafts
lib/api/http-feedback-api.ts         accepts and checks `flow` items
entrypoints/background.ts            wires flow handlers to messages and tab events
entrypoints/flow-probe.content.ts    main-world probe
components/use-flow-recorder.ts      content-side recording hook
components/RecordingBadge.tsx        "REC" badge on the page
components/StepHighlight.tsx         highlights a step's element on request
components/App.tsx                   start-recording, show-anchor, badge
components/PanelFrame.tsx            red dot while recording
entrypoints/content/style.css        badge and dot styles
entrypoints/panel/flow-hooks.ts      useRecording, useNow, useGoTo
entrypoints/panel/FlowSteps.tsx      step list (live, review, sent)
entrypoints/panel/RecordingBar.tsx   controls while recording
entrypoints/panel/FlowReview.tsx     review screen
entrypoints/panel/App.tsx            wires everything into the panel
entrypoints/panel/DraftRow.tsx       flow drafts
entrypoints/panel/SentRow.tsx        expandable sent flows
entrypoints/panel/Checkbox.tsx       + disabled
entrypoints/panel/icons.tsx          + flag, note, goto
entrypoints/panel/style.css          recording, steps, review styles
e2e/pages/flow.html                  test page: form, failing request, crash button
e2e/serve.mjs                        /api/* answers 500
e2e/flow.spec.ts                     end-to-end tests for this feature
README.md                            "Recording a workflow" section
```

---

### Task 1: Contract types, flow drafts and API checks

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/feedback-factory.ts`
- Modify: `lib/draft-store.ts:5`
- Modify: `lib/test-helpers.ts`
- Create: `lib/flow/types.ts`
- Create: `lib/flow/flow-item.ts`
- Create: `lib/flow/flow-item.test.ts`
- Modify: `lib/api/http-feedback-api.ts`
- Modify: `lib/api/http-feedback-api.test.ts`
- Modify: `lib/background-handlers.ts`
- Modify: `lib/background-handlers.test.ts`

**Interfaces:**
- Consumes: `createItem`, `ItemInput`, `ItemEnv` from `lib/feedback-factory.ts`; `DraftPatch` from `lib/draft-store.ts`.
- Produces:
  - `lib/types.ts`: `FeedbackKind` gains `'flow'`; `NavigationCause = 'route' | 'load' | 'reload' | 'history'`; `FlowAction` (union of step bodies); `FlowStep = { id: string; at: string; path: string } & FlowAction`; `Flow`; `FeedbackItem.flow?: Flow`.
  - `lib/flow/types.ts`: `RecordingStatus`, `Recording`, `RecordingState`, `FlowEdits`, `recordingState(recording: Recording | null): RecordingState`, `isRecordingState(value: unknown): value is RecordingState`.
  - `lib/flow/flow-item.ts`: `flowFromEdits(times: { startedAt: string; endedAt: string }, edits: FlowEdits): Flow`, `flowItem(recording: Recording, edits: FlowEdits, env: { id: string; now: Date }): FeedbackItem`, `flowEditsOf(item: FeedbackItem): FlowEdits`, `flowPatch(item: FeedbackItem, edits: FlowEdits): DraftPatch`, `withValue(step: FlowStep, value: string): FlowStep`, `isSendable(item: FeedbackItem): boolean`.
  - `lib/test-helpers.ts`: `makeAnchor(overrides?)`, `clickStep(id, path?)`, `inputStep(id, selector, value, path?)`, `consoleStep(id, message, count?)`, `networkStep(id, status, count?)`, `makeFlow(overrides?)`, `makeFlowItem(overrides?)`.

- [ ] **Step 1: Add the contract types**

In `lib/types.ts`, replace the first line:

```ts
export type FeedbackKind = 'element' | 'text-edit' | 'page';
```

with:

```ts
export type FeedbackKind = 'element' | 'text-edit' | 'page' | 'flow';
```

Replace the `FeedbackItem` type with:

```ts
export type FeedbackItem = {
  id: string;
  buildId: string;
  kind: FeedbackKind;
  /** For 'flow' this is the workflow's title. */
  comment: string;
  /** For 'flow' this is the page where recording started. */
  page: PageRef;
  anchor?: Anchor;
  textEdit?: { before: string; after: string };
  flow?: Flow;
  viewport: Viewport;
  createdAt: string;
};

/** How the tab reached a page: a same-document route change, or a new document. */
export type NavigationCause = 'route' | 'load' | 'reload' | 'history';

/** What one recorded step did. */
export type FlowAction =
  | { type: 'click'; anchor: Anchor }
  | { type: 'input'; anchor: Anchor; value: string }
  | { type: 'select'; anchor: Anchor; value: string; label: string }
  | { type: 'check'; anchor: Anchor; checked: boolean }
  | { type: 'key'; anchor?: Anchor; key: 'Enter' | 'Escape' | 'Tab' }
  | { type: 'navigate'; url: string; cause: NavigationCause }
  | { type: 'left'; url: string }
  | { type: 'new-tab'; url: string }
  | { type: 'note'; text: string }
  | {
      type: 'console';
      source: 'error' | 'exception' | 'rejection';
      message: string;
      stack?: string;
      count: number;
    }
  | { type: 'network'; method: string; url: string; status: number | null; count: number };

export type FlowStep = { id: string; at: string; path: string } & FlowAction;

export type Flow = {
  expected: string;
  actual: string;
  failedStepId?: string;
  startedAt: string;
  endedAt: string;
  steps: FlowStep[];
};
```

- [ ] **Step 2: Pass `flow` through the factory and the draft patch**

In `lib/feedback-factory.ts`, change the import and `ItemInput`:

```ts
import type { Anchor, FeedbackItem, FeedbackKind, Flow, PageContext, Viewport } from './types';

export type ItemInput = {
  kind: FeedbackKind;
  comment: string;
  context: PageContext;
  anchor?: Anchor;
  textEdit?: { before: string; after: string };
  flow?: Flow;
};
```

and in `createItem`, after the `textEdit` spread line add:

```ts
    ...(input.flow ? { flow: input.flow } : {}),
```

In `lib/draft-store.ts`, replace line 5:

```ts
export type DraftPatch = Partial<Pick<FeedbackItem, 'comment' | 'textEdit'>>;
```

with:

```ts
export type DraftPatch = Partial<Pick<FeedbackItem, 'comment' | 'textEdit' | 'flow'>>;
```

- [ ] **Step 3: Add the recording types**

Create `lib/flow/types.ts`:

```ts
import type { FlowStep, PageRef, Viewport } from '../types';

export type RecordingStatus = 'recording' | 'paused' | 'stopped';

/** One tab's workflow recording, kept by the background in session storage. */
export type Recording = {
  tabId: number;
  projectId: string;
  buildId: string;
  startPage: PageRef;
  viewport: Viewport;
  status: RecordingStatus;
  /** Why a paused recording is paused: the reviewer pressed Pause, or the tab left the project. */
  pausedReason?: 'user' | 'left';
  /** Set when the recording stopped itself at the step limit. */
  limitReached?: boolean;
  steps: FlowStep[];
  startedAt: string;
  endedAt?: string;
};

/** What a tab's content script needs to know about its recording. */
export type RecordingState = { status: RecordingStatus | 'none'; steps: number };

/** What the reviewer fills in or changes on the review screen. */
export type FlowEdits = {
  title: string;
  expected: string;
  actual: string;
  failedStepId?: string;
  steps: FlowStep[];
};

export function recordingState(recording: Recording | null): RecordingState {
  return recording
    ? { status: recording.status, steps: recording.steps.length }
    : { status: 'none', steps: 0 };
}

const STATES: ReadonlySet<string> = new Set(['recording', 'paused', 'stopped', 'none']);

export function isRecordingState(value: unknown): value is RecordingState {
  const state = value as Partial<RecordingState> | null;
  return (
    typeof state === 'object' &&
    state !== null &&
    typeof state.status === 'string' &&
    STATES.has(state.status) &&
    typeof state.steps === 'number'
  );
}
```

- [ ] **Step 4: Add test builders**

Append to `lib/test-helpers.ts` (and add `Anchor, Flow, FlowStep` to its type import):

```ts
export function makeAnchor(overrides: Partial<Anchor> = {}): Anchor {
  return {
    source: 'src/pages/Login.tsx:48',
    selector: '#submit',
    tag: 'button',
    text: 'Sign in',
    html: '<button id="submit">Sign in</button>',
    rect: { x: 0, y: 0, width: 80, height: 32 },
    ...overrides,
  };
}

const STEP_AT = '2026-10-01T00:00:00.000Z';

export function clickStep(id: string, path = '/login'): FlowStep {
  return { id, at: STEP_AT, path, type: 'click', anchor: makeAnchor() };
}

export function inputStep(id: string, selector: string, value: string, path = '/login'): FlowStep {
  return {
    id,
    at: STEP_AT,
    path,
    type: 'input',
    anchor: makeAnchor({ selector, tag: 'input', text: '', html: `<input id="${selector.slice(1)}">` }),
    value,
  };
}

export function consoleStep(id: string, message: string, count = 1): FlowStep {
  return { id, at: STEP_AT, path: '/login', type: 'console', source: 'error', message, count };
}

export function networkStep(id: string, status: number | null, count = 1): FlowStep {
  return {
    id,
    at: STEP_AT,
    path: '/login',
    type: 'network',
    method: 'POST',
    url: 'https://demo.web.app/api/login',
    status,
    count,
  };
}

export function makeFlow(overrides: Partial<Flow> = {}): Flow {
  return {
    expected: 'I land on the dashboard',
    actual: 'Nothing happens',
    startedAt: '2026-10-01T00:00:00.000Z',
    endedAt: '2026-10-01T00:01:00.000Z',
    steps: [clickStep('s1'), networkStep('s2', 500)],
    ...overrides,
  };
}

export function makeFlowItem(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return makeItem({
    kind: 'flow',
    comment: 'Sign-in fails',
    anchor: undefined,
    page: { url: 'https://demo.web.app/login', path: '/login', title: 'Sign in' },
    flow: makeFlow(),
    ...overrides,
  });
}
```

- [ ] **Step 5: Write the failing tests for `flow-item`**

Create `lib/flow/flow-item.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clickStep, inputStep, makeFlowItem, makeItem, networkStep } from '../test-helpers';
import { flowEditsOf, flowItem, flowPatch, isSendable, withValue } from './flow-item';
import type { FlowEdits, Recording } from './types';

const recording: Recording = {
  tabId: 7,
  projectId: 'proj',
  buildId: 'build_9',
  startPage: { url: 'https://demo.web.app/login', path: '/login', title: 'Sign in' },
  viewport: { width: 1280, height: 720, dpr: 2 },
  status: 'stopped',
  steps: [clickStep('s1'), networkStep('s2', 500)],
  startedAt: '2026-10-01T00:00:00.000Z',
  endedAt: '2026-10-01T00:02:00.000Z',
};

const edits: FlowEdits = {
  title: '  Sign-in fails  ',
  expected: ' Dashboard ',
  actual: 'Error 500',
  failedStepId: 's2',
  steps: recording.steps,
};

const env = { id: 'flow-1', now: new Date('2026-10-01T00:05:00.000Z') };

describe('flowItem', () => {
  it('builds a flow draft from a recording and the review edits', () => {
    expect(flowItem(recording, edits, env)).toEqual({
      id: 'flow-1',
      buildId: 'build_9',
      kind: 'flow',
      comment: 'Sign-in fails',
      page: recording.startPage,
      flow: {
        expected: 'Dashboard',
        actual: 'Error 500',
        failedStepId: 's2',
        startedAt: '2026-10-01T00:00:00.000Z',
        endedAt: '2026-10-01T00:02:00.000Z',
        steps: recording.steps,
      },
      viewport: recording.viewport,
      createdAt: '2026-10-01T00:05:00.000Z',
    });
  });

  it('drops a failing step that is no longer in the list', () => {
    const item = flowItem(recording, { ...edits, failedStepId: 'gone' }, env);
    expect(item.flow).not.toHaveProperty('failedStepId');
  });

  it('ends at the save time when the recording never stopped', () => {
    const { endedAt: _endedAt, ...open } = recording;
    expect(flowItem(open, edits, env).flow?.endedAt).toBe('2026-10-01T00:05:00.000Z');
  });
});

describe('flowEditsOf and flowPatch', () => {
  it('reads the editable fields of a flow draft', () => {
    const item = makeFlowItem({ flow: { ...makeFlowItem().flow!, failedStepId: 's2' } });
    expect(flowEditsOf(item)).toEqual({
      title: 'Sign-in fails',
      expected: 'I land on the dashboard',
      actual: 'Nothing happens',
      failedStepId: 's2',
      steps: item.flow!.steps,
    });
  });

  it('patches title and flow but keeps the recording times', () => {
    const item = makeFlowItem();
    const patch = flowPatch(item, {
      title: 'New title ',
      expected: '',
      actual: 'x',
      steps: [clickStep('s1')],
    });
    expect(patch).toEqual({
      comment: 'New title',
      flow: {
        expected: '',
        actual: 'x',
        startedAt: item.flow!.startedAt,
        endedAt: item.flow!.endedAt,
        steps: [clickStep('s1')],
      },
    });
  });
});

describe('withValue', () => {
  it('changes the value of an input step and the text of a note', () => {
    expect(withValue(inputStep('i', '#email', 'a'), 'b')).toMatchObject({ value: 'b' });
    const note = { id: 'n', at: 'x', path: '/', type: 'note' as const, text: 'old' };
    expect(withValue(note, 'new')).toMatchObject({ text: 'new' });
  });

  it('leaves other steps unchanged', () => {
    const step = clickStep('c');
    expect(withValue(step, 'x')).toBe(step);
  });
});

describe('isSendable', () => {
  it('sends every non-flow item and flows with a title', () => {
    expect(isSendable(makeItem())).toBe(true);
    expect(isSendable(makeItem({ kind: 'text-edit', comment: '' }))).toBe(true);
    expect(isSendable(makeFlowItem())).toBe(true);
  });

  it('holds back a flow without a title', () => {
    expect(isSendable(makeFlowItem({ comment: '   ' }))).toBe(false);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `pnpm vitest run lib/flow/flow-item.test.ts`
Expected: FAIL, cannot resolve `./flow-item`.

- [ ] **Step 7: Implement `flow-item`**

Create `lib/flow/flow-item.ts`:

```ts
import type { DraftPatch } from '../draft-store';
import { createItem } from '../feedback-factory';
import type { FeedbackItem, Flow, FlowStep } from '../types';
import type { FlowEdits, Recording } from './types';

export function flowFromEdits(
  times: { startedAt: string; endedAt: string },
  edits: FlowEdits,
): Flow {
  // A flagged step the reviewer deleted afterwards must not leave a dangling id.
  const failed =
    edits.failedStepId && edits.steps.some((step) => step.id === edits.failedStepId)
      ? { failedStepId: edits.failedStepId }
      : {};
  return {
    expected: edits.expected.trim(),
    actual: edits.actual.trim(),
    ...failed,
    startedAt: times.startedAt,
    endedAt: times.endedAt,
    steps: edits.steps,
  };
}

/** The draft a recording becomes once it is saved. */
export function flowItem(
  recording: Recording,
  edits: FlowEdits,
  env: { id: string; now: Date },
): FeedbackItem {
  const flow = flowFromEdits(
    { startedAt: recording.startedAt, endedAt: recording.endedAt ?? env.now.toISOString() },
    edits,
  );
  return createItem(
    {
      kind: 'flow',
      comment: edits.title,
      context: { projectId: recording.projectId, buildId: recording.buildId, ...recording.startPage },
      flow,
    },
    { id: env.id, now: env.now, viewport: recording.viewport },
  );
}

export function flowEditsOf(item: FeedbackItem): FlowEdits {
  const flow = item.flow;
  return {
    title: item.comment,
    expected: flow?.expected ?? '',
    actual: flow?.actual ?? '',
    ...(flow?.failedStepId ? { failedStepId: flow.failedStepId } : {}),
    steps: flow?.steps ?? [],
  };
}

export function flowPatch(item: FeedbackItem, edits: FlowEdits): DraftPatch {
  const times = {
    startedAt: item.flow?.startedAt ?? item.createdAt,
    endedAt: item.flow?.endedAt ?? item.createdAt,
  };
  return { comment: edits.title.trim(), flow: flowFromEdits(times, edits) };
}

/** Replaces the one value a step lets the reviewer correct: typed text, or a note. */
export function withValue(step: FlowStep, value: string): FlowStep {
  if (step.type === 'input') return { ...step, value };
  if (step.type === 'note') return { ...step, text: value };
  return step;
}

/** A workflow needs a title before it can be sent; auto-saved ones start without. */
export function isSendable(item: FeedbackItem): boolean {
  return item.kind !== 'flow' || item.comment.trim() !== '';
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm vitest run lib/flow/flow-item.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing API and handler tests**

In `lib/api/http-feedback-api.test.ts`, add `makeFlowItem` to the `../test-helpers` import, and add these cases at the end of the `describe` block:

```ts
  it('accepts workflows', async () => {
    const flow = { ...makeFlowItem({ id: 'f' }), author: { id: 'u1', name: 'Ada' }, status: 'open' };
    const { api } = setup([json([flow])]);
    expect((await api.submit('p1', [makeFlowItem()])).map((item) => item.id)).toEqual(['f']);
  });

  it('rejects workflows whose steps the panel could not show', async () => {
    const base = { ...makeFlowItem(), author: { id: 'u1', name: 'Ada' }, status: 'open' };
    const flow = base.flow!;
    const bad: unknown[] = [
      { ...base, flow: undefined },
      { ...base, flow: { ...flow, steps: 'none' } },
      { ...base, flow: { ...flow, expected: 1 } },
      { ...base, flow: { ...flow, steps: [{ id: 'x', path: '/', type: 'teleport' }] } },
      { ...base, flow: { ...flow, steps: [{ id: 'x', path: '/', type: 'click' }] } },
      { ...base, flow: { ...flow, steps: [{ id: 'x', path: '/', type: 'note' }] } },
    ];
    for (const item of bad) {
      const { api } = setup([json([item])]);
      await expect(api.submit('p1', [makeFlowItem()])).rejects.toThrow('unexpected response');
    }
  });
```

In `lib/background-handlers.test.ts`, add `makeFlowItem` to the `./test-helpers` import, and add inside `describe('handleRequest', …)`:

```ts
  it('never sends a workflow without a title, even when it is chosen', async () => {
    await addDraft('p1', makeFlowItem({ id: 'untitled', comment: '' }));
    await addDraft('p1', makeFlowItem({ id: 'titled' }));
    const api: FeedbackApi = {
      submit: vi.fn(async (_projectId: string, items: FeedbackItem[]) =>
        items.map((item) => ({ ...item, author: { id: 'u', name: 'U' }, status: 'open' as const })),
      ),
    };

    await handleRequest(
      { type: 'submit', projectId: 'p1', ids: ['untitled', 'titled'] },
      makeDeps({ createApi: () => api }),
    );

    expect(vi.mocked(api.submit).mock.calls[0]![1].map((item: FeedbackItem) => item.id)).toEqual(['titled']);
    expect((await listDrafts('p1')).map((d) => d.id)).toEqual(['untitled']);
  });
```

- [ ] **Step 10: Run them to verify they fail**

Run: `pnpm vitest run lib/api/http-feedback-api.test.ts lib/background-handlers.test.ts`
Expected: FAIL. "accepts workflows" rejects with "unexpected response"; the handler test sends both ids.

- [ ] **Step 11: Check `flow` items in the HTTP adapter**

In `lib/api/http-feedback-api.ts`, add above `isSentFeedback`:

```ts
function isStepAnchor(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.selector) &&
    isString(value.tag) &&
    isString(value.text) &&
    isString(value.html)
  );
}

/** Checks the fields the panel reads to label each step. */
function isFlowStep(value: unknown): boolean {
  if (!isRecord(value) || !isString(value.id) || !isString(value.path)) return false;
  switch (value.type) {
    case 'click':
    case 'check':
      return isStepAnchor(value.anchor);
    case 'input':
      return isStepAnchor(value.anchor) && isString(value.value);
    case 'select':
      return isStepAnchor(value.anchor) && isString(value.label);
    case 'key':
      return isString(value.key) && (value.anchor === undefined || isStepAnchor(value.anchor));
    case 'navigate':
    case 'left':
    case 'new-tab':
      return isString(value.url);
    case 'note':
      return isString(value.text);
    case 'console':
      return isString(value.source) && isString(value.message) && typeof value.count === 'number';
    case 'network':
      return isString(value.method) && isString(value.url) && typeof value.count === 'number';
    default:
      return false;
  }
}

function isFlow(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.expected) &&
    isString(value.actual) &&
    Array.isArray(value.steps) &&
    value.steps.every(isFlowStep)
  );
}
```

In `isSentFeedback`, replace the `kind` line:

```ts
    (value.kind === 'element' || value.kind === 'text-edit' || value.kind === 'page') &&
```

with:

```ts
    (value.kind === 'element' ||
      value.kind === 'text-edit' ||
      value.kind === 'page' ||
      value.kind === 'flow') &&
    (value.kind !== 'flow' || isFlow(value.flow)) &&
```

- [ ] **Step 12: Skip unsendable drafts in the background**

In `lib/background-handlers.ts`, add the import:

```ts
import { isSendable } from './flow/flow-item';
```

and in the `submit` case replace:

```ts
      const drafts = (await listDrafts(request.projectId)).filter((draft) => chosen.has(draft.id));
```

with:

```ts
      const drafts = (await listDrafts(request.projectId)).filter(
        (draft) => chosen.has(draft.id) && isSendable(draft),
      );
```

- [ ] **Step 13: Run all unit tests and the type check**

Run: `pnpm test && pnpm compile`
Expected: all tests PASS, no type errors.

- [ ] **Step 14: Commit**

```bash
git add lib/types.ts lib/feedback-factory.ts lib/draft-store.ts lib/test-helpers.ts lib/flow lib/api/http-feedback-api.ts lib/api/http-feedback-api.test.ts lib/background-handlers.ts lib/background-handlers.test.ts
git commit -m "feat: add the flow feedback kind and flow drafts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Step merging and step labels

**Files:**
- Create: `lib/flow/steps.ts`
- Create: `lib/flow/steps.test.ts`
- Create: `lib/flow/step-label.ts`
- Create: `lib/flow/step-label.test.ts`

**Interfaces:**
- Consumes: `FlowStep`, `Anchor` from `lib/types.ts`; test builders from Task 1.
- Produces:
  - `lib/flow/steps.ts`: `MAX_STEPS = 300`, `MAX_MESSAGE = 2000`, `addStep(steps: FlowStep[], step: FlowStep): { steps: FlowStep[]; limitReached: boolean }`.
  - `lib/flow/step-label.ts`: `elementName(anchor: Anchor): string`, `stepLabel(step: FlowStep): { text: string; source?: string }`, `stepAnchor(step: FlowStep): Anchor | undefined`, `stepTone(step: FlowStep): 'error' | 'warning' | 'note' | null`, `editableValue(step: FlowStep): string | null`, `errorCount(steps: FlowStep[]): number`, `flowSummary(steps: FlowStep[]): string`, `formatElapsed(ms: number): string`.

- [ ] **Step 1: Write the failing tests for `addStep`**

Create `lib/flow/steps.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clickStep, consoleStep, inputStep, networkStep } from '../test-helpers';
import type { FlowStep } from '../types';
import { MAX_STEPS, addStep } from './steps';

function addAll(steps: FlowStep[]): FlowStep[] {
  return steps.reduce<FlowStep[]>((list, step) => addStep(list, step).steps, []);
}

describe('addStep', () => {
  it('appends steps in order', () => {
    expect(addAll([clickStep('a'), clickStep('b')]).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('merges typing into the same field into one step with the latest value', () => {
    const steps = addAll([
      inputStep('i1', '#email', 'a'),
      inputStep('i2', '#email', 'ad'),
      inputStep('i3', '#email', 'ada'),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ id: 'i1', value: 'ada' });
  });

  it('keeps typing in different fields, or after another step, apart', () => {
    const steps = addAll([
      inputStep('i1', '#email', 'a'),
      inputStep('i2', '#password', 'b'),
      clickStep('c'),
      inputStep('i3', '#password', 'bc'),
    ]);
    expect(steps.map((s) => s.id)).toEqual(['i1', 'i2', 'c', 'i3']);
  });

  it('counts an error repeated back to back instead of adding steps', () => {
    const steps = addAll([consoleStep('e1', 'Boom'), consoleStep('e2', 'Boom'), consoleStep('e3', 'Other')]);
    expect(steps.map((s) => [s.id, s.type === 'console' && s.count])).toEqual([
      ['e1', 2],
      ['e3', 1],
    ]);
  });

  it('counts a repeated failed request but not one with another status', () => {
    const steps = addAll([networkStep('n1', 500), networkStep('n2', 500), networkStep('n3', 502)]);
    expect(steps.map((s) => [s.id, s.type === 'network' && s.count])).toEqual([
      ['n1', 2],
      ['n3', 1],
    ]);
  });

  it('survives an error storm without using up the step limit', () => {
    const storm = Array.from({ length: 1000 }, (_, i) => consoleStep(`e${i}`, 'Loop'));
    const steps = addAll(storm);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ count: 1000 });
  });

  it('drops a new step once the limit is reached and says so', () => {
    const full = Array.from({ length: MAX_STEPS }, (_, i) => clickStep(`c${i}`));
    const result = addStep(full, clickStep('extra'));
    expect(result.limitReached).toBe(true);
    expect(result.steps).toBe(full);
  });

  it('still merges a repeat when the list is full', () => {
    const full = [...Array.from({ length: MAX_STEPS - 1 }, (_, i) => clickStep(`c${i}`)), consoleStep('e', 'Boom')];
    const result = addStep(full, consoleStep('e2', 'Boom'));
    expect(result.limitReached).toBe(false);
    expect(result.steps.at(-1)).toMatchObject({ count: 2 });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run lib/flow/steps.test.ts`
Expected: FAIL, cannot resolve `./steps`.

- [ ] **Step 3: Implement `addStep`**

Create `lib/flow/steps.ts`:

```ts
import type { FlowStep } from '../types';

export const MAX_STEPS = 300;
export const MAX_MESSAGE = 2000;

function replaceLast(steps: FlowStep[], step: FlowStep): FlowStep[] {
  return [...steps.slice(0, -1), step];
}

/**
 * Adds a step to a recording. Typing into one field becomes one step holding the final value,
 * and an error repeated back to back is counted rather than listed again, so an error loop on
 * the page cannot use up the step limit.
 */
export function addStep(
  steps: FlowStep[],
  step: FlowStep,
): { steps: FlowStep[]; limitReached: boolean } {
  const last = steps.at(-1);
  if (last?.type === 'input' && step.type === 'input' && last.anchor.selector === step.anchor.selector) {
    return { steps: replaceLast(steps, { ...step, id: last.id }), limitReached: false };
  }
  if (
    last?.type === 'console' &&
    step.type === 'console' &&
    last.source === step.source &&
    last.message === step.message
  ) {
    return { steps: replaceLast(steps, { ...last, count: last.count + step.count }), limitReached: false };
  }
  if (
    last?.type === 'network' &&
    step.type === 'network' &&
    last.method === step.method &&
    last.url === step.url &&
    last.status === step.status
  ) {
    return { steps: replaceLast(steps, { ...last, count: last.count + step.count }), limitReached: false };
  }
  if (steps.length >= MAX_STEPS) return { steps, limitReached: true };
  return { steps: [...steps, step], limitReached: false };
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run lib/flow/steps.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for labels**

Create `lib/flow/step-label.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clickStep, consoleStep, inputStep, makeAnchor, networkStep } from '../test-helpers';
import type { FlowStep } from '../types';
import {
  editableValue,
  elementName,
  errorCount,
  flowSummary,
  formatElapsed,
  stepAnchor,
  stepLabel,
  stepTone,
} from './step-label';

const at = '2026-10-01T00:00:00.000Z';

describe('elementName', () => {
  it('prefers aria-label, from the element itself only', () => {
    const anchor = makeAnchor({ html: '<button aria-label="Close dialog"><span aria-label="x"></span></button>' });
    expect(elementName(anchor)).toBe('button "Close dialog"');
  });

  it('names form fields by placeholder, then name', () => {
    expect(elementName(makeAnchor({ tag: 'input', text: '', html: '<input placeholder="Email" name="e">' }))).toBe(
      'input "Email"',
    );
    expect(elementName(makeAnchor({ tag: 'select', text: 'Free Pro', html: '<select name="plan">' }))).toBe(
      'select "plan"',
    );
  });

  it('falls back to the visible text, shortened, then the selector', () => {
    expect(elementName(makeAnchor())).toBe('button "Sign in"');
    const long = 'x'.repeat(60);
    expect(elementName(makeAnchor({ text: long }))).toBe(`button "${'x'.repeat(39)}…"`);
    expect(elementName(makeAnchor({ tag: 'div', text: '', html: '<div>', selector: 'main > div' }))).toBe(
      'main > div',
    );
  });
});

describe('stepLabel', () => {
  const cases: Array<[FlowStep, string]> = [
    [clickStep('c'), 'Click button "Sign in"'],
    [
      { ...inputStep('i', '#email', 'ada@example.com'), anchor: makeAnchor({ tag: 'input', text: '', html: '<input placeholder="Email">' }) },
      'Type "ada@example.com" into input "Email"',
    ],
    [
      { id: 's', at, path: '/', type: 'select', anchor: makeAnchor({ tag: 'select', html: '<select name="plan">' }), value: 'pro', label: 'Pro' },
      'Select "Pro" in select "plan"',
    ],
    [{ id: 'k', at, path: '/', type: 'check', anchor: makeAnchor({ tag: 'input', text: '', html: '<input>', selector: '#remember' }), checked: false }, 'Uncheck #remember'],
    [{ id: 'k', at, path: '/', type: 'key', key: 'Escape' }, 'Press Escape'],
    [{ id: 'n', at, path: '/about.html', type: 'navigate', url: 'x', cause: 'load' }, 'Go to /about.html'],
    [{ id: 'n', at, path: '/a', type: 'navigate', url: 'x', cause: 'reload' }, 'Reload /a'],
    [{ id: 'n', at, path: '/a', type: 'navigate', url: 'x', cause: 'history' }, 'Back or forward to /a'],
    [{ id: 'l', at, path: '/', type: 'left', url: 'https://accounts.example.com/' }, 'Left the preview for https://accounts.example.com/'],
    [{ id: 't', at, path: '/', type: 'new-tab', url: 'https://docs.example.com/' }, 'Opened a new tab: https://docs.example.com/'],
    [{ id: 'o', at, path: '/', type: 'note', text: 'Slow here' }, 'Note: Slow here'],
    [consoleStep('e', 'Boom\n    at x.js:1', 3), 'Console error: Boom ×3'],
    [{ id: 'e', at, path: '/', type: 'console', source: 'exception', message: 'Error: Boom', count: 1 }, 'Uncaught exception: Error: Boom'],
    [networkStep('w', 500), 'POST /api/login → 500'],
    [networkStep('w', null, 2), 'POST /api/login → failed ×2'],
  ];

  it.each(cases)('labels %#', (step, text) => {
    expect(stepLabel(step).text).toBe(text);
  });

  it('gives the source location of an element step', () => {
    expect(stepLabel(clickStep('c')).source).toBe('src/pages/Login.tsx:48');
    const nearest = { ...clickStep('c'), anchor: makeAnchor({ source: undefined, nearestSource: 'src/A.tsx:3' }) };
    expect(stepLabel(nearest).source).toBe('src/A.tsx:3');
    expect(stepLabel(networkStep('w', 500)).source).toBeUndefined();
  });
});

describe('step helpers', () => {
  it('finds the anchor of element steps only', () => {
    expect(stepAnchor(clickStep('c'))?.selector).toBe('#submit');
    expect(stepAnchor(networkStep('w', 500))).toBeUndefined();
  });

  it('colours errors, failed requests and notes', () => {
    expect(stepTone(consoleStep('e', 'x'))).toBe('error');
    expect(stepTone(networkStep('w', 500))).toBe('warning');
    expect(stepTone({ id: 'o', at, path: '/', type: 'note', text: 'x' })).toBe('note');
    expect(stepTone(clickStep('c'))).toBeNull();
  });

  it('exposes the editable value of input and note steps', () => {
    expect(editableValue(inputStep('i', '#e', 'v'))).toBe('v');
    expect(editableValue({ id: 'o', at, path: '/', type: 'note', text: 't' })).toBe('t');
    expect(editableValue(clickStep('c'))).toBeNull();
  });

  it('summarises steps and errors', () => {
    expect(errorCount([clickStep('c'), consoleStep('e', 'x', 4), networkStep('w', 500)])).toBe(2);
    expect(flowSummary([clickStep('c')])).toBe('1 step · 0 errors');
    expect(flowSummary([clickStep('c'), consoleStep('e', 'x')])).toBe('2 steps · 1 error');
  });

  it('formats elapsed time as minutes and seconds', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65_400)).toBe('1:05');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm vitest run lib/flow/step-label.test.ts`
Expected: FAIL, cannot resolve `./step-label`.

- [ ] **Step 7: Implement the labels**

Create `lib/flow/step-label.ts`:

```ts
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
```

- [ ] **Step 8: Run them to verify they pass**

Run: `pnpm vitest run lib/flow/step-label.test.ts lib/flow/steps.test.ts && pnpm compile`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add lib/flow/steps.ts lib/flow/steps.test.ts lib/flow/step-label.ts lib/flow/step-label.test.ts
git commit -m "feat: merge repeated workflow steps and label them for the panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Console and network probe

**Files:**
- Create: `lib/flow/probe-format.ts`
- Create: `lib/flow/probe-format.test.ts`
- Create: `lib/flow/probe-events.ts`
- Create: `lib/flow/probe-events.test.ts`
- Create: `entrypoints/flow-probe.content.ts`

**Interfaces:**
- Consumes: `FlowAction` from `lib/types.ts`; `MAX_MESSAGE` from `lib/flow/steps.ts`; `truncate` from `lib/text.ts`.
- Produces:
  - `lib/flow/probe-format.ts` (imports nothing, so it is safe in the page's main world): `PROBE_TAG = 'vibe-flow-probe'`, `ProbeEvent`, `ProbeMessage = { tag: typeof PROBE_TAG; event: ProbeEvent }`, `formatValue(value: unknown): string`, `formatArgs(args: unknown[]): { message: string; stack?: string }`, `isFailedStatus(status: number): boolean`, `absoluteUrl(url: string | URL, base: string): string`.
  - `lib/flow/probe-events.ts`: `isProbeMessage(data: unknown): data is ProbeMessage`, `probeAction(event: ProbeEvent): FlowAction | null`.
  - A main-world content script that posts `ProbeMessage`s with `window.postMessage`.

- [ ] **Step 1: Write the failing tests for the formatters**

Create `lib/flow/probe-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { absoluteUrl, formatArgs, formatValue, isFailedStatus } from './probe-format';

describe('formatValue', () => {
  it('formats errors, strings and plain data', () => {
    expect(formatValue(new TypeError('bad'))).toBe('TypeError: bad');
    expect(formatValue('text')).toBe('text');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(formatValue(undefined)).toBe('undefined');
    expect(formatValue(function named() {})).toBe('[function named]');
  });

  it('never throws on values JSON cannot handle', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatValue(circular)).toBe('[object Object]');
    expect(formatValue(10n)).toBe('10');
    expect(formatValue(Symbol('s'))).toBe('Symbol(s)');
    expect(formatValue(Object.create(null))).toBe('{}');
    const hostile = { toJSON: () => { throw new Error('no'); }, toString: () => { throw new Error('no'); } };
    expect(formatValue(hostile)).toBe('[unprintable]');
  });
});

describe('formatArgs', () => {
  it('joins console arguments and keeps the stack of the first error', () => {
    const error = new Error('Boom');
    const result = formatArgs(['Failed:', error, 42]);
    expect(result.message).toBe('Failed: Error: Boom 42');
    expect(result.stack).toBe(error.stack);
  });

  it('has no stack when no argument is an error', () => {
    expect(formatArgs(['a', 'b'])).toEqual({ message: 'a b' });
  });
});

describe('isFailedStatus', () => {
  it('treats 4xx and 5xx as failures', () => {
    expect(isFailedStatus(404)).toBe(true);
    expect(isFailedStatus(500)).toBe(true);
    expect(isFailedStatus(200)).toBe(false);
    expect(isFailedStatus(304)).toBe(false);
    // An opaque no-cors response has status 0 and is not known to have failed.
    expect(isFailedStatus(0)).toBe(false);
  });
});

describe('absoluteUrl', () => {
  it('resolves relative URLs against the page', () => {
    expect(absoluteUrl('/api/login', 'https://demo.web.app/login')).toBe('https://demo.web.app/api/login');
    expect(absoluteUrl(new URL('https://x.dev/a'), 'https://demo.web.app/')).toBe('https://x.dev/a');
  });

  it('returns the input when it cannot be parsed', () => {
    expect(absoluteUrl('http://[bad', 'https://demo.web.app/')).toBe('http://[bad');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run lib/flow/probe-format.test.ts`
Expected: FAIL, cannot resolve `./probe-format`.

- [ ] **Step 3: Implement the formatters**

Create `lib/flow/probe-format.ts`:

```ts
/*
 * Runs inside the page's own JavaScript world, so it must not import extension APIs and must
 * never throw: an exception here would surface as the page's own error.
 */

export const PROBE_TAG = 'vibe-flow-probe';

export type ProbeEvent =
  | { kind: 'console'; source: 'error' | 'exception' | 'rejection'; message: string; stack?: string }
  | { kind: 'network'; method: string; url: string; status: number | null };

export type ProbeMessage = { tag: typeof PROBE_TAG; event: ProbeEvent };

export function formatValue(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // Circular structures, BigInts and hostile toJSON methods end up here.
  }
  try {
    return String(value);
  } catch {
    return '[unprintable]';
  }
}

export function formatArgs(args: unknown[]): { message: string; stack?: string } {
  const message = args.map(formatValue).join(' ');
  const error = args.find((arg): arg is Error => arg instanceof Error);
  return error?.stack ? { message, stack: error.stack } : { message };
}

export function isFailedStatus(status: number): boolean {
  return status >= 400;
}

export function absoluteUrl(url: string | URL, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return String(url);
  }
}
```

Note on the circular case: `JSON.stringify` throws, then `String(circular)` gives `[object Object]`. A null-prototype object stringifies to `{}` before `String` is ever needed.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run lib/flow/probe-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for probe events**

Create `lib/flow/probe-events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isProbeMessage, probeAction } from './probe-events';
import { PROBE_TAG } from './probe-format';
import { MAX_MESSAGE } from './steps';

describe('isProbeMessage', () => {
  it('accepts well-formed probe messages', () => {
    expect(isProbeMessage({ tag: PROBE_TAG, event: { kind: 'console', source: 'error', message: 'x' } })).toBe(true);
    expect(
      isProbeMessage({ tag: PROBE_TAG, event: { kind: 'network', method: 'GET', url: 'u', status: null } }),
    ).toBe(true);
  });

  it('rejects other messages the page posts', () => {
    expect(isProbeMessage(null)).toBe(false);
    expect(isProbeMessage('hello')).toBe(false);
    expect(isProbeMessage({ tag: 'other', event: { kind: 'console', source: 'error', message: 'x' } })).toBe(false);
    expect(isProbeMessage({ tag: PROBE_TAG, event: { kind: 'console', source: 'warn', message: 'x' } })).toBe(false);
    expect(isProbeMessage({ tag: PROBE_TAG, event: { kind: 'network', method: 'GET', url: 'u', status: '500' } })).toBe(
      false,
    );
  });
});

describe('probeAction', () => {
  it('turns a console event into a console step body, truncated', () => {
    const long = 'x'.repeat(MAX_MESSAGE + 10);
    expect(probeAction({ kind: 'console', source: 'exception', message: long, stack: long })).toEqual({
      type: 'console',
      source: 'exception',
      message: 'x'.repeat(MAX_MESSAGE),
      stack: 'x'.repeat(MAX_MESSAGE),
      count: 1,
    });
  });

  it('turns a failed request into a network step body', () => {
    expect(probeAction({ kind: 'network', method: 'post', url: 'https://a.dev/x', status: 500 })).toEqual({
      type: 'network',
      method: 'POST',
      url: 'https://a.dev/x',
      status: 500,
      count: 1,
    });
  });

  it('ignores requests to extension pages', () => {
    expect(probeAction({ kind: 'network', method: 'GET', url: 'chrome-extension://abc/x', status: 404 })).toBeNull();
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm vitest run lib/flow/probe-events.test.ts`
Expected: FAIL, cannot resolve `./probe-events`.

- [ ] **Step 7: Implement probe events**

Create `lib/flow/probe-events.ts`:

```ts
import { truncate } from '../text';
import type { FlowAction } from '../types';
import { PROBE_TAG, type ProbeEvent, type ProbeMessage } from './probe-format';
import { MAX_MESSAGE } from './steps';

const SOURCES: ReadonlySet<string> = new Set(['error', 'exception', 'rejection']);

/** Checks a `message` event's data, which any script on the page could have posted. */
export function isProbeMessage(data: unknown): data is ProbeMessage {
  const message = data as Partial<ProbeMessage> | null;
  if (typeof message !== 'object' || message === null || message.tag !== PROBE_TAG) return false;
  const event = message.event as Record<string, unknown> | undefined;
  if (typeof event !== 'object' || event === null) return false;
  if (event.kind === 'console') {
    return (
      typeof event.source === 'string' &&
      SOURCES.has(event.source) &&
      typeof event.message === 'string' &&
      (event.stack === undefined || typeof event.stack === 'string')
    );
  }
  if (event.kind === 'network') {
    return (
      typeof event.method === 'string' &&
      typeof event.url === 'string' &&
      (event.status === null || typeof event.status === 'number')
    );
  }
  return false;
}

export function probeAction(event: ProbeEvent): FlowAction | null {
  if (event.kind === 'console') {
    return {
      type: 'console',
      source: event.source,
      message: truncate(event.message, MAX_MESSAGE),
      ...(event.stack ? { stack: truncate(event.stack, MAX_MESSAGE) } : {}),
      count: 1,
    };
  }
  if (event.url.startsWith('chrome-extension:')) return null;
  return { type: 'network', method: event.method.toUpperCase(), url: event.url, status: event.status, count: 1 };
}
```

- [ ] **Step 8: Run them to verify they pass**

Run: `pnpm vitest run lib/flow/probe-events.test.ts`
Expected: PASS.

- [ ] **Step 9: Add the main-world probe**

Create `entrypoints/flow-probe.content.ts`:

```ts
import { defineContentScript } from '#imports';
import {
  PROBE_TAG,
  type ProbeEvent,
  type ProbeMessage,
  absoluteUrl,
  formatArgs,
  isFailedStatus,
} from '@/lib/flow/probe-format';

/*
 * Runs in the page's own world, from the very start of the document, so a workflow recording
 * also sees errors raised while a page loads. Every wrapper calls straight through to the
 * original and never changes what the page gets back. The isolated content script decides
 * whether a report is kept: only while the tab is recording.
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    const report = (event: ProbeEvent) => {
      try {
        const message: ProbeMessage = { tag: PROBE_TAG, event };
        window.postMessage(message, '*');
      } catch {
        // Never let reporting break the page.
      }
    };

    const originalError = console.error;
    console.error = function (this: Console, ...args: unknown[]) {
      try {
        report({ kind: 'console', source: 'error', ...formatArgs(args) });
      } catch {
        // Formatting must not stop the page's own logging.
      }
      return originalError.apply(this, args);
    };

    window.addEventListener('error', (event) => {
      try {
        const error: unknown = event.error;
        report({
          kind: 'console',
          source: 'exception',
          message: error instanceof Error ? `${error.name}: ${error.message}` : event.message,
          ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        });
      } catch {
        // See above.
      }
    });

    window.addEventListener('unhandledrejection', (event) => {
      try {
        report({ kind: 'console', source: 'rejection', ...formatArgs([event.reason]) });
      } catch {
        // See above.
      }
    });

    const originalFetch = window.fetch;
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const url = input instanceof Request ? input.url : absoluteUrl(input, location.href);
      try {
        const response = await originalFetch.call(window, input, init);
        if (isFailedStatus(response.status)) report({ kind: 'network', method, url, status: response.status });
        return response;
      } catch (error) {
        report({ kind: 'network', method, url, status: null });
        throw error;
      }
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      const method = String(args[0] ?? 'GET');
      const url = absoluteUrl(args[1] as string | URL, location.href);
      this.addEventListener('loadend', () => {
        // Status 0 means the request never got a response: network error, CORS or abort.
        const status = this.status === 0 ? null : this.status;
        if (status === null || isFailedStatus(status)) report({ kind: 'network', method, url, status });
      });
      return (originalOpen as (...openArgs: unknown[]) => void).apply(this, args);
    } as typeof XMLHttpRequest.prototype.open;
  },
});
```

- [ ] **Step 10: Check that the build includes the probe in the main world**

Run: `pnpm compile && pnpm build && grep -A3 '"flow-probe' .output/chrome-mv3/manifest.json; grep -n '"world"' .output/chrome-mv3/manifest.json`
Expected: no type errors; the manifest lists a content script `content-scripts/flow-probe.js` with `"world": "MAIN"` and `"run_at": "document_start"`.

- [ ] **Step 11: Commit**

```bash
git add lib/flow/probe-format.ts lib/flow/probe-format.test.ts lib/flow/probe-events.ts lib/flow/probe-events.test.ts entrypoints/flow-probe.content.ts
git commit -m "feat: report console errors and failed requests from the page's own world

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: DOM event capture

**Files:**
- Create: `lib/flow/capture.ts`
- Create: `lib/flow/capture.test.ts`

**Interfaces:**
- Consumes: `describeElement` from `lib/element-descriptor.ts`; `eventElement` from `lib/picker.ts`; `FlowAction` from `lib/types.ts`.
- Produces: `CAPTURED_EVENTS: readonly ['click', 'input', 'change', 'keydown']`, `clickTarget(element: Element): Element`, `actionFromEvent(event: Event, host: Element): FlowAction | null` (must be called while the event is being dispatched), `navigationCause(entry: PerformanceEntry | undefined): 'load' | 'reload' | 'history'`.

- [ ] **Step 1: Write the failing tests**

Create `lib/flow/capture.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { FlowAction } from '../types';
import { actionFromEvent, clickTarget, navigationCause } from './capture';

let host: HTMLElement;

/** Dispatches `event` on `target` and returns what a capture listener on window records. */
function record(target: EventTarget, event: Event): FlowAction | null {
  let action: FlowAction | null = null;
  const listener = (seen: Event) => {
    action = actionFromEvent(seen, host);
  };
  window.addEventListener(event.type, listener, true);
  target.dispatchEvent(event);
  window.removeEventListener(event.type, listener, true);
  return action;
}

const click = () => new MouseEvent('click', { bubbles: true, composed: true });
const input = () => new Event('input', { bubbles: true, composed: true });
const change = () => new Event('change', { bubbles: true, composed: true });
const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { bubbles: true, composed: true, ...init });

function el<T extends Element>(selector: string): T {
  return document.querySelector<T>(selector)!;
}

describe('actionFromEvent', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <button id="buy" type="button" data-vibe-source="src/A.tsx:3"><span id="label">Buy</span></button>
        <input id="email" placeholder="Email">
        <input id="remember" type="checkbox">
        <input id="volume" type="range" value="3">
        <select id="plan"><option value="free">Free</option><option value="pro">Pro</option></select>
        <textarea id="bio"></textarea>
        <div id="editor" contenteditable="true">Hi</div>
        <a id="link" href="#x">Go</a>
      </form>
      <div id="host"></div>`;
    host = el<HTMLElement>('#host');
    host.attachShadow({ mode: 'open' }).innerHTML = '<button id="inner">Save</button><input id="note">';
  });

  it('records a click on the nearest interactive element', () => {
    expect(record(el('#label'), click())).toMatchObject({
      type: 'click',
      anchor: { selector: '#buy', source: 'src/A.tsx:3' },
    });
  });

  it('ignores clicks that only focus a form field', () => {
    expect(record(el('#email'), click())).toBeNull();
    expect(record(el('#remember'), click())).toBeNull();
    expect(record(el('#plan'), click())).toBeNull();
  });

  it('ignores clicks and typing inside the extension UI', () => {
    const shadow = host.shadowRoot!;
    expect(record(shadow.querySelector('#inner')!, click())).toBeNull();
    expect(record(shadow.querySelector('#note')!, input())).toBeNull();
  });

  it('records typing with the current value, verbatim', () => {
    el<HTMLInputElement>('#email').value = 'ada@example.com';
    expect(record(el('#email'), input())).toMatchObject({
      type: 'input',
      anchor: { selector: '#email' },
      value: 'ada@example.com',
    });
    el<HTMLTextAreaElement>('#bio').value = 'Hello';
    expect(record(el('#bio'), input())).toMatchObject({ type: 'input', value: 'Hello' });
    expect(record(el('#editor'), input())).toMatchObject({ type: 'input', value: 'Hi' });
  });

  it('records choices on change, not on input', () => {
    expect(record(el('#remember'), input())).toBeNull();
    el<HTMLSelectElement>('#plan').value = 'pro';
    expect(record(el('#plan'), change())).toMatchObject({ type: 'select', value: 'pro', label: 'Pro' });
    el<HTMLInputElement>('#remember').checked = true;
    expect(record(el('#remember'), change())).toMatchObject({ type: 'check', checked: true });
    expect(record(el('#volume'), change())).toMatchObject({ type: 'input', value: '3' });
    // Text fields are already recorded through their input events.
    expect(record(el('#email'), change())).toBeNull();
  });

  it('records Enter, Escape and Tab with the focused element', () => {
    expect(record(el('#email'), key({ key: 'Enter' }))).toMatchObject({
      type: 'key',
      key: 'Enter',
      anchor: { selector: '#email' },
    });
    const onBody = record(document.body, key({ key: 'Escape' }));
    expect(onBody).toEqual({ type: 'key', key: 'Escape' });
  });

  it('ignores other keys, repeats and composition', () => {
    expect(record(el('#email'), key({ key: 'a' }))).toBeNull();
    expect(record(el('#email'), key({ key: 'Enter', repeat: true }))).toBeNull();
    expect(record(el('#email'), key({ key: 'Enter', isComposing: true }))).toBeNull();
  });
});

describe('clickTarget', () => {
  it('climbs to a link or button and otherwise keeps the element', () => {
    document.body.innerHTML = '<a id="a" href="#"><b id="b">x</b></a><p id="p"><i id="i">y</i></p>';
    expect(clickTarget(el('#b')).id).toBe('a');
    expect(clickTarget(el('#i')).id).toBe('i');
  });
});

describe('navigationCause', () => {
  it('maps navigation timing types', () => {
    expect(navigationCause({ type: 'reload' } as unknown as PerformanceEntry)).toBe('reload');
    expect(navigationCause({ type: 'back_forward' } as unknown as PerformanceEntry)).toBe('history');
    expect(navigationCause({ type: 'navigate' } as unknown as PerformanceEntry)).toBe('load');
    expect(navigationCause(undefined)).toBe('load');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run lib/flow/capture.test.ts`
Expected: FAIL, cannot resolve `./capture`.

- [ ] **Step 3: Implement capture**

Create `lib/flow/capture.ts`:

```ts
import { describeElement } from '../element-descriptor';
import { eventElement } from '../picker';
import type { FlowAction } from '../types';

export const CAPTURED_EVENTS = ['click', 'input', 'change', 'keydown'] as const;

const INTERACTIVE =
  'a[href], button, summary, label, [role="button"], [role="link"], [role="tab"], ' +
  '[role="menuitem"], [role="option"], [role="checkbox"], [role="switch"]';

/** Input types that are pressed like buttons rather than typed into or chosen from. */
const BUTTON_INPUTS: ReadonlySet<string> = new Set(['submit', 'button', 'reset', 'image']);
/** Input types whose value is chosen, not typed: recorded on change. */
const CHOICE_INPUTS: ReadonlySet<string> = new Set(['checkbox', 'radio', 'file', 'range', 'color', 'hidden']);
const KEYS: ReadonlySet<string> = new Set(['Enter', 'Escape', 'Tab']);

/** A click is about the control the reviewer meant, not the icon or span inside it. */
export function clickTarget(element: Element): Element {
  return element.closest(INTERACTIVE) ?? element;
}

function isEditable(element: Element): boolean {
  return element.matches('[contenteditable]:not([contenteditable="false"])');
}

function isTextEntry(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return !BUTTON_INPUTS.has(element.type) && !CHOICE_INPUTS.has(element.type);
  }
  return isEditable(element);
}

/** Fields are recorded by what changes in them, not by the click that focused them. */
function isFormField(element: Element): boolean {
  if (element instanceof HTMLInputElement) return !BUTTON_INPUTS.has(element.type);
  return (
    element instanceof HTMLSelectElement ||
    element instanceof HTMLOptionElement ||
    element instanceof HTMLTextAreaElement ||
    isEditable(element)
  );
}

function textValue(element: Element): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
  return element.textContent ?? '';
}

/**
 * The step a page event records, or null when it records nothing. Call it while the event is
 * being dispatched: `composedPath()` is empty afterwards.
 */
export function actionFromEvent(event: Event, host: Element): FlowAction | null {
  const target = eventElement(event, host);
  if (!target) return null;

  switch (event.type) {
    case 'click':
      return isFormField(target) ? null : { type: 'click', anchor: describeElement(clickTarget(target)) };

    case 'input':
      return isTextEntry(target)
        ? { type: 'input', anchor: describeElement(target), value: textValue(target) }
        : null;

    case 'change':
      if (target instanceof HTMLSelectElement) {
        const label = Array.from(target.selectedOptions, (option) => option.text.trim()).join(', ');
        return { type: 'select', anchor: describeElement(target), value: target.value, label };
      }
      if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio')) {
        return { type: 'check', anchor: describeElement(target), checked: target.checked };
      }
      if (target instanceof HTMLInputElement && CHOICE_INPUTS.has(target.type)) {
        return { type: 'input', anchor: describeElement(target), value: target.value };
      }
      return null;

    case 'keydown': {
      const keyboard = event as KeyboardEvent;
      if (!KEYS.has(keyboard.key) || keyboard.repeat || keyboard.isComposing) return null;
      const keyName = keyboard.key as 'Enter' | 'Escape' | 'Tab';
      return target === target.ownerDocument.body
        ? { type: 'key', key: keyName }
        : { type: 'key', key: keyName, anchor: describeElement(target) };
    }
  }
  return null;
}

/** How the current document was reached, from its navigation timing entry. */
export function navigationCause(entry: PerformanceEntry | undefined): 'load' | 'reload' | 'history' {
  const type = (entry as PerformanceNavigationTiming | undefined)?.type;
  if (type === 'reload') return 'reload';
  if (type === 'back_forward') return 'history';
  return 'load';
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run lib/flow/capture.test.ts && pnpm compile`
Expected: PASS, no type errors. If happy-dom lacks `HTMLSelectElement.selectedOptions`, the select test fails with `undefined is not iterable`. In that case replace the `label` line with `Array.from(target.options).filter((option) => option.selected).map(...)`, which works in both happy-dom and Chrome.

- [ ] **Step 5: Commit**

```bash
git add lib/flow/capture.ts lib/flow/capture.test.ts
git commit -m "feat: turn page events into workflow steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Recording store

**Files:**
- Create: `lib/flow/recording-store.ts`
- Create: `lib/flow/recording-store.test.ts`

**Interfaces:**
- Consumes: `addStep` from `lib/flow/steps.ts`; `Recording` from `lib/flow/types.ts`; `FlowStep`, `PageContext`, `Viewport` from `lib/types.ts`.
- Produces (all writes serialised through one promise queue):
  - `getRecording(tabId: number): Promise<Recording | null>`
  - `watchRecording(tabId: number, callback: (recording: Recording | null) => void): () => void`
  - `startRecording(input: { tabId: number; context: PageContext; viewport: Viewport; now: Date }): Promise<Recording>`: returns the tab's existing recording, whatever its state, instead of starting over.
  - `recordStep(tabId: number, step: FlowStep, now: Date): Promise<Recording | null>`: ignored unless `recording`; at the limit, stops with `limitReached: true`.
  - `pauseRecording(tabId: number, reason: 'user' | 'left'): Promise<Recording | null>`
  - `resumeRecording(tabId: number): Promise<Recording | null>`
  - `stopRecording(tabId: number, now: Date): Promise<Recording | null>`
  - `removeRecording(tabId: number): Promise<Recording | null>`: returns what was removed.

- [ ] **Step 1: Write the failing tests**

Create `lib/flow/recording-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { clickStep } from '../test-helpers';
import type { PageContext } from '../types';
import {
  getRecording,
  pauseRecording,
  recordStep,
  removeRecording,
  resumeRecording,
  startRecording,
  stopRecording,
  watchRecording,
} from './recording-store';
import { MAX_STEPS } from './steps';

const context: PageContext = {
  projectId: 'proj',
  buildId: 'build_1',
  path: '/login',
  url: 'https://demo.web.app/login',
  title: 'Sign in',
};
const viewport = { width: 1280, height: 720, dpr: 1 };
const now = new Date('2026-10-01T00:00:00.000Z');
const later = new Date('2026-10-01T00:03:00.000Z');

const start = (tabId = 1) => startRecording({ tabId, context, viewport, now });

describe('recording-store', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('starts a recording from the page context', async () => {
    expect(await start()).toEqual({
      tabId: 1,
      projectId: 'proj',
      buildId: 'build_1',
      startPage: { url: context.url, path: '/login', title: 'Sign in' },
      viewport,
      status: 'recording',
      steps: [],
      startedAt: now.toISOString(),
    });
    expect(await getRecording(1)).toMatchObject({ status: 'recording' });
    expect(await getRecording(2)).toBeNull();
  });

  it('returns the existing recording instead of starting over', async () => {
    await start();
    await recordStep(1, clickStep('a'), now);
    await stopRecording(1, later);
    const again = await start();
    expect(again).toMatchObject({ status: 'stopped', steps: [{ id: 'a' }] });
  });

  it('records steps only while recording', async () => {
    expect(await recordStep(1, clickStep('none'), now)).toBeNull();
    await start();
    await recordStep(1, clickStep('a'), now);
    await pauseRecording(1, 'user');
    await recordStep(1, clickStep('paused'), now);
    await resumeRecording(1);
    await recordStep(1, clickStep('b'), now);
    expect((await getRecording(1))?.steps.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('keeps every step when many arrive at once', async () => {
    await start();
    await Promise.all(Array.from({ length: 20 }, (_, i) => recordStep(1, clickStep(`s${i}`), now)));
    expect((await getRecording(1))?.steps).toHaveLength(20);
  });

  it('stops itself at the step limit', async () => {
    await start();
    for (let i = 0; i < MAX_STEPS; i += 1) await recordStep(1, clickStep(`s${i}`), now);
    const stopped = await recordStep(1, clickStep('extra'), later);
    expect(stopped).toMatchObject({ status: 'stopped', limitReached: true, endedAt: later.toISOString() });
    expect(stopped?.steps).toHaveLength(MAX_STEPS);
  });

  it('pauses with a reason, resumes, and stops', async () => {
    await start();
    expect(await pauseRecording(1, 'left')).toMatchObject({ status: 'paused', pausedReason: 'left' });
    const resumed = await resumeRecording(1);
    expect(resumed?.status).toBe('recording');
    expect(resumed).not.toHaveProperty('pausedReason');
    await pauseRecording(1, 'user');
    const stopped = await stopRecording(1, later);
    expect(stopped).toMatchObject({ status: 'stopped', endedAt: later.toISOString() });
    expect(stopped).not.toHaveProperty('pausedReason');
  });

  it('does not resume a stopped recording', async () => {
    await start();
    await stopRecording(1, later);
    expect((await resumeRecording(1))?.status).toBe('stopped');
  });

  it('removes a recording and hands it back', async () => {
    await start();
    expect(await removeRecording(1)).toMatchObject({ tabId: 1 });
    expect(await getRecording(1)).toBeNull();
    expect(await removeRecording(1)).toBeNull();
  });

  it('notifies watchers of their own tab only', async () => {
    const onTab1 = vi.fn();
    const unwatch = watchRecording(1, onTab1);
    await start(2);
    await start(1);
    expect(onTab1).toHaveBeenLastCalledWith(expect.objectContaining({ tabId: 1 }));
    await removeRecording(1);
    expect(onTab1).toHaveBeenLastCalledWith(null);
    unwatch();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run lib/flow/recording-store.test.ts`
Expected: FAIL, cannot resolve `./recording-store`.

- [ ] **Step 3: Implement the store**

Create `lib/flow/recording-store.ts`:

```ts
import { storage } from '#imports';
import type { FlowStep, PageContext, Viewport } from '../types';
import { addStep } from './steps';
import type { Recording } from './types';

type RecordingMap = Record<string, Recording>;

/**
 * One recording per tab. Session storage keeps it while the service worker sleeps and clears
 * it when the browser closes. Content scripts cannot read session storage, so they learn the
 * state from the background's messages; the panel watches it directly.
 */
const recordingsItem = storage.defineItem<RecordingMap>('session:recordings', { fallback: {} });

// Serialises read-modify-write cycles: keystrokes arrive faster than storage writes finish.
let queue: Promise<unknown> = Promise.resolve();

function mutate(
  tabId: number,
  change: (current: Recording | null) => Recording | null,
): Promise<Recording | null> {
  const run = queue.then(async () => {
    const all = await recordingsItem.getValue();
    const key = String(tabId);
    const { [key]: current = null, ...rest } = all;
    const next = change(current);
    if (next !== current) await recordingsItem.setValue(next ? { ...rest, [key]: next } : rest);
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function getRecording(tabId: number): Promise<Recording | null> {
  return (await recordingsItem.getValue())[String(tabId)] ?? null;
}

export function watchRecording(
  tabId: number,
  callback: (recording: Recording | null) => void,
): () => void {
  return recordingsItem.watch((all) => callback((all ?? {})[String(tabId)] ?? null));
}

export type StartInput = { tabId: number; context: PageContext; viewport: Viewport; now: Date };

/** Starts recording the tab, or returns the recording it already has, whatever its state. */
export async function startRecording(input: StartInput): Promise<Recording> {
  const { tabId, context, viewport, now } = input;
  const recording = await mutate(
    tabId,
    (current) =>
      current ?? {
        tabId,
        projectId: context.projectId,
        buildId: context.buildId,
        startPage: { url: context.url, path: context.path, title: context.title },
        viewport,
        status: 'recording',
        steps: [],
        startedAt: now.toISOString(),
      },
  );
  return recording as Recording;
}

export function recordStep(tabId: number, step: FlowStep, now: Date): Promise<Recording | null> {
  return mutate(tabId, (current) => {
    if (current?.status !== 'recording') return current;
    const { steps, limitReached } = addStep(current.steps, step);
    if (!limitReached) return { ...current, steps };
    return { ...current, status: 'stopped', limitReached: true, endedAt: now.toISOString() };
  });
}

export function pauseRecording(tabId: number, reason: 'user' | 'left'): Promise<Recording | null> {
  return mutate(tabId, (current) =>
    current?.status === 'recording' ? { ...current, status: 'paused', pausedReason: reason } : current,
  );
}

export function resumeRecording(tabId: number): Promise<Recording | null> {
  return mutate(tabId, (current) => {
    if (current?.status !== 'paused') return current;
    const { pausedReason: _reason, ...rest } = current;
    return { ...rest, status: 'recording' };
  });
}

export function stopRecording(tabId: number, now: Date): Promise<Recording | null> {
  return mutate(tabId, (current) => {
    if (current?.status !== 'recording' && current?.status !== 'paused') return current;
    const { pausedReason: _reason, ...rest } = current;
    return { ...rest, status: 'stopped', endedAt: now.toISOString() };
  });
}

export async function removeRecording(tabId: number): Promise<Recording | null> {
  let removed: Recording | null = null;
  await mutate(tabId, (current) => {
    removed = current;
    return null;
  });
  return removed;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run lib/flow/recording-store.test.ts && pnpm compile`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/flow/recording-store.ts lib/flow/recording-store.test.ts
git commit -m "feat: keep one workflow recording per tab in session storage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Background flow handling

**Files:**
- Modify: `lib/messages.ts`
- Create: `lib/flow/flow-handlers.ts`
- Create: `lib/flow/flow-handlers.test.ts`
- Modify: `lib/background-handlers.ts`
- Modify: `lib/background-handlers.test.ts`
- Modify: `entrypoints/background.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 and 5; `addDraft` from `lib/draft-store.ts`.
- Produces:
  - `lib/messages.ts`:
    - `FlowContentMessage = { type: 'flow-start'; context: PageContext; viewport: Viewport } | { type: 'flow-hello'; context: PageContext | null; url: string; navigation: 'load' | 'reload' | 'history' } | { type: 'flow-step'; step: FlowStep }`
    - `isFlowContentMessage(message: unknown): message is FlowContentMessage`
    - `FlowStatus = { type: 'flow-status'; state: RecordingState }` and `isFlowStatus(message: unknown): message is FlowStatus`
    - `BackgroundRequest` gains `flow-pause | flow-resume | flow-stop | flow-discard` (each `{ tabId: number }`), `flow-note` (`{ tabId; text; path }`) and `flow-save` (`{ tabId; edits: FlowEdits }`)
    - `FlowRequest = Extract<BackgroundRequest, { type: \`flow-${string}\` }>`
    - `BackgroundResponse` maps the first five to `null` and `'flow-save'` to `FeedbackItem`.
  - `lib/flow/flow-handlers.ts`:
    - `FlowDeps = { now: () => Date; newId: () => string; notify: (tabId: number, state: RecordingState) => void }`
    - `FlowHandlers = { content(message: FlowContentMessage, tabId: number): Promise<RecordingState>; request(request: FlowRequest): Promise<unknown>; tabCreated(tab: { id?: number; openerTabId?: number; pendingUrl?: string; url?: string }): Promise<void>; tabUpdated(tabId: number, url: string): Promise<void>; tabRemoved(tabId: number): Promise<void> }`
    - `createFlowHandlers(deps: FlowDeps): FlowHandlers`
  - `HandlerDeps` gains `flow: FlowHandlers`.

- [ ] **Step 1: Add the flow messages**

In `lib/messages.ts`, replace the first import with:

```ts
import type { FlowEdits, RecordingState } from './flow/types';
import type {
  FeedbackItem,
  FlowStep,
  Mode,
  PageContext,
  SentFeedback,
  Viewport,
} from './types';
```

Add after the `isPanelState` function:

```ts
/** Sent by a content script to the background about its tab's workflow recording. */
export type FlowContentMessage =
  /** Start recording this tab, or get back the recording it already has. */
  | { type: 'flow-start'; context: PageContext; viewport: Viewport }
  /** Sent when a document starts or comes back from the back/forward cache. */
  | { type: 'flow-hello'; context: PageContext | null; url: string; navigation: 'load' | 'reload' | 'history' }
  | { type: 'flow-step'; step: FlowStep };

const FLOW_CONTENT_TYPES: ReadonlyArray<FlowContentMessage['type']> = ['flow-start', 'flow-hello', 'flow-step'];

export function isFlowContentMessage(message: unknown): message is FlowContentMessage {
  const type = (message as { type?: unknown } | null)?.type;
  return typeof type === 'string' && (FLOW_CONTENT_TYPES as readonly string[]).includes(type);
}

/** Sent by the background to a tab whenever its recording changes. */
export type FlowStatus = { type: 'flow-status'; state: RecordingState };

export function isFlowStatus(message: unknown): message is FlowStatus {
  return (message as FlowStatus | null)?.type === 'flow-status';
}
```

Replace `BackgroundRequest`, `BackgroundResponse` and `REQUEST_TYPES` with:

```ts
export type BackgroundRequest =
  | { type: 'submit'; projectId: string; ids: string[] }
  | { type: 'sign-in' }
  | { type: 'sign-out' }
  | { type: 'auth-state' }
  | { type: 'flow-pause'; tabId: number }
  | { type: 'flow-resume'; tabId: number }
  | { type: 'flow-stop'; tabId: number }
  | { type: 'flow-discard'; tabId: number }
  | { type: 'flow-note'; tabId: number; text: string; path: string }
  | { type: 'flow-save'; tabId: number; edits: FlowEdits };

export type FlowRequest = Extract<BackgroundRequest, { type: `flow-${string}` }>;

export type BackgroundResponse = {
  submit: SentFeedback[];
  'sign-in': AuthState;
  'sign-out': AuthState;
  'auth-state': AuthState;
  'flow-pause': null;
  'flow-resume': null;
  'flow-stop': null;
  'flow-discard': null;
  'flow-note': null;
  'flow-save': FeedbackItem;
};
```

```ts
const REQUEST_TYPES: ReadonlyArray<BackgroundRequest['type']> = [
  'submit',
  'sign-in',
  'sign-out',
  'auth-state',
  'flow-pause',
  'flow-resume',
  'flow-stop',
  'flow-discard',
  'flow-note',
  'flow-save',
];
```

- [ ] **Step 2: Write the failing tests for the flow handlers**

Create `lib/flow/flow-handlers.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { listDrafts } from '../draft-store';
import { clickStep, networkStep } from '../test-helpers';
import type { PageContext } from '../types';
import { type FlowDeps, createFlowHandlers } from './flow-handlers';
import { getRecording } from './recording-store';

const TAB = 5;
const context: PageContext = {
  projectId: 'proj',
  buildId: 'b1',
  path: '/login',
  url: 'https://demo.web.app/login',
  title: 'Sign in',
};
const other: PageContext = { ...context, projectId: 'accounts.example.com', path: '/', url: 'https://accounts.example.com/' };
const viewport = { width: 1000, height: 800, dpr: 1 };

function setup() {
  let n = 0;
  const deps: FlowDeps = {
    now: () => new Date('2026-10-01T00:00:00.000Z'),
    newId: () => `id-${++n}`,
    notify: vi.fn(),
  };
  return { flow: createFlowHandlers(deps), deps };
}

async function started() {
  const handlers = setup();
  await handlers.flow.content({ type: 'flow-start', context, viewport }, TAB);
  return handlers;
}

const steps = async () => (await getRecording(TAB))?.steps ?? [];

describe('flow handlers', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('starts a recording and tells the tab', async () => {
    const { flow, deps } = setup();
    const state = await flow.content({ type: 'flow-start', context, viewport }, TAB);
    expect(state).toEqual({ status: 'recording', steps: 0 });
    expect(deps.notify).toHaveBeenCalledWith(TAB, { status: 'recording', steps: 0 });
  });

  it('records steps the content script sends', async () => {
    const { flow } = await started();
    const state = await flow.content({ type: 'flow-step', step: clickStep('c') }, TAB);
    expect(state).toEqual({ status: 'recording', steps: 1 });
  });

  it('records a new document in the same project as a navigate step', async () => {
    const { flow } = await started();
    await flow.content(
      { type: 'flow-hello', context: { ...context, path: '/home' }, url: 'https://demo.web.app/home', navigation: 'reload' },
      TAB,
    );
    expect(await steps()).toMatchObject([{ type: 'navigate', cause: 'reload', path: '/home', url: 'https://demo.web.app/home' }]);
  });

  it('pauses when the tab leaves the project and resumes when it returns', async () => {
    const { flow } = await started();
    const away = await flow.content({ type: 'flow-hello', context: other, url: other.url, navigation: 'load' }, TAB);
    expect(away.status).toBe('paused');
    expect(await steps()).toMatchObject([{ type: 'left', url: other.url, path: '/login' }]);

    await flow.content({ type: 'flow-step', step: clickStep('ignored') }, TAB);
    const back = await flow.content({ type: 'flow-hello', context, url: context.url, navigation: 'history' }, TAB);
    expect(back.status).toBe('recording');
    expect((await steps()).map((s) => s.type)).toEqual(['left', 'navigate']);
  });

  it('treats a page that is not a preview as leaving the project', async () => {
    const { flow } = await started();
    await flow.content({ type: 'flow-hello', context: null, url: 'https://x.dev/', navigation: 'load' }, TAB);
    expect((await getRecording(TAB))?.pausedReason).toBe('left');
  });

  it('records nothing on a new document while the reviewer has paused', async () => {
    const { flow } = await started();
    await flow.request({ type: 'flow-pause', tabId: TAB });
    await flow.content({ type: 'flow-hello', context, url: context.url, navigation: 'load' }, TAB);
    expect(await getRecording(TAB)).toMatchObject({ status: 'paused', pausedReason: 'user', steps: [] });
  });

  it('answers a hello from a tab that is not recording', async () => {
    const { flow, deps } = setup();
    const state = await flow.content({ type: 'flow-hello', context, url: context.url, navigation: 'load' }, TAB);
    expect(state).toEqual({ status: 'none', steps: 0 });
    expect(deps.notify).toHaveBeenCalledWith(TAB, { status: 'none', steps: 0 });
  });

  it('records a tab opened from the recorded tab, once its URL is known', async () => {
    const { flow } = await started();
    await flow.tabCreated({ id: 9, openerTabId: TAB, pendingUrl: 'https://docs.example.com/' });
    await flow.tabCreated({ id: 10, openerTabId: TAB, url: 'about:blank' });
    await flow.tabUpdated(10, 'about:blank');
    await flow.tabUpdated(10, 'https://help.example.com/');
    await flow.tabUpdated(10, 'https://help.example.com/again');
    await flow.tabCreated({ id: 11, openerTabId: 99, url: 'https://x.dev/' });
    expect(await steps()).toMatchObject([
      { type: 'new-tab', url: 'https://docs.example.com/' },
      { type: 'new-tab', url: 'https://help.example.com/' },
    ]);
  });

  it('inserts a note at the page the panel is on', async () => {
    const { flow } = await started();
    await flow.request({ type: 'flow-note', tabId: TAB, text: '  Slow here ', path: '/home' });
    expect(await steps()).toMatchObject([{ type: 'note', text: 'Slow here', path: '/home' }]);
  });

  it('stops, then saves a recording as a draft and forgets it', async () => {
    const { flow, deps } = await started();
    await flow.content({ type: 'flow-step', step: clickStep('c') }, TAB);
    await flow.content({ type: 'flow-step', step: networkStep('n', 500) }, TAB);
    await flow.request({ type: 'flow-stop', tabId: TAB });
    expect((await getRecording(TAB))?.status).toBe('stopped');

    const item = await flow.request({
      type: 'flow-save',
      tabId: TAB,
      edits: { title: 'Sign-in fails', expected: 'e', actual: 'a', failedStepId: 'n', steps: await steps() },
    });
    expect(item).toMatchObject({ kind: 'flow', comment: 'Sign-in fails', flow: { failedStepId: 'n' } });
    expect((await listDrafts('proj')).map((d) => d.kind)).toEqual(['flow']);
    expect(await getRecording(TAB)).toBeNull();
    expect(deps.notify).toHaveBeenLastCalledWith(TAB, { status: 'none', steps: 0 });
  });

  it('fails to save a recording that no longer exists', async () => {
    const { flow } = setup();
    await expect(
      flow.request({ type: 'flow-save', tabId: TAB, edits: { title: 't', expected: '', actual: '', steps: [] } }),
    ).rejects.toThrow('no longer exists');
  });

  it('discards a recording', async () => {
    const { flow } = await started();
    await flow.request({ type: 'flow-discard', tabId: TAB });
    expect(await getRecording(TAB)).toBeNull();
    expect(await listDrafts('proj')).toEqual([]);
  });

  it('keeps the steps of a closed tab as an untitled draft', async () => {
    const { flow } = await started();
    await flow.content({ type: 'flow-step', step: clickStep('c') }, TAB);
    await flow.tabRemoved(TAB);
    expect(await getRecording(TAB)).toBeNull();
    expect(await listDrafts('proj')).toMatchObject([{ kind: 'flow', comment: '', flow: { steps: [{ id: 'c' }] } }]);
  });

  it('saves nothing for a closed tab whose recording has no steps', async () => {
    const { flow } = await started();
    await flow.tabRemoved(TAB);
    expect(await listDrafts('proj')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run lib/flow/flow-handlers.test.ts`
Expected: FAIL, cannot resolve `./flow-handlers`.

- [ ] **Step 4: Implement the flow handlers**

Create `lib/flow/flow-handlers.ts`:

```ts
import { addDraft } from '../draft-store';
import type { FlowContentMessage, FlowRequest } from '../messages';
import type { FlowAction, FlowStep } from '../types';
import { flowItem } from './flow-item';
import {
  getRecording,
  pauseRecording,
  recordStep,
  removeRecording,
  resumeRecording,
  startRecording,
  stopRecording,
} from './recording-store';
import { type Recording, type RecordingState, recordingState } from './types';

export type FlowDeps = {
  now: () => Date;
  newId: () => string;
  /** Tells a tab's content script what its recording is doing now. */
  notify: (tabId: number, state: RecordingState) => void;
};

export type FlowHandlers = {
  content(message: FlowContentMessage, tabId: number): Promise<RecordingState>;
  request(request: FlowRequest): Promise<unknown>;
  tabCreated(tab: { id?: number; openerTabId?: number; pendingUrl?: string; url?: string }): Promise<void>;
  tabUpdated(tabId: number, url: string): Promise<void>;
  tabRemoved(tabId: number): Promise<void>;
};

const BLANK: ReadonlySet<string> = new Set(['', 'about:blank']);

export function createFlowHandlers(deps: FlowDeps): FlowHandlers {
  // Tabs opened from a recorded tab before their URL was known, mapped to the recorded tab.
  // Kept in memory only: losing it when the worker sleeps loses one "new tab" step at most.
  const awaitingUrl = new Map<number, number>();

  const step = (action: FlowAction, path: string): FlowStep => ({
    ...action,
    id: deps.newId(),
    at: deps.now().toISOString(),
    path,
  });

  const report = (tabId: number, recording: Recording | null): RecordingState => {
    const state = recordingState(recording);
    deps.notify(tabId, state);
    return state;
  };

  const lastPath = (recording: Recording) => recording.steps.at(-1)?.path ?? recording.startPage.path;

  const record = (tabId: number, recorded: FlowStep) => recordStep(tabId, recorded, deps.now());

  async function leave(tabId: number, recording: Recording, url: string): Promise<Recording | null> {
    await record(tabId, step({ type: 'left', url }, lastPath(recording)));
    return pauseRecording(tabId, 'left');
  }

  async function hello(
    message: Extract<FlowContentMessage, { type: 'flow-hello' }>,
    tabId: number,
  ): Promise<Recording | null> {
    const recording = await getRecording(tabId);
    if (!recording || recording.status === 'stopped') return recording;
    const { context } = message;
    const inProject = context !== null && context.projectId === recording.projectId;

    if (recording.status === 'paused') {
      // Only a pause caused by leaving the project ends by coming back to it.
      if (recording.pausedReason !== 'left' || !context || !inProject) return recording;
      await resumeRecording(tabId);
    } else if (!context || !inProject) {
      return leave(tabId, recording, message.url);
    }
    return record(tabId, step({ type: 'navigate', url: message.url, cause: message.navigation }, context.path));
  }

  async function newTab(openerId: number, url: string): Promise<void> {
    const recording = await getRecording(openerId);
    if (recording?.status !== 'recording') return;
    report(openerId, await record(openerId, step({ type: 'new-tab', url }, lastPath(recording))));
  }

  return {
    async content(message, tabId) {
      switch (message.type) {
        case 'flow-start':
          return report(
            tabId,
            await startRecording({ tabId, context: message.context, viewport: message.viewport, now: deps.now() }),
          );
        case 'flow-hello':
          return report(tabId, await hello(message, tabId));
        case 'flow-step':
          return report(tabId, await record(tabId, message.step));
      }
    },

    async request(request) {
      const { tabId } = request;
      switch (request.type) {
        case 'flow-pause':
          report(tabId, await pauseRecording(tabId, 'user'));
          return null;
        case 'flow-resume':
          report(tabId, await resumeRecording(tabId));
          return null;
        case 'flow-stop':
          report(tabId, await stopRecording(tabId, deps.now()));
          return null;
        case 'flow-discard':
          await removeRecording(tabId);
          report(tabId, null);
          return null;
        case 'flow-note':
          report(tabId, await record(tabId, step({ type: 'note', text: request.text.trim() }, request.path)));
          return null;
        case 'flow-save': {
          const recording = await getRecording(tabId);
          if (!recording) throw new Error('This recording no longer exists.');
          const item = flowItem(recording, request.edits, { id: deps.newId(), now: deps.now() });
          await addDraft(recording.projectId, item);
          await removeRecording(tabId);
          report(tabId, null);
          return item;
        }
      }
    },

    async tabCreated(tab) {
      if (tab.id === undefined || tab.openerTabId === undefined) return;
      const recording = await getRecording(tab.openerTabId);
      if (recording?.status !== 'recording') return;
      const url = tab.pendingUrl || tab.url || '';
      if (BLANK.has(url)) awaitingUrl.set(tab.id, tab.openerTabId);
      else await newTab(tab.openerTabId, url);
    },

    async tabUpdated(tabId, url) {
      const opener = awaitingUrl.get(tabId);
      if (opener === undefined || BLANK.has(url)) return;
      awaitingUrl.delete(tabId);
      await newTab(opener, url);
    },

    async tabRemoved(tabId) {
      awaitingUrl.delete(tabId);
      const recording = await removeRecording(tabId);
      if (!recording || recording.steps.length === 0) return;
      // Closing the tab must not lose the work; the draft needs a title before it can be sent.
      const item = flowItem(
        recording,
        { title: '', expected: '', actual: '', steps: recording.steps },
        { id: deps.newId(), now: deps.now() },
      );
      await addDraft(recording.projectId, item);
    },
  };
}
```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm vitest run lib/flow/flow-handlers.test.ts`
Expected: PASS.

- [ ] **Step 6: Delegate panel flow requests from `handleRequest`**

In `lib/background-handlers.ts`, add the import:

```ts
import type { FlowHandlers } from './flow/flow-handlers';
```

Add `flow: FlowHandlers;` as the last field of `HandlerDeps`. In `dispatch`, add before the closing brace of the `switch`:

```ts
    case 'flow-pause':
    case 'flow-resume':
    case 'flow-stop':
    case 'flow-discard':
    case 'flow-note':
    case 'flow-save':
      return deps.flow.request(request);
```

In `lib/background-handlers.test.ts`, add the import:

```ts
import { createFlowHandlers } from './flow/flow-handlers';
```

and add to the object returned by `makeDeps`, before `...overrides`:

```ts
    flow: createFlowHandlers({
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      newId: () => crypto.randomUUID(),
      notify: () => undefined,
    }),
```

Then add this test inside `describe('handleRequest', …)`:

```ts
  it('wraps flow request failures in a Result', async () => {
    const result = await handleRequest(
      { type: 'flow-save', tabId: 3, edits: { title: 't', expected: '', actual: '', steps: [] } },
      makeDeps(),
    );
    expect(result).toEqual({ ok: false, code: 'failed', error: 'This recording no longer exists.' });
    expect(isBackgroundRequest({ type: 'flow-note', tabId: 1, text: 'x', path: '/' })).toBe(true);
  });
```

- [ ] **Step 7: Wire the handlers into the service worker**

In `entrypoints/background.ts`, extend the imports:

```ts
import { createFlowHandlers } from '@/lib/flow/flow-handlers';
import {
  type FlowStatus,
  type SetPanel,
  isBackgroundRequest,
  isFlowContentMessage,
  isPanelState,
} from '@/lib/messages';
```

(replacing the existing `@/lib/messages` import). Replace:

```ts
  browser.tabs.onRemoved.addListener((tabId) => void setPanelOpen(tabId, false));
```

with:

```ts
  const flow = createFlowHandlers({
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    notify: (tabId, state) => {
      const message: FlowStatus = { type: 'flow-status', state };
      // The tab may be between documents; its next content script asks for the state itself.
      browser.tabs.sendMessage(tabId, message).catch(() => undefined);
    },
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void setPanelOpen(tabId, false);
    void flow.tabRemoved(tabId);
  });
  browser.tabs.onCreated.addListener((tab) => void flow.tabCreated(tab));
  // Host permissions reveal http and https URLs, which is all a new tab's step needs.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) void flow.tabUpdated(tabId, changeInfo.url);
  });
```

Add `flow,` as the last property of the `deps: HandlerDeps` object. In the `onMessage` listener, add before `if (!isBackgroundRequest(message)) return;`:

```ts
    if (isFlowContentMessage(message)) {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      flow.content(message, tabId).then(sendResponse);
      return true;
    }
```

- [ ] **Step 8: Run all unit tests, the type check and the existing end-to-end tests**

Run: `pnpm test && pnpm compile && pnpm test:e2e`
Expected: all PASS. No behaviour visible to the reviewer has changed yet.

- [ ] **Step 9: Commit**

```bash
git add lib/messages.ts lib/flow/flow-handlers.ts lib/flow/flow-handlers.test.ts lib/background-handlers.ts lib/background-handlers.test.ts entrypoints/background.ts
git commit -m "feat: handle workflow recordings in the background

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Recording on the page

**Files:**
- Modify: `lib/messages.ts` (`PanelToContent`)
- Create: `components/use-flow-recorder.ts`
- Create: `components/RecordingBadge.tsx`
- Modify: `components/App.tsx`
- Modify: `components/PanelFrame.tsx`
- Modify: `entrypoints/content/style.css`
- Modify: `entrypoints/panel/App.tsx`
- Modify: `entrypoints/panel/style.css`
- Modify: `e2e/serve.mjs`
- Create: `e2e/pages/flow.html`
- Create: `e2e/flow.spec.ts`

**Interfaces:**
- Consumes: `actionFromEvent`, `CAPTURED_EVENTS`, `navigationCause` (Task 4); `isProbeMessage`, `probeAction` (Task 3); `FlowContentMessage`, `isFlowStatus` (Task 6); `RecordingState`, `isRecordingState` (Task 1).
- Produces:
  - `PanelToContent` gains `{ type: 'start-recording' }`.
  - `useFlowRecorder(ctx: ContentScriptContext, host: HTMLElement): { state: RecordingState; start: (context: PageContext) => void }`.
  - `<RecordingBadge state={RecordingState} />` renders `.vf-rec` with role `status`.
  - `PanelFrame` takes `recording: boolean`.
  - The panel toolbar has a **Record workflow** button.

- [ ] **Step 1: Add the test page and the failing end-to-end test**

In `e2e/serve.mjs`, add as the first statement inside the request handler, before the `pathname` line:

```js
  // Lets test pages make a request that fails.
  if (request.url?.startsWith('/api/')) {
    response.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"boom"}');
    return;
  }
```

Create `e2e/pages/flow.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Sign in · Demo Shop</title>
    <meta name="vibe:project-id" content="demo-project" />
    <meta name="vibe:build-id" content="build-001" />
    <style>
      body { max-width: 720px; margin: 0 auto; padding: 16px 24px; font: 16px/1.5 system-ui, sans-serif; }
      form { display: grid; gap: 8px; max-width: 320px; }
    </style>
  </head>
  <body>
    <h1 data-vibe-source="src/pages/Login.tsx:10">Sign in</h1>
    <form id="login" data-vibe-source="src/pages/Login.tsx:20">
      <input id="email" name="email" placeholder="Email" data-vibe-source="src/pages/Login.tsx:31" />
      <input id="password" name="password" type="password" placeholder="Password" data-vibe-source="src/pages/Login.tsx:32" />
      <select id="plan" name="plan" data-vibe-source="src/pages/Login.tsx:33">
        <option value="free">Free</option>
        <option value="pro">Pro</option>
      </select>
      <label><input id="remember" type="checkbox" data-vibe-source="src/pages/Login.tsx:34" /> Remember me</label>
      <button id="submit" type="submit" data-vibe-source="src/pages/Login.tsx:48">Sign in</button>
    </form>
    <p><button id="crash" type="button" data-vibe-source="src/pages/Login.tsx:60">Crash</button></p>
    <p><a id="about-link" href="./about.html">About</a></p>
    <script>
      document.getElementById('login').addEventListener('submit', async (event) => {
        event.preventDefault();
        const response = await fetch('/api/login', { method: 'POST' });
        document.title = 'status ' + response.status;
      });
      document.getElementById('crash').addEventListener('click', () => {
        console.error('About to crash');
        throw new Error('Boom');
      });
    </script>
  </body>
</html>
```

Create `e2e/flow.spec.ts`:

```ts
import type { Worker } from '@playwright/test';
import type { browser } from 'wxt/browser';
import { expect, test } from './fixtures';
import { openReview } from './helpers';

// `worker.evaluate` callbacks run inside the extension's service worker, where `chrome` exists.
declare const chrome: typeof browser;

type StoredStep = Record<string, unknown> & { type: string };

/** The one recording in session storage, as the background keeps it. */
async function storedRecording(worker: Worker) {
  return worker.evaluate(async () => {
    const { recordings } = await chrome.storage.session.get('recordings');
    const all = (recordings ?? {}) as Record<string, { status: string; steps: StoredStep[] }>;
    return Object.values(all)[0] ?? null;
  });
}

async function storedTypes(worker: Worker): Promise<string[]> {
  return (await storedRecording(worker))?.steps.map((step) => step.type) ?? [];
}

test('a recording captures entries, clicks, errors and page changes', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'flow.html');
  await panel.getByRole('button', { name: 'Record workflow' }).click();
  await expect(page.getByRole('status')).toContainText('REC');

  await page.locator('#email').fill('ada@example.com');
  await page.locator('#password').fill('hunter2');
  await page.locator('#plan').selectOption('pro');
  await page.locator('#remember').check();
  await page.locator('#submit').click();
  await expect(page).toHaveTitle('status 500');
  await page.locator('#crash').click();
  await page.locator('#about-link').click();
  await expect(page).toHaveTitle('About · Demo Shop');

  await expect
    .poll(() => storedTypes(worker))
    .toEqual(['input', 'input', 'select', 'check', 'click', 'network', 'click', 'console', 'console', 'click', 'navigate']);
  const steps = (await storedRecording(worker))!.steps;
  expect(steps[0]).toMatchObject({ value: 'ada@example.com', anchor: { source: 'src/pages/Login.tsx:31' } });
  // Values are recorded verbatim, passwords included.
  expect(steps[1]).toMatchObject({ value: 'hunter2' });
  expect(steps[5]).toMatchObject({ method: 'POST', status: 500, url: 'http://localhost:4173/api/login' });
  expect(steps[7]).toMatchObject({ source: 'error', message: 'About to crash' });
  expect(steps[8]).toMatchObject({ source: 'exception', message: 'Error: Boom' });
  expect(steps[10]).toMatchObject({ cause: 'load', path: '/about.html' });

  // The new page keeps recording and still shows the badge.
  await expect(page.getByRole('status')).toContainText('REC');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:e2e e2e/flow.spec.ts`
Expected: FAIL, no button named "Record workflow".

- [ ] **Step 3: Add the start message**

In `lib/messages.ts`, add a member to `PanelToContent`:

```ts
  | { type: 'start-recording' }
```

- [ ] **Step 4: Write the content-side recorder hook**

Create `components/use-flow-recorder.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentScriptContext } from '#imports';
import { browser } from 'wxt/browser';
import { REQUIRE_PREVIEW_MARKERS } from '@/lib/config';
import { currentEnv } from '@/lib/feedback-factory';
import { CAPTURED_EVENTS, actionFromEvent, navigationCause } from '@/lib/flow/capture';
import { isProbeMessage, probeAction } from '@/lib/flow/probe-events';
import { type RecordingState, isRecordingState } from '@/lib/flow/types';
import { type FlowContentMessage, isFlowStatus } from '@/lib/messages';
import { readPageContext, routePath } from '@/lib/page-context';
import type { FlowAction, FlowStep, PageContext } from '@/lib/types';

const IDLE: RecordingState = { status: 'none', steps: 0 };

function toBackground(message: FlowContentMessage): Promise<RecordingState | null> {
  return browser.runtime.sendMessage(message).then(
    (reply: unknown) => (isRecordingState(reply) ? reply : null),
    () => null,
  );
}

function makeStep(action: FlowAction): FlowStep {
  return { ...action, id: crypto.randomUUID(), at: new Date().toISOString(), path: routePath(location) };
}

/**
 * Records the reviewer's actions on this page while the background says the tab is recording.
 * Errors the page reports before the background has answered are held back, so a recording
 * also catches what goes wrong while a page loads.
 */
export function useFlowRecorder(ctx: ContentScriptContext, host: HTMLElement) {
  const [state, setState] = useState<RecordingState>(IDLE);
  const recordingRef = useRef(false);
  recordingRef.current = state.status === 'recording';
  // Steps captured before the background's first answer; null once it has answered.
  const pendingRef = useRef<FlowStep[] | null>([]);

  const sendStep = useCallback((step: FlowStep) => {
    void toBackground({ type: 'flow-step', step }).then((reply) => {
      if (reply) setState(reply);
    });
  }, []);

  const record = useCallback(
    (action: FlowAction) => {
      const step = makeStep(action);
      if (pendingRef.current) pendingRef.current.push(step);
      else if (recordingRef.current) sendStep(step);
    },
    [sendStep],
  );

  useEffect(() => {
    const hello = (navigation: 'load' | 'reload' | 'history') => {
      const context = readPageContext(document, location, { requireMarkers: REQUIRE_PREVIEW_MARKERS });
      void toBackground({ type: 'flow-hello', context, url: location.href, navigation }).then((reply) => {
        const held = pendingRef.current ?? [];
        pendingRef.current = null;
        if (!reply) return;
        setState(reply);
        // The background has recorded the navigation by now, so held errors land after it.
        if (reply.status === 'recording') held.forEach(sendStep);
      });
    };
    hello(navigationCause(performance.getEntriesByType('navigation')[0]));

    // A page restored from the back/forward cache keeps this script but is a new step.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) hello('history');
    };
    const onStatus = (message: unknown) => {
      if (isFlowStatus(message)) setState(message.state);
    };
    const onProbe = (event: MessageEvent) => {
      if (event.source !== window || !isProbeMessage(event.data)) return;
      const action = probeAction(event.data.event);
      if (action) record(action);
    };
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('message', onProbe);
    browser.runtime.onMessage.addListener(onStatus);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('message', onProbe);
      browser.runtime.onMessage.removeListener(onStatus);
    };
  }, [record, sendStep]);

  // Listening on window in the capture phase sees events before the page can stop them.
  useEffect(() => {
    if (state.status !== 'recording') return;
    const onEvent = (event: Event) => {
      const action = actionFromEvent(event, host);
      if (action) record(action);
    };
    for (const type of CAPTURED_EVENTS) window.addEventListener(type, onEvent, true);
    return () => {
      for (const type of CAPTURED_EVENTS) window.removeEventListener(type, onEvent, true);
    };
  }, [state.status, host, record]);

  // Same-document route changes. The event fires before the new URL is committed.
  useEffect(() => {
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      ctx.setTimeout(() => {
        if (recordingRef.current) record({ type: 'navigate', url: location.href, cause: 'route' });
      }, 0);
    });
  }, [ctx, record]);

  const start = useCallback((context: PageContext) => {
    void toBackground({ type: 'flow-start', context, viewport: currentEnv(window).viewport }).then((reply) => {
      if (reply) setState(reply);
    });
  }, []);

  return { state, start };
}
```

- [ ] **Step 5: Add the badge**

Create `components/RecordingBadge.tsx`:

```tsx
import type { RecordingState } from '@/lib/flow/types';

/** Tells the reviewer the tab is being recorded, even with the panel folded or closed. */
export function RecordingBadge({ state }: { state: RecordingState }) {
  if (state.status !== 'recording' && state.status !== 'paused') return null;
  const paused = state.status === 'paused';
  return (
    <div className={paused ? 'vf-rec vf-rec--paused' : 'vf-rec'} role="status">
      <span className="vf-rec__dot" aria-hidden="true" />
      {paused ? 'Paused' : 'REC'} · {state.steps}
    </div>
  );
}
```

Append to `entrypoints/content/style.css`:

```css
/* Recording badge: top left, away from the floating panel and from pins on the right. */
.vf-rec {
  position: fixed;
  top: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px 3px 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #fafaf9;
  background: #1c1917;
  border-radius: 999px;
  box-shadow: 0 1px 4px rgba(12, 10, 9, 0.35);
  pointer-events: none;
}

.vf-rec__dot,
.vf-panel__rec {
  width: 8px;
  height: 8px;
  background: #e5484d;
  border-radius: 50%;
  animation: vf-rec-pulse 1.4s ease-in-out infinite;
}

.vf-rec--paused .vf-rec__dot {
  background: #a6a09b;
  animation: none;
}

.vf-panel__rec {
  flex: none;
}

@keyframes vf-rec-pulse {
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .vf-rec__dot,
  .vf-panel__rec {
    animation: none;
  }
}
```

- [ ] **Step 6: Show the dot on the floating panel's title bar**

In `components/PanelFrame.tsx`, change the props:

```tsx
type Props = { drafts: number; recording: boolean; onClose: () => void };
```

and the signature to `export function PanelFrame({ drafts, recording, onClose }: Props) {`. In the header, add before `<span className="vf-panel__title">Auto Agent</span>`:

```tsx
        {recording && <span className="vf-panel__rec" role="img" aria-label="Recording" title="Recording" />}
```

- [ ] **Step 7: Start recordings from the content App**

In `components/App.tsx`:

1. Add imports:

```tsx
import { RecordingBadge } from './RecordingBadge';
import { useFlowRecorder } from './use-flow-recorder';
```

2. After `const contextRef = useRef(context);` and its assignment line, add:

```tsx
  const recorder = useFlowRecorder(ctx, host);
```

3. In the `usePanelPort` switch, add a case:

```tsx
      case 'start-recording':
        if (current) {
          // Picking swallows the page's clicks, so a recording always runs with picking off.
          setComposer(null);
          setMode('off');
          recorder.start(withLiveTitle(current));
        }
        break;
```

4. Replace the `panel` line:

```tsx
  const panel = panelOpen && <PanelFrame drafts={drafts.length} onClose={closePanel} />;
```

with:

```tsx
  const recordingActive = recorder.state.status === 'recording' || recorder.state.status === 'paused';
  const panel = (
    <>
      <RecordingBadge state={recorder.state} />
      {panelOpen && <PanelFrame drafts={drafts.length} recording={recordingActive} onClose={closePanel} />}
    </>
  );
```

- [ ] **Step 8: Add the Record button to the panel**

In `entrypoints/panel/App.tsx`, add after the `addPageComment` function:

```tsx
  const startRecording = () => {
    setMode('off');
    send({ type: 'start-recording' });
  };
```

and replace:

```tsx
          <button type="button" onClick={() => setPageComment('')}>
            Add page comment
          </button>
        </div>
```

with:

```tsx
          <div className="toolbar__actions">
            <button type="button" onClick={() => setPageComment('')}>
              Add page comment
            </button>
            <button type="button" onClick={startRecording}>
              Record workflow
            </button>
          </div>
        </div>
```

In `entrypoints/panel/style.css`, add `flex-wrap: wrap;` to the existing `.toolbar` rule, and add after it:

```css
.toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
```

- [ ] **Step 9: Run the end-to-end tests**

Run: `pnpm compile && pnpm test:e2e`
Expected: all PASS, including `e2e/flow.spec.ts`. If the step order differs only by the position of the `network` step, the request finished after the next click. Add `await expect.poll(() => storedTypes(worker)).toContain('network');` after the title check instead of loosening the final assertion.

- [ ] **Step 10: Commit**

```bash
git add lib/messages.ts components/use-flow-recorder.ts components/RecordingBadge.tsx components/App.tsx components/PanelFrame.tsx entrypoints/content/style.css entrypoints/panel/App.tsx entrypoints/panel/style.css e2e/serve.mjs e2e/pages/flow.html e2e/flow.spec.ts
git commit -m "feat: record workflows on the page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Recording controls in the panel

**Files:**
- Create: `entrypoints/panel/flow-hooks.ts`
- Create: `entrypoints/panel/FlowSteps.tsx`
- Create: `entrypoints/panel/RecordingBar.tsx`
- Modify: `entrypoints/panel/icons.tsx`
- Modify: `entrypoints/panel/App.tsx`
- Modify: `entrypoints/panel/style.css`
- Modify: `e2e/flow.spec.ts`

**Interfaces:**
- Consumes: `getRecording`, `watchRecording` (Task 5); `stepLabel`, `stepTone`, `stepAnchor`, `editableValue`, `errorCount`, `formatElapsed` (Task 2); `withValue` (Task 1); `sendToBackground` and the flow requests (Task 6).
- Produces:
  - `useRecording(tabId: number | null): Recording | null` and `useNow(intervalMs: number): number` in `entrypoints/panel/flow-hooks.ts`.
  - `<FlowSteps steps failedStepId? missing? live? onHover? onFlag? onDelete? onChange? onGoTo? />`. Every handler is optional, and a tool button appears only when its handler is given. Tool button names: "Go to", "Mark as failing step" / "Clear failing step", "Edit step", "Delete step".
  - `<RecordingBar recording onPause onResume onStop onNote />` renders a region named "Recording".
  - Icons `flag`, `goto`.

- [ ] **Step 1: Write the failing end-to-end test**

Append to `e2e/flow.spec.ts`:

```ts
test('the panel lists steps live, takes notes, pauses and stops', async ({ context, worker, extensionId }) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'flow.html');
  await panel.getByRole('button', { name: 'Record workflow' }).click();
  const bar = panel.getByRole('region', { name: 'Recording' });
  await expect(bar).toBeVisible();

  await page.locator('#email').fill('ada@example.com');
  await expect(bar.getByText('Type "ada@example.com" into input "Email"')).toBeVisible();
  await expect(bar.getByText('src/pages/Login.tsx:31')).toBeVisible();

  await bar.getByRole('button', { name: 'Note' }).click();
  await bar.getByRole('textbox', { name: 'Note' }).fill('Looks slow');
  await bar.getByRole('button', { name: 'Add note' }).click();
  await expect(bar.getByText('Note: Looks slow')).toBeVisible();

  await bar.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('status')).toContainText('Paused');
  await page.locator('#password').fill('hunter2');
  await bar.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('status')).toContainText('REC');
  await expect(bar.getByText(/hunter2/)).toHaveCount(0);
  await expect(bar).toContainText('2 steps');

  await bar.getByRole('button', { name: 'Stop' }).click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect.poll(async () => (await storedRecording(worker))?.status).toBe('stopped');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:e2e e2e/flow.spec.ts`
Expected: the new test FAILS, no region named "Recording".

- [ ] **Step 3: Add the panel hooks**

Create `entrypoints/panel/flow-hooks.ts`:

```ts
import { useEffect, useState } from 'react';
import { getRecording, watchRecording } from '@/lib/flow/recording-store';
import type { Recording } from '@/lib/flow/types';

/** The recording of the tab this panel reviews, kept up to date as steps arrive. */
export function useRecording(tabId: number | null): Recording | null {
  const [recording, setRecording] = useState<Recording | null>(null);

  useEffect(() => {
    if (tabId === null) {
      setRecording(null);
      return;
    }
    let active = true;
    void getRecording(tabId).then((current) => {
      if (active) setRecording(current);
    });
    const unwatch = watchRecording(tabId, setRecording);
    return () => {
      active = false;
      unwatch();
    };
  }, [tabId]);

  return recording;
}

/** The current time, refreshed every `intervalMs`, for elapsed-time displays. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
```

- [ ] **Step 4: Add the icons**

In `entrypoints/panel/icons.tsx`, add to `PATHS`:

```ts
  flag: ['M6 21V4', 'M6 4h12l-3 4.5L18 13H6'],
  goto: ['M4 12h14', 'M13 6l6 6-6 6'],
```

- [ ] **Step 5: Add the step list**

Create `entrypoints/panel/FlowSteps.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { withValue } from '@/lib/flow/flow-item';
import { editableValue, stepAnchor, stepLabel, stepTone } from '@/lib/flow/step-label';
import type { FlowStep } from '@/lib/types';
import { IconButton } from './icons';

type Props = {
  steps: FlowStep[];
  failedStepId?: string;
  /** Ids of steps whose element could not be found on the page. */
  missing?: ReadonlySet<string>;
  /** The live list while recording: fixed height, kept scrolled to the newest step. */
  live?: boolean;
  onHover?: (step: FlowStep | null) => void;
  onFlag?: (id: string) => void;
  onDelete?: (id: string) => void;
  onChange?: (step: FlowStep) => void;
  onGoTo?: (step: FlowStep) => void;
};

/** One list for the live recording, the review screen and sent workflows; tools appear per handler. */
export function FlowSteps({ steps, failedStepId, missing, live, onHover, onFlag, onDelete, onChange, onGoTo }: Props) {
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Scrolls the list itself; scrollIntoView could also scroll the page around the panel.
  useEffect(() => {
    const list = listRef.current;
    if (live && list) list.scrollTop = list.scrollHeight;
  }, [live, steps.length]);

  const saveEdit = (step: FlowStep) => {
    if (editing && onChange) onChange(withValue(step, editing.value));
    setEditing(null);
  };

  return (
    <ol ref={listRef} className={live ? 'steps steps--live' : 'steps'}>
      {steps.map((step, index) => {
        const label = stepLabel(step);
        const tone = stepTone(step);
        const failed = step.id === failedStepId;
        const value = editableValue(step);
        const classes = ['step', tone && `step--${tone}`, failed && 'step--failed'].filter(Boolean).join(' ');
        return (
          <li
            key={step.id}
            className={classes}
            onMouseEnter={onHover ? () => onHover(step) : undefined}
            onMouseLeave={onHover ? () => onHover(null) : undefined}
          >
            <span className="step__number">{index + 1}</span>
            <span className="step__body">
              <span className="step__text">{label.text}</span>
              {label.source && <span className="step__source">{label.source}</span>}
              {failed && <span className="step__flag">Fails here</span>}
              {missing?.has(step.id) && <span className="row__warning">element not found</span>}
            </span>
            <span className="step__tools">
              {onGoTo && stepAnchor(step) && <IconButton icon="goto" label="Go to" onClick={() => onGoTo(step)} />}
              {onFlag && (
                <IconButton
                  icon="flag"
                  label={failed ? 'Clear failing step' : 'Mark as failing step'}
                  tone={failed ? 'confirm' : undefined}
                  onClick={() => onFlag(step.id)}
                />
              )}
              {onChange && value !== null && (
                <IconButton icon="edit" label="Edit step" onClick={() => setEditing({ id: step.id, value })} />
              )}
              {onDelete && <IconButton icon="delete" label="Delete step" tone="danger" onClick={() => onDelete(step.id)} />}
            </span>
            {editing?.id === step.id && (
              // Not a form: the list sits inside the review form, and forms cannot nest.
              <div className="step__editor">
                <input
                  autoFocus
                  aria-label="Step value"
                  value={editing.value}
                  onChange={(event) => setEditing({ id: step.id, value: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      saveEdit(step);
                    } else if (event.key === 'Escape') {
                      setEditing(null);
                    }
                  }}
                />
                <button type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button type="button" className="primary" onClick={() => saveEdit(step)}>
                  Save
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 6: Add the recording bar**

Create `entrypoints/panel/RecordingBar.tsx`:

```tsx
import { useState } from 'react';
import { errorCount, formatElapsed } from '@/lib/flow/step-label';
import type { Recording } from '@/lib/flow/types';
import { FlowSteps } from './FlowSteps';
import { useNow } from './flow-hooks';

type Props = {
  recording: Recording;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onNote: (text: string) => void;
};

export function RecordingBar({ recording, onPause, onResume, onStop, onNote }: Props) {
  const now = useNow(1000);
  const [note, setNote] = useState<string | null>(null);
  const paused = recording.status === 'paused';
  const left = paused && recording.pausedReason === 'left';
  const count = recording.steps.length;
  const errors = errorCount(recording.steps);

  const addNote = () => {
    const text = note?.trim();
    if (!text) return;
    onNote(text);
    setNote(null);
  };

  return (
    <section className="recording" aria-label="Recording">
      <div className="recording__bar">
        <span className={paused ? 'recording__dot recording__dot--paused' : 'recording__dot'} aria-hidden="true" />
        <span className="recording__stats">
          {formatElapsed(now - Date.parse(recording.startedAt))} · {count} {count === 1 ? 'step' : 'steps'} ·{' '}
          {errors} {errors === 1 ? 'error' : 'errors'}
        </span>
        <div className="recording__buttons">
          {!paused && (
            <button type="button" onClick={onPause}>
              Pause
            </button>
          )}
          {paused && !left && (
            <button type="button" onClick={onResume}>
              Resume
            </button>
          )}
          <button type="button" onClick={() => setNote('')}>
            Note
          </button>
          <button type="button" className="primary" onClick={onStop}>
            Stop
          </button>
        </div>
      </div>

      {left && <p className="notice">Paused — outside the preview. Recording resumes when you come back.</p>}

      {note !== null && (
        <form
          className="recording__note"
          onSubmit={(event) => {
            event.preventDefault();
            addNote();
          }}
        >
          <input
            autoFocus
            aria-label="Note"
            placeholder="What do you notice here?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <button type="button" onClick={() => setNote(null)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={note.trim() === ''}>
            Add note
          </button>
        </form>
      )}

      {count === 0 ? (
        <p className="empty">Use the page as usual. Every click, entry and page change is listed here.</p>
      ) : (
        <FlowSteps steps={recording.steps} live />
      )}
    </section>
  );
}
```

- [ ] **Step 7: Show the bar instead of the toolbar while recording**

In `entrypoints/panel/App.tsx`:

1. Add imports:

```tsx
import { RecordingBar } from './RecordingBar';
import { useRecording } from './flow-hooks';
```

2. After `const sent = useSent(context, send);` add:

```tsx
  const recording = useRecording(tabId);
  const recordingActive = recording?.status === 'recording' || recording?.status === 'paused';
  const [flowError, setFlowError] = useState<string | null>(null);
  const flowRequest = (request: FlowRequest) => {
    setFlowError(null);
    void sendToBackground(request).then((result) => {
      if (!result.ok) setFlowError(result.error);
    });
  };
```

and add `type FlowRequest` to the existing `@/lib/messages` imports. If App has no import from `@/lib/messages` yet, add `import type { FlowRequest } from '@/lib/messages';`.

3. Wrap the existing toolbar and the page-comment form. Replace everything from `<div className="toolbar">` through the closing `)}` of the `{pageComment !== null && (…)}` block with:

```tsx
        {flowError && <p className="error">{flowError}</p>}

        {recordingActive && recording ? (
          <RecordingBar
            recording={recording}
            onPause={() => flowRequest({ type: 'flow-pause', tabId: recording.tabId })}
            onResume={() => flowRequest({ type: 'flow-resume', tabId: recording.tabId })}
            onStop={() => flowRequest({ type: 'flow-stop', tabId: recording.tabId })}
            onNote={(text) => flowRequest({ type: 'flow-note', tabId: recording.tabId, text, path: context.path })}
          />
        ) : (
          <>
            {/* …the existing <div className="toolbar"> block from Task 7, unchanged… */}
            {/* …the existing {pageComment !== null && (…)} block, unchanged… */}
          </>
        )}
```

Move the two existing blocks into the fragment exactly as they are. The comments above only mark where they go; do not leave the comments in the code.

- [ ] **Step 8: Style the recording bar and step list**

Append to `entrypoints/panel/style.css`:

```css
/* Recording */

.recording {
  margin-top: 14px;
}

.recording__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.recording__dot {
  flex: none;
  width: 10px;
  height: 10px;
  background: #e5484d;
  border-radius: 50%;
  animation: recording-pulse 1.4s ease-in-out infinite;
}

.recording__dot--paused {
  background: var(--faint);
  animation: none;
}

@keyframes recording-pulse {
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .recording__dot {
    animation: none;
  }
}

.recording__stats {
  flex: 1;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}

.recording__buttons {
  display: flex;
  gap: 6px;
}

.recording__note {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}

.recording__note input,
.step__editor input,
.field input {
  flex: 1;
  min-width: 0;
  padding: 5px 9px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 8px;
}

/* Steps */

.steps {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.steps--live {
  max-height: 260px;
  overflow-y: auto;
}

.step {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  column-gap: 8px;
  align-items: start;
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
}

.step__number {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--faint);
  text-align: right;
  padding-top: 1px;
}

.step__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.step__text {
  overflow-wrap: anywhere;
}

.step__source {
  font-size: 12px;
  color: var(--muted);
}

.step--error .step__text {
  color: var(--danger);
}

.step--warning .step__text {
  color: #b54708;
}

.step--note .step__text {
  font-style: italic;
}

.step--failed {
  background: var(--wash);
}

.step__flag {
  align-self: start;
  margin-top: 2px;
  padding: 0 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-deep);
  background: var(--green);
  border-radius: 4px;
}

.step__tools {
  display: flex;
  gap: 2px;
}

.step__editor {
  grid-column: 2 / -1;
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

@media (prefers-color-scheme: dark) {
  .step--warning .step__text {
    color: #fdb022;
  }
}
```

- [ ] **Step 9: Run the end-to-end tests**

Run: `pnpm compile && pnpm test:e2e`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add entrypoints/panel/flow-hooks.ts entrypoints/panel/FlowSteps.tsx entrypoints/panel/RecordingBar.tsx entrypoints/panel/icons.tsx entrypoints/panel/App.tsx entrypoints/panel/style.css e2e/flow.spec.ts
git commit -m "feat: control workflow recordings from the review panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Review screen and flow drafts

**Files:**
- Create: `entrypoints/panel/FlowReview.tsx`
- Modify: `entrypoints/panel/App.tsx`
- Modify: `entrypoints/panel/DraftRow.tsx`
- Modify: `entrypoints/panel/Checkbox.tsx`
- Modify: `entrypoints/panel/style.css`
- Modify: `e2e/flow.spec.ts`

**Interfaces:**
- Consumes: `FlowSteps` (Task 8); `flowEditsOf`, `flowPatch`, `isSendable` (Task 1); `flowSummary`, `MAX_STEPS` (Task 2); `updateDraft` from `lib/draft-store.ts`.
- Produces:
  - `<FlowReview heading initial notice? missing? cancelLabel confirmCancel onHoverStep onSave onCancel />` renders a form named "Review workflow" with fields labelled "Title", "Expected" and "Actual", and buttons "Save draft" and `cancelLabel`. With `confirmCancel`, an inline confirmation offers "Keep" and "Discard".
  - `Checkbox` takes `disabled?: boolean`.
  - `DraftRow` takes `onEditFlow?: () => void`.
  - In `App`, `hoverStep(step: FlowStep | null): void` is passed as `onHoverStep`. For now it does nothing; Task 10 makes it highlight elements.

- [ ] **Step 1: Write the failing end-to-end tests**

Append to `e2e/flow.spec.ts`:

```ts
test('a stopped recording is reviewed, saved as a draft and sent', async ({ context, worker, extensionId }) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'flow.html');
  await panel.getByRole('button', { name: 'Record workflow' }).click();
  await page.locator('#email').fill('ada@example.com');
  await page.locator('#submit').click();
  await expect(page).toHaveTitle('status 500');
  const bar = panel.getByRole('region', { name: 'Recording' });
  await expect(bar.getByText('POST /api/login → 500')).toBeVisible();
  await bar.getByRole('button', { name: 'Stop' }).click();

  const review = panel.getByRole('form', { name: 'Review workflow' });
  await expect(review.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  await review.getByLabel('Title').fill('Sign-in fails');
  await review.getByLabel('Expected').fill('I land on the dashboard');
  await review.getByLabel('Actual').fill('Nothing happens');
  const failing = review.getByRole('listitem').filter({ hasText: 'POST /api/login → 500' });
  await failing.getByRole('button', { name: 'Mark as failing step' }).click();
  await expect(failing.getByText('Fails here')).toBeVisible();
  await review.getByRole('listitem').filter({ hasText: 'Click button "Sign in"' }).getByRole('button', { name: 'Delete step' }).click();
  await review.getByRole('button', { name: 'Save draft' }).click();

  const drafts = panel.getByRole('region', { name: 'Drafts' });
  await expect(drafts.getByText('Sign-in fails')).toBeVisible();
  await expect(drafts.getByText('2 steps · 1 error')).toBeVisible();
  expect(await storedRecording(worker)).toBeNull();

  await panel.getByRole('button', { name: 'Send 1 draft' }).click();
  await expect(panel.getByRole('region', { name: 'Sent' }).getByText('Sign-in fails')).toBeVisible();
  const sent = await worker.evaluate(async () => {
    const { feedback } = await chrome.storage.local.get('feedback');
    return (feedback as Record<string, Array<Record<string, any>>>)['demo-project']?.[0];
  });
  expect(sent).toMatchObject({ kind: 'flow', comment: 'Sign-in fails', flow: { expected: 'I land on the dashboard' } });
  expect(sent?.flow.steps.map((step: { type: string }) => step.type)).toEqual(['input', 'network']);
  expect(sent?.flow.failedStepId).toBe(sent?.flow.steps[1].id);
});

test('discarding asks first; closing the tab keeps an untitled draft that cannot be sent', async ({
  context,
  worker,
  extensionId,
}) => {
  const first = await openReview(context, worker, extensionId, 'flow.html');
  await first.panel.getByRole('button', { name: 'Record workflow' }).click();
  await first.page.locator('#email').fill('first');
  await first.panel.getByRole('button', { name: 'Stop' }).click();
  const review = first.panel.getByRole('form', { name: 'Review workflow' });
  await review.getByRole('button', { name: 'Discard' }).click();
  await review.getByRole('button', { name: 'Keep' }).click();
  await review.getByRole('button', { name: 'Discard' }).click();
  await review.getByRole('button', { name: 'Discard' }).click();
  await expect(review).toHaveCount(0);
  await expect(first.panel.getByRole('heading', { name: 'Drafts (0)' })).toBeVisible();

  await first.panel.getByRole('button', { name: 'Record workflow' }).click();
  await first.page.locator('#email').fill('ada@example.com');
  await expect.poll(async () => (await storedRecording(worker))?.steps.length).toBe(1);
  await first.page.close();

  const second = await openReview(context, worker, extensionId, 'flow.html');
  const drafts = second.panel.getByRole('region', { name: 'Drafts' });
  await expect(drafts.getByText('Untitled workflow')).toBeVisible();
  await expect(drafts.getByText('Add a title to send')).toBeVisible();
  await expect(drafts.getByRole('checkbox', { name: 'Include in send' })).toBeDisabled();
  await expect(second.panel.getByRole('button', { name: 'Send drafts' })).toBeDisabled();

  await drafts.getByRole('button', { name: 'Edit' }).click();
  const edit = second.panel.getByRole('form', { name: 'Review workflow' });
  await edit.getByLabel('Title').fill('Email field loses focus');
  await edit.getByRole('button', { name: 'Save draft' }).click();
  await expect(drafts.getByText('Email field loses focus')).toBeVisible();
  await expect(second.panel.getByRole('button', { name: 'Send 1 draft' })).toBeEnabled();
});
```

In the second test, the second "Discard" click is the confirmation button that replaced the first. Both buttons share the name "Discard", and only one is on screen at a time.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test:e2e e2e/flow.spec.ts`
Expected: the two new tests FAIL, no form named "Review workflow".

- [ ] **Step 3: Add `disabled` to the checkbox**

In `entrypoints/panel/Checkbox.tsx`, add `disabled?: boolean;` to `Props`, destructure `disabled = false`, and pass `disabled={disabled}` to the `<input>`.

- [ ] **Step 4: Add the review screen**

Create `entrypoints/panel/FlowReview.tsx`:

```tsx
import { useState } from 'react';
import type { FlowEdits } from '@/lib/flow/types';
import type { FlowStep } from '@/lib/types';
import { FlowSteps } from './FlowSteps';

type Props = {
  heading: string;
  initial: FlowEdits;
  notice?: string;
  missing?: ReadonlySet<string>;
  cancelLabel: string;
  /** Asks before cancelling, because cancelling throws the recording away. */
  confirmCancel: boolean;
  onHoverStep: (step: FlowStep | null) => void;
  onSave: (edits: FlowEdits) => void;
  onCancel: () => void;
};

export function FlowReview({
  heading,
  initial,
  notice,
  missing,
  cancelLabel,
  confirmCancel,
  onHoverStep,
  onSave,
  onCancel,
}: Props) {
  const [edits, setEdits] = useState<FlowEdits>(initial);
  const [confirming, setConfirming] = useState(false);
  const canSave = edits.title.trim() !== '';

  const setField = (field: 'title' | 'expected' | 'actual', value: string) =>
    setEdits((current) => ({ ...current, [field]: value }));

  const flag = (id: string) =>
    setEdits(({ failedStepId, ...rest }) => (failedStepId === id ? rest : { ...rest, failedStepId: id }));

  const remove = (id: string) =>
    setEdits(({ failedStepId, steps, ...rest }) => ({
      ...rest,
      ...(failedStepId && failedStepId !== id ? { failedStepId } : {}),
      steps: steps.filter((step) => step.id !== id),
    }));

  const change = (changed: FlowStep) =>
    setEdits((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === changed.id ? changed : step)),
    }));

  return (
    <form
      className="review"
      aria-label="Review workflow"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) onSave({ ...edits, title: edits.title.trim() });
      }}
    >
      <h2>{heading}</h2>
      {notice && <p className="notice">{notice}</p>}

      <label className="field">
        <span>Title</span>
        <input
          autoFocus
          value={edits.title}
          placeholder="What goes wrong, in a few words"
          onChange={(event) => setField('title', event.target.value)}
        />
      </label>
      <label className="field">
        <span>Expected</span>
        <textarea
          value={edits.expected}
          placeholder="What should happen"
          onChange={(event) => setField('expected', event.target.value)}
        />
      </label>
      <label className="field">
        <span>Actual</span>
        <textarea
          value={edits.actual}
          placeholder="What happens instead"
          onChange={(event) => setField('actual', event.target.value)}
        />
      </label>

      <h3 className="review__steps">Steps ({edits.steps.length})</h3>
      <FlowSteps
        steps={edits.steps}
        failedStepId={edits.failedStepId}
        missing={missing}
        onHover={onHoverStep}
        onFlag={flag}
        onDelete={remove}
        onChange={change}
      />

      {confirming ? (
        <div className="review__confirm" role="alert">
          <span>Discard this recording? Its steps will be lost.</span>
          <div className="row__actions">
            <button type="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
            <button type="button" className="danger" onClick={onCancel}>
              Discard
            </button>
          </div>
        </div>
      ) : (
        <div className="review__actions">
          <button type="button" onClick={() => (confirmCancel ? setConfirming(true) : onCancel())}>
            {cancelLabel}
          </button>
          <button type="submit" className="primary" disabled={!canSave}>
            Save draft
          </button>
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 5: Show flow drafts in the list**

In `entrypoints/panel/DraftRow.tsx`:

1. Add imports:

```tsx
import { isSendable } from '@/lib/flow/flow-item';
import { flowSummary } from '@/lib/flow/step-label';
```

2. Add `onEditFlow?: () => void;` to `Props` and to the destructured parameters.

3. Right after the `canSave` line, add:

```tsx
  const flow = item.kind === 'flow' ? item.flow : undefined;
  const sendable = isSendable(item);
```

4. Replace the `<Checkbox … />` line with:

```tsx
      <Checkbox
        checked={included && sendable}
        disabled={!sendable}
        label="Include in send"
        onChange={onInclude}
      />
```

5. Replace the `<span className="row__body">…</span>` element with:

```tsx
        <span className="row__body">
          {flow ? (
            <>
              <span className="row__comment">{item.comment || <em>Untitled workflow</em>}</span>
              <span className="row__meta">{flowSummary(flow.steps)}</span>
              {!sendable && <span className="row__warning">Add a title to send</span>}
            </>
          ) : (
            <>
              {item.textEdit && <TextChange className="row__edit" {...item.textEdit} />}
              {!editing && item.comment && <span className="row__comment">{item.comment}</span>}
              {missing && <span className="row__warning">element not found</span>}
            </>
          )}
        </span>
```

6. Change the Edit button's `onClick` so a flow opens the review screen:

```tsx
            onClick={() => {
              if (flow) {
                onEditFlow?.();
                return;
              }
              setComment(item.comment);
              setEditing(true);
            }}
```

Also change the class line of the `<li>` so that an unsendable flow fades like an excluded draft:

```tsx
    <li className={included && sendable ? 'row row--draft' : 'row row--draft row--excluded'}>
```

- [ ] **Step 6: Wire the review screen into the panel**

In `entrypoints/panel/App.tsx`:

1. Add imports:

```tsx
import { flowEditsOf, flowPatch, isSendable } from '@/lib/flow/flow-item';
import { MAX_STEPS } from '@/lib/flow/steps';
import type { FeedbackItem, FlowStep, Mode } from '@/lib/types';
import { FlowReview } from './FlowReview';
```

(replacing the existing `import type { Mode } from '@/lib/types';`).

2. Replace the `chosen` line with:

```tsx
  // A workflow without a title is never part of a Send, whatever its box says.
  const sendable = useMemo(() => drafts.filter(isSendable), [drafts]);
  const chosen = useMemo(() => sendable.filter((draft) => !excluded.has(draft.id)), [sendable, excluded]);
```

3. After the `flowRequest` function from Task 8, add:

```tsx
  const [editingFlow, setEditingFlow] = useState<FeedbackItem | null>(null);
  // Task 10 makes hovering a step highlight its element on the page.
  const hoverStep = (_step: FlowStep | null) => undefined;

  const review =
    recording?.status === 'stopped' ? (
      <FlowReview
        key={recording.startedAt}
        heading="Review workflow"
        initial={{ title: '', expected: '', actual: '', steps: recording.steps }}
        notice={recording.limitReached ? `Reached the ${MAX_STEPS}-step limit, so recording stopped.` : undefined}
        cancelLabel="Discard"
        confirmCancel
        onHoverStep={hoverStep}
        onSave={(edits) => flowRequest({ type: 'flow-save', tabId: recording.tabId, edits })}
        onCancel={() => flowRequest({ type: 'flow-discard', tabId: recording.tabId })}
      />
    ) : null;
```

4. Insert this block immediately **before** the existing `if (!context) { … }` block, so a stopped recording can be reviewed even while the tab shows a page that is not a preview:

```tsx
  if (review) {
    return (
      <div className="panel">
        {header}
        <div className="panel__body">
          {flowError && <p className="error">{flowError}</p>}
          {review}
        </div>
      </div>
    );
  }
```

5. After `const { projectId } = context;` add:

```tsx
  if (editingFlow) {
    return (
      <div className="panel">
        {header}
        <div className="panel__body">
          <FlowReview
            key={editingFlow.id}
            heading="Edit workflow"
            initial={flowEditsOf(editingFlow)}
            cancelLabel="Cancel"
            confirmCancel={false}
            onHoverStep={hoverStep}
            onSave={(edits) => {
              void updateDraft(projectId, editingFlow.id, flowPatch(editingFlow, edits));
              setEditingFlow(null);
            }}
            onCancel={() => setEditingFlow(null)}
          />
        </div>
      </div>
    );
  }
```

6. Update the select-all checkbox in the Drafts heading:

```tsx
              {drafts.length > 0 && (
                <Checkbox
                  checked={sendable.length > 0 && chosen.length === sendable.length}
                  mixed={chosen.length > 0 && chosen.length < sendable.length}
                  disabled={sendable.length === 0}
                  label="Include all drafts in send"
                  onChange={includeAll}
                />
              )}
```

7. Pass the flow editor to each `DraftRow`:

```tsx
                    onEditFlow={item.kind === 'flow' ? () => setEditingFlow(item) : undefined}
```

The `useState` for `editingFlow` must come before any early `return`. Hooks cannot run conditionally, so keep all new `useState`/`useMemo` calls above `if (review)`.

- [ ] **Step 7: Style the review screen**

Append to `entrypoints/panel/style.css`:

```css
/* Review */

.review {
  margin-top: 14px;
}

.review h2 {
  margin-top: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
}

.field span {
  font-weight: 500;
}

.field textarea {
  min-height: 52px;
}

.review__steps {
  margin: 18px 0 0;
  font-size: 14px;
  font-weight: 600;
}

.review__actions,
.review__confirm {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 0;
  background: var(--bg);
  border-top: 1px solid var(--line);
}

.review__confirm {
  justify-content: space-between;
  color: var(--danger);
}

button.danger {
  font-weight: 600;
  color: #ffffff;
  background: var(--danger);
  border-color: var(--danger);
}

.row__meta {
  font-size: 12px;
  color: var(--muted);
}
```

- [ ] **Step 8: Run the end-to-end tests**

Run: `pnpm compile && pnpm test:e2e`
Expected: all PASS, including the existing "only the ticked drafts are sent" test.

- [ ] **Step 9: Commit**

```bash
git add entrypoints/panel/FlowReview.tsx entrypoints/panel/App.tsx entrypoints/panel/DraftRow.tsx entrypoints/panel/Checkbox.tsx entrypoints/panel/style.css e2e/flow.spec.ts
git commit -m "feat: review recorded workflows and keep them as drafts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Sent workflows, Go to and step highlights

**Files:**
- Modify: `lib/messages.ts`
- Create: `components/StepHighlight.tsx`
- Modify: `components/App.tsx`
- Modify: `entrypoints/panel/hooks.ts`
- Modify: `entrypoints/panel/flow-hooks.ts`
- Modify: `entrypoints/panel/SentRow.tsx`
- Modify: `entrypoints/panel/App.tsx`
- Modify: `entrypoints/panel/style.css`
- Modify: `e2e/flow.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `resolveAnchor` from `lib/anchor-resolver.ts`; `HighlightBox`, `useLayoutTick` from `components/`; `stepAnchor` (Task 2); `FlowSteps` (Task 8).
- Produces:
  - `PanelToContent` gains `{ type: 'show-anchor'; key: string; anchor: Anchor | null; scroll: boolean }`.
  - `ContentToPanel` gains `{ type: 'anchor-missing'; key: string }`.
  - `PanelConnection` gains `missingAnchors: string[]`.
  - `useGoTo(tabId: number | null, context: PageContext | null, send: (message: PanelToContent) => void): (item: SentFeedback, step: FlowStep) => void` in `flow-hooks.ts`.
  - `SentRow` takes `onGoTo?: (step: FlowStep) => void` and `missingSteps?: ReadonlySet<string>`.

- [ ] **Step 1: Write the failing end-to-end test**

Append to `e2e/flow.spec.ts`:

```ts
test('steps highlight their element; a sent workflow lists its steps with Go to', async ({
  context,
  worker,
  extensionId,
}) => {
  const { page, panel } = await openReview(context, worker, extensionId, 'flow.html');
  await panel.getByRole('button', { name: 'Record workflow' }).click();
  await page.locator('#email').fill('ada@example.com');
  await page.locator('#about-link').click();
  await expect(page).toHaveTitle('About · Demo Shop');
  // A back/forward cache restore fires no load event, so wait only for the commit.
  await page.goBack({ waitUntil: 'commit' });
  await expect(page).toHaveTitle('Sign in · Demo Shop');
  await panel.getByRole('button', { name: 'Stop' }).click();

  const review = panel.getByRole('form', { name: 'Review workflow' });
  await review.getByText('Type "ada@example.com" into input "Email"').hover();
  await expect(page.locator('.vf-highlight')).toHaveCount(1);
  await review.getByLabel('Title').hover();
  await expect(page.locator('.vf-highlight')).toHaveCount(0);

  await review.getByLabel('Title').fill('Round trip');
  await review.getByRole('button', { name: 'Save draft' }).click();
  await panel.getByRole('button', { name: 'Send 1 draft' }).click();

  const sent = panel.getByRole('region', { name: 'Sent' });
  await sent.getByRole('button', { name: 'Show steps' }).click();
  await expect(sent.getByText('Go to /about.html')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sent
    .getByRole('listitem')
    .filter({ hasText: 'Type "ada@example.com" into input "Email"' })
    .getByRole('button', { name: 'Go to' })
    .click();
  await expect(page.locator('.vf-highlight')).toHaveCount(1);
  await expect(page.locator('#email')).toBeInViewport();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:e2e e2e/flow.spec.ts`
Expected: the new test FAILS. Hovering a step draws no highlight.

- [ ] **Step 3: Add the messages**

In `lib/messages.ts`, add `Anchor` to the `./types` import, then add to `PanelToContent`:

```ts
  /** Highlights a workflow step's element; `scroll` also brings it into view for a moment. */
  | { type: 'show-anchor'; key: string; anchor: Anchor | null; scroll: boolean }
```

and to `ContentToPanel`:

```ts
  | { type: 'anchor-missing'; key: string }
```

- [ ] **Step 4: Highlight steps on the page**

Create `components/StepHighlight.tsx`:

```tsx
import { useEffect, useMemo } from 'react';
import { resolveAnchor } from '@/lib/anchor-resolver';
import type { Anchor } from '@/lib/types';
import { HighlightBox } from './HighlightBox';
import { useLayoutTick } from './use-layout-tick';

export type ShownAnchor = { key: string; anchor: Anchor; scroll: boolean; at: number };

type Props = { shown: ShownAnchor; onMissing: (key: string) => void; onDone: () => void };

/** Outlines the element of a workflow step the reviewer points at in the panel. */
export function StepHighlight({ shown, onMissing, onDone }: Props) {
  const { dom } = useLayoutTick();
  // `dom` is a deliberate dependency: the element may appear after the page re-renders.
  const element = useMemo(() => resolveAnchor(shown.anchor, document), [shown, dom]);
  const found = element !== null;

  useEffect(() => {
    if (!element) {
      onMissing(shown.key);
      return;
    }
    if (!shown.scroll) return;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const timer = setTimeout(onDone, 1500);
    return () => clearTimeout(timer);
    // Once per request: rebuilding `element` on DOM changes must not scroll again.
  }, [shown.at, found]);

  return element ? <HighlightBox element={element} tone="selected" /> : null;
}
```

In `components/App.tsx`:

1. Add the import `import { type ShownAnchor, StepHighlight } from './StepHighlight';`.
2. Add state after the `focus` state: `const [shown, setShown] = useState<ShownAnchor | null>(null);`
3. Add a case to the port switch:

```tsx
      case 'show-anchor':
        setShown(
          message.anchor
            ? { key: message.key, anchor: message.anchor, scroll: message.scroll, at: Date.now() }
            : null,
        );
        break;
```

4. In the `useEffect` that runs when `connected` turns false, add `setShown(null);`.
5. In the connected render, add after `<PinLayer … />`:

```tsx
      {shown && (
        <StepHighlight
          key={shown.at}
          shown={shown}
          onMissing={(key) => post({ type: 'anchor-missing', key })}
          onDone={() => setShown(null)}
        />
      )}
```

- [ ] **Step 5: Track missing step anchors in the panel connection**

In `entrypoints/panel/hooks.ts`:

1. Add `missingAnchors: string[];` to `PanelConnection`.
2. Add state `const [missingAnchors, setMissingAnchors] = useState<string[]>([]);`.
3. In the port message listener, add a branch:

```ts
      } else if (message.type === 'anchor-missing') {
        setMissingAnchors((current) => (current.includes(message.key) ? current : [...current, message.key]));
      }
```

4. In `reset`, add `setMissingAnchors([]);`.
5. Return `missingAnchors` from the hook.

- [ ] **Step 6: Add Go to**

Append to `entrypoints/panel/flow-hooks.ts` (and extend its imports):

```ts
import { useCallback } from 'react';
import { browser } from 'wxt/browser';
import { storage } from '#imports';
import { stepAnchor } from '@/lib/flow/step-label';
import type { PanelToContent } from '@/lib/messages';
import type { Anchor, FlowStep, PageContext, SentFeedback } from '@/lib/types';

type PendingGoTo = { path: string; key: string; anchor: Anchor };

/**
 * A step to show once its page has loaded. The embedded panel is a new page after a full
 * navigation, so the request waits in session storage rather than in memory.
 */
const goToItem = storage.defineItem<Record<string, PendingGoTo>>('session:go-to', { fallback: {} });

export function useGoTo(
  tabId: number | null,
  context: PageContext | null,
  send: (message: PanelToContent) => void,
): (item: SentFeedback, step: FlowStep) => void {
  useEffect(() => {
    if (tabId === null || !context) return;
    void goToItem.getValue().then(async (all) => {
      const key = String(tabId);
      const pending = all[key];
      if (!pending || pending.path !== context.path) return;
      const { [key]: _done, ...rest } = all;
      await goToItem.setValue(rest);
      send({ type: 'show-anchor', key: pending.key, anchor: pending.anchor, scroll: true });
    });
  }, [tabId, context, send]);

  return useCallback(
    (item: SentFeedback, step: FlowStep) => {
      const anchor = stepAnchor(step);
      if (tabId === null || !context || !anchor) return;
      if (step.path === context.path) {
        send({ type: 'show-anchor', key: step.id, anchor, scroll: true });
        return;
      }
      void goToItem.getValue().then(async (all) => {
        await goToItem.setValue({ ...all, [String(tabId)]: { path: step.path, key: step.id, anchor } });
        await browser.tabs.update(tabId, { url: new URL(step.path, item.page.url).href });
      });
    },
    [tabId, context, send],
  );
}
```

Merge these imports with the existing ones at the top of the file. `useEffect` and `useState` are already imported.

- [ ] **Step 7: Make sent workflows expandable**

In `entrypoints/panel/SentRow.tsx`:

1. Add imports:

```tsx
import { useState } from 'react';
import { flowSummary } from '@/lib/flow/step-label';
import type { FlowStep, SentFeedback } from '@/lib/types';
import { FlowSteps } from './FlowSteps';
```

(replacing the existing `import type { SentFeedback } from '@/lib/types';`).

2. Add `onGoTo?: (step: FlowStep) => void;` and `missingSteps?: ReadonlySet<string>;` to `Props` and to the destructured parameters.
3. At the top of the component add:

```tsx
  const [open, setOpen] = useState(false);
  const flow = item.kind === 'flow' ? item.flow : undefined;
```

4. Inside `<span className="row__body">`, after the comment line, add:

```tsx
          {flow && <span className="row__meta">{flowSummary(flow.steps)}</span>}
```

5. Before `<PageLink page={item.page} />`, add:

```tsx
      {flow && (
        <div className="row__flow">
          <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide steps' : 'Show steps'}
          </button>
          {open && (
            <FlowSteps steps={flow.steps} failedStepId={flow.failedStepId} missing={missingSteps} onGoTo={onGoTo} />
          )}
        </div>
      )}
```

Append to `entrypoints/panel/style.css`:

```css
.row__flow {
  grid-column: 1 / -1;
  margin-top: 6px;
}
```

- [ ] **Step 8: Wire hover and Go to into the panel**

In `entrypoints/panel/App.tsx`:

1. Change the connection line to also take `missingAnchors`:

```tsx
  const { status, context, mode, unresolved, missingAnchors, send, setMode } = usePanelConnection(tabId);
```

2. Add `useGoTo` to the `./flow-hooks` import and `stepAnchor` from `@/lib/flow/step-label`.
3. Replace the placeholder `hoverStep` from Task 9 with:

```tsx
  const missingSteps = useMemo(() => new Set(missingAnchors), [missingAnchors]);
  const goTo = useGoTo(tabId, context, send);
  // Only steps on the open page can be pointed at; anything else clears the highlight.
  const hoverStep = (step: FlowStep | null) => {
    const anchor = step && step.path === context?.path ? stepAnchor(step) : undefined;
    send({ type: 'show-anchor', key: step?.id ?? '', anchor: anchor ?? null, scroll: false });
  };
```

`useMemo` and `useGoTo` are hooks: place these lines with the other hooks, above `if (review)`.

4. Pass `missing={missingSteps}` to both `FlowReview` elements.
5. Pass to each `SentRow`:

```tsx
                  missingSteps={missingSteps}
                  onGoTo={(step) => goTo(item, step)}
```

- [ ] **Step 9: Document the feature**

In `README.md`, add a step 4 at the end of the "Using it" list:

```markdown
4. To report a problem that takes several steps, press **Record workflow** and use the page
   as usual. Clicks, typing (values are recorded as typed, so use test data), choices, page
   changes, console errors and failed requests are listed live in the panel. **Note** adds a
   remark at that point, **Pause** stops listening, and leaving the preview pauses recording
   until you come back. **Stop** opens the review: give it a title, say what you expected and
   what happened, flag the step where it goes wrong, and remove any stray steps. The workflow
   then waits with your other drafts. Closing the tab while recording keeps the steps as an
   untitled draft, which needs a title before it can be sent.
```

- [ ] **Step 10: Run every test**

Run: `pnpm test && pnpm compile && pnpm test:e2e`
Expected: all PASS.

- [ ] **Step 11: Manual check on a hash-routed SPA**

Run `pnpm dev`, open `http://localhost:4173/spa.html#/home` (start the server with `node e2e/serve.mjs`), open the panel and record: click "Settings", then "Push", then press Stop. The review must list `Go to /spa.html#/settings` and `Go to /pushed/a` as route steps. Note the result in the task report. This check is manual because Playwright cannot click the toolbar icon that opens the embedded panel.

- [ ] **Step 12: Commit**

```bash
git add lib/messages.ts components/StepHighlight.tsx components/App.tsx entrypoints/panel/hooks.ts entrypoints/panel/flow-hooks.ts entrypoints/panel/SentRow.tsx entrypoints/panel/App.tsx entrypoints/panel/style.css e2e/flow.spec.ts README.md
git commit -m "feat: show sent workflows with Go to, and highlight steps on the page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
