import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // PGlite integration tests apply the real migrations per test, which is slow
  // on cold CI runners — the default 5s timeout flakes. Give DB tests headroom.
  test: { environment: "node", testTimeout: 30000, hookTimeout: 30000 },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
