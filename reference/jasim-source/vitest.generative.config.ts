import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@contracts": path.join(root, "contracts"),
      "@": path.join(root, "src"),
      "@db": path.join(root, "db"),
    },
  },
  test: { environment: "node" },
});
