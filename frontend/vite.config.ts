import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite config. The dev server proxies /api -> the backend so the SPA never
// needs an absolute API URL in dev; in prod VITE_API_BASE_URL points at the API.
// Port defaults to 4221 (the CORS allow-list origin) but honors PORT when a
// launcher assigns one, so it never fights tooling for a busy port.
// Tailwind v4 runs through its first-party Vite plugin (no PostCSS config file).
const DEV_PORT = process.env.PORT ? Number(process.env.PORT) : 4221;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: DEV_PORT,
    proxy: {
      "/api": {
        target: "http://localhost:4222",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
