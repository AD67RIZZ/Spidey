import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Three.js supplies the renderer and all generated geometry in one cacheable
    // game chunk. Its compressed size stays small enough for this static build.
    chunkSizeWarningLimit: 700,
  },
});
