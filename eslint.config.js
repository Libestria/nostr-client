export default [
  {
    files: ['js/**/*.js', 'tests/**/*.mjs', 'sw.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly', indexedDB: 'readonly', fetch: 'readonly', WebSocket: 'readonly', crypto: 'readonly', self: 'readonly', caches: 'readonly', URL: 'readonly', location: 'readonly', Worker: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly' } },
    rules: { 'no-unused-vars': 'warn', 'no-undef': 'error', eqeqeq: ['error', 'always'], 'no-eval': 'error', 'no-implied-eval': 'error' },
  },
];
