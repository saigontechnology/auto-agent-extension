# Workflow Recording — Design Spec

Date: 2026-10-01
Status: draft, awaiting review
Builds on: `2026-09-30-vibe-feedback-extension-design.md` (the "v1 spec"), which listed multi-step flow recording as out of scope

## 1. Purpose

Some problems only show up after a sequence of actions: fill a form, submit, land on another page, and only then does something break. Describing that sequence in a single comment is slow and loses detail.

Workflow recording lets a reviewer press **Record**, use the preview normally, press **Stop**, and send the result as a bug report. The tool's agent receives the ordered steps, the source file and line of every element touched, and the console errors and failed requests that happened in between, so it can reproduce the problem and change the right code.

**Success looks like:** a reviewer can report a multi-step bug without writing the repro steps by hand, and every workflow the tool receives contains enough to reproduce it: ordered actions with anchors, the values typed, the pages visited, the errors that occurred, the expected and actual result, and the step where it went wrong.

## 2. Decisions

| Topic | Decision |
|---|---|
| What is captured | Clicks, text input, select/checkbox/radio changes, Enter/Escape/Tab, navigation, plus console errors, uncaught exceptions, unhandled rejections and failed network requests |
| Typed values | Recorded verbatim, including password fields. This assumes previews use test data only |
| Scope of one recording | One tab and one project. Leaving the project pauses recording; returning resumes it. New tabs opened from the recorded tab are noted as a step, not followed |
| Report shape | Required title, optional "Expected" and "Actual", one optional step flagged as "fails here". Steps can be edited or deleted. Notes can be inserted while recording |
| Data model | A new feedback kind, `flow`, sent through the existing feedback API alongside other drafts |
| Recording state | Owned by the background service worker, per tab, in `storage.session` |

### Out of scope

Replaying a recorded workflow, screenshots, following the reviewer into new tabs or popups, request and response bodies, recording across a browser restart.

## 3. Contract with the tool

The feedback API from v1 spec section 3.2 is unchanged except for the additions below. The tool only needs to accept one more `kind` and its `flow` field.

```ts
type FeedbackKind = 'element' | 'text-edit' | 'page' | 'flow';

type FeedbackItem = {
  // ...fields from the v1 spec...
  flow?: Flow; // present for 'flow' only
};
```

For a `flow` item:

- `comment` is the workflow's title and must be non-empty.
- `page` is the page where recording started.
- `anchor` and `textEdit` are absent.
- `viewport` is taken when recording starts.
- `buildId` is the build of the page where recording started.

```ts
type Flow = {
  expected: string;       // may be empty
  actual: string;         // may be empty
  failedStepId?: string;  // the step flagged as "fails here"
  startedAt: string;      // ISO 8601
  endedAt: string;        // ISO 8601
  steps: FlowStep[];      // in chronological order
};

type FlowStep = { id: string; at: string; path: string } & (
  | { type: 'click'; anchor: Anchor }
  | { type: 'input'; anchor: Anchor; value: string }
  | { type: 'select'; anchor: Anchor; value: string; label: string }
  | { type: 'check'; anchor: Anchor; checked: boolean }
  | { type: 'key'; anchor?: Anchor; key: 'Enter' | 'Escape' | 'Tab' }
  | { type: 'navigate'; url: string; cause: 'route' | 'load' | 'reload' | 'history' }
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
  | { type: 'network'; method: string; url: string; status: number | null; count: number }
);
```

- `path` follows the v1 rule: `location.pathname`, plus the hash for hash-routed apps.
- `Anchor` is the v1 type, so `source` and `nearestSource` give the agent a file and line for each element.
- `input` holds the field's value when the reviewer finished typing in it. Consecutive input into the same field becomes one step.
- `navigate.cause` values:
  - `route`: a same-document route change.
  - `load`: a new document from a link, form or typed URL.
  - `reload`: the page was reloaded.
  - `history`: back/forward, including restores from the back/forward cache.
- `left` means the tab moved to a page outside the recorded project, or to a page the extension cannot run on. Recording is paused from that point until the tab returns to the project.
- `network.status` is `null` for a request that failed without a response (network error, CORS, abort).
- `count` records how many times an identical console or network step repeated back to back. Repeats are merged into one step instead of being appended.
- A workflow holds at most 300 steps. `message` and `stack` are truncated to 2000 characters each.

**Sent list.** `list` stays filtered by path. A sent workflow appears in the Sent list of the page where its recording started.

**Validation.** The `SentFeedback` validation from v1 spec section 5 is extended: an item with `kind: 'flow'` must carry a well-formed `flow`. Otherwise the response is treated as "unexpected response".

## 4. Architecture

```
 page (main world)         content script              background                review panel
 ┌──────────────┐ postMsg  ┌───────────────┐ message  ┌───────────────────┐ watch ┌───────────────┐
 │ flow-probe   │ ───────▶ │ flow capture  │ ───────▶ │ recording store   │ ◀──── │ Record, Pause │
 │ console, net │          │ DOM events    │          │ storage.session   │       │ Note, Stop,   │
 └──────────────┘          └───────────────┘ ◀─────── │ per tab           │ ◀──── │ review screen │
                                          flow-status └───────────────────┘request└───────────────┘
```

New files:

```
entrypoints/flow-probe.content.ts   main-world script: console, errors, fetch, XHR
lib/flow/types.ts                   Flow, FlowStep, Recording
lib/flow/steps.ts                   appendStep: merging and the step limit (pure)
lib/flow/step-label.ts              human-readable label for a step (pure)
lib/flow/probe-events.ts            normalises probe events into steps (pure)
lib/flow/recording-store.ts         per-tab recording state machine (background)
lib/flow/capture.ts                 DOM event capture (content script)
components/RecordingBadge.tsx       "REC" badge on the page
entrypoints/panel/RecordingBar.tsx  controls and live step list while recording
entrypoints/panel/FlowReview.tsx    review screen after Stop, also used to edit a flow draft
entrypoints/panel/FlowSteps.tsx     step list shared by the bar, the review screen and Sent
```

### 4.1 Units

**`steps`.** `appendStep(steps, step): { steps, limitReached }`.
- An `input` step for the same element as the last step replaces the last step's value and keeps its id. Elements are compared by `anchor.selector`.
- A `console` or `network` step identical to the last step increments `count` instead of being appended. Console steps match on `source` and `message`; network steps match on `method`, `url` and `status`.
- When the list already holds 300 steps, the new step is dropped and `limitReached` is true.

**`step-label`.** `stepLabel(step): { text: string; source?: string }`.
- Elements are named by `aria-label`, then visible text (40 characters), then `anchor.selector`.
- `source` is `anchor.source ?? anchor.nearestSource`.
- Labels are for the UI only and are not sent.

**`probe-events`.** Turns raw probe messages into `console` and `network` steps.
- Error objects and arguments are stringified; `message` and `stack` are truncated.
- A response with status ≥ 400 is a failure; so is a request rejected before a response, with `status: null`.
- Requests to the extension's own origin are ignored.

**`recording-store`.** Holds `Record<tabId, Recording>` in `storage.session`. Writes are serialised through a promise queue, like the panel-state queue in `background.ts`.

```ts
type Recording = {
  tabId: number;
  projectId: string;
  buildId: string;
  startPage: PageRef;
  viewport: Viewport;
  status: 'recording' | 'paused' | 'stopped';
  pausedReason?: 'user' | 'left';
  steps: FlowStep[];
  startedAt: string;
  endedAt?: string;
};
```

Operations: `start`, `append`, `pause`, `resume`, `stop`, `discard`, `get`, `watch`.
- `append` is ignored unless the status is `recording`.
- `stop` sets `endedAt`.
- Saving a stopped recording turns it into a `flow` draft and removes it from the store. The draft is built by `feedback-factory` and written to `draft-store`.

**`capture`.** Active only while the background reports the tab as recording. It listens on `document` in the capture phase:
- `click` → a `click` step.
- `change` on `select` → a `select` step. On a checkbox or radio → a `check` step.
- `input` on text fields and `contenteditable` → an `input` step with the current value. `appendStep` merges the keystrokes.
- `keydown` for Enter, Escape and Tab → a `key` step, with the focused element's anchor when there is one.

It does not stop or alter any event. Events that originate inside the extension's Shadow DOM host or the panel iframe are ignored. Anchors come from `describeElement`.

**`flow-probe`.** A content script with `world: 'MAIN'` and `runAt: 'document_start'`, matching the same pages as the main content script. It wraps:
- `console.error`;
- `window` `error` and `unhandledrejection`;
- `fetch` and `XMLHttpRequest`, to report failed requests.

The wrappers always call through to the originals and never change their results. Events are posted with `window.postMessage` under a fixed message tag. The content script forwards them through `probe-events` only while recording.

### 4.2 Data flow

**Panel → background** (`runtime.sendMessage`, added to `BackgroundRequest`):
- `flow-start` with `tabId`, the page context the panel holds for that tab, and the viewport. The page context gives `projectId`, `buildId` and `startPage`.
- `flow-pause`, `flow-resume`, `flow-stop`, `flow-discard`, each with `tabId`
- `flow-note` with `tabId` and `text`
- `flow-save` with `tabId`, `title`, `expected`, `actual`, `failedStepId` and the edited `steps`

The panel watches `storage.session` directly for the live recording.

**Content → background:**
- `flow-step` carries a step.
- `flow-hello` is sent when the content script starts. It carries the page context and the navigation type from `performance.getEntriesByType('navigation')`. The background replies with whether the tab is recording.

**Background → content:** `flow-status` (`recording | paused | stopped | none`) is sent to the tab when its status changes, so capture starts or stops and the badge updates.

**Navigation:**

| Event | Handling |
|---|---|
| SPA route change (`wxt:locationchange`) | Content sends a `navigate` step with cause `route` |
| New document in the same project | `flow-hello` → background appends `navigate` with cause `load`, `reload` or `history` |
| New document in a different project | `flow-hello` → background appends `left` and pauses with reason `left` |
| Back in the recorded project while paused with reason `left` | `flow-hello` → background resumes and appends `navigate` |
| URL the content script cannot run on | `tabs.onUpdated` with a `url` change and no `flow-hello` → background appends `left` and pauses |
| Tab opened from the recorded tab | `tabs.onCreated` with `openerTabId` equal to the recorded tab → `new-tab` step, URL from `pendingUrl` or the first `tabs.onUpdated` |
| Recorded tab closed | Auto-save as a draft titled "Untitled workflow" |

Steps are stored in the order the background receives them. `at` comes from the sender's clock.

**Known costs:**
- `flow-probe` runs on every page the main content script runs on, recording or not. This is the only way to catch errors raised while a page loads during a recording.
- A page can post forged probe messages. This is accepted, because the page already controls its own console and network.

## 5. User interface

### 5.1 Starting and recording

- The review panel gains a **Record workflow** button next to "Add page comment".
- Starting a recording sets the mode to Off. Select and Text are disabled until the recording is stopped, because both swallow the page's clicks.
- While a recording is active the page shows a small "REC" badge in a corner, inside the extension's Shadow DOM root. The minimised panel bar shows a red dot and the step count.
- The recording bar shows elapsed time, the step count, the error count, **Pause/Resume**, **Note** and **Stop**.
- **Note** opens an inline text field in the panel. Enter inserts a `note` step at that point.
- Below the bar, a live step list follows the newest step.
  - Each row shows the label from `step-label` and its source location.
  - Console steps are red and network steps are orange, with `×count` when merged.
- When paused because the tab left the project, the bar reads "Paused — outside the preview".

### 5.2 Review screen

Opens on Stop, when the step limit is reached, and when a flow draft is clicked.

- **Title** (required), **Expected** and **Actual**.
- The step list. Each row has:
  - **Fails here** flag: at most one step; clicking the flagged step clears it.
  - **Delete**.
  - **Edit**, for `input` values and `note` text.
- Hovering a step that belongs to the open page highlights its element on the page.
- **Save draft** creates or updates the `flow` draft.
- **Discard** asks for confirmation inside the panel (no browser dialog), then deletes the recording.
- Clicking Record on a tab that already has a stopped, unsaved recording reopens its review screen instead of starting a new recording.

### 5.3 Drafts and Sent

- A flow draft is one row: workflow icon, title, step count, error count.
  - It takes part in the existing tick, Send and Export JSON.
  - A draft without a title cannot be ticked and shows "Add a title to send".
- A sent flow is one expandable row, with the existing Resolve and Reopen actions. Expanded, it lists its steps read-only.
  - Each step with an anchor has **Go to**. It navigates the tab to the step's path when needed, then scrolls to and flashes the element.
  - If the element cannot be resolved, the step is labelled "element not found".

## 6. Error handling

| Situation | Behaviour |
|---|---|
| Step limit reached | Recording stops; the review screen opens with "Reached the 300-step limit" |
| Service worker suspended mid-recording | State survives in `storage.session`; the next message wakes the worker and recording continues |
| Browser closed during a recording | The recording is lost (`storage.session` is cleared). Accepted limitation |
| Recorded tab closed while recording or reviewing | Saved as a draft titled "Untitled workflow" |
| Content script cannot run on the new page | Background records `left` from `tabs.onUpdated` |
| Submit fails or returns 401 | Existing behaviour from the v1 spec: drafts kept, Retry shown, token refresh |
| A step's anchor cannot be resolved (hover or Go to) | Labelled "element not found"; nothing else happens |
| Record pressed with a stopped, unsaved recording on the tab | Its review screen reopens |

## 7. Testing

- **Unit (Vitest):**
  - `steps`: input merging, console/network merging, the step limit, notes.
  - `step-label`.
  - `probe-events`.
  - `recording-store`: start, pause, resume, stop, discard; auto-save on tab close; leaving the project pauses and returning resumes.
  - `capture` against a DOM: click, change, input, keydown; ignoring events from the extension's own UI.
  - `feedback-payload` and `HttpFeedbackApi` with a `flow` item.
  - `SentFeedback` validation for `flow`.
- **End-to-end (Playwright):** a new page, `e2e/pages/flow.html`, holds a fake login form, a button whose request returns 500 and a button that throws. The scenario:
  1. Record, fill the form, submit, navigate to `about.html`, add a note.
  2. Stop, flag the failing step, set a title, save the draft.
  3. Send. The workflow appears in Sent with all steps, including the `network` and `navigate` steps.
- **Manual:** the same scenario on a real hash-routed SPA.
