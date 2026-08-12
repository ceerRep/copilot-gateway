import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { createNodeFetchHandler, nodeWebDistDir } from '../src/static-web.ts';

const directories: string[] = [];

const makeDist = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'floway-node-web-'));
  directories.push(dir);
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>Floway</title>');
  await writeFile(join(dir, 'app.js'), 'console.log("app")');
  return dir;
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

test('serves static assets and falls back to the SPA for a dashboard route', async () => {
  const fetch = createNodeFetchHandler(async () => new Response('gateway'), { distDir: await makeDist() });

  const asset = await fetch(new Request('http://floway.test/app.js'));
  expect(asset.status).toBe(200);
  expect(asset.headers.get('content-type')).toContain('text/javascript');
  expect(await asset.text()).toBe('console.log("app")');

  const page = await fetch(new Request('http://floway.test/dashboard/upstreams'));
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('<title>Floway</title>');
});

test('preserves gateway 404s and never falls back for missing assets', async () => {
  const fetch = createNodeFetchHandler(async () => new Response('gateway 404', { status: 404 }), { distDir: await makeDist() });

  const api = await fetch(new Request('http://floway.test/api/not-a-route'));
  expect(api.status).toBe(404);
  expect(await api.text()).toBe('gateway 404');

  const apiRoot = await fetch(new Request('http://floway.test/api'));
  expect(apiRoot.status).toBe(404);
  expect(await apiRoot.text()).toBe('gateway 404');

  const favicon = await fetch(new Request('http://floway.test/favicon.ico'));
  expect(favicon.status).toBe(404);
  expect(await favicon.text()).toBe('gateway 404');

  const asset = await fetch(new Request('http://floway.test/assets/missing.js'));
  expect(asset.status).toBe(404);
});

test('forwards the Node adapter context to gateway paths', async () => {
  const env = { websocket: Symbol('websocket') };
  const executionCtx = {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
    props: {},
  };
  let receivedEnv: object | undefined;
  let receivedExecutionCtx: unknown;
  const fetch = createNodeFetchHandler((_request, gatewayEnv, gatewayExecutionCtx) => {
    receivedEnv = gatewayEnv;
    receivedExecutionCtx = gatewayExecutionCtx;
    return new Response('gateway');
  }, { distDir: await makeDist() });

  await fetch(new Request('http://floway.test/azure-api.codex/responses', {
    headers: { upgrade: 'websocket' },
  }), env, executionCtx);

  expect(receivedEnv).toBe(env);
  expect(receivedExecutionCtx).toBe(executionCtx);
});

test('returns an actionable error until the web bundle exists', async () => {
  const fetch = createNodeFetchHandler(async () => new Response('gateway'), { distDir: join(tmpdir(), 'floway-missing-web-dist') });
  const response = await fetch(new Request('http://floway.test/login'));
  expect(response.status).toBe(503);
  expect(await response.text()).toContain('pnpm run build:web');
});

test('locates the default web bundle independently of the launch directory', () => {
  expect(nodeWebDistDir()).toMatch(/[/\\]apps[/\\]web[/\\]dist[/\\]client[/\\]?$/);
  expect(nodeWebDistDir({ FLOWAY_WEB_DIST_DIR: '/tmp/custom-dashboard' })).toBe('/tmp/custom-dashboard');
});
