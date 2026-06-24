import { defineConfig } from "vitest/config";

// Vitest setup for Business Book. jsdom gives the storage/* modules a localStorage and the
// lib/* modules a window; globals: true exposes describe/it/expect without per-file imports.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    clearMocks: true,
    restoreMocks: true,
  },
});
