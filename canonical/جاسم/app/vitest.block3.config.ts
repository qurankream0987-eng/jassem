import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(import.meta.dirname);

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "@contracts": path.resolve(root, "contracts"),
      "@assets": path.resolve(root, "attached_assets"),
      "@db": path.resolve(root, "db"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/block3/**/*.test.ts"],
    pool: "forks",
    // Serialize DB-backed suites (shared proof database per suite).
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
