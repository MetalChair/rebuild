import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, `npm run dev` proxies API and media requests to a running
// `dietpro serve` (default 127.0.0.1:7465).
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:7465",
      "/media": "http://127.0.0.1:7465",
    },
  },
});
