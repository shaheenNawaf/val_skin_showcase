export default [
  { ignores: ['js/vendor/**', 'dist/**', 'supabase/**', '.netlify/**'] },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly', console: 'readonly', URL: 'readonly',
        setTimeout: 'readonly', setInterval: 'readonly', clearTimeout: 'readonly', clearInterval: 'readonly'
      }
    },
    rules: { 'no-console': 'off' }
  },
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', localStorage: 'readonly',
        location: 'readonly', navigator: 'readonly', console: 'readonly',
        crypto: 'readonly', fetch: 'readonly', FileReader: 'readonly',
        Image: 'readonly', BroadcastChannel: 'readonly', requestAnimationFrame: 'readonly',
        addEventListener: 'readonly', removeEventListener: 'readonly',
        innerWidth: 'readonly', innerHeight: 'readonly',
        setTimeout: 'readonly', setInterval: 'readonly', clearTimeout: 'readonly', clearInterval: 'readonly',
        prompt: 'readonly', alert: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
        TextEncoder: 'readonly', TextDecoder: 'readonly', ResizeObserver: 'readonly',
        html2canvas: 'readonly', supabase: 'readonly'
      }
    },
    rules: {
      'eqeqeq': ['error', 'smart'],
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': 'warn'
    }
  }
];
