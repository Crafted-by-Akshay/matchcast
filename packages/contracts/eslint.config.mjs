import tseslint from "typescript-eslint";
import globals from "globals";

export default [
  { ignores: ["**/dist/**", "**/generated.ts"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: globals.node },
    rules: { "no-unused-vars": "error", "no-undef": "error" },
  },
];
