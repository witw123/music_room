import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const ignores = [
  "**/node_modules/**",
  "**/.next/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.turbo/**",
  "**/apps/server/src/generated/prisma/**",
  "**/*.tsbuildinfo"
];

export default tseslint.config(
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooksPlugin
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/triple-slash-reference": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "no-unsafe-finally": "off",
      "prefer-const": "off",
      "no-constant-binary-expression": "off",
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-assign-module-variable": "off"
    }
  },
  {
    files: ["apps/web/src/features/playback/use-progressive-runtime.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "react-hooks/exhaustive-deps": "error"
    }
  },
  {
    files: [
      "apps/web/e2e/**/*.{ts,tsx}",
      "apps/web/*.config.{ts,js}",
      "apps/web/postcss.config.js",
      "apps/web/tailwind.config.ts",
      "apps/web/next-env.d.ts"
    ],
    languageOptions: {
      parserOptions: {
        projectService: false
      },
      globals: {
        ...globals.node
      }
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/triple-slash-reference": "off"
    }
  }
);
