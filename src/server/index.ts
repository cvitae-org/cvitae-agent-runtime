/**
 * The optional HTTP entry point.
 *
 * The library is the primary interface — cvitae can import `createRuntime` and
 * call it in-process. This exists for the cases that need a process of their
 * own: indexing that outlives a request, a runtime shared by more than one
 * caller, or simply keeping the provider credentials out of the Next.js server
 * entirely.
 *
 * It binds to loopback and has no authentication, and those two facts are the
 * same decision. The service reads and writes the user's CV and holds the API
 * keys; it is not built to be reachable by anything other than this machine, so
 * `HOST` should not be changed without putting something in front of it.
 */

import Fastify from 'fastify';
import type { FastifyReply } from 'fastify';
import { createRuntime } from '../index.js';
import { RuntimeError } from '../core/types.js';
import { AiConfigError } from '../providers/resolve.js';
import { runtimeHome } from '../store/paths.js';

const PORT = Number(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? '127.0.0.1';

const server = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
const runtime = createRuntime();

server.get('/health', async () => ({
  status: 'ok',
  home: runtimeHome(),
  capabilities: runtime.listCapabilities(),
  tools: runtime.listTools()
}));

/**
 * Reports what is indexed. Cheap, and the first thing worth checking when
 * retrieval returns nothing — the usual answer is that nothing was imported.
 */
server.get('/state', async () => {
  const store = await runtime.store();
  const document = await store.documents.read();

  return {
    document: {
      updated_at: document.updated_at,
      name: document.personal.name,
      experience_entries: document.experience.length,
      sources: document.sources.length
    },
    chunks: await store.chunks.count(),
    offers: await store.offers.count()
  };
});

server.post<{ Params: { name: string }; Body: unknown }>(
  '/run/:name',
  async (request, reply) => {
    try {
      const result = await runtime.run(request.params.name, request.body ?? {});
      return result;
    } catch (error) {
      return replyForError(reply, error);
    }
  }
);

server.post<{ Body: { document?: unknown } }>(
  '/document',
  async (request, reply) => {
    try {
      const store = await runtime.store();
      const saved = await store.documents.write(
        // Validated by the document schema on the way in; an invalid shape
        // throws and is reported rather than partially written.
        (request.body?.document ?? {}) as Parameters<typeof store.documents.write>[0]
      );
      const indexed = await store.reindex(saved);

      return { updated_at: saved.updated_at, indexed };
    } catch (error) {
      return replyForError(reply, error);
    }
  }
);

server.post('/reindex', async (_request, reply) => {
  try {
    const store = await runtime.store();
    return await store.reindex();
  } catch (error) {
    return replyForError(reply, error);
  }
});

/**
 * Maps a failure to a status the caller can act on.
 *
 * The distinction that matters is between "you asked wrongly" (400) and "this
 * machine is not set up" (500) — cvitae turns the first into a field error and
 * the second into a settings prompt, and collapsing both into 500 makes a
 * missing API key look like a bug in the request.
 */
const replyForError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof RuntimeError) {
    const status =
      error.code === 'invalid_input' || error.code === 'unknown_capability'
        ? 400
        : 502;

    server.log.warn({ code: error.code }, error.message);
    return reply.status(status).send({ error: error.message, reason: error.code });
  }

  if (error instanceof AiConfigError) {
    server.log.error(error.message);
    return reply
      .status(500)
      .send({ error: error.message, reason: 'ai_not_configured' });
  }

  server.log.error(error);
  return reply
    .status(500)
    .send({ error: 'The runtime failed to complete the request.' });
};

const start = async () => {
  try {
    await server.listen({ port: PORT, host: HOST });
    server.log.info(`cvitae-agent-runtime state lives in ${runtimeHome()}`);
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
};

void start();
