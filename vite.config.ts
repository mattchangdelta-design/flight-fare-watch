import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Plain client-side SPA: `vite build` emits static files to dist/.
// Deep links (e.g. /app) are served index.html by the host's SPA fallback
// (see vercel.json), and React Router resolves them in the browser.
export default defineConfig({
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
  },
});
