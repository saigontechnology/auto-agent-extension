import type { PageContext } from './types';

function meta(doc: Document, name: string): string {
  return doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() ?? '';
}

/** Hash-routed apps keep every route on one pathname, so the route lives in the hash. */
export function routePath(loc: Pick<Location, 'pathname' | 'hash'>): string {
  return loc.hash.startsWith('#/') ? loc.pathname + loc.hash : loc.pathname;
}

export const LOCAL_BUILD = 'local';

/**
 * Reads the project and build a page belongs to. With `requireMarkers`, a page missing either
 * meta tag is not a preview and yields null; without it, the host stands in for the project.
 */
export function readPageContext(
  doc: Document,
  loc: Pick<Location, 'href' | 'host' | 'pathname' | 'hash'>,
  options: { requireMarkers: boolean },
): PageContext | null {
  const markedProject = meta(doc, 'vibe:project-id');
  const markedBuild = meta(doc, 'vibe:build-id');
  if (options.requireMarkers && (!markedProject || !markedBuild)) return null;
  return {
    projectId: markedProject || loc.host || LOCAL_BUILD,
    buildId: markedBuild || LOCAL_BUILD,
    path: routePath(loc),
    url: loc.href,
    title: doc.title,
  };
}
