import './style.css';
import { createRoot } from 'react-dom/client';
import { createShadowRootUi, defineContentScript } from '#imports';
import { App } from '@/components/App';

export default defineContentScript({
  // Every web page, while REQUIRE_PREVIEW_MARKERS is off. The UI stays idle until the side
  // panel connects.
  matches: ['http://*/*', 'https://*/*'],
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
