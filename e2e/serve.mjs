// Serves the end-to-end test pages in e2e/pages on http://localhost:4317, and a fake Auto Agent
// API under /fake-auto-agent/api/v1 that the e2e build of the extension talks to.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./pages', import.meta.url));
const port = Number(process.env.PORT ?? 4317);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

const FAKE = '/fake-auto-agent/api/v1';
const USER = {
  id: 'u-test',
  username: 'tester',
  displayName: 'Test Reviewer',
  role: 'DEVELOPER',
  allowedServices: ['DEMO_FEEDBACK'],
};
const PROJECTS = [
  { id: 'p-shop', name: 'Demo Shop', stage: 'INQUIRY' },
  { id: 'p-other', name: 'Other Project', stage: 'PROJECT' },
];
// job-shop is deployed at this server, so the fixture pages on localhost match it.
const JOBS = [
  {
    id: 'job-shop',
    projectId: 'p-shop',
    serviceType: 'FRONTEND_DEMO',
    status: 'SUCCESS',
    jobName: 'Frontend Demo #shop',
    completedAt: '2026-09-30T10:00:00.000Z',
    deploymentUrl: `http://localhost:${port}`,
  },
  {
    id: 'job-shop-failed',
    projectId: 'p-shop',
    serviceType: 'FRONTEND_DEMO',
    status: 'FAILED',
    jobName: 'Frontend Demo #failed',
    completedAt: '2026-09-30T11:00:00.000Z',
    deploymentUrl: null,
  },
  {
    id: 'job-other',
    projectId: 'p-other',
    serviceType: 'MOBILE_DEMO',
    status: 'SUCCESS',
    jobName: 'Mobile Demo #other',
    completedAt: '2026-09-29T10:00:00.000Z',
    deploymentUrl: 'https://other-demo.web.app',
  },
];

// `forbidden` holds project ids the test user has lost access to.
const fresh = () => ({ runs: [], uploads: [], forbidden: [] });
let state = fresh();

function fakeJwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub: USER.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
}

function reply(response, status, data, pagination = null) {
  response
    .writeHead(status, { 'Content-Type': 'application/json' })
    .end(JSON.stringify({ data, message: 'OK', error: null, pagination }));
}

function fail(response, status, message) {
  response
    .writeHead(status, { 'Content-Type': 'application/json' })
    .end(JSON.stringify({ data: null, message, error: 'ERROR', pagination: null }));
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const summary = ({ id, serviceType, status, jobName, completedAt }) => ({
  id,
  serviceType,
  status,
  jobName,
  completedAt,
  parentJobId: null,
});

async function fakeApi(request, response, url) {
  const path = url.pathname.slice(FAKE.length);

  // Test controls.
  if (path === '/_reset') {
    state = fresh();
    return reply(response, 200, null);
  }
  if (path === '/_state') return reply(response, 200, state);
  if (path.startsWith('/_finish/')) {
    const run = state.runs.find((candidate) => candidate.id === path.slice('/_finish/'.length));
    if (run) Object.assign(run, { status: 'SUCCESS', completedAt: new Date().toISOString() });
    return reply(response, 200, run ?? null);
  }

  if (path.startsWith('/_forbid/')) {
    state.forbidden.push(path.slice('/_forbid/'.length));
    return reply(response, 200, null);
  }

  if (path === '/auth/login') {
    const redirect = new URL(url.searchParams.get('cli_redirect'));
    redirect.searchParams.set('token', fakeJwt());
    redirect.searchParams.set('refreshToken', 'refresh-test');
    redirect.searchParams.set('user', JSON.stringify(USER));
    redirect.searchParams.set('state', url.searchParams.get('cli_state') ?? '');
    response.writeHead(302, { Location: redirect.toString() }).end();
    return;
  }
  if (path === '/auth/refresh' && request.method === 'POST') {
    return reply(response, 200, { accessToken: fakeJwt(), refreshToken: 'refresh-test' });
  }

  if (!request.headers.authorization?.startsWith('Bearer ')) return fail(response, 401, 'Authentication required');

  const visible = (projectId) => !state.forbidden.includes(projectId);
  if (path === '/projects') {
    const projects = PROJECTS.filter((project) => visible(project.id));
    return reply(response, 200, projects, { total: projects.length, page: 1, itemPerPage: 100 });
  }
  // Like Auto Agent, a project's jobs come with the project; `GET /jobs` is only the caller's own.
  const projectPath = /^\/projects\/([^/]+)$/.exec(path);
  if (projectPath) {
    const found = PROJECTS.find((project) => project.id === projectPath[1]);
    if (!found) return fail(response, 404, 'Project not found');
    if (!visible(found.id)) return fail(response, 403, 'You are not a member of this project');
    return reply(response, 200, { ...found, jobs: JOBS.filter((job) => job.projectId === found.id).map(summary) });
  }
  if (path === '/files/upload' && request.method === 'POST') {
    const body = await readBody(request);
    const name = /filename="([^"]+)"/.exec(body)?.[1] ?? 'upload';
    const upload = { id: `file-${state.uploads.length + 1}`, name, body };
    state.uploads.push(upload);
    return reply(response, 201, [{ id: upload.id, originalName: name }]);
  }
  const forbiddenJob = /^\/jobs\/([^/]+)/.exec(path);
  if (forbiddenJob && JOBS.some((job) => job.id === forbiddenJob[1] && !visible(job.projectId))) {
    return fail(response, 403, 'You are not a member of this project');
  }
  const feedback = /^\/jobs\/([^/]+)\/feedback$/.exec(path);
  if (feedback && request.method === 'POST') {
    const body = JSON.parse(await readBody(request));
    const run = {
      id: `run-${state.runs.length + 1}`,
      demoJobId: feedback[1],
      status: 'RUNNING',
      createdAt: new Date().toISOString(),
      completedAt: null,
      feedbackDescription: body.description ?? null,
      feedbackFiles: (body.fileIds ?? []).map((id) => state.uploads.find((upload) => upload.id === id)?.name ?? id),
      createdBy: USER.username,
    };
    state.runs.push(run);
    return reply(response, 201, { id: run.id, status: 'PENDING', requiresApproval: false });
  }
  const job = /^\/jobs\/([^/]+)$/.exec(path);
  if (job) {
    const found = JOBS.find((candidate) => candidate.id === job[1]);
    if (!found) return fail(response, 404, 'Job not found');
    const project = PROJECTS.find((candidate) => candidate.id === found.projectId);
    return reply(response, 200, {
      ...summary(found),
      deploymentUrl: found.deploymentUrl,
      project: { id: project.id, name: project.name },
      feedbackHistory: state.runs
        .filter((run) => run.demoJobId === found.id)
        .map(({ demoJobId: _job, ...run }) => run),
    });
  }
  return fail(response, 404, 'Not found');
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith(FAKE)) {
    void fakeApi(request, response, url);
    return;
  }
  // Lets test pages make a request that fails.
  if (url.pathname.startsWith('/api/')) {
    response.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"boom"}');
    return;
  }
  const pathname = decodeURIComponent(url.pathname);
  const relative = normalize(pathname === '/' ? '/index.html' : pathname);
  const file = join(root, relative);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(port, () => console.log(`Test pages at http://localhost:${port}/`));
