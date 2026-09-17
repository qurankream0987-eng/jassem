import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'plugin-inspect-react-code'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // Server-owned routes must reach the Hono app in development exactly as
    // they do in production. `/api/*` was the only exception before, which
    // meant `/health` fell through to the SPA and answered 200 with HTML —
    // a readiness probe that could never report "not ready". Anything the
    // server owns outside `/api/` has to be listed here too.
    devServer({
      entry: "api/boot.ts",
      exclude: [/^\/(?!api\/|health$).*$/],
    }),
    inspectAttr(), react()],
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 3000,
    allowedHosts: true,
    // The generated artifact store can contain many files; polling avoids
    // exhausting the container's inotify watcher limit during previews.
    watch: {
      usePolling: true,
      interval: 250,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
