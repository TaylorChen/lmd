import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/markdown-it") || id.includes("node_modules/linkify-it")) {
            return "markdown";
          }
          if (id.includes("node_modules/@uiw")) {
            return "editor-react";
          }
          if (id.includes("node_modules/@codemirror/view")) {
            return "codemirror-view";
          }
          if (id.includes("node_modules/@codemirror/state")) {
            return "codemirror-state";
          }
          if (id.includes("node_modules/@lezer")) {
            return "codemirror-parser";
          }
          if (id.includes("node_modules/@codemirror")) {
            return "codemirror";
          }
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
