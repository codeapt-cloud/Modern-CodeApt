import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API base is same-origin in dev via the proxy below, so the SPA can call
// `/api/*` without CORS. Override with VITE_API_URL for split deployments.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
