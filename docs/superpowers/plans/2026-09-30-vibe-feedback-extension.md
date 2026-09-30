# Vibe Feedback Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that lets a reviewer pin comments and inline text edits onto elements of a preview build and send them, with source-file context, to the vibe-coding tool.

**Architecture:** A WXT Manifest V3 extension with three contexts. A content script draws the picker, pins and comment popover inside a Shadow DOM root; a side panel lists drafts and sent feedback and owns the Send action; the background service worker is the only context that talks to the network. Drafts are shared through `storage.local`. The side panel and the content script talk over one long-lived port. All logic lives in small pure modules under `lib/` that are unit-tested without a browser; the React layers stay thin and are covered by Playwright tests that load the built extension.

**Tech Stack:** WXT 0.21, React 19, TypeScript 7 (strict), Vitest 5 with happy-dom and WXT's `fakeBrowser`, Playwright 1.63, pnpm 10, Node 22.

**Spec:** `docs/superpowers/specs/2026-09-30-vibe-feedback-extension-design.md`

## Global Constraints

- **Node ≥ 22.12.** WXT 0.21 and Vitest 5 do not run on Node 20. Run `nvm use` in every new shell (it reads `.nvmrc`). In a non-interactive shell, prefix commands with `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH";`.
- **pnpm only.** This machine has `ignore-scripts=true` in its pnpm config, so `postinstall` does not run. After every `pnpm install` run `pnpm wxt prepare`. If a test fails with `Transform failed` or `tsc` reports errors inside `node_modules`, `.wxt/` is missing: run `pnpm wxt prepare`.
- Chrome, Manifest V3 only.
- Manifest `permissions`: `storage`, `identity` (WXT adds `sidePanel` itself). `host_permissions`: `*://*.web.app/*`, `*://*.firebaseapp.com/*`, `http://localhost/*`. `optional_host_permissions`: `https://*/*`.
- Preview page markers, exactly: `<meta name="vibe:project-id">`, `<meta name="vibe:build-id">`, attribute `data-vibe-source`.
- Anchor limits: `text` ≤ 200 characters, `html` ≤ 2000 characters.
- Import WXT APIs from `#imports` (or `wxt/browser` for `browser` and the `Browser` types). Import project modules through the `@/` alias from entrypoints and components; use relative imports inside `lib/`.
- `tsconfig` enables `noUncheckedIndexedAccess`: indexing an array yields `T | undefined`.
- All code, comments, docs and commit messages are in English.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Only `lib/api/http-feedback-api.ts` may know the real API's URLs and payload shape.

## Review Focus

The spec does not spell these out, but a reviewer using the extension would hit them. Each has a test in the task that owns the code.

1. **Hash-routed previews.** Every route shares one `pathname`, so comments from different routes would merge into one page. Expected: the path includes the `#/…` route. Test: `routePath` in Task 2.
2. **Generated markup with duplicate or odd ids.** A selector built from a duplicated id, or an id like `1:a.b`, would match the wrong element or throw. Expected: a selector that still matches exactly one element. Tests: `buildSelector` in Task 2.
3. **Anchors that come back from the server malformed.** A broken selector or tag in a sent item must not take down the pin layer. Expected: that item is reported as "element not found". Test: `resolveAnchor` in Task 3.
4. **Two saves in quick succession, or a draft added while Send is in flight.** Expected: nothing is lost. Tests: `draft-store` in Task 4 and `handleRequest` in Task 9.
5. **Editing the same text twice, or back to the original.** Expected: one draft from the original text, or no draft at all. Test: `planTextEdit` in Task 5.

Also pinned by tests: concurrent requests with an expired token share one refresh (Task 7); a `200` response that is not a JSON array is an error, not an empty list (Task 8).

## File Structure

```
.nvmrc, .gitignore, package.json, tsconfig.json
wxt.config.ts                  manifest, React module, dev start URL
vitest.config.ts               unit tests: lib/**/*.test.ts, happy-dom
playwright.config.ts           end-to-end tests, starts the fixture server

lib/
  types.ts                     FeedbackItem, Anchor, SentFeedback, PageContext, Mode, Settings
  text.ts                      collapseText, truncate
  test-helpers.ts              makeItem, makeSent (test data builders)
  page-context.ts              readPageContext, routePath
  selector.ts                  buildSelector
  element-descriptor.ts        describeElement, anchorText, SOURCE_ATTR
  anchor-resolver.ts           resolveAnchor
  draft-store.ts               drafts in storage.local, per project
  feedback-factory.ts          createItem, currentEnv
  pins.ts                      pagePins, groupDrafts, locationLabel
  text-edit.ts                 planTextEdit
  picker.ts                    eventElement, isOwnUi, parentOf, firstChildOf, isEditableText
  popover-position.ts          popoverPosition
  settings-store.ts            settings in storage.local, validation
  auth/pkce.ts                 verifier, challenge, state
  auth/oauth.ts                signIn, signOut, getAccessToken
  api/feedback-api.ts          FeedbackApi interface, ApiError, UnauthorizedError
  api/mock-feedback-api.ts     storage-backed stand-in
  api/http-feedback-api.ts     the real API adapter
  messages.ts                  message types for the port and the background
  background-handlers.ts       handleRequest (submit, list, auth)
  background-client.ts         sendToBackground

components/                    content-script UI (rendered in the Shadow DOM root)
  App.tsx                      state and wiring
  Picker.tsx                   Select mode
  TextEditor.tsx               Text mode
  PinLayer.tsx                 numbered pins
  CommentPopover.tsx           comment form
  HighlightBox.tsx             outline around an element
  use-layout-tick.ts           re-render on scroll/resize/DOM change
  use-page-cursor.ts           page-wide cursor while picking
  use-panel-port.ts            accepts the side panel's port

entrypoints/
  background.ts                wires real dependencies into handleRequest
  content/index.tsx, style.css mounts components/App in a shadow root
  sidepanel/                   index.html, main.tsx, App.tsx, DraftRow.tsx, hooks.ts, style.css
  options/                     index.html, main.tsx, App.tsx, style.css

fixtures/serve.mjs             static server on http://localhost:4173
fixtures/demo/                 index.html, about.html, plain.html
e2e/                           fixtures.ts, smoke.spec.ts, options.spec.ts
README.md
```

Every file below is given in full. Create it exactly as shown.

---

### Task 1: Scaffold and toolchain

**Files:**
- Create: `.nvmrc`, `.gitignore`, `package.json`, `tsconfig.json`, `wxt.config.ts`, `vitest.config.ts`
- Create: `entrypoints/background.ts` (stub, replaced in Task 9)
- Create: `lib/types.ts`, `lib/text.ts`, `lib/test-helpers.ts`
- Test: `lib/text.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - All shared types in `lib/types.ts` (see the file).
  - `collapseText(value: string): string`, `truncate(value: string, max: number): string`
  - `makeItem(overrides?: Partial<FeedbackItem>): FeedbackItem`, `makeSent(overrides?: Partial<SentFeedback>): SentFeedback` for tests. `makeItem()` has `id: 'item-1'`, `page.path: '/home'`, and an anchor with `source: 'src/pages/Home.tsx:12'`, `selector: '#title'`.
  - Scripts: `pnpm test`, `pnpm compile`, `pnpm build`, `pnpm fixture`, `pnpm test:e2e`.

- [ ] **Step 1: Create the config files**

`.nvmrc`:

```text
22
```

`.gitignore`:

```text
node_modules
.output
.wxt
test-results
playwright-report
*.log
.DS_Store
```

`package.json`:

```json
{
  "name": "vibe-feedback",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "compile": "tsc --noEmit",
    "test": "vitest run",
    "fixture": "node fixtures/serve.mjs",
    "test:e2e": "wxt build && playwright test",
    "postinstall": "wxt prepare"
  },
  "dependencies": {
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.63.0",
    "@types/node": "^22.20.4",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@wxt-dev/module-react": "^1.2.2",
    "happy-dom": "^20.14.5",
    "typescript": "^7.0.2",
    "vitest": "^5.0.2",
    "wxt": "^0.21.4"
  },
  "engines": {
    "node": ">=22.12"
  }
}
```

`tsconfig.json`:

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": { "jsx": "react-jsx", "allowImportingTsExtensions": true }
}
```

`wxt.config.ts`:

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Vibe Feedback',
    description: 'Pin feedback on preview builds and send it to the vibe-coding tool.',
    permissions: ['storage', 'identity'],
    host_permissions: ['*://*.web.app/*', '*://*.firebaseapp.com/*', 'http://localhost/*'],
    optional_host_permissions: ['https://*/*'],
    action: { default_title: 'Vibe Feedback' },
  },
  webExt: {
    startUrls: ['http://localhost:4173/'],
  },
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    include: ['lib/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Create a stub background entrypoint**

WXT needs at least one entrypoint to generate its types. `entrypoints/background.ts`:

```ts
import { defineBackground } from '#imports';

export default defineBackground(() => {
  // Message handling is added in the background task.
});
```

- [ ] **Step 3: Install and generate WXT types**

Run: `nvm use && pnpm install && pnpm wxt prepare`
Expected: install finishes, then `✔ Finished`. A `.wxt/` directory now exists.

- [ ] **Step 4: Create the shared types**

`lib/types.ts`:

```ts
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
```

- [ ] **Step 5: Write the failing test**

`lib/text.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { collapseText, truncate } from './text';

describe('collapseText', () => {
  it('collapses runs of whitespace and trims', () => {
    expect(collapseText('  Buy \n\t now  ')).toBe('Buy now');
  });

  it('returns an empty string for whitespace only', () => {
    expect(collapseText(' \n ')).toBe('');
  });
});

describe('truncate', () => {
  it('leaves short strings alone', () => {
    expect(truncate('abc', 3)).toBe('abc');
  });

  it('cuts long strings to the limit', () => {
    expect(truncate('abcdef', 3)).toBe('abc');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm vitest run lib/text.test.ts`
Expected: FAIL with `Failed to resolve import "./text"`.

- [ ] **Step 7: Implement**

`lib/text.ts`:

```ts
export function collapseText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm vitest run lib/text.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9: Add the test data builders**

`lib/test-helpers.ts`:

```ts
import type { FeedbackItem, SentFeedback } from './types';

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
```

- [ ] **Step 10: Verify the toolchain end to end**

Run: `pnpm compile && pnpm build`
Expected: `tsc` prints no errors; WXT prints `✔ Built extension` and lists `.output/chrome-mv3/manifest.json`.

- [ ] **Step 11: Commit**

```bash
git add .nvmrc .gitignore package.json pnpm-lock.yaml tsconfig.json wxt.config.ts vitest.config.ts entrypoints lib
git commit -m "chore: scaffold WXT extension with shared types" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Page context and selectors

**Files:**
- Create: `lib/page-context.ts`, `lib/selector.ts`
- Test: `lib/page-context.test.ts`, `lib/selector.test.ts`

**Interfaces:**
- Consumes: `PageContext` from `lib/types.ts`.
- Produces:
  - `readPageContext(doc: Document, loc: Pick<Location, 'href' | 'pathname' | 'hash'>): PageContext | null`
  - `routePath(loc: Pick<Location, 'pathname' | 'hash'>): string`
  - `buildSelector(element: Element): string` — matches exactly that element in its document.

- [ ] **Step 1: Write the failing test for page context**

`lib/page-context.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { readPageContext, routePath } from './page-context';

const loc = { href: 'https://demo.web.app/home?tab=1', pathname: '/home', hash: '' };

describe('readPageContext', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('reads project and build ids from the meta tags', () => {
    document.head.innerHTML =
      '<title>Home</title><meta name="vibe:project-id" content="proj_1"><meta name="vibe:build-id" content=" build_9 ">';
    expect(readPageContext(document, loc)).toEqual({
      projectId: 'proj_1',
      buildId: 'build_9',
      path: '/home',
      url: 'https://demo.web.app/home?tab=1',
      title: 'Home',
    });
  });

  it('returns null when a meta tag is missing', () => {
    document.head.innerHTML = '<meta name="vibe:project-id" content="proj_1">';
    expect(readPageContext(document, loc)).toBeNull();
  });

  it('returns null when a meta tag is empty', () => {
    document.head.innerHTML =
      '<meta name="vibe:project-id" content="proj_1"><meta name="vibe:build-id" content="  ">';
    expect(readPageContext(document, loc)).toBeNull();
  });
});

describe('routePath', () => {
  it('uses the pathname for history-routed apps', () => {
    expect(routePath({ pathname: '/home', hash: '#section' })).toBe('/home');
  });

  it('includes the hash route for hash-routed apps', () => {
    expect(routePath({ pathname: '/', hash: '#/settings' })).toBe('/#/settings');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run lib/page-context.test.ts`
Expected: FAIL with `Failed to resolve import "./page-context"`.

- [ ] **Step 3: Implement page context**

`lib/page-context.ts`:

```ts
import type { PageContext } from './types';

function meta(doc: Document, name: string): string {
  return doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() ?? '';
}

/** Hash-routed apps keep every route on one pathname, so the route lives in the hash. */
export function routePath(loc: Pick<Location, 'pathname' | 'hash'>): string {
  return loc.hash.startsWith('#/') ? loc.pathname + loc.hash : loc.pathname;
}

export function readPageContext(
  doc: Document,
  loc: Pick<Location, 'href' | 'pathname' | 'hash'>,
): PageContext | null {
  const projectId = meta(doc, 'vibe:project-id');
  const buildId = meta(doc, 'vibe:build-id');
  if (!projectId || !buildId) return null;
  return { projectId, buildId, path: routePath(loc), url: loc.href, title: doc.title };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run lib/page-context.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing test for selectors**

`lib/selector.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { buildSelector } from './selector';

function expectUnique(element: Element): string {
  const selector = buildSelector(element);
  expect(Array.from(document.querySelectorAll(selector))).toEqual([element]);
  return selector;
}

describe('buildSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <header><h1 id="title">Shop</h1></header>
      <main>
        <section><p>One</p><p class="css-1x2y3z">Two</p><button data-testid="buy">Buy</button></section>
        <section><p>Three</p><span id="dup">a</span><span id="dup">b</span></section>
        <ul><li>x</li><li>y</li><li>z</li></ul>
      </main>`;
  });

  it('uses a unique id', () => {
    expect(expectUnique(document.querySelector('h1')!)).toBe('#title');
  });

  it('uses a unique data-testid', () => {
    expect(expectUnique(document.querySelector('button')!)).toBe('[data-testid="buy"]');
  });

  it('falls back to a tag path and never uses class names', () => {
    const selector = expectUnique(document.querySelectorAll('p')[1]!);
    expect(selector).toBe('html > body > main:nth-of-type(1) > section:nth-of-type(1) > p:nth-of-type(2)');
    expect(selector).not.toContain('css-');
  });

  it('distinguishes repeated siblings', () => {
    const items = Array.from(document.querySelectorAll('li'));
    const selectors = items.map(expectUnique);
    expect(new Set(selectors).size).toBe(3);
  });

  it('does not trust an id that is duplicated in the document', () => {
    const [first, second] = Array.from(document.querySelectorAll('span'));
    expect(expectUnique(first!)).not.toContain('#dup');
    expect(expectUnique(second!)).not.toContain('#dup');
  });

  it('anchors the path at the nearest ancestor with a unique id', () => {
    document.body.innerHTML = '<div id="card"><p>a</p><p>b</p></div>';
    expect(expectUnique(document.querySelectorAll('p')[1]!)).toBe('#card > p:nth-of-type(2)');
  });

  it('handles ids that are not valid CSS identifiers', () => {
    document.body.innerHTML = '<div id="1:a.b">x</div>';
    expect(expectUnique(document.querySelector('div')!)).toBe('[id="1:a.b"]');
  });

  it('handles body and html', () => {
    expect(buildSelector(document.body)).toBe('html > body');
    expect(buildSelector(document.documentElement)).toBe('html');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run lib/selector.test.ts`
Expected: FAIL with `Failed to resolve import "./selector"`.

- [ ] **Step 7: Implement the selector builder**

`lib/selector.ts`:

```ts
const SIMPLE_IDENT = /^[A-Za-z_][\w-]*$/;

function quote(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function isUnique(doc: Document, selector: string): boolean {
  try {
    return doc.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function idSelector(id: string): string {
  return SIMPLE_IDENT.test(id) ? `#${id}` : `[id="${quote(id)}"]`;
}

function nthOfType(element: Element): string {
  const parent = element.parentElement;
  if (!parent) return element.localName;
  const sameType = Array.from(parent.children).filter(
    (child) => child.localName === element.localName,
  );
  return `${element.localName}:nth-of-type(${sameType.indexOf(element) + 1})`;
}

/**
 * Builds a selector matching exactly `element`. Class names are ignored on purpose:
 * generated builds hash them, so they change between deploys.
 */
export function buildSelector(element: Element): string {
  const doc = element.ownerDocument;
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== doc.documentElement) {
    if (current.id) {
      const byId = idSelector(current.id);
      if (isUnique(doc, byId)) return [byId, ...parts].join(' > ');
    }
    const testId = current.getAttribute('data-testid');
    if (testId) {
      const byTestId = `[data-testid="${quote(testId)}"]`;
      if (isUnique(doc, byTestId)) return [byTestId, ...parts].join(' > ');
    }
    parts.unshift(current === doc.body ? 'body' : nthOfType(current));
    current = current.parentElement;
  }

  return ['html', ...parts].join(' > ');
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm vitest run lib/selector.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 9: Commit**

```bash
git add lib/page-context.ts lib/page-context.test.ts lib/selector.ts lib/selector.test.ts
git commit -m "feat: read preview page context and build stable selectors" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Element descriptor and anchor resolver

**Files:**
- Create: `lib/element-descriptor.ts`, `lib/anchor-resolver.ts`
- Test: `lib/element-descriptor.test.ts`, `lib/anchor-resolver.test.ts`

**Interfaces:**
- Consumes: `buildSelector` (Task 2), `collapseText`, `truncate` (Task 1), `Anchor` type.
- Produces:
  - `SOURCE_ATTR = 'data-vibe-source'`, `MAX_TEXT = 200`, `MAX_HTML = 2000`
  - `anchorText(element: Element): string` — collapsed, truncated text; the value stored in `Anchor.text`.
  - `describeElement(element: Element): Anchor`
  - `resolveAnchor(anchor: Anchor, doc: Document): Element | null` — tries source, then selector (tag must match), then tag + text. Never throws.

- [ ] **Step 1: Write the failing test for the descriptor**

`lib/element-descriptor.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_HTML, MAX_TEXT, describeElement } from './element-descriptor';

describe('describeElement', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section data-vibe-source="src/pages/Home.tsx:10">
        <h1 data-vibe-source="src/pages/Home.tsx:12">  Welcome
          back </h1>
        <div><button id="buy">Buy</button></div>
      </section>
      <footer><p id="plain">No source here</p></footer>`;
  });

  it('records the element own source', () => {
    const anchor = describeElement(document.querySelector('h1')!);
    expect(anchor.source).toBe('src/pages/Home.tsx:12');
    expect(anchor).not.toHaveProperty('nearestSource');
    expect(anchor.tag).toBe('h1');
    expect(anchor.text).toBe('Welcome back');
  });

  it('records the nearest ancestor source when the element has none', () => {
    const anchor = describeElement(document.querySelector('#buy')!);
    expect(anchor).not.toHaveProperty('source');
    expect(anchor.nearestSource).toBe('src/pages/Home.tsx:10');
    expect(anchor.selector).toBe('#buy');
    expect(anchor.html).toBe('<button id="buy">Buy</button>');
  });

  it('records neither when no ancestor has a source', () => {
    const anchor = describeElement(document.querySelector('#plain')!);
    expect(anchor).not.toHaveProperty('source');
    expect(anchor).not.toHaveProperty('nearestSource');
  });

  it('truncates long text and html', () => {
    const p = document.querySelector('#plain')!;
    p.textContent = 'x'.repeat(5000);
    const anchor = describeElement(p);
    expect(anchor.text).toHaveLength(MAX_TEXT);
    expect(anchor.html).toHaveLength(MAX_HTML);
  });

  it('reports a rect with numeric fields', () => {
    const { rect } = describeElement(document.querySelector('#buy')!);
    expect(Object.keys(rect).sort()).toEqual(['height', 'width', 'x', 'y']);
    for (const value of Object.values(rect)) expect(typeof value).toBe('number');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run lib/element-descriptor.test.ts`
Expected: FAIL with `Failed to resolve import "./element-descriptor"`.

- [ ] **Step 3: Implement the descriptor**

`lib/element-descriptor.ts`:

```ts
import { buildSelector } from './selector';
import { collapseText, truncate } from './text';
import type { Anchor } from './types';

export const SOURCE_ATTR = 'data-vibe-source';
export const MAX_TEXT = 200;
export const MAX_HTML = 2000;

/** The normalised text stored in an anchor and compared when re-finding the element. */
export function anchorText(element: Element): string {
  return truncate(collapseText(element.textContent ?? ''), MAX_TEXT);
}

function sourceOf(element: Element | null | undefined): string | undefined {
  return element?.getAttribute(SOURCE_ATTR)?.trim() || undefined;
}

export function describeElement(element: Element): Anchor {
  const source = sourceOf(element);
  const nearestSource = source
    ? undefined
    : sourceOf(element.parentElement?.closest(`[${SOURCE_ATTR}]`));
  const box = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView;

  return {
    ...(source ? { source } : {}),
    ...(nearestSource ? { nearestSource } : {}),
    selector: buildSelector(element),
    tag: element.localName,
    text: anchorText(element),
    html: truncate(element.outerHTML, MAX_HTML),
    rect: {
      x: box.x + (view?.scrollX ?? 0),
      y: box.y + (view?.scrollY ?? 0),
      width: box.width,
      height: box.height,
    },
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run lib/element-descriptor.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing test for the resolver**

`lib/anchor-resolver.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveAnchor } from './anchor-resolver';
import { describeElement } from './element-descriptor';
import type { Anchor } from './types';

const rect = { x: 0, y: 0, width: 0, height: 0 };

function anchor(partial: Partial<Anchor>): Anchor {
  return { selector: '#missing', tag: 'p', text: '', html: '', rect, ...partial };
}

describe('resolveAnchor', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <h1 data-vibe-source="src/Home.tsx:12">Welcome</h1>
      <ul>
        <li data-vibe-source="src/Home.tsx:30">Apples</li>
        <li data-vibe-source="src/Home.tsx:30">Pears</li>
        <li data-vibe-source="src/Home.tsx:30">Plums</li>
      </ul>
      <p id="note">Free shipping</p>
      <p>Returns accepted</p>`;
  });

  it('round-trips every described element', () => {
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      expect(resolveAnchor(describeElement(element), document)).toBe(element);
    }
  });

  it('finds an element by source even when the selector is stale', () => {
    const found = resolveAnchor(anchor({ source: 'src/Home.tsx:12', tag: 'h1' }), document);
    expect(found).toBe(document.querySelector('h1'));
  });

  it('uses the selector to pick among elements sharing one source', () => {
    const pears = document.querySelectorAll('li')[1];
    const found = resolveAnchor(
      anchor({ source: 'src/Home.tsx:30', tag: 'li', selector: 'html > body > ul:nth-of-type(1) > li:nth-of-type(2)', text: 'Apples' }),
      document,
    );
    expect(found).toBe(pears);
  });

  it('uses the text to pick among elements sharing one source when the selector misses', () => {
    const found = resolveAnchor(anchor({ source: 'src/Home.tsx:30', tag: 'li', text: 'Plums' }), document);
    expect(found).toBe(document.querySelectorAll('li')[2]);
  });

  it('falls back to the first element sharing the source', () => {
    const found = resolveAnchor(anchor({ source: 'src/Home.tsx:30', tag: 'li', text: 'Gone' }), document);
    expect(found).toBe(document.querySelectorAll('li')[0]);
  });

  it('falls back to the selector when there is no source', () => {
    expect(resolveAnchor(anchor({ selector: '#note' }), document)).toBe(document.querySelector('#note'));
  });

  it('rejects a selector hit with a different tag', () => {
    expect(resolveAnchor(anchor({ selector: '#note', tag: 'button' }), document)).toBeNull();
  });

  it('falls back to tag and text', () => {
    const found = resolveAnchor(anchor({ text: 'Returns accepted' }), document);
    expect(found).toBe(document.querySelectorAll('p')[1]);
  });

  it('returns null when nothing matches', () => {
    expect(resolveAnchor(anchor({ source: 'src/Gone.tsx:1', text: 'Nope' }), document)).toBeNull();
  });

  it('does not match on empty text', () => {
    document.body.innerHTML = '<p></p>';
    expect(resolveAnchor(anchor({ text: '' }), document)).toBeNull();
  });

  it('returns null instead of throwing on a malformed selector or tag', () => {
    expect(resolveAnchor(anchor({ selector: 'p:nth-of-type(', tag: '<bad tag>', text: 'x' }), document)).toBeNull();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run lib/anchor-resolver.test.ts`
Expected: FAIL with `Failed to resolve import "./anchor-resolver"`.

- [ ] **Step 7: Implement the resolver**

`lib/anchor-resolver.ts`:

```ts
import { SOURCE_ATTR, anchorText } from './element-descriptor';
import type { Anchor } from './types';

/** Anchors can come from the server, so a malformed selector must not throw. */
function safeQuery(doc: Document, selector: string): Element | null {
  try {
    return doc.querySelector(selector);
  } catch {
    return null;
  }
}

function safeTagMatches(doc: Document, tag: string): Element[] {
  try {
    return Array.from(doc.getElementsByTagName(tag));
  } catch {
    return [];
  }
}

export function resolveAnchor(anchor: Anchor, doc: Document): Element | null {
  const bySelector = safeQuery(doc, anchor.selector);

  if (anchor.source) {
    const matches = Array.from(doc.querySelectorAll(`[${SOURCE_ATTR}]`)).filter(
      (element) => element.getAttribute(SOURCE_ATTR)?.trim() === anchor.source,
    );
    const [first] = matches;
    if (first) {
      if (matches.length === 1) return first;
      if (bySelector && matches.includes(bySelector)) return bySelector;
      return matches.find((element) => anchorText(element) === anchor.text) ?? first;
    }
  }

  if (bySelector && bySelector.localName === anchor.tag) return bySelector;

  if (anchor.text) {
    return (
      safeTagMatches(doc, anchor.tag).find((element) => anchorText(element) === anchor.text) ?? null
    );
  }
  return null;
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm vitest run lib/anchor-resolver.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 9: Commit**

```bash
git add lib/element-descriptor.ts lib/element-descriptor.test.ts lib/anchor-resolver.ts lib/anchor-resolver.test.ts
git commit -m "feat: describe elements as anchors and resolve anchors back to elements" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Draft store and feedback factory

**Files:**
- Create: `lib/draft-store.ts`, `lib/feedback-factory.ts`
- Test: `lib/draft-store.test.ts`, `lib/feedback-factory.test.ts`

**Interfaces:**
- Consumes: `FeedbackItem`, `Anchor`, `PageContext`, `Viewport`, `FeedbackKind` types; `makeItem` (Task 1); `storage` from `#imports`.
- Produces:
  - `type DraftPatch = Partial<Pick<FeedbackItem, 'comment' | 'textEdit'>>`
  - `listDrafts(projectId: string): Promise<FeedbackItem[]>`
  - `addDraft(projectId: string, item: FeedbackItem): Promise<void>`
  - `updateDraft(projectId: string, id: string, patch: DraftPatch): Promise<void>`
  - `removeDraft(projectId: string, id: string): Promise<void>`
  - `removeDrafts(projectId: string, ids: string[]): Promise<void>`
  - `watchDrafts(projectId: string, callback: (drafts: FeedbackItem[]) => void): () => void`
  - `type ItemInput = { kind: FeedbackKind; comment: string; context: PageContext; anchor?: Anchor; textEdit?: { before: string; after: string } }`
  - `type ItemEnv = { id: string; now: Date; viewport: Viewport }`
  - `currentEnv(view: Window): ItemEnv`, `createItem(input: ItemInput, env: ItemEnv): FeedbackItem`
- Storage key: `local:drafts`, shape `Record<projectId, FeedbackItem[]>`.

- [ ] **Step 1: Write the failing test for the draft store**

`lib/draft-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  addDraft,
  listDrafts,
  removeDraft,
  removeDrafts,
  updateDraft,
  watchDrafts,
} from './draft-store';
import { makeItem } from './test-helpers';

describe('draft-store', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('starts empty', async () => {
    expect(await listDrafts('p1')).toEqual([]);
  });

  it('keeps drafts separate per project', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    await addDraft('p2', makeItem({ id: 'b' }));
    expect((await listDrafts('p1')).map((d) => d.id)).toEqual(['a']);
    expect((await listDrafts('p2')).map((d) => d.id)).toEqual(['b']);
  });

  it('keeps both drafts when two are added without awaiting', async () => {
    await Promise.all([
      addDraft('p1', makeItem({ id: 'a' })),
      addDraft('p1', makeItem({ id: 'b' })),
    ]);
    expect((await listDrafts('p1')).map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('updates the comment of one draft', async () => {
    await addDraft('p1', makeItem({ id: 'a', comment: 'old' }));
    await addDraft('p1', makeItem({ id: 'b', comment: 'keep' }));
    await updateDraft('p1', 'a', { comment: 'new' });
    expect((await listDrafts('p1')).map((d) => d.comment)).toEqual(['new', 'keep']);
  });

  it('removes one draft', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    await addDraft('p1', makeItem({ id: 'b' }));
    await removeDraft('p1', 'a');
    expect((await listDrafts('p1')).map((d) => d.id)).toEqual(['b']);
  });

  it('removes many drafts and ignores unknown ids', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    await addDraft('p1', makeItem({ id: 'b' }));
    await addDraft('p1', makeItem({ id: 'c' }));
    await removeDrafts('p1', ['a', 'c', 'zzz']);
    expect((await listDrafts('p1')).map((d) => d.id)).toEqual(['b']);
  });

  it('notifies watchers of their own project only', async () => {
    const onP1 = vi.fn();
    const unwatch = watchDrafts('p1', onP1);
    await addDraft('p1', makeItem({ id: 'a' }));
    expect(onP1).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a' })]);
    await removeDraft('p1', 'a');
    expect(onP1).toHaveBeenLastCalledWith([]);
    unwatch();
    await addDraft('p1', makeItem({ id: 'b' }));
    expect(onP1).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run lib/draft-store.test.ts`
Expected: FAIL with `Failed to resolve import "./draft-store"`.

- [ ] **Step 3: Implement the draft store**

`lib/draft-store.ts`:

```ts
import { storage } from '#imports';
import type { FeedbackItem } from './types';

type DraftMap = Record<string, FeedbackItem[]>;
export type DraftPatch = Partial<Pick<FeedbackItem, 'comment' | 'textEdit'>>;

const draftsItem = storage.defineItem<DraftMap>('local:drafts', { fallback: {} });

// Serialises read-modify-write cycles so two quick saves in one context cannot overwrite each other.
let queue: Promise<unknown> = Promise.resolve();

function mutate(
  projectId: string,
  change: (drafts: FeedbackItem[]) => FeedbackItem[],
): Promise<void> {
  const run = queue.then(async () => {
    const all = await draftsItem.getValue();
    const { [projectId]: current = [], ...rest } = all;
    const next = change(current);
    await draftsItem.setValue(next.length > 0 ? { ...rest, [projectId]: next } : rest);
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function listDrafts(projectId: string): Promise<FeedbackItem[]> {
  return (await draftsItem.getValue())[projectId] ?? [];
}

export function addDraft(projectId: string, item: FeedbackItem): Promise<void> {
  return mutate(projectId, (drafts) => [...drafts, item]);
}

export function updateDraft(projectId: string, id: string, patch: DraftPatch): Promise<void> {
  return mutate(projectId, (drafts) =>
    drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
  );
}

export function removeDraft(projectId: string, id: string): Promise<void> {
  return removeDrafts(projectId, [id]);
}

export function removeDrafts(projectId: string, ids: string[]): Promise<void> {
  const gone = new Set(ids);
  return mutate(projectId, (drafts) => drafts.filter((draft) => !gone.has(draft.id)));
}

export function watchDrafts(
  projectId: string,
  callback: (drafts: FeedbackItem[]) => void,
): () => void {
  return draftsItem.watch((all) => callback((all ?? {})[projectId] ?? []));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run lib/draft-store.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing test for the factory**

`lib/feedback-factory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createItem, currentEnv } from './feedback-factory';
import { makeItem } from './test-helpers';
import type { PageContext } from './types';

const context: PageContext = {
  projectId: 'proj_1',
  buildId: 'build_9',
  path: '/home',
  url: 'https://demo.web.app/home',
  title: 'Home',
};
const env = {
  id: 'id-1',
  now: new Date('2026-09-30T10:00:00.000Z'),
  viewport: { width: 1280, height: 720, dpr: 2 },
};

describe('createItem', () => {
  it('builds an element comment stamped with the build and page', () => {
    const anchor = makeItem().anchor!;
    expect(createItem({ kind: 'element', comment: '  Too small ', context, anchor }, env)).toEqual({
      id: 'id-1',
      buildId: 'build_9',
      kind: 'element',
      comment: 'Too small',
      page: { url: 'https://demo.web.app/home', path: '/home', title: 'Home' },
      anchor,
      viewport: { width: 1280, height: 720, dpr: 2 },
      createdAt: '2026-09-30T10:00:00.000Z',
    });
  });

  it('builds a page comment without an anchor', () => {
    const item = createItem({ kind: 'page', comment: 'Missing back button', context }, env);
    expect(item).not.toHaveProperty('anchor');
    expect(item).not.toHaveProperty('textEdit');
  });

  it('carries the text edit', () => {
    const item = createItem(
      { kind: 'text-edit', comment: '', context, anchor: makeItem().anchor, textEdit: { before: 'Buy', after: 'Order' } },
      env,
    );
    expect(item.textEdit).toEqual({ before: 'Buy', after: 'Order' });
    expect(item.comment).toBe('');
  });
});

describe('currentEnv', () => {
  it('reads the viewport and generates a fresh id', () => {
    const first = currentEnv(window);
    const second = currentEnv(window);
    expect(first.id).not.toBe(second.id);
    expect(first.viewport).toEqual({
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run lib/feedback-factory.test.ts`
Expected: FAIL with `Failed to resolve import "./feedback-factory"`.

- [ ] **Step 7: Implement the factory**

`lib/feedback-factory.ts`:

```ts
import type { Anchor, FeedbackItem, FeedbackKind, PageContext, Viewport } from './types';

export type ItemInput = {
  kind: FeedbackKind;
  comment: string;
  context: PageContext;
  anchor?: Anchor;
  textEdit?: { before: string; after: string };
};

export type ItemEnv = { id: string; now: Date; viewport: Viewport };

export function currentEnv(view: Window): ItemEnv {
  return {
    id: crypto.randomUUID(),
    now: new Date(),
    viewport: { width: view.innerWidth, height: view.innerHeight, dpr: view.devicePixelRatio },
  };
}

export function createItem(input: ItemInput, env: ItemEnv): FeedbackItem {
  const { context } = input;
  return {
    id: env.id,
    buildId: context.buildId,
    kind: input.kind,
    comment: input.comment.trim(),
    page: { url: context.url, path: context.path, title: context.title },
    ...(input.anchor ? { anchor: input.anchor } : {}),
    ...(input.textEdit ? { textEdit: input.textEdit } : {}),
    viewport: env.viewport,
    createdAt: env.now.toISOString(),
  };
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm vitest run lib/feedback-factory.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9: Commit**

```bash
git add lib/draft-store.ts lib/draft-store.test.ts lib/feedback-factory.ts lib/feedback-factory.test.ts
git commit -m "feat: store drafts per project and build feedback items" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: On-page UI logic

Pure functions behind the pins, the picker, inline text editing and the popover. Keeping them out of the React components is what makes them testable.

**Files:**
- Create: `lib/pins.ts`, `lib/text-edit.ts`, `lib/picker.ts`, `lib/popover-position.ts`
- Test: `lib/pins.test.ts`, `lib/text-edit.test.ts`, `lib/picker.test.ts`, `lib/popover-position.test.ts`

**Interfaces:**
- Consumes: `FeedbackItem`, `SentFeedback` types; `makeItem`, `makeSent`; `collapseText`.
- Produces:
  - `type Pin = { id: string; number: number; state: 'draft' | 'sent'; item: FeedbackItem | SentFeedback }`
  - `pagePins(drafts: FeedbackItem[], sent: SentFeedback[], path: string): Pin[]`
  - `type DraftGroup = { path: string; items: FeedbackItem[] }`, `groupDrafts(drafts: FeedbackItem[], currentPath: string): DraftGroup[]`
  - `locationLabel(item: FeedbackItem): string`
  - `type TextEdit = { before: string; after: string }`
  - `type TextEditChange = { type: 'create'; textEdit: TextEdit } | { type: 'update'; id: string; textEdit: TextEdit } | { type: 'remove'; id: string }`
  - `planTextEdit(existing: FeedbackItem | undefined, before: string, after: string): TextEditChange | null`
  - `isOwnUi(event: Event, host: Element): boolean`
  - `eventElement(event: Event, host: Element): Element | null`
  - `parentOf(element: Element): Element | null`, `firstChildOf(element: Element): Element | null`
  - `isEditableText(element: Element): boolean`
  - `POPOVER = { width: 320, height: 200, gap: 8, margin: 8 }`
  - `popoverPosition(rect: { top: number; bottom: number; left: number }, viewport: { width: number; height: number }): { top: number; left: number }`

- [ ] **Step 1: Write the failing test for pins**

`lib/pins.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { groupDrafts, locationLabel, pagePins } from './pins';
import { makeItem, makeSent } from './test-helpers';

const about = { url: 'https://demo.web.app/about', path: '/about', title: 'About' };

describe('pagePins', () => {
  it('numbers drafts first, then sent items', () => {
    const pins = pagePins(
      [makeItem({ id: 'd1' }), makeItem({ id: 'd2' })],
      [makeSent({ id: 's1' })],
      '/home',
    );
    expect(pins.map((pin) => [pin.number, pin.id, pin.state])).toEqual([
      [1, 'd1', 'draft'],
      [2, 'd2', 'draft'],
      [3, 's1', 'sent'],
    ]);
  });

  it('skips items from other pages', () => {
    const pins = pagePins([makeItem({ id: 'd1', page: about })], [makeSent({ id: 's1' })], '/home');
    expect(pins.map((pin) => pin.id)).toEqual(['s1']);
  });

  it('skips page-level comments, which have no anchor', () => {
    const pageComment = makeItem({ id: 'd1', kind: 'page', anchor: undefined });
    expect(pagePins([pageComment], [], '/home')).toEqual([]);
  });

  it('skips resolved sent items', () => {
    expect(pagePins([], [makeSent({ id: 's1', status: 'resolved' })], '/home')).toEqual([]);
  });

  it('shows an item once when it is both a draft and already sent', () => {
    const pins = pagePins([makeItem({ id: 'x' })], [makeSent({ id: 'x' })], '/home');
    expect(pins.map((pin) => [pin.id, pin.state])).toEqual([['x', 'sent']]);
  });
});

describe('groupDrafts', () => {
  it('groups by path with the current page first', () => {
    const groups = groupDrafts(
      [
        makeItem({ id: 'a', page: about }),
        makeItem({ id: 'b' }),
        makeItem({ id: 'c', page: about }),
      ],
      '/home',
    );
    expect(groups.map((group) => [group.path, group.items.map((item) => item.id)])).toEqual([
      ['/home', ['b']],
      ['/about', ['a', 'c']],
    ]);
  });

  it('returns no groups for no drafts', () => {
    expect(groupDrafts([], '/home')).toEqual([]);
  });
});

describe('locationLabel', () => {
  it('prefers the element source, then the nearest source, then the selector', () => {
    const anchor = makeItem().anchor!;
    expect(locationLabel(makeItem())).toBe('src/pages/Home.tsx:12');
    expect(
      locationLabel(makeItem({ anchor: { ...anchor, source: undefined, nearestSource: 'src/App.tsx:3' } })),
    ).toBe('src/App.tsx:3');
    expect(locationLabel(makeItem({ anchor: { ...anchor, source: undefined } }))).toBe('#title');
  });

  it('labels page-level comments', () => {
    expect(locationLabel(makeItem({ kind: 'page', anchor: undefined }))).toBe('Whole page');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run lib/pins.test.ts`
Expected: FAIL with `Failed to resolve import "./pins"`.

- [ ] **Step 3: Implement pins**

`lib/pins.ts`:

```ts
import type { FeedbackItem, SentFeedback } from './types';

export type Pin = {
  id: string;
  number: number;
  state: 'draft' | 'sent';
  item: FeedbackItem | SentFeedback;
};

/**
 * The numbered pins for one page: anchored drafts first, then open sent items.
 * The side panel and the on-page pin layer both use this so their numbers agree.
 */
export function pagePins(drafts: FeedbackItem[], sent: SentFeedback[], path: string): Pin[] {
  const sentIds = new Set(sent.map((item) => item.id));
  const onPage = (item: FeedbackItem) => item.anchor !== undefined && item.page.path === path;

  const draftPins = drafts
    .filter((item) => onPage(item) && !sentIds.has(item.id))
    .map((item) => ({ id: item.id, state: 'draft' as const, item }));
  const sentPins = sent
    .filter((item) => onPage(item) && item.status === 'open')
    .map((item) => ({ id: item.id, state: 'sent' as const, item }));

  return [...draftPins, ...sentPins].map((pin, index) => ({ ...pin, number: index + 1 }));
}

export type DraftGroup = { path: string; items: FeedbackItem[] };

/** Groups drafts by page, with the page currently open first. */
export function groupDrafts(drafts: FeedbackItem[], currentPath: string): DraftGroup[] {
  const groups = new Map<string, FeedbackItem[]>();
  for (const draft of drafts) {
    const items = groups.get(draft.page.path) ?? [];
    items.push(draft);
    groups.set(draft.page.path, items);
  }
  return Array.from(groups, ([path, items]) => ({ path, items })).sort(
    (a, b) => Number(b.path === currentPath) - Number(a.path === currentPath),
  );
}

/** A short description of where a feedback item points, for list rows and tooltips. */
export function locationLabel(item: FeedbackItem): string {
  const { anchor } = item;
  if (!anchor) return 'Whole page';
  return anchor.source ?? anchor.nearestSource ?? anchor.selector;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run lib/pins.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the failing test for text-edit planning**

`lib/text-edit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeItem } from './test-helpers';
import { planTextEdit } from './text-edit';

const existing = makeItem({ id: 'e1', kind: 'text-edit', textEdit: { before: 'Buy', after: 'Order' } });

describe('planTextEdit', () => {
  it('creates a draft for a first edit', () => {
    expect(planTextEdit(undefined, 'Buy', 'Order')).toEqual({
      type: 'create',
      textEdit: { before: 'Buy', after: 'Order' },
    });
  });

  it('does nothing when the text did not change', () => {
    expect(planTextEdit(undefined, 'Buy', 'Buy')).toBeNull();
  });

  it('amends the existing draft and keeps the original text as before', () => {
    expect(planTextEdit(existing, 'Order', 'Order now')).toEqual({
      type: 'update',
      id: 'e1',
      textEdit: { before: 'Buy', after: 'Order now' },
    });
  });

  it('removes the draft when the text is edited back to the original', () => {
    expect(planTextEdit(existing, 'Order', 'Buy')).toEqual({ type: 'remove', id: 'e1' });
  });

  it('does nothing when a re-edit leaves the text as it was', () => {
    expect(planTextEdit(existing, 'Order', 'Order')).toBeNull();
  });

  it('allows clearing the text', () => {
    expect(planTextEdit(undefined, 'Buy', '')).toEqual({
      type: 'create',
      textEdit: { before: 'Buy', after: '' },
    });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run lib/text-edit.test.ts`
Expected: FAIL with `Failed to resolve import "./text-edit"`.

- [ ] **Step 7: Implement text-edit planning**

`lib/text-edit.ts`:

```ts
import type { FeedbackItem } from './types';

export type TextEdit = { before: string; after: string };

export type TextEditChange =
  | { type: 'create'; textEdit: TextEdit }
  | { type: 'update'; id: string; textEdit: TextEdit }
  | { type: 'remove'; id: string };

/**
 * Decides what an inline edit means for the drafts. Editing the same element again
 * amends its existing draft, so the tool sees one change from the original text.
 */
export function planTextEdit(
  existing: FeedbackItem | undefined,
  before: string,
  after: string,
): TextEditChange | null {
  if (!existing?.textEdit) {
    return before === after ? null : { type: 'create', textEdit: { before, after } };
  }
  const original = existing.textEdit.before;
  if (after === original) return { type: 'remove', id: existing.id };
  if (after === existing.textEdit.after) return null;
  return { type: 'update', id: existing.id, textEdit: { before: original, after } };
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm vitest run lib/text-edit.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9: Write the failing test for the picker helpers**

`lib/picker.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eventElement, firstChildOf, isEditableText, isOwnUi, parentOf } from './picker';

function capture(target: Element): Event {
  let seen: Event | undefined;
  const listener = (event: Event) => {
    seen = event;
  };
  document.addEventListener('click', listener, true);
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  document.removeEventListener('click', listener, true);
  return seen!;
}

describe('picker helpers', () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <main><p id="p">Hello <b id="b">world</b></p><button id="btn">Buy</button><div id="empty"> </div></main>
      <textarea id="ta">text</textarea>
      <div id="host"></div>`;
    host = document.querySelector<HTMLElement>('#host')!;
    host.attachShadow({ mode: 'open' }).innerHTML = '<button id="inner">Save</button>';
  });

  it('returns the page element an event started on', () => {
    const button = document.querySelector('#btn')!;
    expect(eventElement(capture(button), host)).toBe(button);
  });

  it('ignores events from inside the extension UI', () => {
    const inner = host.shadowRoot!.querySelector('#inner')!;
    const event = capture(inner);
    expect(isOwnUi(event, host)).toBe(true);
    expect(eventElement(event, host)).toBeNull();
  });

  it('ignores the root element', () => {
    expect(eventElement(capture(document.documentElement), host)).toBeNull();
  });

  it('walks to the parent but not past body', () => {
    expect(parentOf(document.querySelector('#b')!)).toBe(document.querySelector('#p'));
    expect(parentOf(document.body)).toBeNull();
  });

  it('walks to the first child element', () => {
    expect(firstChildOf(document.querySelector('#p')!)).toBe(document.querySelector('#b'));
    expect(firstChildOf(document.querySelector('#btn')!)).toBeNull();
  });

  it('allows inline editing only for text-only elements', () => {
    expect(isEditableText(document.querySelector('#btn')!)).toBe(true);
    expect(isEditableText(document.querySelector('#b')!)).toBe(true);
    expect(isEditableText(document.querySelector('#p')!)).toBe(false);
    expect(isEditableText(document.querySelector('#empty')!)).toBe(false);
    expect(isEditableText(document.querySelector('#ta')!)).toBe(false);
  });
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `pnpm vitest run lib/picker.test.ts`
Expected: FAIL with `Failed to resolve import "./picker"`.

- [ ] **Step 11: Implement the picker helpers**

`lib/picker.ts`:

```ts
import { collapseText } from './text';

const NOT_EDITABLE = new Set(['textarea', 'input', 'select', 'option', 'script', 'style']);

/** True when the event started inside the extension's own UI, which lives under `host`. */
export function isOwnUi(event: Event, host: Element): boolean {
  return event.composedPath().includes(host);
}

/** The page element an event points at, or null for our own UI and for the root element. */
export function eventElement(event: Event, host: Element): Element | null {
  if (isOwnUi(event, host)) return null;
  const target = event.composedPath()[0];
  if (!(target instanceof Element)) return null;
  return target === target.ownerDocument.documentElement ? null : target;
}

export function parentOf(element: Element): Element | null {
  const parent = element.parentElement;
  return parent && parent !== element.ownerDocument.documentElement ? parent : null;
}

export function firstChildOf(element: Element): Element | null {
  return element.firstElementChild;
}

/**
 * Inline text editing is limited to elements that contain text and nothing else, so that
 * cancelling an edit can restore the original without destroying child elements.
 */
export function isEditableText(element: Element): boolean {
  if (NOT_EDITABLE.has(element.localName)) return false;
  if (element.children.length > 0) return false;
  return collapseText(element.textContent ?? '') !== '';
}
```

- [ ] **Step 12: Run it to verify it passes**

Run: `pnpm vitest run lib/picker.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 13: Write the failing test for popover positioning**

`lib/popover-position.test.ts`:

```ts
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
```

- [ ] **Step 14: Run it to verify it fails**

Run: `pnpm vitest run lib/popover-position.test.ts`
Expected: FAIL with `Failed to resolve import "./popover-position"`.

- [ ] **Step 15: Implement popover positioning**

`lib/popover-position.ts`:

```ts
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
```

- [ ] **Step 16: Run it to verify it passes**

Run: `pnpm vitest run lib/popover-position.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 17: Commit**

```bash
git add lib/pins.ts lib/pins.test.ts lib/text-edit.ts lib/text-edit.test.ts lib/picker.ts lib/picker.test.ts lib/popover-position.ts lib/popover-position.test.ts
git commit -m "feat: add pin numbering, text-edit planning and picker helpers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Settings store

**Files:**
- Create: `lib/settings-store.ts`
- Test: `lib/settings-store.test.ts`

**Interfaces:**
- Consumes: `Settings` type; `storage` from `#imports`.
- Produces:
  - `DEFAULT_SETTINGS: Settings` — `useMock: true`, all strings empty.
  - `normalizeSettings(settings: Settings): Settings` — trims; strips trailing slashes from `apiBase`.
  - `validateSettings(settings: Settings): string[]` — empty when valid; always empty in mock mode.
  - `isConfigured(settings: Settings): boolean`
  - `requiredOrigins(settings: Settings): string[]` — host-permission patterns such as `https://api.example.com/*`.
  - `getSettings(): Promise<Settings>`, `saveSettings(settings: Settings): Promise<void>`, `watchSettings(callback: (settings: Settings) => void): () => void`
- Storage key: `local:settings`.

- [ ] **Step 1: Write the failing test**

`lib/settings-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS,
  getSettings,
  isConfigured,
  normalizeSettings,
  requiredOrigins,
  saveSettings,
  validateSettings,
} from './settings-store';
import type { Settings } from './types';

const real: Settings = {
  useMock: false,
  apiBase: 'https://api.example.com/v1',
  oauth: {
    authorizeUrl: 'https://auth.example.com/authorize',
    tokenUrl: 'https://auth.example.com/token',
    clientId: 'ext',
    scopes: 'feedback',
  },
};

describe('settings-store', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('defaults to mock mode', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.useMock).toBe(true);
  });

  it('saves normalised settings', async () => {
    await saveSettings({ ...real, apiBase: '  https://api.example.com/v1// ' });
    expect((await getSettings()).apiBase).toBe('https://api.example.com/v1');
  });

  it('trims the OAuth fields', () => {
    const normalised = normalizeSettings({
      ...real,
      oauth: { ...real.oauth, clientId: ' ext ', scopes: ' feedback ' },
    });
    expect(normalised.oauth.clientId).toBe('ext');
    expect(normalised.oauth.scopes).toBe('feedback');
  });
});

describe('validateSettings', () => {
  it('accepts anything in mock mode', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual([]);
    expect(isConfigured(DEFAULT_SETTINGS)).toBe(true);
  });

  it('accepts complete real settings', () => {
    expect(validateSettings(real)).toEqual([]);
  });

  it('accepts http only for localhost', () => {
    expect(validateSettings({ ...real, apiBase: 'http://localhost:8787' })).toEqual([]);
    expect(validateSettings({ ...real, apiBase: 'http://api.example.com' })).toEqual([
      'API base URL must be an https URL.',
    ]);
  });

  it('reports every missing field when mock is off', () => {
    const errors = validateSettings({ ...DEFAULT_SETTINGS, useMock: false });
    expect(errors).toHaveLength(4);
    expect(isConfigured({ ...DEFAULT_SETTINGS, useMock: false })).toBe(false);
  });

  it('rejects text that is not a URL', () => {
    expect(validateSettings({ ...real, apiBase: 'not a url' })).toEqual([
      'API base URL must be an https URL.',
    ]);
  });
});

describe('requiredOrigins', () => {
  it('returns one pattern per distinct host, without ports or paths', () => {
    expect(requiredOrigins(real)).toEqual(['https://api.example.com/*', 'https://auth.example.com/*']);
    expect(requiredOrigins({ ...real, apiBase: 'http://localhost:8787/api' })).toContain(
      'http://localhost/*',
    );
  });

  it('deduplicates and skips invalid URLs', () => {
    const sameHost = { ...real, apiBase: 'https://auth.example.com/api' };
    expect(requiredOrigins(sameHost)).toEqual(['https://auth.example.com/*']);
    expect(requiredOrigins({ ...real, apiBase: 'nope' })).toEqual(['https://auth.example.com/*']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run lib/settings-store.test.ts`
Expected: FAIL with `Failed to resolve import "./settings-store"`.

- [ ] **Step 3: Implement**

`lib/settings-store.ts`:

```ts
import { storage } from '#imports';
import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  useMock: true,
  apiBase: '',
  oauth: { authorizeUrl: '', tokenUrl: '', clientId: '', scopes: '' },
};

const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

export function normalizeSettings(settings: Settings): Settings {
  return {
    useMock: settings.useMock,
    apiBase: settings.apiBase.trim().replace(/\/+$/, ''),
    oauth: {
      authorizeUrl: settings.oauth.authorizeUrl.trim(),
      tokenUrl: settings.oauth.tokenUrl.trim(),
      clientId: settings.oauth.clientId.trim(),
      scopes: settings.oauth.scopes.trim(),
    },
  };
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isAllowedUrl(value: string): boolean {
  const url = parseUrl(value);
  if (!url) return false;
  return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
}

/** Returns human-readable problems; an empty list means the settings can be saved. */
export function validateSettings(settings: Settings): string[] {
  if (settings.useMock) return [];
  const errors: string[] = [];
  if (!isAllowedUrl(settings.apiBase)) errors.push('API base URL must be an https URL.');
  if (!isAllowedUrl(settings.oauth.authorizeUrl)) errors.push('Authorize URL must be an https URL.');
  if (!isAllowedUrl(settings.oauth.tokenUrl)) errors.push('Token URL must be an https URL.');
  if (!settings.oauth.clientId) errors.push('Client ID is required.');
  return errors;
}

export function isConfigured(settings: Settings): boolean {
  return validateSettings(settings).length === 0;
}

/** Host-permission patterns the background needs in order to call the API and token endpoint. */
export function requiredOrigins(settings: Settings): string[] {
  const patterns = [settings.apiBase, settings.oauth.tokenUrl]
    .map(parseUrl)
    .filter((url): url is URL => url !== null)
    .map((url) => `${url.protocol}//${url.hostname}/*`);
  return Array.from(new Set(patterns));
}

export function getSettings(): Promise<Settings> {
  return settingsItem.getValue();
}

export function saveSettings(settings: Settings): Promise<void> {
  return settingsItem.setValue(normalizeSettings(settings));
}

export function watchSettings(callback: (settings: Settings) => void): () => void {
  return settingsItem.watch((settings) => callback(settings ?? DEFAULT_SETTINGS));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run lib/settings-store.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/settings-store.ts lib/settings-store.test.ts
git commit -m "feat: add settings store with validation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: OAuth with PKCE

**Files:**
- Create: `lib/auth/pkce.ts`, `lib/auth/oauth.ts`
- Test: `lib/auth/pkce.test.ts`, `lib/auth/oauth.test.ts`

**Interfaces:**
- Consumes: `OAuthSettings` type; `storage` from `#imports`.
- Produces:
  - `base64UrlEncode(bytes: Uint8Array): string`, `createVerifier(): string`, `createState(): string`, `createChallenge(verifier: string): Promise<string>`
  - `type Tokens = { accessToken: string; refreshToken?: string; expiresAt: number }`
  - `type OAuthDeps = { settings: OAuthSettings; redirectUri: string; fetch: typeof fetch; now: () => number; launchWebAuthFlow: (url: string) => Promise<string | undefined> }`
  - `buildAuthorizeUrl(settings: OAuthSettings, redirectUri: string, challenge: string, state: string): string`
  - `parseRedirect(redirectUrl: string, expectedState: string): string` — returns the code or throws.
  - `signIn(deps: OAuthDeps): Promise<void>`, `signOut(): Promise<void>`, `isSignedIn(): Promise<boolean>`
  - `watchTokens(callback: () => void): () => void` — fires on every token change.
  - `getAccessToken(deps: OAuthDeps, options?: { forceRefresh?: boolean }): Promise<string | null>` — `null` means the user must sign in.
- Storage key: `local:tokens`.

- [ ] **Step 1: Write the failing test for PKCE**

`lib/auth/pkce.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { base64UrlEncode, createChallenge, createState, createVerifier } from './pkce';

describe('pkce', () => {
  it('encodes without padding or URL-unsafe characters', () => {
    expect(base64UrlEncode(new Uint8Array([251, 255, 254]))).toBe('-__-');
    expect(base64UrlEncode(new Uint8Array([1]))).toBe('AQ');
  });

  it('matches the RFC 7636 appendix B example', async () => {
    expect(await createChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('creates a 43-character verifier from the unreserved alphabet', () => {
    expect(createVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('creates a different verifier and state each time', () => {
    expect(createVerifier()).not.toBe(createVerifier());
    expect(createState()).not.toBe(createState());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run lib/auth/pkce.test.ts`
Expected: FAIL with `Failed to resolve import "./pkce"`.

- [ ] **Step 3: Implement PKCE**

`lib/auth/pkce.ts`:

```ts
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(byteLength: number): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export function createVerifier(): string {
  return randomToken(32);
}

export function createState(): string {
  return randomToken(16);
}

export async function createChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run lib/auth/pkce.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing test for the OAuth flow**

`lib/auth/oauth.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  type OAuthDeps,
  buildAuthorizeUrl,
  getAccessToken,
  isSignedIn,
  parseRedirect,
  signIn,
  signOut,
  watchTokens,
} from './oauth';

const settings = {
  authorizeUrl: 'https://auth.example.com/authorize',
  tokenUrl: 'https://auth.example.com/token',
  clientId: 'ext',
  scopes: 'feedback',
};
const redirectUri = 'https://abc.chromiumapp.org/';

function tokenResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeDeps(overrides: Partial<OAuthDeps> = {}): OAuthDeps {
  return {
    settings,
    redirectUri,
    now: () => 1_000_000,
    fetch: vi.fn(async () =>
      tokenResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }),
    ) as unknown as typeof fetch,
    launchWebAuthFlow: vi.fn(async (url: string) => {
      const state = new URL(url).searchParams.get('state');
      return `${redirectUri}?code=the-code&state=${state}`;
    }),
    ...overrides,
  };
}

function bodyOf(fetchMock: unknown, call = 0): URLSearchParams {
  const init = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[call]![1] as RequestInit;
  return new URLSearchParams(init.body as string);
}

describe('buildAuthorizeUrl', () => {
  it('includes the PKCE and client parameters', () => {
    const url = new URL(buildAuthorizeUrl(settings, redirectUri, 'chal', 'st'));
    expect(url.origin + url.pathname).toBe('https://auth.example.com/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'ext',
      redirect_uri: redirectUri,
      code_challenge: 'chal',
      code_challenge_method: 'S256',
      state: 'st',
      scope: 'feedback',
    });
  });

  it('omits scope when none is configured', () => {
    const url = new URL(buildAuthorizeUrl({ ...settings, scopes: '' }, redirectUri, 'c', 's'));
    expect(url.searchParams.has('scope')).toBe(false);
  });
});

describe('parseRedirect', () => {
  it('returns the code when the state matches', () => {
    expect(parseRedirect(`${redirectUri}?code=abc&state=st`, 'st')).toBe('abc');
  });

  it('rejects a state mismatch', () => {
    expect(() => parseRedirect(`${redirectUri}?code=abc&state=other`, 'st')).toThrow('state mismatch');
  });

  it('surfaces the provider error', () => {
    expect(() =>
      parseRedirect(`${redirectUri}?error=access_denied&error_description=Nope&state=st`, 'st'),
    ).toThrow('Sign-in failed: Nope');
  });

  it('rejects a redirect without a code', () => {
    expect(() => parseRedirect(`${redirectUri}?state=st`, 'st')).toThrow('no authorization code');
  });
});

describe('sign-in and tokens', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('exchanges the code with the PKCE verifier and stores the tokens', async () => {
    const deps = makeDeps();
    await signIn(deps);

    const body = bodyOf(deps.fetch);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('client_id')).toBe('ext');
    expect(body.get('redirect_uri')).toBe(redirectUri);
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await isSignedIn()).toBe(true);
    expect(await getAccessToken(deps)).toBe('access-1');
  });

  it('fails when the auth window is closed', async () => {
    const deps = makeDeps({ launchWebAuthFlow: vi.fn(async () => undefined) });
    await expect(signIn(deps)).rejects.toThrow('Sign-in was cancelled');
    expect(await isSignedIn()).toBe(false);
  });

  it('fails when the token endpoint rejects the code', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () => tokenResponse({}, 400)) as unknown as typeof fetch,
    });
    await expect(signIn(deps)).rejects.toThrow('Token request failed (400)');
    expect(await isSignedIn()).toBe(false);
  });

  it('returns null when signed out', async () => {
    expect(await getAccessToken(makeDeps())).toBeNull();
  });

  it('signs out', async () => {
    const deps = makeDeps();
    await signIn(deps);
    await signOut();
    expect(await isSignedIn()).toBe(false);
    expect(await getAccessToken(deps)).toBeNull();
  });

  it('notifies token watchers on sign-in and sign-out', async () => {
    const onChange = vi.fn();
    const unwatch = watchTokens(onChange);
    await signIn(makeDeps());
    expect(onChange).toHaveBeenCalledTimes(1);
    await signOut();
    expect(onChange).toHaveBeenCalledTimes(2);
    unwatch();
    await signIn(makeDeps());
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('refreshes a token that is about to expire and keeps the old refresh token', async () => {
    const deps = makeDeps();
    await signIn(deps);

    const later = makeDeps({
      now: () => 1_000_000 + 3600_000 - 30_000,
      fetch: vi.fn(async () =>
        tokenResponse({ access_token: 'access-2', expires_in: 3600 }),
      ) as unknown as typeof fetch,
    });
    expect(await getAccessToken(later)).toBe('access-2');
    const body = bodyOf(later.fetch);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-1');

    const afterwards = makeDeps({ now: () => 1_000_000 + 3600_000 + 3600_000 - 30_000 });
    await getAccessToken(afterwards);
    expect(bodyOf(afterwards.fetch).get('refresh_token')).toBe('refresh-1');
  });

  it('refreshes on demand even when the token looks fresh', async () => {
    const deps = makeDeps();
    await signIn(deps);
    const forced = makeDeps({
      fetch: vi.fn(async () =>
        tokenResponse({ access_token: 'access-2', expires_in: 3600 }),
      ) as unknown as typeof fetch,
    });
    expect(await getAccessToken(forced, { forceRefresh: true })).toBe('access-2');
  });

  it('shares one refresh between concurrent callers', async () => {
    const deps = makeDeps();
    await signIn(deps);
    const later = makeDeps({
      now: () => 1_000_000 + 3600_000,
      fetch: vi.fn(async () =>
        tokenResponse({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }),
      ) as unknown as typeof fetch,
    });
    const [a, b] = await Promise.all([getAccessToken(later), getAccessToken(later)]);
    expect([a, b]).toEqual(['access-2', 'access-2']);
    expect(later.fetch).toHaveBeenCalledTimes(1);
  });

  it('signs out when the refresh is rejected', async () => {
    const deps = makeDeps();
    await signIn(deps);
    const later = makeDeps({
      now: () => 1_000_000 + 3600_000,
      fetch: vi.fn(async () => tokenResponse({}, 400)) as unknown as typeof fetch,
    });
    expect(await getAccessToken(later)).toBeNull();
    expect(await isSignedIn()).toBe(false);
  });

  it('signs out when the token expired and there is no refresh token', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () =>
        tokenResponse({ access_token: 'access-1', expires_in: 3600 }),
      ) as unknown as typeof fetch,
    });
    await signIn(deps);
    const later = makeDeps({ now: () => 1_000_000 + 3600_000 });
    expect(await getAccessToken(later)).toBeNull();
    expect(later.fetch).not.toHaveBeenCalled();
    expect(await isSignedIn()).toBe(false);
  });

  it('defaults to a one-hour lifetime when expires_in is missing', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () =>
        tokenResponse({ access_token: 'access-1', refresh_token: 'r' }),
      ) as unknown as typeof fetch,
    });
    await signIn(deps);
    const almostHour = makeDeps({ now: () => 1_000_000 + 3600_000 - 120_000 });
    expect(await getAccessToken(almostHour)).toBe('access-1');
    expect(almostHour.fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run lib/auth/oauth.test.ts`
Expected: FAIL with `Failed to resolve import "./oauth"`.

- [ ] **Step 7: Implement the OAuth flow**

`lib/auth/oauth.ts`:

```ts
import { storage } from '#imports';
import type { OAuthSettings } from '../types';
import { createChallenge, createState, createVerifier } from './pkce';

export type Tokens = { accessToken: string; refreshToken?: string; expiresAt: number };

export type OAuthDeps = {
  settings: OAuthSettings;
  redirectUri: string;
  fetch: typeof fetch;
  now: () => number;
  launchWebAuthFlow: (url: string) => Promise<string | undefined>;
};

const EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_EXPIRES_IN_S = 3600;

const tokensItem = storage.defineItem<Tokens | null>('local:tokens', { fallback: null });

export function buildAuthorizeUrl(
  settings: OAuthSettings,
  redirectUri: string,
  challenge: string,
  state: string,
): string {
  const url = new URL(settings.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', settings.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  if (settings.scopes) url.searchParams.set('scope', settings.scopes);
  return url.toString();
}

/** Extracts the authorization code from the redirect, rejecting errors and forged states. */
export function parseRedirect(redirectUrl: string, expectedState: string): string {
  const params = new URL(redirectUrl).searchParams;
  const error = params.get('error');
  if (error) throw new Error(`Sign-in failed: ${params.get('error_description') ?? error}`);
  if (params.get('state') !== expectedState) throw new Error('Sign-in failed: state mismatch');
  const code = params.get('code');
  if (!code) throw new Error('Sign-in failed: no authorization code returned');
  return code;
}

async function requestTokens(
  deps: OAuthDeps,
  body: Record<string, string>,
  previous?: Tokens,
): Promise<Tokens> {
  const response = await deps.fetch(deps.settings.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: deps.settings.clientId, ...body }).toString(),
  });
  if (!response.ok) throw new Error(`Token request failed (${response.status})`);
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) throw new Error('Token response had no access_token');
  const refreshToken = json.refresh_token ?? previous?.refreshToken;
  return {
    accessToken: json.access_token,
    ...(refreshToken ? { refreshToken } : {}),
    expiresAt: deps.now() + (json.expires_in ?? DEFAULT_EXPIRES_IN_S) * 1000,
  };
}

export async function signIn(deps: OAuthDeps): Promise<void> {
  const verifier = createVerifier();
  const state = createState();
  const challenge = await createChallenge(verifier);
  const redirectUrl = await deps.launchWebAuthFlow(
    buildAuthorizeUrl(deps.settings, deps.redirectUri, challenge, state),
  );
  if (!redirectUrl) throw new Error('Sign-in was cancelled');
  const code = parseRedirect(redirectUrl, state);
  const tokens = await requestTokens(deps, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: deps.redirectUri,
    code_verifier: verifier,
  });
  await tokensItem.setValue(tokens);
}

export async function signOut(): Promise<void> {
  await tokensItem.setValue(null);
}

export async function isSignedIn(): Promise<boolean> {
  return (await tokensItem.getValue()) !== null;
}

/** Fires whenever the stored tokens change: sign-in, sign-out, refresh, or a forced sign-out. */
export function watchTokens(callback: () => void): () => void {
  return tokensItem.watch(() => callback());
}

// Refresh tokens are often single-use, so concurrent callers must share one refresh.
let refreshing: Promise<string | null> | null = null;

async function refresh(deps: OAuthDeps, tokens: Tokens): Promise<string | null> {
  if (!tokens.refreshToken) {
    await signOut();
    return null;
  }
  try {
    const next = await requestTokens(
      deps,
      { grant_type: 'refresh_token', refresh_token: tokens.refreshToken },
      tokens,
    );
    await tokensItem.setValue(next);
    return next.accessToken;
  } catch {
    await signOut();
    return null;
  }
}

/** Returns a usable access token, refreshing it when needed, or null when sign-in is required. */
export async function getAccessToken(
  deps: OAuthDeps,
  options: { forceRefresh?: boolean } = {},
): Promise<string | null> {
  const tokens = await tokensItem.getValue();
  if (!tokens) return null;
  const fresh = tokens.expiresAt - deps.now() > EXPIRY_MARGIN_MS;
  if (fresh && !options.forceRefresh) return tokens.accessToken;
  refreshing ??= refresh(deps, tokens).finally(() => {
    refreshing = null;
  });
  return refreshing;
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm vitest run lib/auth/oauth.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 9: Commit**

```bash
git add lib/auth
git commit -m "feat: add OAuth authorization-code flow with PKCE and token refresh" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Feedback API adapters

**Files:**
- Create: `lib/api/feedback-api.ts`, `lib/api/mock-feedback-api.ts`, `lib/api/http-feedback-api.ts`
- Test: `lib/api/mock-feedback-api.test.ts`, `lib/api/http-feedback-api.test.ts`

**Interfaces:**
- Consumes: `FeedbackItem`, `SentFeedback`, `ClientInfo` types; `makeItem`, `makeSent`; `storage` from `#imports`.
- Produces:
  - `interface FeedbackApi { submit(projectId: string, items: FeedbackItem[]): Promise<SentFeedback[]>; list(projectId: string, path: string): Promise<SentFeedback[]> }`
  - `class ApiError extends Error { readonly status?: number }`, `class UnauthorizedError extends ApiError` (message `Sign in to continue`)
  - `MOCK_AUTHOR = { id: 'mock-user', name: 'You (mock)' }`, `createMockFeedbackApi(): FeedbackApi`
  - `type HttpFeedbackApiDeps = { apiBase: string; client: ClientInfo; fetch: typeof fetch; getAccessToken: (options?: { forceRefresh?: boolean }) => Promise<string | null>; onUnauthorized: () => Promise<void> }`
  - `createHttpFeedbackApi(deps: HttpFeedbackApiDeps): FeedbackApi`
- Storage key (mock only): `local:mock-feedback`.
- HTTP contract: `POST {apiBase}/projects/{projectId}/feedback` with body `{ items, client }`; `GET {apiBase}/projects/{projectId}/feedback?path={path}`; both respond with a JSON array of `SentFeedback`.

- [ ] **Step 1: Create the interface and error types**

`lib/api/feedback-api.ts`:

```ts
import type { FeedbackItem, SentFeedback } from '../types';

export interface FeedbackApi {
  /** Sends drafts to the tool. Resending an item with the same id must not duplicate it. */
  submit(projectId: string, items: FeedbackItem[]): Promise<SentFeedback[]>;
  /** Returns the feedback already sent for one page of a project. */
  list(projectId: string, path: string): Promise<SentFeedback[]>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class UnauthorizedError extends ApiError {
  constructor() {
    super('Sign in to continue', 401);
    this.name = 'UnauthorizedError';
  }
}
```

- [ ] **Step 2: Write the failing test for the mock API**

`lib/api/mock-feedback-api.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { makeItem } from '../test-helpers';
import { MOCK_AUTHOR, createMockFeedbackApi } from './mock-feedback-api';

const home = { url: 'https://demo.web.app/home', path: '/home', title: 'Home' };
const about = { url: 'https://demo.web.app/about', path: '/about', title: 'About' };

describe('MockFeedbackApi', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('returns submitted items as open feedback from the mock author', async () => {
    const api = createMockFeedbackApi();
    const sent = await api.submit('p1', [makeItem({ id: 'a' })]);
    expect(sent).toEqual([{ ...makeItem({ id: 'a' }), author: MOCK_AUTHOR, status: 'open' }]);
  });

  it('lists by project and path', async () => {
    const api = createMockFeedbackApi();
    await api.submit('p1', [makeItem({ id: 'a', page: home }), makeItem({ id: 'b', page: about })]);
    await api.submit('p2', [makeItem({ id: 'c', page: home })]);
    expect((await api.list('p1', '/home')).map((item) => item.id)).toEqual(['a']);
    expect((await api.list('p1', '/about')).map((item) => item.id)).toEqual(['b']);
    expect(await api.list('p3', '/home')).toEqual([]);
  });

  it('does not duplicate an item that is submitted twice', async () => {
    const api = createMockFeedbackApi();
    await api.submit('p1', [makeItem({ id: 'a', page: home })]);
    const again = await api.submit('p1', [makeItem({ id: 'a', page: home })]);
    expect(again.map((item) => item.id)).toEqual(['a']);
    expect(await api.list('p1', '/home')).toHaveLength(1);
  });

  it('persists across instances', async () => {
    await createMockFeedbackApi().submit('p1', [makeItem({ id: 'a', page: home })]);
    expect(await createMockFeedbackApi().list('p1', '/home')).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run lib/api/mock-feedback-api.test.ts`
Expected: FAIL with `Failed to resolve import "./mock-feedback-api"`.

- [ ] **Step 4: Implement the mock API**

`lib/api/mock-feedback-api.ts`:

```ts
import { storage } from '#imports';
import type { SentFeedback } from '../types';
import type { FeedbackApi } from './feedback-api';

export const MOCK_AUTHOR = { id: 'mock-user', name: 'You (mock)' };

const mockItem = storage.defineItem<Record<string, SentFeedback[]>>('local:mock-feedback', {
  fallback: {},
});

/** Stands in for the tool's API until the real one exists. Data stays in this browser. */
export function createMockFeedbackApi(): FeedbackApi {
  return {
    async submit(projectId, items) {
      const all = await mockItem.getValue();
      const stored = all[projectId] ?? [];
      const known = new Set(stored.map((item) => item.id));
      const created = items
        .filter((item) => !known.has(item.id))
        .map((item): SentFeedback => ({ ...item, author: MOCK_AUTHOR, status: 'open' }));
      const next = [...stored, ...created];
      await mockItem.setValue({ ...all, [projectId]: next });
      const ids = new Set(items.map((item) => item.id));
      return next.filter((item) => ids.has(item.id));
    },

    async list(projectId, path) {
      const all = await mockItem.getValue();
      return (all[projectId] ?? []).filter((item) => item.page.path === path);
    },
  };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm vitest run lib/api/mock-feedback-api.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Write the failing test for the HTTP API**

`lib/api/http-feedback-api.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { makeItem, makeSent } from '../test-helpers';
import { ApiError, UnauthorizedError } from './feedback-api';
import { type HttpFeedbackApiDeps, createHttpFeedbackApi } from './http-feedback-api';

const client = { extensionVersion: '0.1.0', userAgent: 'test-agent' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function setup(responses: Array<Response | Error>, overrides: Partial<HttpFeedbackApiDeps> = {}) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return next;
  });
  const deps: HttpFeedbackApiDeps = {
    apiBase: 'https://api.example.com/v1',
    client,
    fetch: fetchMock as unknown as typeof fetch,
    getAccessToken: vi.fn(async (options?: { forceRefresh?: boolean }) =>
      options?.forceRefresh ? 'token-2' : 'token-1',
    ),
    onUnauthorized: vi.fn(async () => undefined),
    ...overrides,
  };
  return { api: createHttpFeedbackApi(deps), fetchMock, deps };
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return init?.headers as Record<string, string>;
}

describe('HttpFeedbackApi', () => {
  it('posts items and client info with a bearer token', async () => {
    const { api, fetchMock } = setup([json([makeSent({ id: 'a' })])]);
    const sent = await api.submit('proj 1', [makeItem({ id: 'a' })]);

    expect(sent).toEqual([makeSent({ id: 'a' })]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/projects/proj%201/feedback');
    expect(init?.method).toBe('POST');
    expect(headersOf(init)).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-1',
    });
    expect(JSON.parse(init?.body as string)).toEqual({ items: [makeItem({ id: 'a' })], client });
  });

  it('lists by encoded path', async () => {
    const { api, fetchMock } = setup([json([])]);
    expect(await api.list('p1', '/#/settings?x=1')).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/projects/p1/feedback?path=%2F%23%2Fsettings%3Fx%3D1');
    expect(init?.method).toBe('GET');
    expect(headersOf(init).Authorization).toBe('Bearer token-1');
  });

  it('fails without calling the server when signed out', async () => {
    const { api, fetchMock } = setup([], { getAccessToken: vi.fn(async () => null) });
    await expect(api.list('p1', '/')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes the token once after a 401 and retries', async () => {
    const { api, fetchMock, deps } = setup([json({}, 401), json([makeSent()])]);
    expect(await api.list('p1', '/')).toEqual([makeSent()]);
    expect(deps.getAccessToken).toHaveBeenLastCalledWith({ forceRefresh: true });
    expect(headersOf(fetchMock.mock.calls[1]![1]).Authorization).toBe('Bearer token-2');
    expect(deps.onUnauthorized).not.toHaveBeenCalled();
  });

  it('gives up and reports unauthorized after a second 401', async () => {
    const { api, fetchMock, deps } = setup([json({}, 401), json({}, 401)]);
    await expect(api.list('p1', '/')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(deps.onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('reports unauthorized when the refresh yields no token', async () => {
    const { api, fetchMock } = setup([json({}, 401)], {
      getAccessToken: vi.fn(async (options?: { forceRefresh?: boolean }) =>
        options?.forceRefresh ? null : 'token-1',
      ),
    });
    await expect(api.list('p1', '/')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports server errors with their status', async () => {
    const { api } = setup([json({ message: 'boom' }, 500)]);
    const error = await api.submit('p1', [makeItem()]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
    expect((error as ApiError).message).toBe('Request failed (500)');
  });

  it('reports network failures as an ApiError', async () => {
    const { api } = setup([new TypeError('Failed to fetch')]);
    await expect(api.list('p1', '/')).rejects.toThrow('Could not reach the server');
  });

  it('rejects a body that is not an array', async () => {
    const { api } = setup([json({ items: [] })]);
    await expect(api.list('p1', '/')).rejects.toThrow('unexpected response');
  });

  it('rejects a body that is not JSON', async () => {
    const { api } = setup([new Response('<html>gateway</html>', { status: 200 })]);
    await expect(api.list('p1', '/')).rejects.toThrow('unexpected response');
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm vitest run lib/api/http-feedback-api.test.ts`
Expected: FAIL with `Failed to resolve import "./http-feedback-api"`.

- [ ] **Step 8: Implement the HTTP API**

`lib/api/http-feedback-api.ts`:

```ts
import type { ClientInfo, SentFeedback } from '../types';
import { ApiError, type FeedbackApi, UnauthorizedError } from './feedback-api';

export type HttpFeedbackApiDeps = {
  apiBase: string;
  client: ClientInfo;
  fetch: typeof fetch;
  getAccessToken: (options?: { forceRefresh?: boolean }) => Promise<string | null>;
  /** Called when the API still answers 401 after a token refresh. */
  onUnauthorized: () => Promise<void>;
};

/**
 * The real API adapter. When the tool's actual contract is known, this is the file to change:
 * the URLs, the request body, and how the response maps to SentFeedback.
 */
export function createHttpFeedbackApi(deps: HttpFeedbackApiDeps): FeedbackApi {
  async function send(url: string, init: RequestInit, token: string): Promise<Response> {
    try {
      return await deps.fetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new ApiError('Could not reach the server. Check your connection.');
    }
  }

  async function request(url: string, init: RequestInit): Promise<SentFeedback[]> {
    let token = await deps.getAccessToken();
    if (!token) throw new UnauthorizedError();

    let response = await send(url, init, token);
    if (response.status === 401) {
      token = await deps.getAccessToken({ forceRefresh: true });
      if (!token) throw new UnauthorizedError();
      response = await send(url, init, token);
      if (response.status === 401) {
        await deps.onUnauthorized();
        throw new UnauthorizedError();
      }
    }
    if (!response.ok) throw new ApiError(`Request failed (${response.status})`, response.status);

    const data: unknown = await response.json().catch(() => null);
    if (!Array.isArray(data)) throw new ApiError('The server sent an unexpected response.');
    return data as SentFeedback[];
  }

  const feedbackUrl = (projectId: string) =>
    `${deps.apiBase}/projects/${encodeURIComponent(projectId)}/feedback`;

  return {
    submit(projectId, items) {
      return request(feedbackUrl(projectId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, client: deps.client }),
      });
    },

    list(projectId, path) {
      return request(`${feedbackUrl(projectId)}?path=${encodeURIComponent(path)}`, {
        method: 'GET',
      });
    },
  };
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `pnpm vitest run lib/api/http-feedback-api.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 10: Commit**

```bash
git add lib/api
git commit -m "feat: add feedback API interface with mock and HTTP adapters" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Background request handling

**Files:**
- Create: `lib/messages.ts`, `lib/background-handlers.ts`, `lib/background-client.ts`
- Modify: `entrypoints/background.ts` (replace the stub from Task 1)
- Test: `lib/background-handlers.test.ts`

**Interfaces:**
- Consumes: `FeedbackApi`, `UnauthorizedError`, `createMockFeedbackApi`, `createHttpFeedbackApi` (Task 8); `listDrafts`, `removeDrafts`, `addDraft` (Task 4); `getSettings`, `isConfigured`, `DEFAULT_SETTINGS` (Task 6); `OAuthDeps`, `signIn`, `signOut`, `isSignedIn`, `getAccessToken` (Task 7).
- Produces:
  - `PANEL_PORT = 'vibe-panel'`
  - `type PickerKey = 'ArrowUp' | 'ArrowDown'`
  - `type PanelToContent = { type: 'set-mode'; mode: Mode } | { type: 'key'; key: PickerKey } | { type: 'focus-item'; id: string } | { type: 'create-page-comment'; comment: string } | { type: 'set-sent'; items: SentFeedback[] }`
  - `type ContentToPanel = { type: 'context'; context: PageContext | null } | { type: 'mode'; mode: Mode } | { type: 'unresolved'; ids: string[] }`
  - `type ContentReady = { type: 'content-ready' }`, `isContentReady(message: unknown): message is ContentReady`
  - `type AuthState = { useMock: boolean; configured: boolean; signedIn: boolean }`
  - `type BackgroundRequest = { type: 'submit'; projectId: string } | { type: 'list'; projectId: string; path: string } | { type: 'sign-in' } | { type: 'sign-out' } | { type: 'auth-state' }`
  - `type BackgroundResponse = { submit: SentFeedback[]; list: SentFeedback[]; 'sign-in': AuthState; 'sign-out': AuthState; 'auth-state': AuthState }`
  - `type ErrorCode = 'unauthorized' | 'not-configured' | 'failed'`
  - `type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; error: string }`
  - `isBackgroundRequest(message: unknown): message is BackgroundRequest`
  - `type HandlerDeps = { getSettings: () => Promise<Settings>; createApi: (settings: Settings) => FeedbackApi; signIn: (settings: Settings) => Promise<void>; signOut: () => Promise<void>; isSignedIn: () => Promise<boolean> }`
  - `handleRequest(request: BackgroundRequest, deps: HandlerDeps): Promise<Result<unknown>>`
  - `sendToBackground<T extends BackgroundRequest['type']>(request: Extract<BackgroundRequest, { type: T }>): Promise<Result<BackgroundResponse[T]>>` — never rejects.

- [ ] **Step 1: Create the message types**

`lib/messages.ts`:

```ts
import type { Mode, PageContext, SentFeedback } from './types';

/** Name of the long-lived port the side panel opens to a tab's content script. */
export const PANEL_PORT = 'vibe-panel';

/** Keys pressed while the side panel has focus, forwarded so they still steer the picker. */
export type PickerKey = 'ArrowUp' | 'ArrowDown';

export type PanelToContent =
  | { type: 'set-mode'; mode: Mode }
  | { type: 'key'; key: PickerKey }
  | { type: 'focus-item'; id: string }
  | { type: 'create-page-comment'; comment: string }
  | { type: 'set-sent'; items: SentFeedback[] };

export type ContentToPanel =
  | { type: 'context'; context: PageContext | null }
  | { type: 'mode'; mode: Mode }
  | { type: 'unresolved'; ids: string[] };

/** Broadcast by a content script when it starts, so an open side panel can connect to it. */
export type ContentReady = { type: 'content-ready' };

export function isContentReady(message: unknown): message is ContentReady {
  return (message as ContentReady | null)?.type === 'content-ready';
}

export type AuthState = { useMock: boolean; configured: boolean; signedIn: boolean };

export type BackgroundRequest =
  | { type: 'submit'; projectId: string }
  | { type: 'list'; projectId: string; path: string }
  | { type: 'sign-in' }
  | { type: 'sign-out' }
  | { type: 'auth-state' };

export type BackgroundResponse = {
  submit: SentFeedback[];
  list: SentFeedback[];
  'sign-in': AuthState;
  'sign-out': AuthState;
  'auth-state': AuthState;
};

export type ErrorCode = 'unauthorized' | 'not-configured' | 'failed';

export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; error: string };

const REQUEST_TYPES: ReadonlyArray<BackgroundRequest['type']> = [
  'submit',
  'list',
  'sign-in',
  'sign-out',
  'auth-state',
];

export function isBackgroundRequest(message: unknown): message is BackgroundRequest {
  const type = (message as { type?: unknown } | null)?.type;
  return typeof type === 'string' && (REQUEST_TYPES as readonly string[]).includes(type);
}
```

- [ ] **Step 2: Write the failing test for the handlers**

`lib/background-handlers.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ApiError, type FeedbackApi, UnauthorizedError } from './api/feedback-api';
import { createMockFeedbackApi } from './api/mock-feedback-api';
import { type HandlerDeps, handleRequest } from './background-handlers';
import { addDraft, listDrafts } from './draft-store';
import { isBackgroundRequest } from './messages';
import { DEFAULT_SETTINGS } from './settings-store';
import { makeItem } from './test-helpers';
import type { Settings } from './types';

const real: Settings = {
  useMock: false,
  apiBase: 'https://api.example.com',
  oauth: {
    authorizeUrl: 'https://auth.example.com/authorize',
    tokenUrl: 'https://auth.example.com/token',
    clientId: 'ext',
    scopes: '',
  },
};

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    getSettings: async () => DEFAULT_SETTINGS,
    createApi: () => createMockFeedbackApi(),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    isSignedIn: vi.fn(async () => false),
    ...overrides,
  };
}

function failingApi(error: Error): FeedbackApi {
  return {
    submit: async () => {
      throw error;
    },
    list: async () => {
      throw error;
    },
  };
}

describe('handleRequest', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('submits every draft of the project and clears them', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    await addDraft('p1', makeItem({ id: 'b' }));
    await addDraft('p2', makeItem({ id: 'other' }));

    const result = await handleRequest({ type: 'submit', projectId: 'p1' }, makeDeps());

    expect(result).toMatchObject({ ok: true, value: [{ id: 'a' }, { id: 'b' }] });
    expect(await listDrafts('p1')).toEqual([]);
    expect((await listDrafts('p2')).map((d) => d.id)).toEqual(['other']);
  });

  it('does not call the API when there is nothing to send', async () => {
    const api = { submit: vi.fn(), list: vi.fn() };
    const result = await handleRequest(
      { type: 'submit', projectId: 'p1' },
      makeDeps({ createApi: () => api }),
    );
    expect(result).toEqual({ ok: true, value: [] });
    expect(api.submit).not.toHaveBeenCalled();
  });

  it('keeps the drafts when the submit fails', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    const result = await handleRequest(
      { type: 'submit', projectId: 'p1' },
      makeDeps({ createApi: () => failingApi(new ApiError('Request failed (500)', 500)) }),
    );
    expect(result).toEqual({ ok: false, code: 'failed', error: 'Request failed (500)' });
    expect((await listDrafts('p1')).map((d) => d.id)).toEqual(['a']);
  });

  it('keeps a draft that was added while the submit was in flight', async () => {
    await addDraft('p1', makeItem({ id: 'a' }));
    const api: FeedbackApi = {
      list: async () => [],
      submit: async (_projectId, items) => {
        await addDraft('p1', makeItem({ id: 'late' }));
        return items.map((item) => ({ ...item, author: { id: 'u', name: 'U' }, status: 'open' }));
      },
    };
    await handleRequest({ type: 'submit', projectId: 'p1' }, makeDeps({ createApi: () => api }));
    expect((await listDrafts('p1')).map((d) => d.id)).toEqual(['late']);
  });

  it('lists sent feedback for a page', async () => {
    await createMockFeedbackApi().submit('p1', [makeItem({ id: 'a' })]);
    const result = await handleRequest({ type: 'list', projectId: 'p1', path: '/home' }, makeDeps());
    expect(result).toMatchObject({ ok: true, value: [{ id: 'a' }] });
  });

  it('reports unauthorized distinctly', async () => {
    const result = await handleRequest(
      { type: 'list', projectId: 'p1', path: '/' },
      makeDeps({ createApi: () => failingApi(new UnauthorizedError()) }),
    );
    expect(result).toEqual({ ok: false, code: 'unauthorized', error: 'Sign in to continue' });
  });

  it('refuses API calls when the real API is not configured', async () => {
    const createApi = vi.fn();
    const result = await handleRequest(
      { type: 'list', projectId: 'p1', path: '/' },
      makeDeps({ getSettings: async () => ({ ...DEFAULT_SETTINGS, useMock: false }), createApi }),
    );
    expect(result).toMatchObject({ ok: false, code: 'not-configured' });
    expect(createApi).not.toHaveBeenCalled();
  });

  it('reports the auth state in mock mode as signed in', async () => {
    const result = await handleRequest({ type: 'auth-state' }, makeDeps());
    expect(result).toEqual({
      ok: true,
      value: { useMock: true, configured: true, signedIn: true },
    });
  });

  it('reports the auth state for the real API', async () => {
    const result = await handleRequest(
      { type: 'auth-state' },
      makeDeps({ getSettings: async () => real, isSignedIn: async () => false }),
    );
    expect(result).toEqual({
      ok: true,
      value: { useMock: false, configured: true, signedIn: false },
    });
  });

  it('signs in with the saved settings and returns the new state', async () => {
    let signedIn = false;
    const deps = makeDeps({
      getSettings: async () => real,
      signIn: vi.fn(async () => {
        signedIn = true;
      }),
      isSignedIn: async () => signedIn,
    });
    const result = await handleRequest({ type: 'sign-in' }, deps);
    expect(deps.signIn).toHaveBeenCalledWith(real);
    expect(result).toMatchObject({ ok: true, value: { signedIn: true } });
  });

  it('reports a cancelled sign-in as a failure', async () => {
    const deps = makeDeps({
      getSettings: async () => real,
      signIn: async () => {
        throw new Error('Sign-in was cancelled');
      },
    });
    expect(await handleRequest({ type: 'sign-in' }, deps)).toEqual({
      ok: false,
      code: 'failed',
      error: 'Sign-in was cancelled',
    });
  });

  it('signs out', async () => {
    const deps = makeDeps({ getSettings: async () => real });
    const result = await handleRequest({ type: 'sign-out' }, deps);
    expect(deps.signOut).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, value: { signedIn: false } });
  });
});

describe('isBackgroundRequest', () => {
  it('accepts known request types only', () => {
    expect(isBackgroundRequest({ type: 'submit', projectId: 'p' })).toBe(true);
    expect(isBackgroundRequest({ type: 'content-ready' })).toBe(false);
    expect(isBackgroundRequest(null)).toBe(false);
    expect(isBackgroundRequest('submit')).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run lib/background-handlers.test.ts`
Expected: FAIL with `Failed to resolve import "./background-handlers"`.

- [ ] **Step 4: Implement the handlers**

`lib/background-handlers.ts`:

```ts
import { type FeedbackApi, UnauthorizedError } from './api/feedback-api';
import { listDrafts, removeDrafts } from './draft-store';
import type { AuthState, BackgroundRequest, Result } from './messages';
import { isConfigured } from './settings-store';
import type { Settings } from './types';

export type HandlerDeps = {
  getSettings: () => Promise<Settings>;
  createApi: (settings: Settings) => FeedbackApi;
  signIn: (settings: Settings) => Promise<void>;
  signOut: () => Promise<void>;
  isSignedIn: () => Promise<boolean>;
};

class NotConfiguredError extends Error {
  constructor() {
    super('Finish the API settings in Options first.');
  }
}

async function authState(deps: HandlerDeps): Promise<AuthState> {
  const settings = await deps.getSettings();
  return {
    useMock: settings.useMock,
    configured: isConfigured(settings),
    signedIn: settings.useMock ? true : await deps.isSignedIn(),
  };
}

async function configuredApi(deps: HandlerDeps): Promise<FeedbackApi> {
  const settings = await deps.getSettings();
  if (!isConfigured(settings)) throw new NotConfiguredError();
  return deps.createApi(settings);
}

async function dispatch(request: BackgroundRequest, deps: HandlerDeps): Promise<unknown> {
  switch (request.type) {
    case 'auth-state':
      return authState(deps);

    case 'sign-in': {
      const settings = await deps.getSettings();
      if (!isConfigured(settings)) throw new NotConfiguredError();
      if (!settings.useMock) await deps.signIn(settings);
      return authState(deps);
    }

    case 'sign-out':
      await deps.signOut();
      return authState(deps);

    case 'list':
      return (await configuredApi(deps)).list(request.projectId, request.path);

    case 'submit': {
      const api = await configuredApi(deps);
      const drafts = await listDrafts(request.projectId);
      if (drafts.length === 0) return [];
      const sent = await api.submit(request.projectId, drafts);
      // Remove only what was sent: a draft added while the request was in flight must survive.
      await removeDrafts(
        request.projectId,
        drafts.map((draft) => draft.id),
      );
      return sent;
    }
  }
}

export async function handleRequest(
  request: BackgroundRequest,
  deps: HandlerDeps,
): Promise<Result<unknown>> {
  try {
    return { ok: true, value: await dispatch(request, deps) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Something went wrong';
    if (error instanceof UnauthorizedError) return { ok: false, code: 'unauthorized', error: message };
    if (error instanceof NotConfiguredError) {
      return { ok: false, code: 'not-configured', error: message };
    }
    return { ok: false, code: 'failed', error: message };
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm vitest run lib/background-handlers.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Add the client used by the side panel**

`lib/background-client.ts`:

```ts
import { browser } from '#imports';
import type { BackgroundRequest, BackgroundResponse, Result } from './messages';

/** Sends a request to the background service worker and always resolves with a Result. */
export async function sendToBackground<T extends BackgroundRequest['type']>(
  request: Extract<BackgroundRequest, { type: T }>,
): Promise<Result<BackgroundResponse[T]>> {
  try {
    const response = (await browser.runtime.sendMessage(request)) as
      | Result<BackgroundResponse[T]>
      | undefined;
    return response ?? { ok: false, code: 'failed', error: 'The extension did not respond.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The extension did not respond.';
    return { ok: false, code: 'failed', error: message };
  }
}
```

- [ ] **Step 7: Replace the background stub with the real wiring**

`entrypoints/background.ts`:

```ts
import { browser, defineBackground } from '#imports';
import { createHttpFeedbackApi } from '@/lib/api/http-feedback-api';
import { createMockFeedbackApi } from '@/lib/api/mock-feedback-api';
import { type OAuthDeps, getAccessToken, isSignedIn, signIn, signOut } from '@/lib/auth/oauth';
import { type HandlerDeps, handleRequest } from '@/lib/background-handlers';
import { isBackgroundRequest } from '@/lib/messages';
import { getSettings } from '@/lib/settings-store';
import type { Settings } from '@/lib/types';

export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

  const oauthDeps = (settings: Settings): OAuthDeps => ({
    settings: settings.oauth,
    redirectUri: browser.identity.getRedirectURL(),
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    launchWebAuthFlow: (url) => browser.identity.launchWebAuthFlow({ url, interactive: true }),
  });

  const deps: HandlerDeps = {
    getSettings,
    createApi: (settings) =>
      settings.useMock
        ? createMockFeedbackApi()
        : createHttpFeedbackApi({
            apiBase: settings.apiBase,
            client: {
              extensionVersion: browser.runtime.getManifest().version,
              userAgent: navigator.userAgent,
            },
            fetch: (input, init) => fetch(input, init),
            getAccessToken: (options) => getAccessToken(oauthDeps(settings), options),
            onUnauthorized: signOut,
          }),
    signIn: (settings) => signIn(oauthDeps(settings)),
    signOut,
    isSignedIn,
  };

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isBackgroundRequest(message)) return;
    handleRequest(message, deps).then(sendResponse);
    return true;
  });
});
```

The listener returns `true` and answers through `sendResponse` so the reply can be asynchronous. It ignores messages that are not background requests, such as `content-ready`.

- [ ] **Step 8: Verify the whole unit suite, types and build**

Run: `pnpm test && pnpm compile && pnpm build`
Expected: 17 test files pass; `tsc` prints no errors; `✔ Built extension`.

- [ ] **Step 9: Commit**

```bash
git add lib/messages.ts lib/background-handlers.ts lib/background-handlers.test.ts lib/background-client.ts entrypoints/background.ts
git commit -m "feat: handle submit, list and auth requests in the background" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Content script UI

The on-page UI: highlight, picker, inline text editor, pins and the comment popover, mounted in a Shadow DOM root. It only becomes active when a side panel connects, so its behaviour is exercised by the end-to-end tests in Task 11. This task's gate is that it type-checks and builds.

**Files:**
- Create: `components/use-layout-tick.ts`, `components/use-page-cursor.ts`, `components/use-panel-port.ts`
- Create: `components/HighlightBox.tsx`, `components/Picker.tsx`, `components/TextEditor.tsx`, `components/PinLayer.tsx`, `components/CommentPopover.tsx`, `components/App.tsx`
- Create: `entrypoints/content/index.tsx`, `entrypoints/content/style.css`

**Interfaces:**
- Consumes: everything in `lib/` from Tasks 2–5 and `lib/messages.ts` from Task 9.
- Produces (relied on by Task 11's tests and side panel):
  - The content script accepts a port named `PANEL_PORT`, answers with `{ type: 'context', context }` on connect and on route change, and broadcasts `{ type: 'content-ready' }` when it starts.
  - Pins render as `<button data-vf-pin="draft|sent">` whose text is the pin number.
  - The comment box has placeholder `Add a comment` (or `Add a note (optional)` for a text edit) and buttons `Save`, `Cancel`, `Delete`.
  - A text edit opens a popover titled `Text change`.

How the pieces behave:

- `use-layout-tick` re-renders its caller once per animation frame when the page scrolls, resizes or mutates. A `MutationObserver` on the document does not see inside our shadow root, so our own rendering cannot trigger it.
- `Picker` and `TextEditor` listen on `document` in the capture phase and call `stopImmediatePropagation()` plus `preventDefault()`, so the page never sees the click. Events that start inside our own UI (`isOwnUi`) are left alone.
- While the popover is open neither mode component is mounted, so clicks behave normally.
- Right after the reviewer picks a mode, keyboard focus is still in the side panel. The panel forwards `ArrowUp`/`ArrowDown` as `key` messages, which reach `Picker` through its `remoteKey` prop; `Picker` handles the same keys itself once the page has focus.
- `isolateEvents` on the shadow root stops key events from our text boxes reaching the page's keyboard shortcuts.

- [ ] **Step 1: Create the hooks**

`components/use-layout-tick.ts`:

```ts
import { useEffect, useState } from 'react';

/**
 * Re-renders the caller when on-page geometry may have changed. `layout` bumps on scroll,
 * resize and DOM mutation; `dom` bumps only on DOM mutation. Updates are coalesced per frame.
 */
export function useLayoutTick(): { layout: number; dom: number } {
  const [tick, setTick] = useState({ layout: 0, dom: 0 });

  useEffect(() => {
    let frame = 0;
    let domChanged = false;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const bumpDom = domChanged;
        domChanged = false;
        setTick((t) => ({ layout: t.layout + 1, dom: bumpDom ? t.dom + 1 : t.dom }));
      });
    };
    const onMutation = () => {
      domChanged = true;
      schedule();
    };

    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    const observer = new MutationObserver(onMutation);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
  }, []);

  return tick;
}
```

`components/use-page-cursor.ts`:

```ts
import { useEffect } from 'react';

/** Forces a cursor on the whole page while a picking mode is active. */
export function usePageCursor(cursor: 'crosshair' | 'text'): void {
  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-vibe-feedback', 'cursor');
    style.textContent = `* { cursor: ${cursor} !important; }`;
    document.head.append(style);
    return () => style.remove();
  }, [cursor]);
}
```

`components/use-panel-port.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Browser, browser } from 'wxt/browser';
import { type ContentToPanel, PANEL_PORT, type PanelToContent } from '@/lib/messages';

/**
 * Accepts the side panel's connection. The page UI is only active while a panel is
 * connected, so closing the panel hides pins and turns picking off.
 */
export function usePanelPort(onMessage: (message: PanelToContent) => void) {
  const [port, setPort] = useState<Browser.runtime.Port | null>(null);
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    const onConnect = (incoming: Browser.runtime.Port) => {
      if (incoming.name !== PANEL_PORT) return;
      incoming.onMessage.addListener((message) => handler.current(message as PanelToContent));
      incoming.onDisconnect.addListener(() => {
        setPort((current) => (current === incoming ? null : current));
      });
      setPort(incoming);
    };
    browser.runtime.onConnect.addListener(onConnect);
    // Tell an already-open side panel that this page is ready to be connected to.
    browser.runtime.sendMessage({ type: 'content-ready' }).catch(() => undefined);
    return () => browser.runtime.onConnect.removeListener(onConnect);
  }, []);

  const post = useCallback(
    (message: ContentToPanel) => {
      try {
        port?.postMessage(message);
      } catch {
        // The panel closed between render and post; onDisconnect will clear the port.
      }
    },
    [port],
  );

  return { connected: port !== null, post };
}
```

- [ ] **Step 2: Create the highlight box and the picker**

`components/HighlightBox.tsx`:

```tsx
import { useLayoutTick } from './use-layout-tick';

type Props = { element: Element; label?: string; tone?: 'hover' | 'selected' | 'edit' };

export function HighlightBox({ element, label, tone = 'hover' }: Props) {
  useLayoutTick();
  const rect = element.getBoundingClientRect();
  return (
    <div
      className={`vf-highlight vf-highlight--${tone}`}
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
    >
      {label && <span className="vf-highlight__label">{label}</span>}
    </div>
  );
}
```

`components/Picker.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { SOURCE_ATTR } from '@/lib/element-descriptor';
import { eventElement, firstChildOf, isOwnUi, parentOf } from '@/lib/picker';
import { HighlightBox } from './HighlightBox';
import { usePageCursor } from './use-page-cursor';

/** A key forwarded from the side panel; `at` makes repeated presses distinct. */
export type RemoteKey = { key: string; at: number };

type Props = {
  host: HTMLElement;
  remoteKey: RemoteKey | null;
  onPick: (element: Element) => void;
  onExit: () => void;
};

const BLOCKED = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu', 'auxclick'];

function block(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function labelFor(element: Element): string {
  const source = element.getAttribute(SOURCE_ATTR);
  return source ? `${element.localName} · ${source}` : element.localName;
}

export function Picker({ host, remoteKey, onPick, onExit }: Props) {
  const [target, setTarget] = useState<Element | null>(null);
  const targetRef = useRef<Element | null>(null);
  const hoveredRef = useRef<Element | null>(null);
  const callbacks = useRef({ onPick, onExit });
  callbacks.current = { onPick, onExit };
  usePageCursor('crosshair');

  const select = useCallback((element: Element | null) => {
    targetRef.current = element;
    setTarget(element);
  }, []);

  /** Applies a picker key and reports whether it did anything. */
  const applyKey = useCallback(
    (key: string): boolean => {
      if (key === 'Escape') {
        callbacks.current.onExit();
        return true;
      }
      const current = targetRef.current;
      if (!current) return false;
      if (key === 'ArrowUp') select(parentOf(current) ?? current);
      else if (key === 'ArrowDown') select(firstChildOf(current) ?? current);
      else if (key === 'Enter') callbacks.current.onPick(current);
      else return false;
      return true;
    },
    [select],
  );

  useEffect(() => {
    if (remoteKey) applyKey(remoteKey.key);
  }, [remoteKey, applyKey]);

  useEffect(() => {

    // Only a move onto a different element changes the target, so a keyboard
    // adjustment (ArrowUp/ArrowDown) survives small mouse jitters.
    const onMove = (event: MouseEvent) => {
      const element = eventElement(event, host);
      if (element === hoveredRef.current) return;
      hoveredRef.current = element;
      if (element) select(element);
    };

    const onBlocked = (event: Event) => {
      if (!isOwnUi(event, host)) block(event);
    };

    const onClick = (event: MouseEvent) => {
      if (isOwnUi(event, host)) return;
      block(event);
      const clicked = eventElement(event, host);
      const current = targetRef.current;
      const chosen = current && clicked && current.contains(clicked) ? current : clicked;
      if (chosen) callbacks.current.onPick(chosen);
    };

    const onKey = (event: KeyboardEvent) => {
      if (isOwnUi(event, host)) return;
      if (applyKey(event.key)) block(event);
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    for (const type of BLOCKED) document.addEventListener(type, onBlocked, true);
    return () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      for (const type of BLOCKED) document.removeEventListener(type, onBlocked, true);
    };
  }, [host, select, applyKey]);

  return target ? <HighlightBox element={target} label={labelFor(target)} /> : null;
}
```

- [ ] **Step 3: Create the inline text editor**

`components/TextEditor.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { describeElement } from '@/lib/element-descriptor';
import { eventElement, isEditableText, isOwnUi } from '@/lib/picker';
import { collapseText } from '@/lib/text';
import type { Anchor } from '@/lib/types';
import { HighlightBox } from './HighlightBox';
import { usePageCursor } from './use-page-cursor';

export type TextEditResult = { element: HTMLElement; anchor: Anchor; before: string; after: string };

type Props = {
  host: HTMLElement;
  onEdited: (result: TextEditResult) => void;
  onExit: () => void;
};

type Session = {
  element: HTMLElement;
  anchor: Anchor;
  before: string;
  originalText: string;
  previousAttr: string | null;
  detach: () => void;
};

const BLOCKED = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu', 'auxclick'];

function block(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

export function TextEditor({ host, onEdited, onExit }: Props) {
  const [hovered, setHovered] = useState<Element | null>(null);
  const [editing, setEditing] = useState<HTMLElement | null>(null);
  const session = useRef<Session | null>(null);
  const callbacks = useRef({ onEdited, onExit });
  callbacks.current = { onEdited, onExit };
  usePageCursor('text');

  useEffect(() => {
    const finish = (commit: boolean) => {
      const current = session.current;
      if (!current) return;
      session.current = null;
      current.detach();
      const { element } = current;
      if (current.previousAttr === null) element.removeAttribute('contenteditable');
      else element.setAttribute('contenteditable', current.previousAttr);
      setEditing(null);

      if (!commit) {
        element.textContent = current.originalText;
        return;
      }
      const after = collapseText(element.textContent ?? '');
      callbacks.current.onEdited({ element, anchor: current.anchor, before: current.before, after });
    };

    const begin = (element: HTMLElement) => {
      // Describe the element before touching it, so the anchor holds the original text and markup.
      const anchor = describeElement(element);
      const originalText = element.textContent ?? '';
      const previousAttr = element.getAttribute('contenteditable');

      const onKeyDown = (event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      };
      const onBlur = () => finish(true);
      element.addEventListener('keydown', onKeyDown);
      element.addEventListener('blur', onBlur);

      session.current = {
        element,
        anchor,
        before: collapseText(originalText),
        originalText,
        previousAttr,
        detach: () => {
          element.removeEventListener('keydown', onKeyDown);
          element.removeEventListener('blur', onBlur);
        },
      };
      element.setAttribute('contenteditable', 'plaintext-only');
      element.focus();
      setHovered(null);
      setEditing(element);
    };

    const insideEdit = (event: Event) => {
      const target = event.composedPath()[0];
      return target instanceof Node && session.current?.element.contains(target) === true;
    };

    const onMove = (event: MouseEvent) => {
      if (session.current) return;
      const element = eventElement(event, host);
      setHovered(element && isEditableText(element) ? element : null);
    };

    const onBlocked = (event: Event) => {
      if (isOwnUi(event, host)) return;
      // Inside the element being edited the default must run so the caret can be placed.
      if (insideEdit(event)) event.stopPropagation();
      else block(event);
    };

    const onClick = (event: MouseEvent) => {
      if (isOwnUi(event, host)) return;
      block(event);
      if (session.current) {
        if (!insideEdit(event)) finish(true);
        return;
      }
      const element = eventElement(event, host);
      if (element instanceof HTMLElement && isEditableText(element)) begin(element);
    };

    const onKey = (event: KeyboardEvent) => {
      if (isOwnUi(event, host) || session.current) return;
      if (event.key === 'Escape') {
        block(event);
        callbacks.current.onExit();
      }
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    for (const type of BLOCKED) document.addEventListener(type, onBlocked, true);
    return () => {
      finish(true);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      for (const type of BLOCKED) document.removeEventListener(type, onBlocked, true);
    };
  }, [host]);

  if (editing) {
    return <HighlightBox element={editing} tone="edit" label="Enter to save · Esc to cancel" />;
  }
  return hovered ? <HighlightBox element={hovered} label="Click to edit text" /> : null;
}
```

- [ ] **Step 4: Create the pin layer and the comment popover**

`components/PinLayer.tsx`:

```tsx
import { useEffect, useMemo } from 'react';
import { resolveAnchor } from '@/lib/anchor-resolver';
import { type Pin, locationLabel } from '@/lib/pins';
import { useLayoutTick } from './use-layout-tick';

export type PinFocus = { id: string; at: number };

type Props = {
  pins: Pin[];
  focus: PinFocus | null;
  onUnresolved: (ids: string[]) => void;
  onOpen: (pin: Pin, element: Element) => void;
};

function tooltip(pin: Pin): string {
  const author = 'author' in pin.item ? `${pin.item.author.name}: ` : '';
  return `${author}${pin.item.comment || locationLabel(pin.item)}`;
}

export function PinLayer({ pins, focus, onUnresolved, onOpen }: Props) {
  const { dom } = useLayoutTick();

  // Re-resolve only when the pins or the DOM change; scrolling just re-reads rects below.
  const elements = useMemo(
    () =>
      new Map(
        pins.map((pin) => [pin.id, pin.item.anchor ? resolveAnchor(pin.item.anchor, document) : null]),
      ),
    // `dom` is a deliberate dependency: it changes when the page's DOM does.
    [pins, dom],
  );

  const unresolved = pins.filter((pin) => !elements.get(pin.id)).map((pin) => pin.id);
  const unresolvedKey = unresolved.join('|');
  useEffect(() => {
    onUnresolved(unresolved);
    // Keyed on the joined ids so the panel is told only when the set actually changes.
  }, [unresolvedKey]);

  useEffect(() => {
    if (focus) elements.get(focus.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Scroll once per focus request, not again when the elements map is rebuilt.
  }, [focus]);

  return (
    <>
      {pins.map((pin) => {
        const element = elements.get(pin.id);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return null;
        const focused = focus?.id === pin.id ? ' vf-pin--focused' : '';
        return (
          <button
            key={pin.id}
            type="button"
            data-vf-pin={pin.state}
            className={`vf-pin vf-pin--${pin.state}${focused}`}
            style={{ top: rect.top - 10, left: rect.right - 10 }}
            title={tooltip(pin)}
            onClick={() => onOpen(pin, element)}
          >
            {pin.number}
          </button>
        );
      })}
    </>
  );
}
```

`components/CommentPopover.tsx`:

```tsx
import { useState } from 'react';
import { popoverPosition } from '@/lib/popover-position';

type Props = {
  anchorRect: { top: number; bottom: number; left: number };
  title: string;
  detail?: string;
  initial: string;
  allowEmpty: boolean;
  onSave: (comment: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
};

export function CommentPopover(props: Props) {
  const { anchorRect, title, detail, initial, allowEmpty, onSave, onCancel, onDelete } = props;
  const [comment, setComment] = useState(initial);
  const canSave = allowEmpty || comment.trim() !== '';
  const position = popoverPosition(anchorRect, {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const save = () => {
    if (canSave) onSave(comment);
  };

  return (
    <form
      className="vf-popover"
      style={position}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save();
      }}
    >
      <div className="vf-popover__title">{title}</div>
      {detail && <div className="vf-popover__detail">{detail}</div>}
      <textarea
        autoFocus
        className="vf-popover__input"
        placeholder={allowEmpty ? 'Add a note (optional)' : 'Add a comment'}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <div className="vf-popover__actions">
        {onDelete && (
          <button type="button" className="vf-button vf-button--danger" onClick={onDelete}>
            Delete
          </button>
        )}
        <span className="vf-popover__spacer" />
        <button type="button" className="vf-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="vf-button vf-button--primary" disabled={!canSave}>
          Save
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: Create the content app**

`components/App.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContentScriptContext } from '#imports';
import { resolveAnchor } from '@/lib/anchor-resolver';
import { addDraft, listDrafts, removeDraft, updateDraft, watchDrafts } from '@/lib/draft-store';
import { describeElement } from '@/lib/element-descriptor';
import { createItem, currentEnv } from '@/lib/feedback-factory';
import { readPageContext } from '@/lib/page-context';
import { type Pin, pagePins } from '@/lib/pins';
import { planTextEdit } from '@/lib/text-edit';
import type { Anchor, FeedbackItem, Mode, PageContext, SentFeedback } from '@/lib/types';
import { CommentPopover } from './CommentPopover';
import { HighlightBox } from './HighlightBox';
import { Picker, type RemoteKey } from './Picker';
import { type PinFocus, PinLayer } from './PinLayer';
import { TextEditor, type TextEditResult } from './TextEditor';
import { usePanelPort } from './use-panel-port';

type Composer =
  | { type: 'new'; element: Element; anchor: Anchor }
  | { type: 'edit'; element: Element; item: FeedbackItem };

type Props = { ctx: ContentScriptContext; host: HTMLElement };

export function App({ ctx, host }: Props) {
  const [context, setContext] = useState<PageContext | null>(() =>
    readPageContext(document, location),
  );
  const [mode, setMode] = useState<Mode>('off');
  const [drafts, setDrafts] = useState<FeedbackItem[]>([]);
  const [sent, setSent] = useState<SentFeedback[]>([]);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [focus, setFocus] = useState<PinFocus | null>(null);
  const [remoteKey, setRemoteKey] = useState<RemoteKey | null>(null);
  const contextRef = useRef(context);
  contextRef.current = context;

  const { connected, post } = usePanelPort((message) => {
    const current = contextRef.current;
    switch (message.type) {
      case 'set-mode':
        setComposer(null);
        setMode(current ? message.mode : 'off');
        break;
      case 'key':
        setRemoteKey({ key: message.key, at: Date.now() });
        break;
      case 'set-sent':
        setSent(message.items);
        break;
      case 'focus-item':
        setFocus({ id: message.id, at: Date.now() });
        break;
      case 'create-page-comment':
        if (current) {
          const item = createItem(
            { kind: 'page', comment: message.comment, context: current },
            currentEnv(window),
          );
          void addDraft(current.projectId, item);
        }
        break;
    }
  });

  // SPA route changes do not reload the content script, so re-read the context.
  useEffect(() => {
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      setComposer(null);
      setContext(readPageContext(document, location));
    });
  }, [ctx]);

  const projectId = context?.projectId;
  useEffect(() => {
    if (!projectId) {
      setDrafts([]);
      return;
    }
    let active = true;
    void listDrafts(projectId).then((items) => {
      if (active) setDrafts(items);
    });
    const unwatch = watchDrafts(projectId, setDrafts);
    return () => {
      active = false;
      unwatch();
    };
  }, [projectId]);

  useEffect(() => {
    if (connected) post({ type: 'context', context });
  }, [connected, context, post]);

  useEffect(() => {
    if (connected) return;
    setMode('off');
    setComposer(null);
    setSent([]);
  }, [connected]);

  useEffect(() => {
    if (!focus) return;
    const timer = setTimeout(() => setFocus(null), 1500);
    return () => clearTimeout(timer);
  }, [focus]);

  const pins = useMemo(
    () => (context ? pagePins(drafts, sent, context.path) : []),
    [context, drafts, sent],
  );

  if (!connected || !context) return null;

  const exitMode = () => {
    setMode('off');
    post({ type: 'mode', mode: 'off' });
  };

  const openPin = (pin: Pin, element: Element) => {
    if (pin.state === 'draft') setComposer({ type: 'edit', element, item: pin.item });
  };

  const saveComposer = (comment: string) => {
    if (!composer) return;
    if (composer.type === 'new') {
      const item = createItem(
        { kind: 'element', comment, context, anchor: composer.anchor },
        currentEnv(window),
      );
      void addDraft(context.projectId, item);
    } else {
      void updateDraft(context.projectId, composer.item.id, { comment: comment.trim() });
    }
    setComposer(null);
  };

  const deleteComposer = () => {
    if (composer?.type === 'edit') void removeDraft(context.projectId, composer.item.id);
    setComposer(null);
  };

  const handleEdited = ({ element, anchor, before, after }: TextEditResult) => {
    const existing = drafts.find(
      (draft) =>
        draft.kind === 'text-edit' &&
        draft.anchor !== undefined &&
        resolveAnchor(draft.anchor, document) === element,
    );
    const change = planTextEdit(existing, before, after);
    if (!change) return;
    if (change.type === 'remove') {
      void removeDraft(context.projectId, change.id);
    } else if (change.type === 'update' && existing) {
      void updateDraft(context.projectId, change.id, { textEdit: change.textEdit });
      setComposer({ type: 'edit', element, item: { ...existing, textEdit: change.textEdit } });
    } else if (change.type === 'create') {
      const item = createItem(
        { kind: 'text-edit', comment: '', context, anchor, textEdit: change.textEdit },
        currentEnv(window),
      );
      void addDraft(context.projectId, item);
      setComposer({ type: 'edit', element, item });
    }
  };

  const editedItem = composer?.type === 'edit' ? composer.item : null;
  const textEdit = editedItem?.textEdit;

  return (
    <div className="vf-root">
      <PinLayer
        pins={pins}
        focus={focus}
        onUnresolved={(ids) => post({ type: 'unresolved', ids })}
        onOpen={openPin}
      />
      {!composer && mode === 'select' && (
        <Picker
          host={host}
          remoteKey={remoteKey}
          onPick={(element) =>
            setComposer({ type: 'new', element, anchor: describeElement(element) })
          }
          onExit={exitMode}
        />
      )}
      {!composer && mode === 'text' && (
        <TextEditor host={host} onEdited={handleEdited} onExit={exitMode} />
      )}
      {composer && (
        <>
          <HighlightBox element={composer.element} tone="selected" />
          <CommentPopover
            key={editedItem?.id ?? 'new'}
            anchorRect={composer.element.getBoundingClientRect()}
            title={textEdit ? 'Text change' : editedItem ? 'Edit comment' : 'New comment'}
            detail={textEdit ? `"${textEdit.before}" → "${textEdit.after}"` : undefined}
            initial={editedItem?.comment ?? ''}
            allowEmpty={editedItem?.kind === 'text-edit'}
            onSave={saveComposer}
            onCancel={() => setComposer(null)}
            onDelete={editedItem ? deleteComposer : undefined}
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create the content script entrypoint and its styles**

`entrypoints/content/style.css`:

```css
.vf-root {
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: #1c1c1e;
}

.vf-highlight {
  position: fixed;
  pointer-events: none;
  box-sizing: border-box;
  border: 2px solid #2f6fed;
  background: rgba(47, 111, 237, 0.1);
  border-radius: 2px;
}

.vf-highlight--selected {
  border-color: #f08c00;
  background: rgba(240, 140, 0, 0.1);
}

.vf-highlight--edit {
  border-style: dashed;
  border-color: #12924f;
  background: transparent;
}

.vf-highlight__label {
  position: absolute;
  left: -2px;
  bottom: 100%;
  max-width: 60vw;
  padding: 2px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #fff;
  background: #2f6fed;
  border-radius: 3px 3px 0 0;
}

.vf-highlight--edit .vf-highlight__label {
  background: #12924f;
}

.vf-pin {
  position: fixed;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 2px solid #fff;
  border-radius: 50%;
  font: 600 11px/1 system-ui, sans-serif;
  color: #fff;
  background: #f08c00;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  cursor: pointer;
}

.vf-pin--sent {
  background: #6b7280;
  cursor: default;
}

.vf-pin--focused {
  outline: 3px solid rgba(47, 111, 237, 0.6);
  transform: scale(1.25);
}

.vf-popover {
  position: fixed;
  box-sizing: border-box;
  width: 320px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #fff;
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
}

.vf-popover__title {
  font-weight: 600;
}

.vf-popover__detail {
  font-size: 12px;
  color: #52525b;
  overflow-wrap: anywhere;
}

.vf-popover__input {
  box-sizing: border-box;
  width: 100%;
  height: 84px;
  padding: 6px 8px;
  resize: none;
  font: inherit;
  color: inherit;
  background: #fff;
  border: 1px solid #d4d4d8;
  border-radius: 6px;
}

.vf-popover__actions {
  display: flex;
  gap: 8px;
}

.vf-popover__spacer {
  flex: 1;
}

.vf-button {
  padding: 5px 12px;
  font: inherit;
  color: #1c1c1e;
  background: #f4f4f5;
  border: 1px solid #d4d4d8;
  border-radius: 6px;
  cursor: pointer;
}

.vf-button--primary {
  color: #fff;
  background: #2f6fed;
  border-color: #2f6fed;
}

.vf-button--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.vf-button--danger {
  color: #c92a2a;
}
```

`entrypoints/content/index.tsx`:

```tsx
import './style.css';
import { createRoot } from 'react-dom/client';
import { createShadowRootUi, defineContentScript } from '#imports';
import { App } from '@/components/App';

export default defineContentScript({
  matches: ['*://*.web.app/*', '*://*.firebaseapp.com/*', 'http://localhost/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'vibe-feedback-ui',
      position: 'overlay',
      anchor: 'body',
      zIndex: 2147483647,
      // Keep typing in the comment box from triggering the page's keyboard shortcuts.
      isolateEvents: ['keydown', 'keyup', 'keypress'],
      onMount(container, _shadow, host) {
        const mount = document.createElement('div');
        container.append(mount);
        const root = createRoot(mount);
        root.render(<App ctx={ctx} host={host} />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
```

- [ ] **Step 7: Verify types, unit tests and build**

Run: `pnpm compile && pnpm test && pnpm build`
Expected: no `tsc` errors; 17 test files pass; the build output lists `content-scripts/content.js` and `content-scripts/content.css`.

- [ ] **Step 8: Commit**

```bash
git add components entrypoints/content
git commit -m "feat: add on-page picker, text editor, pins and comment popover" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Side panel, fixture and end-to-end tests

**Files:**
- Create: `fixtures/serve.mjs`, `fixtures/demo/index.html`, `fixtures/demo/about.html`, `fixtures/demo/plain.html`
- Create: `playwright.config.ts`, `e2e/fixtures.ts`
- Create: `entrypoints/sidepanel/index.html`, `main.tsx`, `hooks.ts`, `DraftRow.tsx`, `App.tsx`, `style.css`
- Test: `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: the content script protocol from Task 10; `sendToBackground` (Task 9); `listDrafts`, `watchDrafts`, `updateDraft`, `removeDraft` (Task 4); `pagePins`, `groupDrafts`, `locationLabel` (Task 5); `watchSettings` (Task 6); `watchTokens` (Task 7).
- Produces:
  - `sidepanel.html`, which reviews the active tab, or the tab in `?tabId=<id>` when that query parameter is present.
  - Accessible names the tests rely on: mode buttons `Off`, `Select`, `Text`; button `Add page comment`; regions `Drafts` and `Sent`; headings `Drafts (n)` and `Sent on this page (n)`; button `Send n`; button `Options`.
  - E2E fixtures in `e2e/fixtures.ts`: `test` with `context`, `worker` (the extension's service worker) and `extensionId`; `expect`.
  - The fixture site on `http://localhost:4173/`: `index.html` (project `demo-project`, build `build-001`, elements `#title`, `#tagline`, `#buy`, `#fruit li`), `about.html`, and `plain.html` (no meta tags).

**Before you start:** the end-to-end tests need Playwright's Chromium, a download of roughly 150 MB. Confirm with the user before running the install in Step 4.

**About these tests:** the specs were type-checked when this plan was written but have not been run in a browser. If one fails, read the failure before changing product code: the fault may be in the test.

- [ ] **Step 1: Create the fixture site and its server**

`fixtures/serve.mjs`:

```js
// Serves fixtures/demo on http://localhost:4173 for manual checks and end-to-end tests.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./demo', import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  const relative = normalize(pathname === '/' ? '/index.html' : pathname);
  const file = join(root, relative);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(port, () => console.log(`Fixture at http://localhost:${port}/`));
```

`fixtures/demo/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Demo Shop</title>
    <meta name="vibe:project-id" content="demo-project" />
    <meta name="vibe:build-id" content="build-001" />
    <style>
      body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #222; }
      header, main, footer { max-width: 720px; margin: 0 auto; padding: 16px 24px; }
      header { display: flex; justify-content: space-between; align-items: center; }
      .hero { padding: 32px; background: #eef3ff; border-radius: 12px; }
      button { padding: 10px 18px; font: inherit; color: #fff; background: #2f6fed; border: 0; border-radius: 8px; }
      li { margin: 6px 0; }
      .spacer { height: 900px; }
    </style>
  </head>
  <body>
    <header data-vibe-source="src/components/Header.tsx:8">
      <strong data-vibe-source="src/components/Header.tsx:9">Demo Shop</strong>
      <nav><a id="about-link" href="about.html">About</a></nav>
    </header>
    <main>
      <section class="hero" data-vibe-source="src/pages/Home.tsx:10">
        <h1 id="title" data-vibe-source="src/pages/Home.tsx:12">Welcome back</h1>
        <p id="tagline" data-vibe-source="src/pages/Home.tsx:13">Fresh fruit delivered to your door.</p>
        <div><button id="buy" type="button">Buy</button></div>
      </section>
      <h2 data-vibe-source="src/pages/Home.tsx:28">Popular</h2>
      <ul id="fruit">
        <li data-vibe-source="src/pages/Home.tsx:30">Apples</li>
        <li data-vibe-source="src/pages/Home.tsx:30">Pears</li>
        <li data-vibe-source="src/pages/Home.tsx:30">Plums</li>
      </ul>
      <div class="spacer"></div>
      <p id="far" data-vibe-source="src/pages/Home.tsx:40">You scrolled all the way down.</p>
    </main>
    <footer><p id="legal">No source attribute on this one.</p></footer>
    <script>
      document.getElementById('buy').addEventListener('click', () => {
        document.title = 'clicked';
      });
    </script>
  </body>
</html>
```

`fixtures/demo/about.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>About · Demo Shop</title>
    <meta name="vibe:project-id" content="demo-project" />
    <meta name="vibe:build-id" content="build-001" />
    <style>
      body { max-width: 720px; margin: 0 auto; padding: 16px 24px; font: 16px/1.5 system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <p><a id="home-link" href="index.html">Home</a></p>
    <h1 data-vibe-source="src/pages/About.tsx:5">About us</h1>
    <p data-vibe-source="src/pages/About.tsx:6">We have sold fruit since 1999.</p>
  </body>
</html>
```

`fixtures/demo/plain.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Not a preview</title>
  </head>
  <body>
    <h1>This page has no vibe meta tags</h1>
  </body>
</html>
```

Run: `pnpm fixture` and open http://localhost:4173/ in a browser.
Expected: the Demo Shop page renders. Stop the server with Ctrl+C.

- [ ] **Step 2: Create the Playwright config and fixtures**

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  webServer: {
    command: 'node fixtures/serve.mjs',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
  },
});
```

`e2e/fixtures.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { type BrowserContext, type Worker, test as base, chromium } from '@playwright/test';

const extensionPath = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));

type Fixtures = { context: BrowserContext; worker: Worker; extensionId: string };

/** Launches Chromium with the built extension loaded and exposes its service worker. */
export const test = base.extend<Fixtures>({
  // Playwright requires the first argument to be a destructuring pattern, even an empty one.
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
});

export const expect = test.expect;
```

- [ ] **Step 3: Write the failing end-to-end tests**

`e2e/smoke.spec.ts`:

```ts
import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { browser } from 'wxt/browser';
import { expect, test } from './fixtures';

// `worker.evaluate` callbacks run inside the extension's service worker, where `chrome` exists.
declare const chrome: typeof browser;

const FIXTURE = 'http://localhost:4173/';

/** Opens a fixture page plus the side panel UI bound to that page's tab. */
async function openReview(
  context: BrowserContext,
  worker: Worker,
  extensionId: string,
  path = '',
): Promise<{ page: Page; panel: Page }> {
  const page = await context.newPage();
  await page.goto(FIXTURE + path);
  const tabId = await worker.evaluate(async (origin) => {
    const [tab] = await chrome.tabs.query({ url: `${origin}*` });
    return tab?.id;
  }, FIXTURE);
  expect(tabId).toBeDefined();

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);
  return { page, panel };
}

test('pin a comment, send it, and see it as sent', async ({ context, worker, extensionId }) => {
  const { page, panel } = await openReview(context, worker, extensionId);
  await expect(panel.getByText('demo-project · build-001')).toBeVisible();

  await panel.getByRole('button', { name: 'Select', exact: true }).click();
  await page.bringToFront();
  await page.locator('#buy').click();
  // Picking must swallow the click: the fixture's own handler would change the title.
  await expect(page).toHaveTitle('Demo Shop');

  await page.getByPlaceholder('Add a comment').fill('Make this button bigger');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-vf-pin="draft"]')).toHaveText('1');

  await panel.bringToFront();
  const drafts = panel.getByRole('region', { name: 'Drafts' });
  await expect(drafts.getByText('Make this button bigger')).toBeVisible();
  await expect(drafts.getByText('src/pages/Home.tsx:10')).toBeVisible();

  await panel.getByRole('button', { name: 'Send 1' }).click();
  await expect(panel.getByRole('heading', { name: 'Drafts (0)' })).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Sent' }).getByText('Make this button bigger')).toBeVisible();
  await expect(page.locator('[data-vf-pin="sent"]')).toHaveText('1');
});

test('edit text inline and keep the draft across a reload', async ({ context, worker, extensionId }) => {
  const { page, panel } = await openReview(context, worker, extensionId);

  await panel.getByRole('button', { name: 'Text', exact: true }).click();
  await page.bringToFront();
  await page.locator('#tagline').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Fruit at your door.');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Text change')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  const drafts = panel.getByRole('region', { name: 'Drafts' });
  await expect(drafts.getByText('“Fresh fruit delivered to your door.” → “Fruit at your door.”')).toBeVisible();

  await page.reload();
  await expect(page.locator('#tagline')).toHaveText('Fresh fruit delivered to your door.');
  await expect(page.locator('[data-vf-pin="draft"]')).toHaveCount(1);
  await expect(drafts.getByText('→ “Fruit at your door.”')).toBeVisible();
});

test('a page without the meta tags is reported as not a preview', async ({ context, worker, extensionId }) => {
  const { panel } = await openReview(context, worker, extensionId, 'plain.html');
  await expect(panel.getByText('This page is not a preview build')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Select', exact: true })).toHaveCount(0);
});
```

- [ ] **Step 4: Install Chromium and run the tests to verify they fail**

Run (after the user confirms the download): `pnpm exec playwright install chromium`
Run: `pnpm test:e2e`
Expected: all 3 tests FAIL. `sidepanel.html` does not exist yet, so navigating to it fails or the expected text never appears.

- [ ] **Step 5: Create the side panel page and hooks**

`entrypoints/sidepanel/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vibe Feedback</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`entrypoints/sidepanel/main.tsx`:

```tsx
import './style.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
```

`entrypoints/sidepanel/hooks.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Browser, browser } from 'wxt/browser';
import { watchTokens } from '@/lib/auth/oauth';
import { sendToBackground } from '@/lib/background-client';
import { listDrafts, watchDrafts } from '@/lib/draft-store';
import {
  type AuthState,
  type ContentToPanel,
  PANEL_PORT,
  type PanelToContent,
  type Result,
  isContentReady,
} from '@/lib/messages';
import { watchSettings } from '@/lib/settings-store';
import type { FeedbackItem, Mode, PageContext, SentFeedback } from '@/lib/types';

/**
 * The tab this panel reviews: the active tab of its window. A `?tabId=` query parameter
 * pins it to one tab, which lets the panel run as a normal page in end-to-end tests.
 */
export function useTargetTab(): number | null {
  const fixed = useMemo(() => {
    const value = new URLSearchParams(location.search).get('tabId');
    return value ? Number(value) : null;
  }, []);
  const [tabId, setTabId] = useState<number | null>(fixed);

  useEffect(() => {
    if (fixed !== null) return;
    const refresh = async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      setTabId(tab?.id ?? null);
    };
    void refresh();
    browser.tabs.onActivated.addListener(refresh);
    return () => browser.tabs.onActivated.removeListener(refresh);
  }, [fixed]);

  return tabId;
}

export type PanelConnection = {
  context: PageContext | null;
  mode: Mode;
  unresolved: string[];
  send: (message: PanelToContent) => void;
  setMode: (mode: Mode) => void;
};

/** Keeps a port open to the tab's content script and reconnects when the page reloads. */
export function usePanelConnection(tabId: number | null): PanelConnection {
  const [context, setContext] = useState<PageContext | null>(null);
  const [mode, setModeState] = useState<Mode>('off');
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const portRef = useRef<Browser.runtime.Port | null>(null);
  const modeRef = useRef<Mode>('off');

  const send = useCallback((message: PanelToContent) => {
    try {
      portRef.current?.postMessage(message);
    } catch {
      // The page went away; onDisconnect resets the state.
    }
  }, []);

  const setMode = useCallback(
    (next: Mode) => {
      modeRef.current = next;
      setModeState(next);
      send({ type: 'set-mode', mode: next });
    },
    [send],
  );

  // A different tab starts with picking off.
  useEffect(() => {
    modeRef.current = 'off';
    setModeState('off');
  }, [tabId]);

  useEffect(() => {
    if (tabId === null) return;
    const port = browser.tabs.connect(tabId, { name: PANEL_PORT });
    portRef.current = port;

    port.onMessage.addListener((raw) => {
      const message = raw as ContentToPanel;
      if (message.type === 'context') {
        setContext(message.context);
        // The panel owns the mode: re-apply it after a reload or route change.
        if (message.context && modeRef.current !== 'off') {
          port.postMessage({ type: 'set-mode', mode: modeRef.current } satisfies PanelToContent);
        }
      } else if (message.type === 'mode') {
        modeRef.current = message.mode;
        setModeState(message.mode);
      } else if (message.type === 'unresolved') {
        setUnresolved(message.ids);
      }
    });

    const reset = () => {
      if (portRef.current === port) portRef.current = null;
      setContext(null);
      setUnresolved([]);
    };
    port.onDisconnect.addListener(() => {
      // Reading lastError marks "no content script on this page" as handled.
      void browser.runtime.lastError;
      reset();
    });

    const onReady = (message: unknown, sender: Browser.runtime.MessageSender) => {
      if (isContentReady(message) && sender.tab?.id === tabId) setAttempt((n) => n + 1);
    };
    browser.runtime.onMessage.addListener(onReady);

    return () => {
      browser.runtime.onMessage.removeListener(onReady);
      port.disconnect();
      reset();
    };
  }, [tabId, attempt]);

  return { context, mode, unresolved, send, setMode };
}

export function useDrafts(projectId: string | undefined): FeedbackItem[] {
  const [drafts, setDrafts] = useState<FeedbackItem[]>([]);

  useEffect(() => {
    if (!projectId) {
      setDrafts([]);
      return;
    }
    let active = true;
    void listDrafts(projectId).then((items) => {
      if (active) setDrafts(items);
    });
    const unwatch = watchDrafts(projectId, setDrafts);
    return () => {
      active = false;
      unwatch();
    };
  }, [projectId]);

  return drafts;
}

export type Auth = {
  state: AuthState | null;
  error: string | null;
  signIn: () => void;
  signOut: () => void;
};

export function useAuth(): Auth {
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((result: Result<AuthState>) => {
    if (result.ok) {
      setState(result.value);
      setError(null);
    } else {
      setError(result.error);
    }
  }, []);

  const refresh = useCallback(() => {
    void sendToBackground({ type: 'auth-state' }).then(apply);
  }, [apply]);

  // Tokens also change outside this panel, for example when the API rejects them.
  useEffect(() => {
    refresh();
    const unwatchSettings = watchSettings(refresh);
    const unwatchTokens = watchTokens(refresh);
    return () => {
      unwatchSettings();
      unwatchTokens();
    };
  }, [refresh]);

  return {
    state,
    error,
    signIn: () => void sendToBackground({ type: 'sign-in' }).then(apply),
    signOut: () => void sendToBackground({ type: 'sign-out' }).then(apply),
  };
}

export type SentState = { sent: SentFeedback[]; error: string | null; reload: () => void };

/** Loads the feedback already sent for the open page and mirrors it to the page for pins. */
export function useSent(
  context: PageContext | null,
  send: (message: PanelToContent) => void,
  refreshKey: string,
): SentState {
  const [sent, setSent] = useState<SentFeedback[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const projectId = context?.projectId;
  const path = context?.path;

  useEffect(() => {
    if (!projectId || path === undefined) {
      setSent([]);
      setError(null);
      return;
    }
    let active = true;
    void sendToBackground({ type: 'list', projectId, path }).then((result) => {
      if (!active) return;
      setSent(result.ok ? result.value : []);
      setError(result.ok ? null : result.error);
    });
    return () => {
      active = false;
    };
  }, [projectId, path, version, refreshKey]);

  // `context` is a new object after every reconnect, so a reloaded page gets the list again.
  useEffect(() => {
    if (context) send({ type: 'set-sent', items: sent });
  }, [context, sent, send]);

  const reload = useCallback(() => setVersion((n) => n + 1), []);
  return { sent, error, reload };
}
```

- [ ] **Step 6: Create the draft row and the panel app**

`entrypoints/sidepanel/DraftRow.tsx`:

```tsx
import { useState } from 'react';
import { locationLabel } from '@/lib/pins';
import type { FeedbackItem } from '@/lib/types';

type Props = {
  item: FeedbackItem;
  number?: number;
  missing: boolean;
  onFocus?: () => void;
  onSave: (comment: string) => void;
  onDelete: () => void;
};

const KIND_LABEL = { element: 'Element', 'text-edit': 'Text', page: 'Page' } as const;

export function DraftRow({ item, number, missing, onFocus, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState(item.comment);
  const canSave = item.kind === 'text-edit' || comment.trim() !== '';

  return (
    <li className="row">
      <button type="button" className="row__main" onClick={onFocus} disabled={!onFocus}>
        <span className="badge">{number ?? '•'}</span>
        <span className="row__body">
          <span className="row__meta">
            {KIND_LABEL[item.kind]} · {locationLabel(item)}
          </span>
          {item.textEdit && (
            <span className="row__edit">
              “{item.textEdit.before}” → “{item.textEdit.after}”
            </span>
          )}
          {!editing && item.comment && <span className="row__comment">{item.comment}</span>}
          {missing && <span className="row__warning">element not found</span>}
        </span>
      </button>

      {editing ? (
        <form
          className="row__editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave) return;
            onSave(comment.trim());
            setEditing(false);
          }}
        >
          <textarea value={comment} autoFocus onChange={(event) => setComment(event.target.value)} />
          <div className="row__actions">
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!canSave}>
              Save
            </button>
          </div>
        </form>
      ) : (
        <div className="row__actions">
          <button
            type="button"
            onClick={() => {
              setComment(item.comment);
              setEditing(true);
            }}
          >
            Edit
          </button>
          <button type="button" className="danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      )}
    </li>
  );
}
```

`entrypoints/sidepanel/App.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { sendToBackground } from '@/lib/background-client';
import { removeDraft, updateDraft } from '@/lib/draft-store';
import { groupDrafts, locationLabel, pagePins } from '@/lib/pins';
import type { Mode } from '@/lib/types';
import { DraftRow } from './DraftRow';
import { useAuth, useDrafts, usePanelConnection, useSent, useTargetTab } from './hooks';

const MODES: Array<{ mode: Mode; label: string }> = [
  { mode: 'off', label: 'Off' },
  { mode: 'select', label: 'Select' },
  { mode: 'text', label: 'Text' },
];

export function App() {
  const tabId = useTargetTab();
  const { context, mode, unresolved, send, setMode } = usePanelConnection(tabId);
  const drafts = useDrafts(context?.projectId);
  const auth = useAuth();
  const authKey = auth.state
    ? `${auth.state.useMock}:${auth.state.configured}:${auth.state.signedIn}`
    : 'loading';
  const { sent, error: sentError, reload } = useSent(context, send, authKey);

  const [pageComment, setPageComment] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const numbers = useMemo(() => {
    const pins = context ? pagePins(drafts, sent, context.path) : [];
    return new Map(pins.map((pin) => [pin.id, pin.number]));
  }, [context, drafts, sent]);
  const missing = useMemo(() => new Set(unresolved), [unresolved]);

  // Right after choosing a mode the keyboard focus is still in this panel, not in the page,
  // so the picker's keys are handled here and forwarded.
  useEffect(() => {
    if (mode === 'off') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest('textarea, input')) return;
      if (event.key === 'Escape') {
        setMode('off');
      } else if (mode === 'select' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        send({ type: 'key', key: event.key });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, send, setMode]);

  const openOptions = () => void browser.runtime.openOptionsPage();

  const header = (
    <header className="header">
      <div>
        <h1>Vibe Feedback</h1>
        {context && (
          <p className="muted">
            {context.projectId} · {context.buildId}
          </p>
        )}
      </div>
      <div className="header__actions">
        {auth.state && !auth.state.useMock && auth.state.configured && (
          <button type="button" onClick={auth.state.signedIn ? auth.signOut : auth.signIn}>
            {auth.state.signedIn ? 'Sign out' : 'Sign in'}
          </button>
        )}
        {auth.state?.useMock && <span className="tag">Mock</span>}
        <button type="button" onClick={openOptions}>
          Options
        </button>
      </div>
    </header>
  );

  if (!context) {
    return (
      <div className="panel">
        {header}
        <p className="notice">
          This page is not a preview build. Open a preview deployed by the tool to leave feedback.
        </p>
      </div>
    );
  }

  const { projectId } = context;
  const groups = groupDrafts(drafts, context.path);
  const canSend = auth.state !== null && auth.state.configured && auth.state.signedIn;

  const submit = async () => {
    setSending(true);
    setSendError(null);
    const result = await sendToBackground({ type: 'submit', projectId });
    setSending(false);
    if (result.ok) reload();
    else setSendError(result.error);
  };

  const addPageComment = () => {
    const comment = pageComment?.trim();
    if (!comment) return;
    send({ type: 'create-page-comment', comment });
    setPageComment(null);
  };

  return (
    <div className="panel">
      {header}
      {auth.error && <p className="error">{auth.error}</p>}
      {auth.state && !auth.state.configured && (
        <p className="notice">
          The API is not set up yet.{' '}
          <button type="button" className="link" onClick={openOptions}>
            Open Options
          </button>
        </p>
      )}

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Mode">
          {MODES.map((option) => (
            <button
              key={option.mode}
              type="button"
              aria-pressed={mode === option.mode}
              onClick={() => setMode(option.mode)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setPageComment('')}>
          Add page comment
        </button>
      </div>

      {pageComment !== null && (
        <form
          className="page-comment"
          onSubmit={(event) => {
            event.preventDefault();
            addPageComment();
          }}
        >
          <textarea
            autoFocus
            placeholder="Comment about this page as a whole"
            value={pageComment}
            onChange={(event) => setPageComment(event.target.value)}
          />
          <div className="row__actions">
            <button type="button" onClick={() => setPageComment(null)}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={pageComment.trim() === ''}>
              Add
            </button>
          </div>
        </form>
      )}

      <main className="lists">
        <section aria-label="Drafts">
          <h2>Drafts ({drafts.length})</h2>
          {drafts.length === 0 && <p className="muted">Pick Select or Text, then click the page.</p>}
          {groups.map((group) => (
            <div key={group.path}>
              <h3>{group.path}</h3>
              <ul>
                {group.items.map((item) => (
                  <DraftRow
                    key={item.id}
                    item={item}
                    number={numbers.get(item.id)}
                    missing={missing.has(item.id)}
                    onFocus={
                      numbers.has(item.id)
                        ? () => send({ type: 'focus-item', id: item.id })
                        : undefined
                    }
                    onSave={(comment) => void updateDraft(projectId, item.id, { comment })}
                    onDelete={() => void removeDraft(projectId, item.id)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section aria-label="Sent">
          <h2>Sent on this page ({sent.length})</h2>
          {sentError && (
            <p className="error">
              {sentError}{' '}
              <button type="button" className="link" onClick={reload}>
                Retry
              </button>
            </p>
          )}
          <ul>
            {sent.map((item) => (
              <li key={item.id} className={`row row--${item.status}`}>
                <button
                  type="button"
                  className="row__main"
                  disabled={!numbers.has(item.id)}
                  onClick={() => send({ type: 'focus-item', id: item.id })}
                >
                  <span className="badge badge--sent">{numbers.get(item.id) ?? '•'}</span>
                  <span className="row__body">
                    <span className="row__meta">
                      {item.author.name} · {item.status} · {locationLabel(item)}
                    </span>
                    {item.textEdit && (
                      <span className="row__edit">
                        “{item.textEdit.before}” → “{item.textEdit.after}”
                      </span>
                    )}
                    {item.comment && <span className="row__comment">{item.comment}</span>}
                    {missing.has(item.id) && (
                      <span className="row__warning">element not found</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="footer">
        {sendError && (
          <p className="error">
            {sendError}{' '}
            <button type="button" className="link" onClick={() => void submit()}>
              Retry
            </button>
          </p>
        )}
        {auth.state && auth.state.configured && !auth.state.signedIn && (
          <p className="muted">Sign in to send your drafts.</p>
        )}
        <button
          type="button"
          className="primary footer__send"
          disabled={!canSend || sending || drafts.length === 0}
          onClick={() => void submit()}
        >
          {sending ? 'Sending…' : `Send ${drafts.length}`}
        </button>
      </footer>
    </div>
  );
}
```

- [ ] **Step 7: Create the side panel styles**

`entrypoints/sidepanel/style.css`:

```css
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1c1c1e;
  --muted: #6b7280;
  --line: #e4e4e7;
  --surface: #f4f4f5;
  --accent: #2f6fed;
  --draft: #f08c00;
  --danger: #c92a2a;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #18181b;
    --fg: #f4f4f5;
    --muted: #a1a1aa;
    --line: #3f3f46;
    --surface: #27272a;
    --accent: #6c9bff;
    --danger: #ff8787;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--fg);
  background: var(--bg);
}

h1,
h2,
h3,
p,
ul {
  margin: 0;
  padding: 0;
}

h1 {
  font-size: 14px;
}

h2 {
  margin: 16px 0 6px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

h3 {
  margin: 8px 0 4px;
  font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--muted);
}

ul {
  list-style: none;
}

button,
textarea {
  font: inherit;
  color: inherit;
}

button {
  padding: 4px 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 6px;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.primary {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
}

button.danger {
  color: var(--danger);
}

button.link {
  padding: 0;
  color: var(--accent);
  background: none;
  border: none;
  text-decoration: underline;
}

textarea {
  width: 100%;
  min-height: 64px;
  padding: 6px 8px;
  resize: vertical;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 6px;
}

.panel {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding: 12px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}

.header__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tag {
  padding: 1px 6px;
  font-size: 11px;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 999px;
}

.muted {
  color: var(--muted);
}

.notice,
.error {
  margin-top: 10px;
  padding: 8px 10px;
  background: var(--surface);
  border-radius: 6px;
}

.error {
  color: var(--danger);
}

.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
}

.segmented {
  display: flex;
}

.segmented button {
  border-radius: 0;
  margin-left: -1px;
}

.segmented button:first-child {
  margin-left: 0;
  border-radius: 6px 0 0 6px;
}

.segmented button:last-child {
  border-radius: 0 6px 6px 0;
}

.segmented button[aria-pressed='true'] {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
}

.page-comment {
  margin-top: 10px;
}

.lists {
  flex: 1;
}

.row {
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}

.row--resolved {
  opacity: 0.55;
}

.row__main {
  display: flex;
  gap: 8px;
  width: 100%;
  padding: 0;
  text-align: left;
  background: none;
  border: none;
}

.row__main:disabled {
  opacity: 1;
  cursor: default;
}

.row__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.row__meta {
  font-size: 11px;
  color: var(--muted);
  overflow-wrap: anywhere;
}

.row__edit,
.row__comment {
  overflow-wrap: anywhere;
}

.row__warning {
  font-size: 11px;
  color: var(--danger);
}

.row__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 6px;
}

.row__editor {
  margin-top: 6px;
}

.badge {
  flex: none;
  width: 20px;
  height: 20px;
  font: 600 11px/20px system-ui, sans-serif;
  text-align: center;
  color: #fff;
  background: var(--draft);
  border-radius: 50%;
}

.badge--sent {
  background: #6b7280;
}

.footer {
  position: sticky;
  bottom: 0;
  padding-top: 10px;
  background: var(--bg);
}

.footer__send {
  width: 100%;
  margin-top: 8px;
  padding: 8px;
}
```

- [ ] **Step 8: Run the end-to-end tests to verify they pass**

Run: `pnpm compile && pnpm test:e2e`
Expected: no `tsc` errors; 3 Playwright tests PASS.

If a test fails, run `pnpm exec playwright test --headed --debug` to step through it. Check first that `.output/chrome-mv3/manifest.json` contains `side_panel` and a `content_scripts` entry matching `http://localhost/*`.

- [ ] **Step 9: Check the real side panel by hand**

The tests drive the panel as a normal tab. The real side panel follows the active tab, which only a manual check covers.

Run `pnpm fixture` in one terminal and `pnpm dev` in another (or `pnpm build` and load `.output/chrome-mv3` through `chrome://extensions` → Load unpacked). Then:

1. Open http://localhost:4173/ and click the extension icon. Expected: the side panel opens and shows `demo-project · build-001`.
2. Choose Select, hover the page. Expected: a blue outline follows the cursor with a label such as `h1 · src/pages/Home.tsx:12`.
3. Without clicking the page, press `↑`. Expected: the outline grows to the parent (the panel forwards the key). Press `Esc`. Expected: the mode returns to Off.
4. Pin a comment on the far-down paragraph, scroll up, click the draft in the panel. Expected: the page scrolls to the pin and the pin pulses.
5. Click "About". Expected: the panel header stays, Drafts shows the home-page draft under `/`, and no pin is drawn on the About page.
6. Open a new tab with any other site. Expected: the panel shows "This page is not a preview build". Switch back. Expected: the panel reconnects.
7. Close the side panel. Expected: the pins disappear from the page.

- [ ] **Step 10: Commit**

```bash
git add fixtures playwright.config.ts e2e entrypoints/sidepanel
git commit -m "feat: add side panel with drafts, sent feedback and send" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Options page, README and final verification

**Files:**
- Create: `entrypoints/options/index.html`, `main.tsx`, `App.tsx`, `style.css`
- Create: `README.md`
- Test: `e2e/options.spec.ts`

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS`, `getSettings`, `normalizeSettings`, `requiredOrigins`, `saveSettings`, `validateSettings` (Task 6); `test`, `expect` from `e2e/fixtures.ts` (Task 11); the side panel's CSS variables and `.notice`, `.error`, `.primary` classes (Task 11).
- Produces: `options.html`, opened from the side panel's Options button through `browser.runtime.openOptionsPage()`.

- [ ] **Step 1: Write the failing end-to-end test**

`e2e/options.spec.ts`:

```ts
import { expect, test } from './fixtures';

test('options refuse incomplete real-API settings and keep mock as the default', async ({
  context,
  extensionId,
}) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);

  const mock = options.getByLabel('Use mock API');
  await expect(mock).toBeChecked();

  await mock.uncheck();
  await options.getByRole('button', { name: 'Save' }).click();
  const status = options.getByRole('status');
  await expect(status).toContainText('API base URL must be an https URL.');
  await expect(status).toContainText('Client ID is required.');

  await options.reload();
  await expect(options.getByLabel('Use mock API')).toBeChecked();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm build && pnpm exec playwright test e2e/options.spec.ts`
Expected: FAIL. `options.html` does not exist.

- [ ] **Step 3: Create the options page**

`entrypoints/options/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vibe Feedback Options</title>
    <meta name="manifest.open_in_tab" content="true" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`entrypoints/options/main.tsx`:

```tsx
import '../sidepanel/style.css';
import './style.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
```

`entrypoints/options/style.css`:

```css
.options {
  max-width: 560px;
  margin: 0 auto;
  padding: 24px 16px;
}

.options label {
  display: block;
  margin-top: 14px;
  font-weight: 600;
}

.options input[type='text'],
.options input[type='url'] {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 6px 8px;
  font: inherit;
  font-weight: 400;
  color: inherit;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 6px;
}

.options .check {
  display: flex;
  align-items: center;
  gap: 8px;
}

.options fieldset {
  margin: 16px 0 0;
  padding: 0;
  border: none;
}

.options fieldset:disabled {
  opacity: 0.5;
}

.options code {
  font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
}

.options .submit {
  margin-top: 20px;
  padding: 8px 16px;
}
```

`entrypoints/options/App.tsx`:

```tsx
import { type FormEvent, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  DEFAULT_SETTINGS,
  getSettings,
  normalizeSettings,
  requiredOrigins,
  saveSettings,
  validateSettings,
} from '@/lib/settings-store';
import type { OAuthSettings, Settings } from '@/lib/types';

type Status = { kind: 'ok' | 'error'; messages: string[] };

export function App() {
  const [form, setForm] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    void getSettings().then(setForm);
  }, []);

  const setOAuth = (patch: Partial<OAuthSettings>) =>
    setForm((current) => ({ ...current, oauth: { ...current.oauth, ...patch } }));

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next = normalizeSettings(form);
    const errors = validateSettings(next);
    if (errors.length > 0) {
      setStatus({ kind: 'error', messages: errors });
      return;
    }
    if (!next.useMock) {
      // Must stay the first await: Chrome only allows permission prompts inside a user gesture.
      const granted = await browser.permissions
        .request({ origins: requiredOrigins(next) })
        .catch(() => false);
      if (!granted) {
        setStatus({
          kind: 'error',
          messages: ['Access to the API host was not granted, so nothing was saved.'],
        });
        return;
      }
    }
    await saveSettings(next);
    setForm(next);
    setStatus({ kind: 'ok', messages: ['Saved.'] });
  };

  return (
    <form className="options" onSubmit={(event) => void onSubmit(event)}>
      <h1>Vibe Feedback Options</h1>

      <label className="check">
        <input
          type="checkbox"
          checked={form.useMock}
          onChange={(event) => setForm({ ...form, useMock: event.target.checked })}
        />
        Use mock API (feedback stays in this browser)
      </label>

      <fieldset disabled={form.useMock}>
        <label>
          API base URL
          <input
            type="url"
            placeholder="https://tool.example.com/api"
            value={form.apiBase}
            onChange={(event) => setForm({ ...form, apiBase: event.target.value })}
          />
        </label>
        <label>
          OAuth authorize URL
          <input
            type="url"
            value={form.oauth.authorizeUrl}
            onChange={(event) => setOAuth({ authorizeUrl: event.target.value })}
          />
        </label>
        <label>
          OAuth token URL
          <input
            type="url"
            value={form.oauth.tokenUrl}
            onChange={(event) => setOAuth({ tokenUrl: event.target.value })}
          />
        </label>
        <label>
          OAuth client ID
          <input
            type="text"
            value={form.oauth.clientId}
            onChange={(event) => setOAuth({ clientId: event.target.value })}
          />
        </label>
        <label>
          OAuth scopes (space separated)
          <input
            type="text"
            value={form.oauth.scopes}
            onChange={(event) => setOAuth({ scopes: event.target.value })}
          />
        </label>
        <p className="notice">
          Register this redirect URI with the tool: <code>{browser.identity.getRedirectURL()}</code>
        </p>
      </fieldset>

      {status && (
        <div className={status.kind === 'error' ? 'error' : 'notice'} role="status">
          {status.messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}

      <button type="submit" className="primary submit">
        Save
      </button>
    </form>
  );
}
```

`browser.permissions.request` must be the first `await` in the submit handler: Chrome only shows the permission prompt while the click's user gesture is still active.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm build && pnpm exec playwright test e2e/options.spec.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Write the README**

`README.md`:

````markdown
# Vibe Feedback

A Chrome extension for leaving feedback on preview builds deployed by the vibe-coding tool.
Open a preview, pick an element, pin a comment, and send the batch to the tool.

Design: `docs/superpowers/specs/2026-09-30-vibe-feedback-extension-design.md`

## Requirements

- Node 22.12 or newer (`nvm use` reads `.nvmrc`)
- pnpm 10

## Commands

| Command | What it does |
|---|---|
| `pnpm install && pnpm wxt prepare` | Install dependencies and generate WXT types |
| `pnpm dev` | Run the extension in a development browser with hot reload |
| `pnpm fixture` | Serve the sample preview at http://localhost:4173/ |
| `pnpm test` | Unit tests |
| `pnpm compile` | Type-check |
| `pnpm test:e2e` | Build, then run the Playwright tests against the built extension |
| `pnpm build` | Production build in `.output/chrome-mv3` |

To install a build by hand: open `chrome://extensions`, enable Developer mode, choose
"Load unpacked" and select `.output/chrome-mv3`.

## Using it

1. Open a preview build and click the extension icon. The side panel opens.
2. Choose **Select** and click an element to comment on it, or **Text** and click a piece of
   text to rewrite it in place. **Add page comment** records feedback about the whole page.
3. Review the drafts in the side panel, then press **Send**.

`Esc` leaves the current mode. In Select mode, `↑` and `↓` move to the parent or first child.

## What the tool must inject into a preview build

```html
<meta name="vibe:project-id" content="proj_123">
<meta name="vibe:build-id" content="build_456">
<button data-vibe-source="src/pages/Home.tsx:42">Buy</button>
```

Without both meta tags the extension treats the page as "not a preview build".

## Connecting the real API

The extension starts in mock mode: feedback is stored in the browser only.

- `lib/api/http-feedback-api.ts` is the only file that knows the API's URLs and payload.
  Change it when the real contract differs from the proposal in the design spec.
- Turn mock off on the Options page and fill in the API base URL and the OAuth settings.
  The page shows the redirect URI to register with the tool.
- The redirect URI contains the extension id. An unpacked extension's id depends on its
  folder path, so add a fixed `key` to the manifest in `wxt.config.ts` before sharing the
  extension with the team.
````

- [ ] **Step 6: Run the full verification**

Run: `pnpm test && pnpm compile && pnpm test:e2e`
Expected: 17 unit test files pass (129 tests); `tsc` prints no errors; 4 Playwright tests pass.

- [ ] **Step 7: Check the options page by hand**

With the extension loaded, click Options in the side panel.

1. Expected: the options page opens in a tab with "Use mock API" checked and the API fields disabled.
2. Uncheck mock, enter `https://example.com/api`, `https://example.com/authorize`, `https://example.com/token` and a client id, then Save. Expected: Chrome asks for access to `example.com`; after allowing it the page shows "Saved."
3. Back in the side panel. Expected: the Mock tag is gone, a "Sign in" button is shown, Send is disabled, and the Sent section shows "Sign in to continue" with a Retry link.
4. Re-check mock and Save. Expected: the side panel returns to mock mode and Send works again.

- [ ] **Step 8: Commit**

```bash
git add entrypoints/options e2e/options.spec.ts README.md
git commit -m "feat: add options page and README" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the last task

What is still open once every task is done, and needs the tool's owner:

- **The real API contract.** Adjust `lib/api/http-feedback-api.ts` and its test to the actual endpoints and payload.
- **OAuth endpoints and client registration.** Enter them in Options; register the redirect URI shown there.
- **A fixed extension id.** Add a `key` to the manifest in `wxt.config.ts` so the redirect URI is the same for every teammate.
- **Build-time injection in the tool.** The tool must emit the two meta tags and `data-vibe-source` attributes; until then the extension works only on the fixture.
