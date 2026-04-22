import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

import { config } from './config.js';
import { openDb, closeDb } from './db.js';
import { registerAuth } from './auth.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';
import actionRoutes from './routes/actions.js';
import { startScheduler } from './scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const clientDistDir = join(rootDir, 'client', 'dist');

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.isProduction ? 'info' : 'debug',
      transport: config.isProduction ? undefined : {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' }
      }
    },
    trustProxy: true,
    bodyLimit: 1 * 1024 * 1024
  });

  // Health check — unauthenticated, used by PM2 / uptime monitors
  fastify.get('/health', async () => ({ ok: true, uptime: Math.round(process.uptime()) }));

  // Auth / session / oauth2 plugins + csrf & requireAuth decorators
  await registerAuth(fastify);

  // Routes
  await fastify.register(authRoutes);
  await fastify.register(apiRoutes);
  await fastify.register(actionRoutes);

  // Public access-denied page (shown when email not in allowlist — simple inline HTML
  // so this works even before the client is built).
  fastify.get('/denied', async (req, reply) => {
    const email = String(req.query.email || '').slice(0, 200);
    reply.type('text/html; charset=utf-8');
    return `<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><title>Access denied</title>
<style>body{font-family:sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;color:#111827}
a{color:#4f46e5}</style></head>
<body>
<h1>הגישה נדחתה</h1>
<p>האימייל <strong>${email || '(לא ידוע)'}</strong> אינו מורשה להיכנס למערכת זו.</p>
<p><a href="/login">חזרה להתחברות</a></p>
</body></html>`;
  });

  // Static client — if the client has been built, serve it at /.
  // Otherwise, fall through and the user sees a helpful stub.
  const hasClient = existsSync(join(clientDistDir, 'index.html'));
  if (hasClient) {
    await fastify.register(fastifyStatic, {
      root: clientDistDir,
      prefix: '/'
    });
    // SPA fallback: any unmatched non-API GET serves index.html
    fastify.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/auth')) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: 'not found' });
    });
  } else {
    fastify.get('/', async (req, reply) => {
      reply.type('text/html; charset=utf-8');
      return `<!doctype html><html><body style="font-family:sans-serif;max-width:36rem;margin:4rem auto">
<h1>pulse</h1>
<p>Server is running but the React client has not been built.</p>
<p>Run <code>npm run build:client</code> and restart PM2.</p>
<p>Try <a href="/health">/health</a> to verify the API.</p>
</body></html>`;
    });
    fastify.get('/login', async (req, reply) => {
      reply.type('text/html; charset=utf-8');
      return `<!doctype html><html><body style="font-family:sans-serif;max-width:36rem;margin:4rem auto">
<h1>Sign in</h1>
<p><a href="/auth/google" style="display:inline-block;padding:.75rem 1.25rem;background:#4f46e5;color:#fff;text-decoration:none;border-radius:.5rem">Sign in with Google</a></p>
</body></html>`;
    });
  }

  return fastify;
}

async function main() {
  // Validate config (thrown during import if missing)
  openDb();

  const fastify = await buildServer();

  try {
    await fastify.listen({ host: config.host, port: config.port });
  } catch (err) {
    fastify.log.error(err, 'failed to listen');
    process.exit(1);
  }

  // Start the scheduler after the HTTP server is listening so the app comes
  // up fast; the first collection runs in the background.
  startScheduler().catch((err) => {
    fastify.log.error(err, 'scheduler failed to start');
  });

  // Graceful shutdown — finish in-flight requests, close DB, exit 0.
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    fastify.log.info({ signal }, 'shutting down');
    try {
      await Promise.race([
        fastify.close(),
        new Promise((resolve) => setTimeout(resolve, 10000))
      ]);
    } catch (err) {
      fastify.log.error(err, 'error while closing');
    }
    try { closeDb(); } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
