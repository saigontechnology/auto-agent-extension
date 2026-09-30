import type { PageContext } from './types';

function meta(doc: Document, name: string): string {
  return doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() ?? '';
}

/** Hash-routed apps keep every route on one pathname, so the route lives in the hash. */
export function routePath(loc: Pick<Location, 'pathname' | 'hash'>): string {
  return loc.hash.startsWith('#/') ? loc.pathname + loc.hash : loc.pathname;
}

export function readPageContext(
  doc: Document,
  loc: Pick<Location, 'href' | 'pathname' | 'hash'>,
): PageContext | null {
  const projectId = meta(doc, 'vibe:project-id');
  const buildId = meta(doc, 'vibe:build-id');
  if (!projectId || !buildId) return null;
  return { projectId, buildId, path: routePath(loc), url: loc.href, title: doc.title };
}
