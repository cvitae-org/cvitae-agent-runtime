import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `port/` is the old runtime, parked until it is ported onto the spine. It is
  // outside the build tsconfig too — it is a work queue made of code, not a
  // second source tree, and linting it would only report on code being deleted.
  { ignores: ['dist/**', 'node_modules/**', 'port/**', '.claude/worktrees/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The boundary config is the one CommonJS file in an ESM package, because
    // that is what dependency-cruiser loads. `module` and `require` are globals
    // there, not undefined names.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' }
    }
  },
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        // `scripts/` sits outside the build tsconfig, because rootDir has to
        // stay at `src` for dist to come out flat. tsconfig.scripts.json is the
        // one that spans both, so it is also the right project for the linter —
        // `projectService` would resolve to tsconfig.json and find no scripts,
        // and `allowDefaultProject` takes no `**`, so every new subdirectory
        // under scripts/ would have to be added by hand.
        project: './tsconfig.scripts.json',
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  }
);
