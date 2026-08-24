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
        //
        // The count is raised from the default of 8, which the suite grew past.
        // The warning behind that default is about linting speed on a large
        // tree of unprojected files; this is a handful of test scripts and one
        // smoke runner, and the measured difference is not perceptible.
        projectService: {
          allowDefaultProject: ['scripts/*.ts'],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 24
        },
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  }
);
