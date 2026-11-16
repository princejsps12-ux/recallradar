// One ESLint setup for the whole repository. The rules are the recommended set plus the React hooks rules for the UI;
// nothing is style (there is no formatter war here), only things that are bugs or dead code.
module.exports = {
  root: true,
  env: { es2022: true, node: true },
  parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
  extends: ['eslint:recommended'],
  rules: {
    // Unused arguments and caught errors are normal in handlers and in `catch (error) {}` blocks that deliberately ignore it.
    'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
  overrides: [
    {
      files: ['static/ui/src/**/*.js'],
      env: { browser: true },
      parserOptions: { ecmaFeatures: { jsx: true } },
      plugins: ['react', 'react-hooks'],
      // The two react/* rules only teach ESLint that JSX uses the components it mentions (so they are not "unused").
      rules: { 'react/jsx-uses-vars': 'error', 'react/jsx-uses-react': 'error', 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
    },
    { files: ['**/*.cjs'], parserOptions: { sourceType: 'script' }, env: { node: true, browser: true } },
    { files: ['scripts/preview/backend.js', 'scripts/preview/bridge-stub.js', 'scripts/preview/csp-probe.js'], parserOptions: { sourceType: 'script' }, env: { browser: true, node: true } },
  ],
  ignorePatterns: ['node_modules/', 'static/ui/build/', 'static/ui/node_modules/', 'marketplace/', 'docs/'],
};
