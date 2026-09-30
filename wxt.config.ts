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
