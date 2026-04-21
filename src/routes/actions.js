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
const SYSTEMCTL_BIN = '/usr/bin/systemctl';

const VALID_RESTART_POLICIES = new Set(['no', 'always', 'unless-stopped', 'on-failure']);

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

function systemctlArgs(extra) {
  if (needsSudo()) {
    return { bin: SUDO_BIN, args: [SYSTEMCTL_BIN, ...extra] };
  }
  return { bin: SYSTEMCTL_BIN, args: extra };
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

  // Change a container's Docker restart policy (affects future restarts of
  // the Docker daemon or host reboots — does NOT touch a running container).
  fastify.post('/api/action/container/:name/restart-policy/:policy', async (req, reply) => {
    let name;
    try {
      name = validateName(req.params.name);
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err.message };
    }
    const policy = String(req.params.policy || '');
    if (!VALID_RESTART_POLICIES.has(policy)) {
      reply.code(400);
      return { ok: false, error: `invalid policy (must be one of: ${[...VALID_RESTART_POLICIES].join(', ')})` };
    }
    if (!(await containerExists(name))) {
      log(req, name, 'container:restart-policy', false, 'not found');
      reply.code(404);
      return { ok: false, error: 'container not found' };
    }
    try {
      await docker.getContainer(name).update({ RestartPolicy: { Name: policy } });
      log(req, name, 'container:restart-policy', true, `policy=${policy}`);
      return { ok: true, message: 'restart policy updated', policy };
    } catch (err) {
      log(req, name, 'container:restart-policy', false, err.message);
      reply.code(500);
      return { ok: false, error: err.message };
    }
  });

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

  // Full Nginx service restart (kills workers and respawns). Heavier than
  // `-s reload` because it drops in-flight connections.
  fastify.post('/api/action/nginx/restart', async (req, reply) => {
    const { bin, args } = systemctlArgs(['restart', 'nginx']);
    const result = await shellRun(bin, args);
    const ok = result.code === 0;
    log(req, 'nginx', 'nginx:restart', ok, ok ? '' : result.stderr.trim());
    if (ok) {
      refreshSites().catch(() => {});
    } else {
      reply.code(500);
    }
    return ok
      ? { ok: true, message: 'nginx restarted' }
      : { ok: false, error: result.stderr || result.stdout };
  });

  // ---------------- host actions ----------------

  // Reboots the whole Ubuntu host. Extremely destructive — all containers
  // and this monitor go down until the host comes back up. The client should
  // gate this behind a strong confirmation dialog.
  fastify.post('/api/action/server/reboot', async (req, reply) => {
    log(req, 'server', 'server:reboot', true, 'initiating systemctl reboot');
    // Fire-and-forget — the response must race back to the client before the
    // kernel terminates the process. systemctl reboot blocks until shutdown
    // starts, so we kick it off without awaiting and return immediately.
    const { bin, args } = systemctlArgs(['reboot']);
    shellRun(bin, args).catch((err) => {
      console.error(`[action] server:reboot failed: ${err.message}`);
    });
    return { ok: true, message: 'reboot initiated; server will be back in ~1 minute' };
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
