import { z } from 'zod';
import { domDetailRecipeSchema } from './dom.mjs';
const base = domDetailRecipeSchema.shape;
export const sitemapRecipeSchema = z.object({ kind: z.literal('sitemap-v1'), sourceId: base.sourceId,
  revision: base.revision, hosts: base.hosts, offer: base.offer,
  seeds: z.array(z.string().url().max(2048)).min(1).max(5),
  maxDocuments: z.number().int().min(1).max(5), maxDepth: z.number().int().min(0).max(2),
  maxUrls: z.number().int().min(1).max(5000),
}).strict().refine(recipe => new Set(recipe.seeds).size === recipe.seeds.length && recipe.seeds.every(raw => {
  const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && recipe.hosts.includes(url.hostname);
}), 'Sitemap seeds must use declared public HTTPS hosts');
