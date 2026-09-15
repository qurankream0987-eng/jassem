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
    include: ["tests/block2/**/*.test.ts"],
    pool: "forks",
    // Vitest 4 removed singleFork; serialize DB-backed suites instead.
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});