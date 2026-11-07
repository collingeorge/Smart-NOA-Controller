import js from "@eslint/js";
import globals from "globals";
export default [
  js.configs.recommended,
  { files: ["**/*.js", "**/*.mjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.browser, ...globals.node } },
    rules: {
      "no-unused-vars": ["error", { args: "after-used", argsIgnorePattern: "^_", caughtErrors: "all", caughtErrorsIgnorePattern: "^_" }],
      "eqeqeq": ["error", "always", { null: "ignore" }],
      "no-implicit-globals": "error", "no-eval": "error", "no-implied-eval": "error", "no-new-func": "error",
      "no-script-url": "error", "no-shadow": "error", "no-use-before-define": ["error", { functions: false }],
      "no-unsafe-optional-chaining": "error", "no-constant-binary-expression": "error", "no-self-compare": "error",
      "no-unmodified-loop-condition": "error", "no-unreachable-loop": "error", "no-promise-executor-return": "error",
      "no-template-curly-in-string": "error", "array-callback-return": "error", "default-case-last": "error",
      "no-fallthrough": "error", "no-param-reassign": "off", "prefer-const": "error", "no-var": "error",
      "no-console": "off"
    } },
  // UI: never use the native el.append()/replaceChildren(): they render null/undefined as text.
  // Use add()/fill() from ui/dom.js, which skip null children (05l final review).
  { files: ["ui/**/*.js"], ignores: ["ui/dom.js"],
    rules: { "no-restricted-syntax": ["error",
      { selector: "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(append|prepend|replaceChildren)$/]",
        message: "Use add()/fill() from ui/dom.js: the native method renders null/undefined as text." }] } } ];
