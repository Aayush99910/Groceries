import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies /api and /photos to FastAPI, so the frontend code can
// just fetch("/api/...") and never care which port the backend is on.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/photos": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
