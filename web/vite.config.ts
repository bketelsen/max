import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/message": "http://127.0.0.1:7777",
      "/stream": "http://127.0.0.1:7777",
      "/cancel": "http://127.0.0.1:7777",
      "/auth": "http://127.0.0.1:7777",
      "/status": "http://127.0.0.1:7777",
      "/agents": "http://127.0.0.1:7777",
      "/history": "http://127.0.0.1:7777",
      "/model": "http://127.0.0.1:7777",
      "/models": "http://127.0.0.1:7777",
      "/auto": "http://127.0.0.1:7777",
      "/memory": "http://127.0.0.1:7777",
      "/skills": "http://127.0.0.1:7777",
    },
  },
});
