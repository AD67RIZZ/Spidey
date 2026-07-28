import { defineConfig } from "vite";

export default defineConfig({
  plugins: [],

  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
  },
});
