import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// В dev-режиме /api проксируется на локальный бэкенд (scripts/dev.js выставляет YMC_API)
export default defineConfig({
  plugins: [preact()],
  base: "./",
  build: { outDir: "dist", target: "chrome130", sourcemap: false, chunkSizeWarningLimit: 300 },
  server: {
    port: 5173,
    strictPort: true,
    proxy: process.env.YMC_API ? { "/api": { target: process.env.YMC_API, changeOrigin: true } } : undefined,
  },
  test: { environment: "node", include: ["test/**/*.test.js"] },
});
