import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Static (SSG) output. The calculator is a client:only island, so nothing is
// server-rendered beyond the static shell in index.astro.
export default defineConfig({
  site: 'https://isfar.app',
  output: 'static',
  integrations: [react()],
  build: { assets: '_assets' },
});
