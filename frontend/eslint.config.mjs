import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { domainBoundariesRule } from "./eslint-rules/domain-boundaries.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "blob-report/**",
    "test-results/**",
    "e2e/__snapshots__/**",
    "src/generated/**",
  ]),
  {
    // Playwright's fixture API names its callback `use`, which confuses
    // `react-hooks/rules-of-hooks` (it thinks we're calling React's `use()`).
    files: ["e2e/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    plugins: {
      agenticpay: {
        rules: {
          "domain-boundaries": domainBoundariesRule,
        },
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react/no-unescaped-entities": "warn",
      "prefer-const": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "agenticpay/domain-boundaries": "error",
      "@typescript-eslint/ban-ts-comment": ["error", {
        "ts-expect-error": "allow-with-description",
        "ts-ignore": "allow-with-description",
        "ts-nocheck": false
      }],
    },
  },
]);

export default eslintConfig;
