// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";

// Isfar — Astro config.
// Static site (SSG). The whole calculator is one React island hydrated on the
// client; every page is prerendered to static HTML for SEO + offline.
// The /api/flight backend stays a standalone Cloudflare Worker (same origin in
// prod), so it is NOT an Astro endpoint here.
export default defineConfig({
  site: "https://isfar.app",
  trailingSlash: "ignore",
  integrations: [react()],
  build: {
    // Emit index.html at the root (not /index/index.html) so the canonical
    // root URL serves it directly and the SW shell fallback finds it.
    format: "file",
  },
  vite: {
    build: {
      // Deterministic-ish asset names; the SW precache script reads the build
      // manifest, so hashing is fine — we never hand-maintain the hashes.
      assetsInlineLimit: 0,
    },
  },
});
