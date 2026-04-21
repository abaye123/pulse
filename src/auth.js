import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import fastifyOauth2 from '@fastify/oauth2';
import crypto from 'node:crypto';
import { config, isAllowedEmail } from './config.js';

const CSRF_COOKIE = 'csrf';
const SESSION_COOKIE = 'monitor_sid';

export async function registerAuth(fastify) {
  await fastify.register(fastifyCookie);

  await fastify.register(fastifySession, {
    secret: config.sessionSecret,
    cookieName: SESSION_COOKIE,
    cookie: {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 3600 * 1000,
      path: '/'
    },
    saveUninitialized: false,
    rolling: true
  });

  await fastify.register(fastifyOauth2, {
    name: 'googleOAuth2',
    scope: ['openid', 'email', 'profile'],
    credentials: {
      client: {
        id: config.googleClientId,
        secret: config.googleClientSecret
      },
      auth: fastifyOauth2.GOOGLE_CONFIGURATION
    },
    startRedirectPath: '/auth/google',
    callbackUri: config.oauthCallbackUrl
  });

  // CSRF: issue a token in a non-httpOnly cookie on every request that doesn't have one.
  // The frontend reads it and echoes it in X-CSRF-Token for every POST.
  fastify.addHook('onRequest', async (req, reply) => {
    if (!req.cookies?.[CSRF_COOKIE]) {
      const token = crypto.randomBytes(24).toString('hex');
      reply.setCookie(CSRF_COOKIE, token, {
        httpOnly: false,
        secure: config.isProduction,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 3600
      });
      req.cookies[CSRF_COOKIE] = token;
    }
  });

  // Auth guard — use as preHandler on protected routes.
  fastify.decorate('requireAuth', async (req, reply) => {
    if (req.session?.user) return;
    if (req.url.startsWith('/api/')) {
      reply.code(401).send({ error: 'unauthorized' });
      return reply;
    }
    reply.redirect('/login');
    return reply;
  });

  // CSRF guard — use as preHandler on all POST endpoints.
  fastify.decorate('requireCsrf', async (req, reply) => {
    const cookieToken = req.cookies?.[CSRF_COOKIE];
    const headerToken = req.headers['x-csrf-token'];
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      reply.code(403).send({ error: 'csrf_mismatch' });
      return reply;
    }
  });
}

export function isAllowed(email) {
  return isAllowedEmail(email);
}
