import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { PWA_MANIFEST } from "./src/lib/pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      filename: "sw.js",
      injectRegister: false,
      manifest: PWA_MANIFEST,
      manifestFilename: "site.webmanifest",
      registerType: "prompt",
      includeAssets: [
        "icons/atreides-hawk-icon.svg",
        "icons/icon-16.png",
        "icons/favicon-32.png",
        "icons/apple-touch-icon-180.png",
        "icons/icon-192.png",
        "icons/icon-192-maskable.png",
        "icons/icon-512.png",
        "icons/icon-512-maskable.png",
      ],
      workbox: {
        globPatterns: ["**/*.{css,html,ico,js,png,svg,woff2}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [
          /^\/(?:auth(?:\/.*)?|stream|message|cancel|status|agents|sessions|model|models|auto|history|memory|skills|restart)(?:\/.*)?$/,
        ],
        runtimeCaching: [
          {
            handler: "NetworkOnly",
            method: "GET",
            urlPattern: /^\/(?:auth(?:\/.*)?|stream|status|agents|sessions|model|models|auto|history|memory|skills|restart)(?:\/.*)?$/,
          },
          {
            handler: "NetworkOnly",
            method: "POST",
            urlPattern: /^\/(?:auth(?:\/.*)?|message|cancel|model|auto|restart)(?:\/.*)?$/,
          },
        ],
      },
    }),
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
