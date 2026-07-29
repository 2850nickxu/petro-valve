import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Lightweight, non-type-checked flat config. Keeps lint fast and dependency-light
// (no eslint-config-next / type-aware linting). Tighten as the app grows.
export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // Local `vercel build` output — generated bundles, not source.
      ".vercel/**",
      "next-env.d.ts",
      "coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Node scripts (.mjs) run in Node — declare its globals.
    files: ["scripts/**/*"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
  {
    // Scripts and mocks are pragmatic; relax further.
    files: ["scripts/**/*", "tests/**/*"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-empty": "off",
    },
  },
);
