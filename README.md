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
