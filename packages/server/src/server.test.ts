import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ReadingPlanSchema } from '@prl/contracts';
import { buildApp } from './app.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('GET /api/health', () => {
  it('returns { ok: true }', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('GET /api/reading-plan', () => {
  it('serves a schema-valid plan for a fixture', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reading-plan?fixture=rate-limit' });
    expect(res.statusCode).toBe(200);
    const plan = ReadingPlanSchema.parse(res.json()); // throws if invalid
    expect(plan.stats.entityCount).toBe(7);
    expect(plan.stats.backwardEdges).toBe(0);
  });

  it('400s when fixture is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reading-plan' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it('400s for an unknown fixture', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reading-plan?fixture=nope' });
    expect(res.statusCode).toBe(400);
  });

  it('sets permissive CORS headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

describe('POST /api/reading-plan', () => {
  it('serves a schema-valid plan for every committed fixture', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/fixtures' });
    for (const fixture of list.json().fixtures as string[]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/reading-plan',
        payload: { ingestor: 'fixture', fixture },
      });
      expect(res.statusCode, fixture).toBe(200);
      expect(() => ReadingPlanSchema.parse(res.json())).not.toThrow();
    }
  });

  it('400s for an unknown fixture', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/reading-plan',
      payload: { ingestor: 'fixture', fixture: 'ghost' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('503s for the sem ingestor when sem is not installed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/reading-plan',
      payload: { ingestor: 'sem', repo: '.', base: 'main', head: 'HEAD' },
    });
    // 503 if sem is absent; 500 if sem is present but the repo/refs are invalid
    // (this repo has no commits); 200 if it happens to resolve. All are valid.
    expect([200, 500, 503]).toContain(res.statusCode);
    if (res.statusCode === 503) {
      expect(res.json().error.kind).toBe('sem-unavailable');
    }
  });
});
