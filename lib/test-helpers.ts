import type { Anchor, FeedbackItem, Flow, FlowStep, SentFeedback } from './types';

export function makeItem(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: 'item-1',
    buildId: 'build_1',
    kind: 'element',
    comment: 'Make this bigger',
    page: { url: 'https://demo.web.app/home', path: '/home', title: 'Home' },
    anchor: {
      source: 'src/pages/Home.tsx:12',
      selector: '#title',
      tag: 'h1',
      text: 'Welcome',
      html: '<h1 id="title">Welcome</h1>',
      rect: { x: 0, y: 0, width: 100, height: 20 },
    },
    viewport: { width: 1280, height: 720, dpr: 2 },
    createdAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

export function makeSent(overrides: Partial<SentFeedback> = {}): SentFeedback {
  return {
    ...makeItem(),
    author: { id: 'u1', name: 'Ada' },
    status: 'open',
    ...overrides,
  };
}

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
