import { z } from 'zod';

/** Storage accepts retired board IDs; collection resolves IDs through the registry. */
export const discoveryBoardIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const maxDiscoveryBoards = 32;
