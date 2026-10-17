import js from '@eslint/js';
import globals from 'globals';

/* Globals that PocketBase's JS VM provides to migrations and hooks (see server/pb_data/types.d.ts once the server has run). */
const pocketbaseVm = {
  migrate: 'readonly',
  routerUse: 'readonly',
  onRecordCreate: 'readonly',
  onRecordCreateRequest: 'readonly',
  onRecordUpdateRequest: 'readonly',
  onFileDownloadRequest: 'readonly',
  Collection: 'readonly',
  Field: 'readonly',
  BadRequestError: 'readonly',
  NotFoundError: 'readonly',
  UnauthorizedError: 'readonly',
  ValidationError: 'readonly',
  DynamicModel: 'readonly',
  $app: 'readonly',
};

export default [
  { ignores: ['dist/', 'server/pb_public/', 'server/pb_data/', 'qa/out/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    files: ['vite.config.js', 'eslint.config.js', 'scripts/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // QA kits run under Node and hand code to the browser (page.evaluate), so both sets of globals apply.
    files: ['qa/**/*.{js,mjs,cjs}'],
    languageOptions: { ecmaVersion: 'latest', globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['qa/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    // Not ES modules: the JS VM runs these files as plain scripts.
    files: ['server/pb_migrations/**/*.js', 'server/pb_hooks/**/*.js'],
    languageOptions: { sourceType: 'script', globals: pocketbaseVm },
  },
];
