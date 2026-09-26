import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  // Type-checked rules (issue #245): `parserOptions.project` was already
  // declared but only the untyped `recommended` set ran on it. What the typed
  // set catches that the untyped one cannot: a promise that is never awaited
  // (`no-floating-promises`), a promise handed to a void callback
  // (`no-misused-promises` — the `createServer` bug of #237), `async` with no
  // `await`, an assertion that changes nothing, a `switch` on a union with a
  // missing case.
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: "tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `ignoreRestSiblings`: `const { signal: _omitted, ...rest } = store` is the
      // idiom for dropping a key without writing `undefined` under it
      // (exactOptionalPropertyTypes, issue #289).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      // `AbortSignal.reason` is `any` by lib definition, and it is what the
      // rate limiter / backoff / request context reject with on cancellation.
      "@typescript-eslint/prefer-promise-reject-errors": [
        "error",
        { allowThrowingAny: true, allowThrowingUnknown: true },
      ],
      // Rendering JSON:API attribute bags (`Record<string, unknown>`) is the
      // formatters' whole job — every `${attrs.title}` in `format/summary.ts`
      // trips these two, and objects are already routed through
      // `renderAttributeValue()`. Off on purpose, not per line.
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Tests mock at the module boundary (`vi.mocked(server.registerTool)`,
    // `as never`, untyped payloads); the type-safety rules would flag ~700
    // sites there for no defect. The bug-class rules above stay on.
    files: ["**/*.test.ts", "src/tools/test-helpers.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
  {
    ignores: ["dist/", "node_modules/", "*.config.js", "coverage/"],
  }
);
