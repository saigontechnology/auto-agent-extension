# Auto Agent

A Chrome extension for leaving feedback on preview builds deployed by the vibe-coding tool.
Open a demo deployed by Auto Agent, pick an element, pin a comment, and send the batch as an Update
Feedback run.

Design: `docs/superpowers/specs/2026-09-30-vibe-feedback-extension-design.md`
Auto Agent integration: `docs/superpowers/specs/2026-10-01-auto-agent-integration-design.md`

## Requirements

- Node 22.12 or newer (`nvm use` reads `.nvmrc`)
- pnpm 10

## Commands

| Command | What it does |
|---|---|
| `pnpm install && pnpm wxt prepare` | Install dependencies and generate WXT types |
| `pnpm dev` | Run the extension in a development browser with hot reload |
| `pnpm test` | Unit tests |
| `pnpm compile` | Type-check |
| `pnpm test:e2e` | Builds with `--mode e2e` (into `.output/chrome-mv3-e2e`, talking to a fake Auto Agent API) and runs the Playwright tests; `e2e/serve.mjs` serves the pages and the fake API on port 4317, which must be free |
| `pnpm build` | Production build in `.output/chrome-mv3` |

To install a build by hand: open `chrome://extensions`, enable Developer mode, choose
"Load unpacked" and select `.output/chrome-mv3`.

## Switches

`lib/config.ts` holds build-time switches:

- `REQUIRE_PREVIEW_MARKERS = false`: it works on any web page. A page without the meta tags
  below uses its host as the project and `local` as the build.
- `WORKFLOW_RECORDING = false`: the **Record workflow** button is hidden, so step 5 below is
  not available for now. Set it to `true` to turn workflow recording back on.
- `API_BASE`: Auto Agent's API, `https://vibe.saigontechnology.vn/api/v1`. A build can point
  elsewhere with `WXT_API_BASE`, as `.env.e2e` does for the end-to-end tests.

## Look and feel

The UI follows Saigon Technology's brand: green `#8dc63f` on warm ink `#1c1917`, set in Barlow
(bundled through `@fontsource/barlow`). The logo files in `public/brand/` and the mark used
for the extension icon in `public/icon/` come from https://saigontechnology.com/. Colours are
defined at the top of `entrypoints/panel/style.css` and `entrypoints/content/style.css`.

## Using it

1. Click **Sign in with Microsoft** in the panel. Your Saigon Technology account must be a
   user in Auto Agent. The panel then looks for the demo deployed at the page's address; if
   none of your demos matches, choose the project and demo yourself. **Change** picks another.
2. Open a preview build and click the extension icon. The review panel opens as a window
   floating over the page, so the page keeps its full width. Drag its title bar to move it,
   fold it down to a small bar with the chevron, and click the icon again to close it.
3. Choose **Select** and click an element to comment on it, or **Text** and click a piece of
   text to rewrite it in place. **Add page comment** records feedback about the whole page.
4. Review the drafts in the panel, untick any you want to hold back, then press **Send**.
   Only ticked drafts are sent, as one Update Feedback run on the demo; the others stay as
   drafts. The panel shows each run's status and links to it in Auto Agent. Sent feedback can
   be resolved and reopened; **Export JSON** saves the ticked drafts as the file Send uploads.
5. To report a problem that takes several steps, press **Record workflow** and use the page
   as usual. Clicks, typing (values are recorded as typed, so use test data), choices, page
   changes, console errors and failed requests are listed live in the panel. **Note** adds a
   remark at that point, **Pause** stops listening, and leaving the preview pauses recording
   until you come back. **Stop** opens the review: give it a title, say what you expected and
   what happened, flag the step where it goes wrong, and remove any stray steps. The workflow
   then waits with your other drafts. Closing the tab while recording keeps the steps as an
   untitled draft, which needs a title before it can be sent.

`Esc` leaves the current mode. In Select mode, `↑` and `↓` move to the parent or first child.

## What the tool must inject into a preview build

```html
<meta name="vibe:project-id" content="proj_123">
<meta name="vibe:build-id" content="build_456">
<button data-vibe-source="src/pages/Home.tsx:42">Buy</button>
```

With `REQUIRE_PREVIEW_MARKERS` on, a page without both meta tags is treated as "not a preview
build". With it off, the host and `local` stand in for the missing values.

## Auto Agent

- Sign-in uses Auto Agent's browser-extension flow, so the extension id must be in the
  server's `BROWSER_EXTENSION_IDS`. The `key` in `wxt.config.ts` pins the id to
  `halobcdjpokedneejfmdjecjgdkejjdk` on every machine; do not change it.
- `lib/api/auto-agent-client.ts` is the only file that knows Auto Agent's URLs and response
  shapes.
- Auto Agent's download page asks the installed extension for its version through
  `externally_connectable`; the background answers `{ type: "ping" }`.
- To publish a release: bump `version` in `package.json`, run `pnpm zip`, and upload the zip
  in Auto Agent under **System Settings → Browser Extension**.
