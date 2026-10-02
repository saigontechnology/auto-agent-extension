import { describe, expect, it } from 'vitest';
import { type JobMatch, isDemoJob, normalizeOrigin, pickMatch } from './job-matcher';

function match(jobId: string, completedAt: string | null, deploymentUrl: string | null): JobMatch {
  return {
    projectId: 'p1',
    projectName: 'Shop',
    jobId,
    jobName: jobId,
    serviceType: 'FRONTEND_DEMO',
    completedAt,
    deploymentUrl,
  };
}

describe('normalizeOrigin', () => {
  it('keeps only scheme, host and port, lower-cased', () => {
    expect(normalizeOrigin('https://Shop.Web.App/home?x=1#/cart')).toBe('https://shop.web.app');
    expect(normalizeOrigin('https://shop.web.app/')).toBe('https://shop.web.app');
    expect(normalizeOrigin('http://localhost:4173/plain.html')).toBe('http://localhost:4173');
  });

  it('treats a Firebase site on firebaseapp.com as the same site on web.app', () => {
    expect(normalizeOrigin('https://shop.firebaseapp.com/home')).toBe('https://shop.web.app');
  });

  it('refuses anything that is not an http(s) URL', () => {
    expect(normalizeOrigin('not a url')).toBeNull();
    expect(normalizeOrigin('chrome://extensions')).toBeNull();
  });
});

describe('isDemoJob', () => {
  it('accepts only successful demo jobs', () => {
    expect(isDemoJob({ serviceType: 'FRONTEND_DEMO', status: 'SUCCESS' })).toBe(true);
    expect(isDemoJob({ serviceType: 'MOBILE_DEMO_NEXT_PHASE', status: 'SUCCESS' })).toBe(true);
    expect(isDemoJob({ serviceType: 'FRONTEND_DEMO', status: 'FAILED' })).toBe(false);
    expect(isDemoJob({ serviceType: 'DEMO_FEEDBACK', status: 'SUCCESS' })).toBe(false);
  });
});

describe('pickMatch', () => {
  it('finds the demo deployed at the page origin, whatever the path', () => {
    const demos = [
      match('a', '2026-09-01T00:00:00Z', 'https://other.web.app'),
      match('b', '2026-09-02T00:00:00Z', 'https://shop.web.app'),
    ];
    expect(pickMatch('https://shop.firebaseapp.com/cart', demos)?.jobId).toBe('b');
  });

  it('prefers the newest demo when several share a site', () => {
    const demos = [
      match('old', '2026-09-01T00:00:00Z', 'https://shop.web.app'),
      match('new', '2026-09-03T00:00:00Z', 'https://shop.web.app/'),
      match('none', null, 'https://shop.web.app'),
    ];
    expect(pickMatch('https://shop.web.app', demos)?.jobId).toBe('new');
  });

  it('skips demos without a usable deployment URL', () => {
    expect(pickMatch('https://shop.web.app', [match('a', null, null), match('b', null, 'garbage')])).toBeNull();
  });
});
