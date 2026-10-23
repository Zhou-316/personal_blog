import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "BLOG_");
  const target = env.BLOG_DEV_API_TARGET || "http://127.0.0.1:8000";
  const proxy = { "/api": { target, changeOrigin: true }, "/uploads": { target, changeOrigin: true } };
  return {
    plugins: [react()],
    server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy },
    preview: { host: "127.0.0.1", strictPort: true, proxy }
  };
});
