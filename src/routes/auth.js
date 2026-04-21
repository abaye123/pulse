import { isAllowed } from '../auth.js';

// Fetch userinfo from Google using the access token
async function fetchUserInfo(accessToken) {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    throw new Error(`userinfo failed: ${res.status}`);
  }
  return res.json();
}

export default async function authRoutes(fastify) {
  fastify.get('/auth/callback', async (req, reply) => {
    try {
      const tokenResult = await fastify.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);
      const accessToken = tokenResult.token?.access_token || tokenResult.access_token;
      if (!accessToken) throw new Error('no access token');

      const info = await fetchUserInfo(accessToken);
      const email = (info.email || '').toLowerCase();

      if (!isAllowed(email)) {
        req.log.warn({ email }, 'login denied: email not in allowlist');
        return reply.redirect(`/denied?email=${encodeURIComponent(email)}`);
      }

      req.session.user = {
        email,
        name: info.name || email,
        picture: info.picture || null
      };
      req.log.info({ email }, 'login ok');
      return reply.redirect('/');
    } catch (err) {
      req.log.error({ err: err.message }, 'oauth callback failed');
      return reply.code(500).send({ error: 'oauth_failed', detail: err.message });
    }
  });

  fastify.get('/auth/logout', async (req, reply) => {
    const email = req.session?.user?.email;
    await new Promise((resolve) => {
      req.session.destroy(() => resolve());
    });
    if (email) req.log.info({ email }, 'logout');
    return reply.redirect('/login');
  });

  // Lightweight session probe used by the client to know whether to render
  // the dashboard or redirect to /login.
  fastify.get('/api/session', async (req, reply) => {
    if (!req.session?.user) {
      reply.code(401);
      return { error: 'unauthorized' };
    }
    return req.session.user;
  });
}
