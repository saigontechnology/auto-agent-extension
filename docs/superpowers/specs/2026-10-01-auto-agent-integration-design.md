# Auto Agent Integration — Design Spec

Date: 2026-10-01
Status: approved 2026-10-01
Builds on: `2026-09-30-vibe-feedback-extension-design.md` (the "v1 spec") and `2026-10-01-workflow-recording-design.md`
Source contract: `BROWSER_EXTENSION_INTEGRATION.md` from the Auto Agent team (the "integration guide"), plus responses read from the live API on 2026-10-01

## 1. Purpose

Until now the extension has run in a local-only testing mode: drafts are "sent" to a mock API, and the only way to get feedback to the tool is **Export JSON** followed by a manual upload in the Auto Agent web app. The feedback API proposed in the v1 spec (`POST /projects/{id}/feedback`) does not exist.

This change connects the extension to Auto Agent (`https://vibe.saigontechnology.vn`):

- Staff sign in with their company Microsoft account through Auto Agent's browser-extension sign-in.
- The extension works out which finished demo job the open preview belongs to.
- **Send** starts an Update Feedback run on that demo job, which applies the feedback and redeploys the same site.
- The panel shows the status of every feedback run on that demo, the reviewer's own and their teammates'.

**Success looks like:** a reviewer opens a deployed demo, signs in once, pins comments and presses Send; an Update Feedback run starts on the right demo job without any manual upload, and the panel shows when it is running, waiting for approval, finished or failed.

## 2. Decisions

| Topic | Decision |
|---|---|
| Sign-in | Integration guide §3: `chrome.identity.launchWebAuthFlow` on `/auth/login?cli_redirect=&cli_state=`, run in the background worker. Silent attempt first, interactive on failure |
| Sign-in gate | The panel is usable only when signed in. Signed out, it shows only **Sign in with Microsoft** |
| Finding the demo job | Match the page's origin against `deploymentUrl` of the reviewer's successful demo jobs. When nothing matches, the reviewer picks Project → Demo job; the choice is remembered per origin |
| Send format | `description` is a Markdown summary of the drafts (at most 10,000 characters); the full payload (today's Export JSON body) is uploaded as one `.json` feedback file |
| After Send | Each Send is a run. The panel polls the demo job's `feedbackHistory` while it is open and a run is unfinished, and links to the run in Auto Agent |
| Removed | `LOCAL_ONLY`, the mock API, the OAuth/PKCE code, the API and OAuth settings form in Options, and `docs/tool-api-requirements.md` |
| API base | Fixed to `https://vibe.saigontechnology.vn/api/v1`, overridable at build time with `WXT_API_BASE` for end-to-end tests |
| Version ping | Answer `{ type: "ping" }` from the Auto Agent download page (integration guide §5) |

### Out of scope

Choosing a workflow type other than Update Feedback, attaching extra user files to a Send, following a run's individual steps (`/jobs/:id/steps`), resolving feedback on the server, publishing releases from the extension, and anything for admins only.

### Prerequisite outside this repo

The extension ID `halobcdjpokedneejfmdjecjgdkejjdk` (fixed by the `key` in `wxt.config.ts`) must be in the server's `BROWSER_EXTENSION_IDS`. Done on the production server as of 2026-10-01. If the ID or the `key` ever changes, the sign-in window ends on the Auto Agent web app instead of returning tokens.

## 3. Contract with Auto Agent

All responses use one envelope:

```ts
type Envelope<T> = {
  data: T;
  message: string;
  error: string | null; // e.g. "UNAUTHORIZED"
  pagination: { total: number; page: number; itemPerPage: number } | null;
};
```

### 3.1 Sign-in

`GET {API_BASE}/auth/login?cli_redirect=<chrome.identity.getRedirectURL("auth")>&cli_state=<uuid>`, opened through `launchWebAuthFlow`. The browser intercepts the final redirect:

```
https://halobcdjpokedneejfmdjecjgdkejjdk.chromiumapp.org/auth?token=…&refreshToken=…&user=<json>&state=<uuid>
```

- `token`: access JWT, valid 15 minutes. Its `exp` claim gives the expiry.
- `refreshToken`: valid 7 days.
- `user`: `{ id, username, displayName, role, allowedServices }`.
- `state` must equal the `cli_state` sent, otherwise the response is rejected.

Refresh: `POST {API_BASE}/auth/refresh` with `{ "refreshToken": "…" }` returns `data: { accessToken, refreshToken }`. Both are stored. A `401` ends the session.

Sign-out removes the stored session. The server keeps no session to revoke.

### 3.2 Calls used

| Call | Used for | Shape read by the extension |
|---|---|---|
| `GET /projects?page=&itemPerPage=100` | Matching and the picker | `data: Array<{ id, name, stage }>`, `pagination.total` |
| `GET /jobs?projectId=&status=SUCCESS&page=&itemPerPage=100` | Matching and the picker | `data: Array<{ id, serviceType, status, jobName, projectName, completedAt }>`. The list has **no** `deploymentUrl` |
| `GET /jobs/:id` | `deploymentUrl` of a candidate, and status of runs | `data: { id, serviceType, status, jobName, deploymentUrl, project: { id, name }, feedbackHistory }` |
| `POST /files/upload?serviceType=DEMO_FEEDBACK` | The JSON payload file | `multipart/form-data`, field `files`; `data: Array<{ id }>` |
| `POST /jobs/:id/feedback` | Starting a run | Body `{ description, fileIds }`; `data: { id, status, requiresApproval? }` |

`feedbackHistory` entries, as returned on a demo job:

```ts
type FeedbackRun = {
  id: string;             // the run's own job id
  status: string;         // e.g. "SUCCESS", "FAILED"; other values shown as given
  createdAt: string;
  completedAt: string | null;
  feedbackDescription: string | null;
  feedbackFiles: string[]; // original file names
  createdBy: string;       // username
};
```

Facts observed on the live API that the design depends on:

- Only successful jobs of `FRONTEND_DEMO`, `FRONTEND_DEMO_NEXT_PHASE`, `MOBILE_DEMO` and `MOBILE_DEMO_NEXT_PHASE` accept feedback.
- A `DEMO_FEEDBACK` run has the **same** `deploymentUrl` as its demo job and points back to it through `configData.parentJobId`. Matching therefore considers demo jobs only, never runs.
- `deploymentUrl` is a Firebase Hosting URL such as `https://test-browseros-portal-admin.web.app`. Firebase serves the same site on `<site>.firebaseapp.com`.

### 3.3 Version ping

```jsonc
"externally_connectable": { "matches": ["https://vibe.saigontechnology.vn/*", "http://localhost:5173/*"] }
```

`runtime.onMessageExternal` answers `{ type: "ping" }` with `{ installed: true, version }` and ignores anything else.

## 4. Architecture

### 4.1 Units

| Unit | Responsibility | Depends on |
|---|---|---|
| `lib/config.ts` | `API_BASE` (from `import.meta.env.WXT_API_BASE`, default production), `REQUIRE_PREVIEW_MARKERS`, `WORKFLOW_RECORDING`. `LOCAL_ONLY` is removed | — |
| `lib/auth/session.ts` | `signIn(deps)`, `signOut()`, `getSession()`, `watchSession()`, `getAccessToken(deps, { forceRefresh })`. Parses the sign-in redirect, reads `exp` from the JWT, refreshes 60 s before expiry, shares one refresh between concurrent callers, signs out when refresh returns 401. Session stored in `local:session` as `{ accessToken, refreshToken, expiresAt, user }` | `launchWebAuthFlow`, `fetch`, clock (injected) |
| `lib/api/auto-agent-client.ts` | The only code that knows URLs and the envelope: `listProjects`, `listJobs`, `getJob`, `uploadFeedbackFile`, `createFeedbackRun`. Adds the bearer token, retries once after a 401 with a forced refresh, signs out after a second 401, turns an error envelope into `ApiError(message, status)`, and checks the fields it returns | `session`, `fetch` |
| `lib/api/job-matcher.ts` | Pure functions: `normalizeOrigin(url)` (lower-case origin, `.firebaseapp.com` → `.web.app`), `isDemoJob(job)`, `pickMatch(origin, candidates)` (newest `completedAt` wins) | — |
| `lib/api/job-resolver.ts` | `resolveJob(origin)`: cache in `local:job-matches` (`origin → JobMatch`), then a scan on a miss; `chooseJob(origin, match)`; `forgetJob(origin)`. The scan pages through projects, lists each project's successful jobs, keeps demo jobs, and fetches their details with at most 4 requests in flight. Detail fetches already made are cached in `local:job-urls` (`jobId → deploymentUrl`) so a later scan only fetches new jobs | client, matcher |
| `lib/api/feedback-markdown.ts` | `feedbackMarkdown(items, page)`: one section per draft (kind, page path, element tag/text, `source` or `nearestSource`, comment, text edit before → after, workflow title/expected/actual/steps). Over 10,000 characters it truncates at a section boundary and ends with "Truncated: the attached JSON file has all N items" | `flow/step-label` |
| `lib/background-handlers.ts` | Handles the requests in 4.2 | the units above, stores |
| `lib/feedback-store.ts` | Unchanged API. `SentFeedback` gains an optional `run: { jobId, demoJobId, sentAt, requiresApproval }` so the panel can group items by run; items sent before this change have none | — |
| `entrypoints/background.ts` | Wires dependencies, adds the external `ping` listener | — |
| `entrypoints/panel/*` | Sign-in screen, account header, demo-job line and picker, Sent grouped by run with status | background client |
| `entrypoints/options/App.tsx` | Shows the signed-in account and **Sign out**, or a note to sign in from the panel | session |

Removed: `lib/auth/oauth.ts`, `lib/auth/pkce.ts` and their tests, `lib/api/mock-feedback-api.ts`, `lib/api/http-feedback-api.ts` and their tests, `lib/settings-store.ts` and its test, the `Settings`/`OAuthSettings` types, `docs/tool-api-requirements.md`. `lib/api/feedback-payload.ts` stays: it builds the uploaded JSON file and the Export JSON download.

### 4.2 Background requests

```ts
type JobMatch = {
  projectId: string; projectName: string;
  jobId: string; jobName: string; serviceType: string; completedAt: string | null;
};

type BackgroundRequest =
  | { type: 'auth-state' }                                  // → { signedIn: boolean; user?: User }
  | { type: 'sign-in' }                                     // → AuthState
  | { type: 'sign-out' }                                    // → AuthState
  | { type: 'resolve-job'; url: string }                    // → JobMatch | null
  | { type: 'choose-job'; url: string; match: JobMatch }    // → JobMatch
  | { type: 'list-projects' }                               // → Project[]
  | { type: 'list-demo-jobs'; project: Project }            // → JobMatch[]
  | { type: 'job-runs'; url: string }                       // → FeedbackRun[] for the page's matched demo job
  | { type: 'submit'; projectId: string; url: string; ids: string[] } // → SentFeedback[]
  | /* flow-* requests, unchanged */;
```

`url` is the page's URL; the background normalises it to an origin. `projectId` in `submit` is still the drafts' storage key from the page context (the host when the page has no `vibe:project-id` meta tag). It is unrelated to the Auto Agent project id.

A new error code, `forbidden`, is returned for 403/404 on a job, next to `unauthorized`, `not-configured` (now: no demo job chosen) and `failed`.

### 4.3 Data flow

**Sign-in.** The panel sends `sign-in`. The background runs the silent flow, then the interactive one if the silent one fails, stores the session and replies. The panel also watches `local:session`, so a sign-out caused elsewhere (a failed refresh, Options) takes it back to the sign-in screen.

**Resolving the demo job.** Once signed in and connected to a page, the panel sends `resolve-job` with the page's origin.

1. A cached match is returned at once.
2. Otherwise the scan runs. One match → cached and returned. Several → the newest by `completedAt`. None → `null`.
3. On `null` the panel shows the picker: projects from `list-projects`, then that project's demo jobs from `list-demo-jobs` (newest first, labelled `jobName · serviceType · completed date`). Choosing one sends `choose-job`, which caches it for the origin.
4. The demo line has a **Change** button that reopens the picker.

**Send.** The panel sends `submit` with the ticked draft ids.

1. Look up the cached match for the origin. None → `not-configured`.
2. Build the payload with `feedbackPayload(drafts, clientInfo())` and upload it as `auto-agent-feedback-<host>-<timestamp>.json`.
3. `POST /jobs/:demoJobId/feedback` with `description: feedbackMarkdown(drafts)` and the returned file id.
4. Save the drafts as `SentFeedback` with `author: { id: user.id, name: user.displayName }`, `status: 'open'` and `run: { jobId: <run id>, demoJobId, sentAt, requiresApproval }`.
5. Remove the sent drafts.

A failure at any step leaves the drafts in place. A file uploaded before a failed step 3 stays orphaned on the server, which is harmless. The panel disables Send while a submit is in flight, so a double click cannot start two runs.

**Run status.** The panel sends `job-runs` for the matched demo job when it opens, then every 10 seconds while the panel is visible and any run is unfinished (`SUCCESS`, `FAILED` and `CANCELLED` count as finished). Runs are matched to local `SentFeedback` by `run.jobId`.

## 5. User interface

**Signed out.** The brand header and a single **Sign in with Microsoft** button, with any sign-in error below it.

**Header, signed in.** The user's display name and a **Sign out** button. The Mock tag and the Options button are removed from the header.

**Demo line.** Above the toolbar: `Demo: <project name> · <job name>` with **Change**. While resolving: "Finding this demo in Auto Agent…". With no match: the picker inline, with a note "This page did not match any of your demos. Choose one:". Until a demo is chosen, Send is disabled; drafts can still be created.

**Sent.** Grouped by run, newest first. Each group's heading shows the send time, a status chip (Waiting for approval / Running / Done / Failed, or the raw status), and **Open in Auto Agent** (`https://vibe.saigontechnology.vn/jobs/<run id>`). The items below keep today's rows, pins, Go to, and the local resolve/reopen. Runs on the same demo by other people, or sent from another browser, appear as a one-line group "by <createdBy>" with the same chip and link, and no items.

**Options.** Logo, "Signed in as <displayName> (<username>)" and **Sign out**, or "Not signed in. Open the Auto Agent panel on a page to sign in."

## 6. Error handling

| Situation | Behaviour |
|---|---|
| Reviewer closes the sign-in window | "Sign-in was cancelled." |
| Returned `state` differs | "Sign-in response did not match the request. Try again." |
| Sign-in window ends on the Auto Agent web app | Indistinguishable from a cancel. The cancel message adds: "If the window showed the Auto Agent site, this extension is not allowed yet; ask the Auto Agent team to add its ID." |
| 401 after a forced refresh, or refresh returns 401 | Session cleared; the panel shows the sign-in screen with "Your session ended. Sign in again." |
| 403 or 404 on a job call | The cached match for that origin is forgotten; "You no longer have access to this demo." and the picker |
| Other non-2xx | The envelope's `message`, shown as is (for example "Feedback updates require a successfully completed job") |
| Network failure | "Could not reach Auto Agent. Check your connection." |
| Response missing a field the extension reads | "Auto Agent sent an unexpected response." |

Tokens are stored only in `chrome.storage.local`, sent only to the `API_BASE` host, and never logged or passed to content scripts.

## 7. Testing

**Unit (vitest).**
- `session`: parses a valid redirect; rejects a wrong `state` and a missing token; computes `expiresAt` from `exp`; concurrent `getAccessToken` calls share one refresh; refresh 401 clears the session.
- `auto-agent-client`: unwraps the envelope; retries once on 401; signs out on a second 401; maps error envelopes and network failures; rejects malformed data.
- `job-matcher`: origin normalisation and the `firebaseapp.com` alias; demo types and `SUCCESS` only; newest wins.
- `job-resolver`: cache hit makes no request; scan with pagination; detail cache avoids refetching; at most 4 detail requests in flight; `forgetJob`.
- `feedback-markdown`: each kind; source vs nearest source; truncation at 10,000 characters with the note.
- `background-handlers`: submit uploads, creates the run, saves and removes in that order; any failure keeps the drafts; no match gives `not-configured`; 403 forgets the match.

**End to end (Playwright).**
- `pnpm test:e2e` builds with `WXT_API_BASE=http://localhost:4173/api/v1`. `e2e/serve.mjs` gains a fake Auto Agent API with in-memory projects and jobs. One job's `deploymentUrl` is the test server's origin, so matching succeeds without a picker.
- The fake `/auth/login` redirects straight to the `cli_redirect` with a test token and the received `state`, which exercises the real sign-in flow. If Playwright cannot complete `launchWebAuthFlow`, the sign-in test is dropped and a fixture seeds `local:session` through the service worker instead.
- Existing panel, review and flow tests run signed in.
- New tests: sign in and sign out; Send creates a run and the Sent group shows its status; the picker appears when nothing matches and the choice persists.

**Manual, against production.** After the ID is allowlisted: sign in, open a demo deployed by Auto Agent, send one comment, and check that the run appears in the Auto Agent web app with the Markdown description and the JSON file attached.
