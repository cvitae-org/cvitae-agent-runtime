import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        // `scripts/` is outside the build tsconfig, because its `rootDir` has
        // to stay at `src` for dist to come out flat. It is still typechecked,
        // via tsconfig.scripts.json — this just tells eslint where to look.
        projectService: { allowDefaultProject: ['scripts/*.ts'] },
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  }
);
