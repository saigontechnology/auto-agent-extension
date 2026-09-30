export type FeedbackKind = 'element' | 'text-edit' | 'page';

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
  comment: string;
  page: PageRef;
  anchor?: Anchor;
  textEdit?: { before: string; after: string };
  viewport: Viewport;
  createdAt: string;
};

export type SentFeedback = FeedbackItem & {
  author: { id: string; name: string };
  status: 'open' | 'resolved';
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
