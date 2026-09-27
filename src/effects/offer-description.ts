/** Select only the current posting's published description, never related jobs. */
export function extractJobDescription(html: string, sourceUrl: string, visibleText: (html: string) => string): string | undefined {
  const candidates: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 10 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.slice(0, 200).forEach(item => visit(item, depth + 1)); return; }
    const node = value as Record<string, unknown>;
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    if (types.includes('JobPosting')) candidates.push(node);
    if (node['@graph']) visit(node['@graph'], depth + 1);
    if (node.mainEntity) visit(node.mainEntity, depth + 1);
  };
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(script[1]!)) continue;
    try { visit(JSON.parse(script[2]!)); } catch { /* Optional malformed metadata. */ }
  }
  const canonical = (raw: string): string | undefined => {
    try {
      const url = new URL(raw, sourceUrl);
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) {
        if (/^utm_/i.test(key) || ['gclid', 'fbclid'].includes(key)) url.searchParams.delete(key);
      }
      url.searchParams.sort();
      return url.origin + url.pathname.replace(/\/$/, '') + url.search;
    } catch { return undefined; }
  };
  const matching = candidates.filter(node => {
    const page = node.mainEntityOfPage;
    const advertised = node.url ?? (typeof page === 'string' ? page : page && typeof page === 'object' ? (page as Record<string, unknown>)['@id'] : undefined);
    return typeof advertised === 'string' ? canonical(advertised) === canonical(sourceUrl) : candidates.length === 1;
  });
  if (matching.length !== 1 || typeof matching[0]!.description !== 'string') return undefined;
  const text = visibleText(matching[0]!.description).split('\n').map(line => line.trim()).join('\n').trim();
  return text.length >= 40 ? text.slice(0, 1_000_000) : undefined;
}
