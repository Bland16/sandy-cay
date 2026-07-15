/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from /<repo>/ — see SPEC.md §12.
export default defineConfig({
  base: '/sandy-cay/',
  plugins: [react()],
  test: {
    // src/core is pure JS with zero DOM imports (SPEC §12), so the engine
    // suite runs headless in the node environment.
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
  },
});
