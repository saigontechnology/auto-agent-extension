import { beforeEach, describe, expect, it } from 'vitest';
import { readPageContext, routePath } from './page-context';

const loc = {
  href: 'https://demo.web.app/home?tab=1',
  host: 'demo.web.app',
  pathname: '/home',
  hash: '',
};
const strict = { requireMarkers: true };
const relaxed = { requireMarkers: false };

describe('readPageContext', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('reads project and build ids from the meta tags', () => {
    document.head.innerHTML =
      '<title>Home</title><meta name="vibe:project-id" content="proj_1"><meta name="vibe:build-id" content=" build_9 ">';
    expect(readPageContext(document, loc, strict)).toEqual({
      projectId: 'proj_1',
      buildId: 'build_9',
      path: '/home',
      url: 'https://demo.web.app/home?tab=1',
      title: 'Home',
    });
  });

  it('returns null when a meta tag is missing', () => {
    document.head.innerHTML = '<meta name="vibe:project-id" content="proj_1">';
    expect(readPageContext(document, loc, strict)).toBeNull();
  });

  it('returns null when a meta tag is empty', () => {
    document.head.innerHTML =
      '<meta name="vibe:project-id" content="proj_1"><meta name="vibe:build-id" content="  ">';
    expect(readPageContext(document, loc, strict)).toBeNull();
  });
});

describe('routePath', () => {
  it('uses the pathname for history-routed apps', () => {
    expect(routePath({ pathname: '/home', hash: '#section' })).toBe('/home');
  });

  it('includes the hash route for hash-routed apps', () => {
    expect(routePath({ pathname: '/', hash: '#/settings' })).toBe('/#/settings');
  });
});

describe('readPageContext without required markers', () => {
  beforeEach(() => {
    document.head.innerHTML = '<title>Any site</title>';
  });

  it('falls back to the host as the project and a local build', () => {
    expect(readPageContext(document, loc, relaxed)).toEqual({
      projectId: 'demo.web.app',
      buildId: 'local',
      path: '/home',
      url: 'https://demo.web.app/home?tab=1',
      title: 'Any site',
    });
  });

  it('keeps the port in the project, so two local servers stay separate', () => {
    const local = { ...loc, host: 'localhost:4173', href: 'http://localhost:4173/home' };
    expect(readPageContext(document, local, relaxed)?.projectId).toBe('localhost:4173');
  });

  it('still prefers the markers when the page has them', () => {
    document.head.innerHTML =
      '<meta name="vibe:project-id" content="proj_1"><meta name="vibe:build-id" content="build_9">';
    expect(readPageContext(document, loc, relaxed)).toMatchObject({
      projectId: 'proj_1',
      buildId: 'build_9',
    });
  });

  it('fills in only the marker that is missing', () => {
    document.head.innerHTML = '<meta name="vibe:project-id" content="proj_1">';
    expect(readPageContext(document, loc, relaxed)).toMatchObject({
      projectId: 'proj_1',
      buildId: 'local',
    });
  });

  it('uses a fixed project name for pages without a host', () => {
    expect(readPageContext(document, { ...loc, host: '' }, relaxed)?.projectId).toBe('local');
  });
});
