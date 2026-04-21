import 'dotenv/config';

const required = [
  'SESSION_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'OAUTH_CALLBACK_URL',
  'ALLOWED_EMAILS'
];

const missing = required.filter((k) => !process.env[k] || process.env[k].trim() === '');
if (missing.length > 0) {
  console.error(`[config] missing required env vars: ${missing.join(', ')}`);
  console.error('[config] copy .env.example to .env and fill values, then restart');
  process.exit(1);
}

const allowedEmails = new Set(
  process.env.ALLOWED_EMAILS
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

if (allowedEmails.size === 0) {
  console.error('[config] ALLOWED_EMAILS must contain at least one email');
  process.exit(1);
}

const sessionSecret = process.env.SESSION_SECRET.trim();
if (sessionSecret.length < 32) {
  console.error('[config] SESSION_SECRET must be at least 32 characters — generate with `openssl rand -hex 32`');
  process.exit(1);
}

function parseComposeCmd(raw) {
  const parts = (raw || 'docker compose').trim().split(/\s+/);
  return { bin: parts[0], args: parts.slice(1) };
}

export const config = {
  port: Number(process.env.PORT || 3100),
  host: process.env.HOST || '127.0.0.1',
  nodeEnv: process.env.NODE_ENV || 'production',
  isProduction: (process.env.NODE_ENV || 'production') === 'production',

  sessionSecret,
  googleClientId: process.env.GOOGLE_CLIENT_ID.trim(),
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET.trim(),
  oauthCallbackUrl: process.env.OAUTH_CALLBACK_URL.trim(),
  allowedEmails,

  nginxSitesDir: process.env.NGINX_SITES_DIR || '/etc/nginx/sites-enabled',
  composeBaseDir: process.env.COMPOSE_BASE_DIR || '/mnt/HC_Volume_102971677',
  dbPath: process.env.DB_PATH || '/var/lib/channels-monitor/metrics.db',

  nginxProcessName: process.env.NGINX_PROCESS_NAME || 'nginx',
  composeCmd: parseComposeCmd(process.env.DOCKER_COMPOSE_CMD),

  retentionDays: Number(process.env.RETENTION_DAYS || 30)
};

export function isAllowedEmail(email) {
  if (!email) return false;
  return config.allowedEmails.has(email.toLowerCase());
}
