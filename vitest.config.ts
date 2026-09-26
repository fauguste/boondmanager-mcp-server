import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/tools/test-helpers.ts"],
      // Global thresholds alone hid the holes (issue #245): 92 % of lines
      // overall with `tab-tools.ts` at 50 % and `projects.ts` at 55 %, because
      // their suites asserted the registration and never ran a handler. Each
      // folder now has its own floor, and `perFile` sets the minimum a single
      // file may drop to before the run fails — the number that actually
      // names the untested domain.
      thresholds: {
        lines: 92,
        functions: 90,
        branches: 80,
        statements: 90,
        perFile: { lines: 80, functions: 65, branches: 55, statements: 80 },
        "src/tools/**": { lines: 92, functions: 90, branches: 75, statements: 90 },
        "src/services/**": { lines: 92, functions: 90, branches: 80, statements: 90 },
        "src/transports/**": { lines: 92, functions: 92, branches: 82, statements: 92 },
      },
    },
  },
});
