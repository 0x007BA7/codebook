import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { linearize } from '@codebook/core';
import { ReadingPlanSchema, type ReadingPlan } from '@codebook/contracts';
import {
  FixtureIngestor,
  SemIngestor,
  SemUnavailableError,
  listFixtures,
  type Ingestor,
  type IngestOpts,
} from '@codebook/ingest';

export interface PlanRequest extends IngestOpts {
  ingestor?: 'sem' | 'fixture';
}

/** Ingest -> linearize -> re-validate against the contract before serving (§8.1). */
export async function buildPlan(req: PlanRequest): Promise<ReadingPlan> {
  const ingestor: Ingestor =
    req.ingestor === 'sem' ? new SemIngestor() : new FixtureIngestor();
  const input = await ingestor.ingest(req);
  const plan = linearize(input);
  // A validation failure here must surface as a structured 500, never a
  // malformed body (§8.1). ReadingPlanSchema.parse throws ZodError.
  return ReadingPlanSchema.parse(plan);
}

/** Build the Fastify app. Exported so contract tests can run it in-process. */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  // Minimal permissive CORS so the Vite dev server (different port) can call us.
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-allow-methods', 'GET,POST,OPTIONS');
    reply.header('access-control-allow-headers', 'content-type');
  });
  app.options('/*', async (_req, reply) => reply.code(204).send());

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/fixtures', async () => ({ fixtures: listFixtures() }));

  // GET convenience for demos: /api/reading-plan?fixture=rate-limit
  app.get('/api/reading-plan', async (req, reply) => {
    const fixture = (req.query as Record<string, string | undefined>).fixture;
    if (!fixture) {
      return reply
        .code(400)
        .send({ error: { message: 'query param `fixture` is required for GET' } });
    }
    return send(reply, { ingestor: 'fixture', fixture });
  });

  app.post('/api/reading-plan', async (req, reply) => {
    const body = (req.body ?? {}) as PlanRequest;
    return send(reply, body);
  });

  return app;
}

async function send(reply: FastifyReply, req: PlanRequest): Promise<unknown> {
  try {
    const plan = await buildPlan(req);
    return reply.code(200).send(plan);
  } catch (err) {
    if (err instanceof SemUnavailableError) {
      return reply.code(503).send({ error: { kind: 'sem-unavailable', message: err.message } });
    }
    if (err instanceof ZodError) {
      // Contract validation failed — structured 500, never a malformed body.
      return reply
        .code(500)
        .send({ error: { kind: 'contract-violation', message: 'response failed schema validation', issues: err.issues } });
    }
    const message = err instanceof Error ? err.message : String(err);
    // Unknown fixture / bad request -> 400; anything else -> 500.
    const code = /no fixture|requires opts\.fixture/.test(message) ? 400 : 500;
    return reply.code(code).send({ error: { kind: 'ingest-error', message } });
  }
}
