import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  output: 'static',
  integrations: [preact({ compat: false }), tailwind()],
  vite: {
    resolve: {
      alias: {
        '@olympian/api': fileURLToPath(new URL('../api/src', import.meta.url)),
      },
    },
    server: {
      proxy: {
        '/jobs': 'http://localhost:3030',
        '/stream': 'http://localhost:3030',
      },
    },
  },
});
