import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const backendTarget = process.env.LOCAL_BACKEND_URL || "http://localhost:8000";
const devPort = Number(process.env.VITE_DEV_PORT || 8080);

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: devPort,
    strictPort: true,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/functions/v1/run-warehouse-sql": {
        target: backendTarget,
        changeOrigin: true,
      },
      "/functions/v1/test-warehouse-connectivity": {
        target: backendTarget,
        changeOrigin: true,
      },
      "/functions/v1/agent-orchestrate": {
        target: backendTarget,
        changeOrigin: true,
      },
      "/functions/v1/playwright-runtime": {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
