import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve("src/main/index.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve("src/preload/index.ts") } },
  },
  renderer: {
    resolve: { alias: { "@": resolve("src/renderer/src") } },
    plugins: [react(), tailwindcss()],
    root: resolve("src/renderer"),
    build: { rollupOptions: { input: resolve("src/renderer/index.html") } },
  },
});
