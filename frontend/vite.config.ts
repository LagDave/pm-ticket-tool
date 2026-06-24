import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite config. The dev server proxies /api -> the backend so the SPA never
// needs an absolute API URL in dev; in prod VITE_API_BASE_URL points at the API.
// Port defaults to 5173 (the CORS allow-list origin) but honors PORT when a
// launcher assigns one, so it never fights tooling for a busy port.
const DEV_PORT = process.env.PORT ? Number(process.env.PORT) : 5173;

export default defineConfig({
  plugins: [react()],
  server: {
    port: DEV_PORT,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
