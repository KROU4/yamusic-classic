import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// In dev mode /api is proxied to the local backend (scripts/dev.js sets YMC_API)
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
