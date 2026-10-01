export type FeedbackKind = 'element' | 'text-edit' | 'page' | 'flow';

export type Rect = { x: number; y: number; width: number; height: number };

export type Anchor = {
  source?: string;
  nearestSource?: string;
  selector: string;
  tag: string;
  text: string;
  html: string;
  rect: Rect;
};

export type PageRef = { url: string; path: string; title: string };

export type Viewport = { width: number; height: number; dpr: number };

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

/** The Auto Agent feedback run an item went out in. */
export type SentRun = {
  /** The run's own job id. */
  jobId: string;
  /** The demo job the run updates. */
  demoJobId: string;
  sentAt: string;
  requiresApproval: boolean;
};

export type SentFeedback = FeedbackItem & {
  author: { id: string; name: string };
  status: 'open' | 'resolved';
  /** Absent on items sent before the extension was connected to Auto Agent. */
  run?: SentRun;
};

export type ClientInfo = { extensionVersion: string; userAgent: string };

export type PageContext = {
  projectId: string;
  buildId: string;
  path: string;
  url: string;
  title: string;
};

export type Mode = 'off' | 'select' | 'text';

export type OAuthSettings = {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  scopes: string;
};

export type Settings = { useMock: boolean; apiBase: string; oauth: OAuthSettings };
