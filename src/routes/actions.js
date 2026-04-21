import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import Docker from 'dockerode';
import { config } from '../config.js';
import { run as shellRun, validateName, validateProjectName } from '../lib/shell.js';
import { runRetention } from '../scheduler.js';
import { refreshSites } from '../collectors/nginx.js';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const DOCKER_BIN = '/usr/bin/docker';
const NGINX_BIN = '/usr/sbin/nginx';
const SUDO_BIN = '/usr/bin/sudo';

function needsSudo() {
  return typeof process.getuid === 'function' && process.getuid() !== 0;
}

function nginxArgs(extra) {
  // When running as root, invoke nginx directly; else wrap via sudo
  // (a matching NOPASSWD rule must exist in /etc/sudoers.d).
  if (needsSudo()) {
    return { bin: SUDO_BIN, args: [NGINX_BIN, ...extra] };
  }
  return { bin: NGINX_BIN, args: extra };
}

async function composeExists(project) {
  const path = join(config.composeBaseDir, project, 'docker-compose.yml');
  try {
    await access(path, constants.R_OK);
    return path;
  } catch {
    // also accept compose.yaml / compose.yml
    for (const alt of ['compose.yaml', 'compose.yml', 'docker-compose.yaml']) {
      const p = join(config.composeBaseDir, project, alt);
      try {
        await access(p, constants.R_OK);
        return p;
      } catch {}
    }
    return null;
  }
}

async function containerExists(name) {
  const list = await docker.listContainers({ all: true });
  return list.some((c) => (c.Names || []).some((n) => n.replace(/^\//, '') === name));
}

function log(req, target, action, ok, extra = '') {
  const email = req.session?.user?.email || 'unknown';
  const msg = `[action] user=${email} target=${target} action=${action} result=${ok ? 'ok' : 'error'}${extra ? ' ' + extra : ''}`;
  if (ok) console.log(msg);
  else console.error(msg);
}

async function dockerCmd(args) {
  return shellRun(DOCKER_BIN, args);
}

export default async function actionRoutes(fastify) {
  fastify.addHook('preHandler', fastify.requireAuth);
  fastify.addHook('preHandler', fastify.requireCsrf);

  // ---------------- container actions ----------------

  const containerActions = {
    start: (name) => dockerCmd(['start', name]),
    stop: (name) => dockerCmd(['stop', name]),
    restart: (name) => dockerCmd(['restart', name])
  };

  for (const [action, fn] of Object.entries(containerActions)) {
    fastify.post(`/api/action/container/:name/${action}`, async (req, reply) => {
      let name;
      try {
        name = validateName(req.params.name);
      } catch (err) {
        reply.code(400);
        return { ok: false, error: err.message };
      }
      if (!(await containerExists(name))) {
        log(req, name, `container:${action}`, false, 'not found');
        reply.code(404);
        return { ok: false, error: 'container not found' };
      }
      const result = await fn(name);
      const ok = result.code === 0;
      log(req, name, `container:${action}`, ok, ok ? '' : result.stderr.trim());
      if (!ok) reply.code(500);
      return ok
        ? { ok: true, message: `container ${action} ok` }
        : { ok: false, error: result.stderr || result.stdout };
    });
  }

  // ---------------- compose actions ----------------

  const composeActions = {
    up: ['up', '-d'],
    down: ['down'],
    restart: ['restart']
  };

  for (const [action, suffix] of Object.entries(composeActions)) {
    fastify.post(`/api/action/compose/:project/${action}`, async (req, reply) => {
      let project;
      try {
        project = validateProjectName(req.params.project);
      } catch (err) {
        reply.code(400);
        return { ok: false, error: err.message };
      }
      const path = await composeExists(project);
      if (!path) {
        log(req, project, `compose:${action}`, false, 'compose file not found');
        reply.code(404);
        return { ok: false, error: 'compose file not found' };
      }
      const args = [...config.composeCmd.args, '-f', path, ...suffix];
      // bin for compose v2 is always "docker"; normalize to absolute path
      const result = await dockerCmd(args);
      const ok = result.code === 0;
      log(req, project, `compose:${action}`, ok, ok ? '' : result.stderr.trim());
      if (!ok) reply.code(500);
      return ok
        ? { ok: true, message: `compose ${action} ok` }
        : { ok: false, error: result.stderr || result.stdout };
    });
  }

  // ---------------- nginx actions ----------------

  fastify.post('/api/action/nginx/test', async (req, reply) => {
    const { bin, args } = nginxArgs(['-t']);
    const result = await shellRun(bin, args);
    const ok = result.code === 0;
    log(req, 'nginx', 'nginx:test', ok);
    return {
      ok,
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code
    };
  });

  fastify.post('/api/action/nginx/reload', async (req, reply) => {
    const { bin, args } = nginxArgs(['-s', 'reload']);
    const result = await shellRun(bin, args);
    const ok = result.code === 0;
    log(req, 'nginx', 'nginx:reload', ok, ok ? '' : result.stderr.trim());
    if (ok) {
      // configs may have been edited — reparse to pick up new sites
      refreshSites().catch(() => {});
    } else {
      reply.code(500);
    }
    return ok
      ? { ok: true, message: 'nginx reloaded' }
      : { ok: false, error: result.stderr || result.stdout };
  });

  // ---------------- db purge ----------------

  fastify.post('/api/action/db/purge', async (req, reply) => {
    try {
      const deleted = await runRetention();
      log(req, 'db', 'db:purge', true, `deleted=${deleted}`);
      return { ok: true, deleted };
    } catch (err) {
      log(req, 'db', 'db:purge', false, err.message);
      reply.code(500);
      return { ok: false, error: err.message };
    }
  });
}
