import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".beads/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**"
    ]
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          "fixStyle": "inline-type-imports"
        }
      ]
    }
  }
);
