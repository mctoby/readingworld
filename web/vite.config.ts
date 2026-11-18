import { defineConfig } from "vite";

// Relative base so the build works from any folder on a web server (e.g. itch.io or a sub-path).
export default defineConfig({
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  server: { host: true },
});
