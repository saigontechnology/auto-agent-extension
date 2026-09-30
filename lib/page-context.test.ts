import { beforeEach, describe, expect, it } from 'vitest';
import { readPageContext, routePath } from './page-context';

const loc = { href: 'https://demo.web.app/home?tab=1', pathname: '/home', hash: '' };

describe('readPageContext', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('reads project and build ids from the meta tags', () => {
    document.head.innerHTML =
      '<title>Home</title><meta name="vibe:project-id" content="proj_1"><meta name="vibe:build-id" content=" build_9 ">';
    expect(readPageContext(document, loc)).toEqual({
      projectId: 'proj_1',
      buildId: 'build_9',
      path: '/home',
      url: 'https://demo.web.app/home?tab=1',
      title: 'Home',
    });
  });

  it('returns null when a meta tag is missing', () => {
    document.head.innerHTML = '<meta name="vibe:project-id" content="proj_1">';
    expect(readPageContext(document, loc)).toBeNull();
  });

  it('returns null when a meta tag is empty', () => {
    document.head.innerHTML =
      '<meta name="vibe:project-id" content="proj_1"><meta name="vibe:build-id" content="  ">';
    expect(readPageContext(document, loc)).toBeNull();
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
