import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// In dev mode /api is proxied to the local backend (scripts/dev.js sets YMC_API)
export default defineConfig({
  plugins: [preact()],
  // the version for Settings and bug reports; the release workflow sets package.json from the tag before building
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: "./",
  build: { outDir: "dist", target: "chrome130", sourcemap: false, chunkSizeWarningLimit: 300 },
  server: {
    port: 5173,
    strictPort: true,
    proxy: process.env.YMC_API ? { "/api": { target: process.env.YMC_API, changeOrigin: true } } : undefined,
  },
  test: { environment: "node", include: ["test/**/*.test.js"] },
});
