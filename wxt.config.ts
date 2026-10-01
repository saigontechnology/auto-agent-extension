import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    // Pins the extension ID to halobcdjpokedneejfmdjecjgdkejjdk on every machine. The matching
    // private key is not in the repo; it is only needed to sign a packed .crx.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuBoxdGJlF6kT8KPBPFakT7hrTQTBv2m8CGtHs7zs4d9vTC3fQ2GKvIn6xuYiXvHXTLhWTEf16Vi0wzyHmiZ6Y4reG3Z8ImVE8VWV2Btl6OiuF49GjvhoB2BluN3S8/oyhRct7PnW/ybvMZ/b54tQnXQPG6d5e2rM7ybjuzUzdQbIcN44os52hFTZZKHnUMEXANjyKzyPL4EX71hnBHyYA9RFHd7LG+kuZGcDxGSYcE4LUobfJw0x9WuPco5UdHlIc9Zj83JAXS3BZyuAxcA6tGhqyIlJMFOy0XuQlJ16w/kX4c11eLfcL8F2EnnC+gNJ0DAlLkU089+4M1bLZ2eRfQIDAQAB',
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
