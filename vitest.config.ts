import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Quiet the Pino request logger during tests (§9.2 debug-only noise).
    // SCOUT_WORKER_SECRET is set so the guarded internal scout-processor trigger
    // (§5.4) has a known secret to exercise its authorized + rejected paths.
    env: { LOG_LEVEL: "silent", SCOUT_WORKER_SECRET: "test-scout-worker-secret" },
    // Integration tests share one DB; run files serially to avoid cross-talk.
    fileParallelism: false,
    globalSetup: ["./src/test/globalSetup.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
