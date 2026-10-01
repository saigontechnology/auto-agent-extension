import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Auto Agent',
    description: 'Pin feedback on preview builds and send it to the vibe-coding tool.',
    permissions: ['storage', 'identity'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_title: 'Auto Agent' },
  },
  webExt: {
    startUrls: ['http://localhost:4173/'],
  },
});
