# Vibe Feedback — Design Spec

Date: 2026-09-30
Status: approved 2026-09-30; amended the same day while writing the implementation plan (hash-route paths, port-based panel protocol, text-only inline editing, settings validation)

## 1. Purpose

The vibe-coding tool deploys preview builds to Firebase Hosting. Requesting a change currently means writing feedback into a file and pushing it back into the tool.

Vibe Feedback is a Chrome extension that replaces that step. A reviewer opens the preview, picks an element inspector-style, pins a comment on it, and presses Send. The tool receives feedback with enough context for its agent to change the right code.

**Success looks like:** a reviewer can leave feedback on a preview without leaving the page, and every feedback item the tool receives identifies the project, the build, and the source file and line it refers to.

## 2. Decisions

| Topic | Decision |
|---|---|
| Users | Internal team (dev/QA/PM) |
| Collaboration | Teammates see each other's comments after they are sent. Not realtime |
| Storage | The tool is the single source of truth, via one write API and one read API. The extension has no backend |
| Source mapping | The tool injects project/build meta tags and a `data-vibe-source` attribute into preview builds |
| Feedback kinds | Element comment, inline text edit, page-level comment |
| Auth | The tool's own OAuth, Authorization Code + PKCE |
| Layout | Chrome side panel. The page carries only highlight, pins and a popover |
| Stack | WXT, React, TypeScript, Manifest V3 |

### Out of scope for v1

Screenshots, multi-step flow recording, realtime updates, replies and threads, resolving items from the extension, custom domains beyond Firebase Hosting, a global keyboard shortcut, Firefox.

## 3. Contract with the tool

The shapes in this section are proposals. The real API will be supplied later; when it is, only `lib/api/http-feedback-api.ts` and the types it maps to should need to change.

### 3.1 Preview page

The tool injects these at build time:

```html
<meta name="vibe:project-id" content="proj_123">
<meta name="vibe:build-id" content="build_456">
<button data-vibe-source="src/pages/Home.tsx:42">Buy</button>
```

- A page is a **preview page** when both meta tags are present with non-empty content. On any other page the side panel shows "not a preview build" and the picker is disabled.
- `data-vibe-source` is `<repo-relative path>:<line>`. It is not required on every element.
- A page's **path** is `location.pathname`. For hash-routed apps (hash starting with `#/`) the hash is appended, so `/#/settings` and `/#/home` are different pages.

### 3.2 Feedback API

| Call | Request | Response |
|---|---|---|
| `POST {apiBase}/projects/{projectId}/feedback` | `{ items: FeedbackItem[], client: ClientInfo }` | `SentFeedback[]` for the created items |
| `GET {apiBase}/projects/{projectId}/feedback?path={path}` | — | `SentFeedback[]` for that project and path |

Both calls send `Authorization: Bearer <access_token>`. `FeedbackItem.id` is a client-generated UUID; the server treats a repeated id as the same item, so a retried POST does not create duplicates.

```ts
type FeedbackItem = {
  id: string;
  buildId: string;                 // build the reviewer was looking at
  kind: 'element' | 'text-edit' | 'page';
  comment: string;                 // may be empty only for 'text-edit'
  page: { url: string; path: string; title: string };
  anchor?: Anchor;                 // present for 'element' and 'text-edit'
  textEdit?: { before: string; after: string }; // present for 'text-edit'
  viewport: { width: number; height: number; dpr: number };
  createdAt: string;               // ISO 8601
};

type Anchor = {
  source?: string;        // data-vibe-source on the element itself
  nearestSource?: string; // on the nearest ancestor, when the element has none
  selector: string;       // CSS selector, fallback locator
  tag: string;            // lower-case tag name
  text: string;           // textContent, whitespace-collapsed, max 200 chars
  html: string;           // outerHTML, max 2000 chars
  rect: { x: number; y: number; width: number; height: number }; // page coordinates
};

type SentFeedback = FeedbackItem & {
  author: { id: string; name: string };
  status: 'open' | 'resolved';
};

type ClientInfo = { extensionVersion: string; userAgent: string };
```

`buildId` lives on each item, not on the batch, because drafts written against one build may be sent after a redeploy.

### 3.3 OAuth

Authorization Code with PKCE through `chrome.identity.launchWebAuthFlow`.

- Configured on the Options page: `authorizeUrl`, `tokenUrl`, `clientId`, `scopes`.
- Redirect URI: `https://<extension-id>.chromiumapp.org/`.
- The token endpoint returns `access_token`, `expires_in` and optionally `refresh_token`.

## 4. Architecture

```
entrypoints/
  background.ts          service worker: API calls, OAuth, side panel behaviour
  content/index.tsx      runs on preview pages; UI inside a Shadow DOM root
  sidepanel/             React app: drafts, sent items, Send, sign-in
  options/               React app: settings
lib/
  types.ts               FeedbackItem, Anchor, SentFeedback, Settings
  messages.ts            message types shared by all contexts
  page-context.ts        reads project/build meta and the current path
  selector.ts            builds a stable CSS selector for an element
  element-descriptor.ts  element -> Anchor
  anchor-resolver.ts     Anchor -> element
  draft-store.ts         drafts in storage.local
  settings-store.ts      settings in storage.local
  feedback-factory.ts    builds a FeedbackItem from a comment, context and anchor
  pins.ts                pin numbering and draft grouping shared by page and panel
  picker.ts, text-edit.ts, popover-position.ts   pure logic behind the on-page UI
  background-handlers.ts handles side panel requests (testable without Chrome)
  auth/pkce.ts           verifier and challenge generation
  auth/oauth.ts          sign-in, token storage, refresh
  api/feedback-api.ts    interface FeedbackApi
  api/http-feedback-api.ts   real API adapter
  api/mock-feedback-api.ts   storage-backed stand-in
components/              Picker, PinLayer, CommentPopover, TextEditor (content script UI)
fixtures/demo/           sample preview page for tests and manual checks
e2e/                     Playwright tests that load the built extension
```

### 4.1 Units

**`page-context`** — `readPageContext(document, location)` returns `{ projectId, buildId, path, url, title }`, or `null` when the page is not a preview page.

**`selector`** — `buildSelector(element)` returns a selector that matches exactly that element in its document. It prefers an `id`, then `data-testid`, then a path of tag names with `:nth-of-type`. It ignores class names, which are unstable in generated builds.

**`element-descriptor`** — `describeElement(element)` returns an `Anchor`. `source` comes from the element's own `data-vibe-source`; when absent, `nearestSource` comes from the closest ancestor that has one.

**`anchor-resolver`** — `resolveAnchor(anchor, document)` returns an element or `null`, trying in order:

1. Elements whose `data-vibe-source` equals `anchor.source`. If several match (a list rendered from one line), pick the one matching `anchor.selector`, else the one whose text equals `anchor.text`, else the first.
2. `document.querySelector(anchor.selector)`, accepted only if its tag equals `anchor.tag`.
3. The first element with tag `anchor.tag` whose collapsed text equals `anchor.text`, when `anchor.text` is non-empty.

**`draft-store`** — drafts are `FeedbackItem`s stored under one `storage.local` key as `Record<projectId, FeedbackItem[]>`. Operations: `list(projectId)`, `add`, `update`, `remove`, `removeMany`, and `watch(projectId, callback)`.

**`FeedbackApi`**

```ts
interface FeedbackApi {
  submit(projectId: string, items: FeedbackItem[]): Promise<SentFeedback[]>;
  list(projectId: string, path: string): Promise<SentFeedback[]>;
}
```

`HttpFeedbackApi` takes `apiBase`, a `getAccessToken` function and `fetch`. `MockFeedbackApi` persists to `storage.local` and stamps items with a fixed mock author. The background picks one from settings.

**`settings-store`** — `{ useMock: boolean, apiBase: string, oauth: { authorizeUrl, tokenUrl, clientId, scopes } }`. `useMock` defaults to `true`, so the extension works end to end before the real API exists. With mock off, the API and OAuth URLs must be `https` (or `http://localhost`) and the client id is required; Options refuses to save otherwise.

**`auth/oauth`** — `signIn()`, `signOut()`, `getAccessToken()`. Tokens are stored in `storage.local`. `getAccessToken()` refreshes when the token is within 60 seconds of expiry.

### 4.2 Data flow

- **Drafts** are shared state in `storage.local`. The content script writes them; the side panel and the pin layer subscribe through `watch`. No messages are used to sync drafts.
- **Side panel ↔ content script** use one long-lived port (`tabs.connect`, name `vibe-panel`) opened by the side panel to the tab it is reviewing. The page UI is active only while a panel is connected: closing the panel hides the pins and turns picking off.
  - Panel → content: `set-mode` (`off | select | text`), `key` (`ArrowUp`/`ArrowDown` pressed while the panel has keyboard focus, so they still steer the picker), `focus-item` (scroll to a pin and flash it), `create-page-comment`, `set-sent` (the sent items for the open page, so the page can draw their pins).
  - Content → panel: `context` (on connect and on SPA route change, `wxt:locationchange`), `mode` (when the reviewer leaves a mode with `Escape`), `unresolved` (ids whose element could not be found).
  - A content script broadcasts `content-ready` (`runtime.sendMessage`) when it starts, so an already-open panel reconnects after a page reload.
- **Side panel → background** (`runtime.sendMessage`): `submit`, `list`, `sign-in`, `sign-out`, `auth-state`. The background reads the drafts itself on `submit` and removes the ones it sent.
- Only the background service worker makes network requests, so tokens never enter the page.
- The side panel owns the current mode. When a content script reports `context` after a page load or route change, the side panel re-applies the mode.
- The side panel reviews the active tab of its window and follows tab switches. A `?tabId=` query parameter pins it to one tab; end-to-end tests use this to run the panel as a normal page.

### 4.3 On-page behaviour

All extension UI on the page is mounted in one Shadow DOM root so page CSS and extension CSS cannot affect each other.

- **Select mode** — hovering outlines the element under the cursor. Clicking opens the comment popover anchored to it. `ArrowUp` moves the selection to the parent, `ArrowDown` to the first child, `Escape` leaves the mode. Pointer and click events are captured and stopped so the page does not react.
- **Text mode** — clicking an element that contains text and no child elements makes it `contenteditable="plaintext-only"`. (Mixed content such as `<p>Hello <b>world</b></p>` is not editable as a whole, because cancelling could not restore the child elements; the inner `<b>` is.) `Enter` or blur saves; `Escape` restores the original text. If the text changed, a `text-edit` draft is created with `before` and `after`, and the popover opens for an optional note. If it did not change, nothing is created. Editing the same element again amends its existing draft and keeps the original `before`; editing it back to the original removes the draft.
- **Page-level comment** — created from a button in the side panel; has no anchor and no pin.
- **Pins** — numbered markers at the top-right corner of each anchored element: drafts first, then open sent items. Resolved sent items get no pin. Drafts and sent items use different colours; a sent pin shows its author on hover, and clicking a draft pin reopens its comment. Positions are recomputed on scroll, resize and DOM mutation, throttled with `requestAnimationFrame`.
- After a reload, inline text edits are not re-applied to the page. The draft remains in the side panel and its pin is shown.

### 4.4 Side panel

- Header: project id, build id, sign-in state.
- Mode switch: Off / Select / Text, plus "Add page comment".
- **Drafts** — every unsent draft for the current project, grouped by page path. Each can be edited or deleted. Clicking one focuses its pin when it belongs to the open page.
- **Sent** — items returned by `list` for the current project and path, with author and status. Read-only. Items whose anchor cannot be resolved are labelled "element not found".
- **Send** — submits all drafts for the current project. On success the drafts are removed and the sent list is reloaded.
- Clicking the toolbar icon opens the side panel (`sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`).

### 4.5 Permissions

- `permissions`: `sidePanel`, `storage`, `identity`
- `host_permissions`: `*://*.web.app/*`, `*://*.firebaseapp.com/*`, `http://localhost/*`
- `optional_host_permissions`: `https://*/*`, requested for the origins of `apiBase` and `tokenUrl` when Options is saved

## 5. Error handling

| Situation | Behaviour |
|---|---|
| Page is not a preview page | Side panel shows a notice; mode switch disabled |
| Signed out, real API | Drafting works; Send is disabled with a sign-in prompt |
| Submit fails (network or 5xx) | Drafts are kept; an error with a Retry action is shown |
| 401 from the API | Refresh the token once and retry; if it fails again, clear tokens and prompt to sign in |
| `list` fails | Sent section shows an error with Retry; drafts are unaffected |
| Anchor cannot be resolved | Item stays in the list, labelled "element not found"; no pin |
| Settings incomplete with mock off | Side panel links to Options |

## 6. Testing

- **Unit** — Vitest with the `WxtVitest` plugin, `fakeBrowser` for extension APIs and a DOM environment for the DOM modules. Covered: `page-context`, `selector`, `element-descriptor`, `anchor-resolver`, `draft-store`, `settings-store`, `pkce`, `oauth` refresh logic, `HttpFeedbackApi` (URL, headers, body, 401 path) and `MockFeedbackApi`.
- **Fixture** — `fixtures/demo` is a small preview page with both meta tags, elements with and without `data-vibe-source`, and a repeated list rendered from one source line.
- **End-to-end smoke** — Playwright loads the built extension, opens the fixture, pins a comment, sends against the mock and checks the item appears as sent.
- **Manual** — the same scenario on a real Firebase preview once the tool injects the markers.
