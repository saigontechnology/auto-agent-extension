# Auto Agent

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
| `pnpm demo` | Build, then open Chromium with the extension loaded and the sample page open |
| `pnpm fixture` | Serve the sample preview at http://localhost:4173/ |
| `pnpm test` | Unit tests |
| `pnpm compile` | Type-check |
| `pnpm test:e2e` | Build, then run the Playwright tests against the built extension |
| `pnpm build` | Production build in `.output/chrome-mv3` |

To install a build by hand: open `chrome://extensions`, enable Developer mode, choose
"Load unpacked" and select `.output/chrome-mv3`.

## Testing mode

The extension currently runs in a testing mode set in `lib/config.ts`:

- `REQUIRE_PREVIEW_MARKERS = false`: it works on any web page. A page without the meta tags
  below uses its host as the project and `local` as the build.
- `LOCAL_ONLY = true`: feedback is stored in this browser only. There is no sign-in, and the
  API settings are hidden.

`pnpm demo` opens a Chromium window with the extension loaded and the sample page open.

## Look and feel

The UI follows Saigon Technology's brand: green `#8dc63f` on warm ink `#1c1917`, set in Barlow
(bundled through `@fontsource/barlow`). The logo files in `public/brand/` and the mark used
for the extension icon in `public/icon/` come from https://saigontechnology.com/. Colours are
defined at the top of `entrypoints/sidepanel/style.css` and `entrypoints/content/style.css`.

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

With `REQUIRE_PREVIEW_MARKERS` on, a page without both meta tags is treated as "not a preview
build". With it off, the host and `local` stand in for the missing values.

## Connecting the real API

First set `LOCAL_ONLY` to `false` in `lib/config.ts`. The extension then starts in mock mode:
feedback is still stored in the browser until mock is turned off in Options.

- `lib/api/http-feedback-api.ts` is the only file that knows the API's URLs and payload.
  Change it when the real contract differs from the proposal in the design spec.
- Turn mock off on the Options page and fill in the API base URL and the OAuth settings.
  The page shows the redirect URI to register with the tool.
- The redirect URI contains the extension id. An unpacked extension's id depends on its
  folder path, so add a fixed `key` to the manifest in `wxt.config.ts` before sharing the
  extension with the team.
