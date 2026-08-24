/**
 * Three lines on purpose. Everything this route does lives in
 * `src/server/netlify.ts`, where it is compiled and typechecked with the rest
 * of the project; this file exists only to give it a path.
 */
export { handleHealth as default } from '../../dist/server/netlify.js';

export const config = { path: '/health' };
