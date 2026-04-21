import Docker from 'dockerode';
import { currentMinuteTs, insertContainerMetrics } from '../db.js';
import { state } from '../state.js';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const STATS_CONCURRENCY = 10;

function cpuPercentFromStats(stats) {
  const cpuDelta =
    (stats.cpu_stats?.cpu_usage?.total_usage || 0) -
    (stats.precpu_stats?.cpu_usage?.total_usage || 0);
  const systemDelta =
    (stats.cpu_stats?.system_cpu_usage || 0) -
    (stats.precpu_stats?.system_cpu_usage || 0);
  const cpuCount = stats.cpu_stats?.online_cpus || 1;
  if (systemDelta > 0 && cpuDelta > 0) {
    return (cpuDelta / systemDelta) * cpuCount * 100;
  }
  return 0;
}

async function limitedParallel(items, worker, concurrency) {
  const out = new Array(items.length);
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await worker(items[idx]);
      } catch (err) {
        out[idx] = { error: err.message };
      }
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, next);
  await Promise.all(runners);
  return out;
}

export async function collectDocker() {
  const containers = await docker.listContainers({ all: true });

  const entries = await limitedParallel(
    containers,
    async (info) => {
      const name = (info.Names?.[0] || '').replace(/^\//, '');
      const project = info.Labels?.['com.docker.compose.project'] || null;
      const serviceName = info.Labels?.['com.docker.compose.service'] || null;
      const stateName = info.State || 'unknown';

      let cpuPct = 0;
      let memUsedMb = 0;
      let uptimeSec = 0;
      let restartCount = 0;
      let restartPolicy = 'no';

      if (stateName === 'running') {
        try {
          const container = docker.getContainer(info.Id);
          const [stats, inspect] = await Promise.all([
            container.stats({ stream: false }),
            container.inspect()
          ]);
          cpuPct = Number(cpuPercentFromStats(stats).toFixed(2));
          memUsedMb = Math.round((stats.memory_stats?.usage || 0) / 1024 / 1024);
          restartCount = inspect.RestartCount || 0;
          restartPolicy = inspect.HostConfig?.RestartPolicy?.Name || 'no';
          if (inspect.State?.StartedAt) {
            const startedMs = new Date(inspect.State.StartedAt).getTime();
            uptimeSec = Math.max(0, Math.round((Date.now() - startedMs) / 1000));
          }
        } catch (err) {
          // stats unavailable — keep zeros
        }
      } else {
        try {
          const container = docker.getContainer(info.Id);
          const inspect = await container.inspect();
          restartCount = inspect.RestartCount || 0;
          restartPolicy = inspect.HostConfig?.RestartPolicy?.Name || 'no';
        } catch (err) {
          // inspect failed — keep zero
        }
      }

      return {
        id: info.Id,
        name,
        project,
        service: serviceName,
        state: stateName,
        cpuPct,
        memUsedMb,
        uptimeSec,
        restartCount,
        restartPolicy
      };
    },
    STATS_CONCURRENCY
  );

  // Group by compose project
  const byProject = new Map();
  for (const c of entries) {
    const key = c.project || '__standalone__';
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(c);
  }

  const composeProjects = [];
  for (const [name, list] of byProject) {
    composeProjects.push({
      name: name === '__standalone__' ? null : name,
      containers: list.sort((a, b) => a.name.localeCompare(b.name))
    });
  }
  composeProjects.sort((a, b) => {
    if (!a.name) return 1;
    if (!b.name) return -1;
    return a.name.localeCompare(b.name);
  });

  return { composeProjects, flat: entries };
}

export async function runDockerCollector() {
  const ts = currentMinuteTs();
  const { composeProjects, flat } = await collectDocker();

  insertContainerMetrics(
    flat.map((c) => ({
      ts,
      container_name: c.name,
      cpu_pct: c.cpuPct,
      mem_used_mb: c.memUsedMb,
      state: c.state
    }))
  );

  state.composeProjects = composeProjects;
  return composeProjects;
}
