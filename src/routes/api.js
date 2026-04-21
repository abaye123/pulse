import os from 'node:os';
import { openDb, dbStats } from '../db.js';
import { state } from '../state.js';
import { run as shellRun, validateName } from '../lib/shell.js';
import { runSystemCollector } from '../collectors/system.js';
import { addSubscriber, removeSubscriber } from '../sse.js';

const RANGE_SECONDS = {
  '1h': 3600,
  '6h': 6 * 3600,
  '24h': 24 * 3600,
  '7d': 7 * 86400,
  '30d': 30 * 86400
};

// Bucket sizes tuned so every range returns ~<=1000 points.
const RANGE_BUCKETS = {
  '1h': 60,
  '6h': 60,
  '24h': 120,
  '7d': 600,
  '30d': 3600
};

function bucketize(range) {
  const seconds = RANGE_SECONDS[range] || RANGE_SECONDS['24h'];
  const bucket = RANGE_BUCKETS[range] || 60;
  const since = Math.floor(Date.now() / 1000) - seconds;
  return { since, bucket };
}

function aggregate(rows, valueKey) {
  return rows.map((r) => ({ ts: r.bucket_ts, value: Number(r[valueKey]) }));
}

function queryHistory(metric, query) {
  const range = query.range || '24h';
  const { since, bucket } = bucketize(range);
  const d = openDb();

  switch (metric) {
    case 'system.cpu': {
      const rows = d.prepare(`
        SELECT (ts / ?) * ? AS bucket_ts, AVG(cpu_pct) AS v
        FROM system_metrics
        WHERE ts >= ?
        GROUP BY bucket_ts
        ORDER BY bucket_ts
      `).all(bucket, bucket, since);
      return aggregate(rows, 'v');
    }
    case 'system.mem': {
      const rows = d.prepare(`
        SELECT (ts / ?) * ? AS bucket_ts,
               AVG(mem_used_mb) AS used,
               AVG(mem_total_mb) AS total
        FROM system_metrics
        WHERE ts >= ?
        GROUP BY bucket_ts
        ORDER BY bucket_ts
      `).all(bucket, bucket, since);
      return rows.map((r) => ({ ts: r.bucket_ts, usedMb: Math.round(r.used), totalMb: Math.round(r.total) }));
    }
    case 'system.load': {
      const rows = d.prepare(`
        SELECT (ts / ?) * ? AS bucket_ts,
               AVG(load1) AS l1, AVG(load5) AS l5, AVG(load15) AS l15
        FROM system_metrics
        WHERE ts >= ?
        GROUP BY bucket_ts
        ORDER BY bucket_ts
      `).all(bucket, bucket, since);
      return rows.map((r) => ({ ts: r.bucket_ts, load1: r.l1, load5: r.l5, load15: r.l15 }));
    }
    case 'system.net': {
      const rows = d.prepare(`
        SELECT (ts / ?) * ? AS bucket_ts,
               AVG(net_rx_bytes) AS rx, AVG(net_tx_bytes) AS tx
        FROM system_metrics
        WHERE ts >= ?
        GROUP BY bucket_ts
        ORDER BY bucket_ts
      `).all(bucket, bucket, since);
      return rows.map((r) => ({ ts: r.bucket_ts, rx: Math.round(r.rx), tx: Math.round(r.tx) }));
    }
    case 'system.disk': {
      const rows = d.prepare(`
        SELECT (ts / ?) * ? AS bucket_ts, mount,
               AVG(used_gb) AS used, AVG(total_gb) AS total
        FROM disk_metrics
        WHERE ts >= ?
        GROUP BY bucket_ts, mount
        ORDER BY bucket_ts
      `).all(bucket, bucket, since);
      return rows.map((r) => ({ ts: r.bucket_ts, mount: r.mount, usedGb: r.used, totalGb: r.total }));
    }
    case 'container.cpu': {
      const name = validateName(query.name);
      const rows = d.prepare(`
        SELECT (ts / ?) * ? AS bucket_ts, AVG(cpu_pct) AS v
        FROM container_metrics
        WHERE ts >= ? AND container_name = ?
        GROUP BY bucket_ts
        ORDER BY bucket_ts
      `).all(bucket, bucket, since, name);
      return aggregate(rows, 'v');
    }
    case 'container.mem': {
      const name = validateName(query.name);
      const rows = d.prepare(`
        SELECT (ts / ?) * ? AS bucket_ts, AVG(mem_used_mb) AS v
        FROM container_metrics
        WHERE ts >= ? AND container_name = ?
        GROUP BY bucket_ts
        ORDER BY bucket_ts
      `).all(bucket, bucket, since, name);
      return aggregate(rows, 'v');
    }
    case 'site.connections': {
      const name = String(query.name || '');
      const rows = d.prepare(`
        SELECT (ts / ?) * ? AS bucket_ts,
               AVG(http_connections) AS http, AVG(sse_connections) AS sse
        FROM site_metrics
        WHERE ts >= ? AND server_name = ?
        GROUP BY bucket_ts
        ORDER BY bucket_ts
      `).all(bucket, bucket, since, name);
      return rows.map((r) => ({ ts: r.bucket_ts, http: Math.round(r.http), sse: Math.round(r.sse) }));
    }
    case 'site.latency': {
      const name = String(query.name || '');
      const rows = d.prepare(`
        SELECT (ts / ?) * ? AS bucket_ts, AVG(latency_ms) AS v
        FROM site_metrics
        WHERE ts >= ? AND server_name = ? AND latency_ms IS NOT NULL
        GROUP BY bucket_ts
        ORDER BY bucket_ts
      `).all(bucket, bucket, since, name);
      return rows.map((r) => ({ ts: r.bucket_ts, latencyMs: r.v === null ? null : Math.round(r.v) }));
    }
    default:
      throw new Error(`unknown metric: ${metric}`);
  }
}

export default async function apiRoutes(fastify) {
  fastify.addHook('preHandler', fastify.requireAuth);

  fastify.get('/api/overview', async (req) => {
    // When ?live=true, refresh the system collector on-demand (cheap — ~50ms).
    // Docker/nginx/latency stay cached (1-minute cadence) because they're costly.
    if (req.query?.live === 'true' || req.query?.live === '1') {
      try {
        await runSystemCollector();
      } catch (err) {
        req.log.warn({ err: err.message }, 'live refresh of system collector failed');
      }
    }
    const sys = state.system || {
      cpuPct: 0, memUsedMb: 0, memTotalMb: 0, memAvailableMb: 0, memBuffCacheMb: 0,
      load: [0, 0, 0], uptimeSec: Math.round(os.uptime())
    };
    return {
      lastCollectionTs: state.lastCollectionTs,
      server: {
        cpuPct: sys.cpuPct,
        memUsedMb: sys.memUsedMb,
        memTotalMb: sys.memTotalMb,
        memAvailableMb: sys.memAvailableMb ?? 0,
        memBuffCacheMb: sys.memBuffCacheMb ?? 0,
        load: sys.load,
        uptimeSec: sys.uptimeSec
      },
      disk: state.disks,
      db: dbStats(),
      composeProjects: state.composeProjects,
      sites: state.sites
    };
  });

  fastify.get('/api/history', async (req, reply) => {
    const metric = String(req.query.metric || '');
    if (!metric) {
      reply.code(400);
      return { error: 'metric required' };
    }
    try {
      const points = queryHistory(metric, req.query);
      return { metric, range: req.query.range || '24h', points };
    } catch (err) {
      reply.code(400);
      return { error: err.message };
    }
  });

  fastify.get('/api/logs/container/:name', async (req, reply) => {
    let name;
    try {
      name = validateName(req.params.name);
    } catch (err) {
      reply.code(400);
      return { error: err.message };
    }
    const lines = Math.min(Math.max(Number(req.query.lines) || 200, 1), 5000);
    const result = await shellRun('/usr/bin/docker', ['logs', '--tail', String(lines), name]);
    return {
      name,
      lines,
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code
    };
  });

  // Server-Sent Events stream for the live-mode dashboard. While at least one
  // client is connected, sse.js also runs a fast system collector (every 2s)
  // so CPU/RAM/load stream in near-real-time.
  fastify.get('/api/stream', (req, reply) => {
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // Tells Nginx not to buffer the response (no effect elsewhere)
      'X-Accel-Buffering': 'no'
    });
    // Initial comment flushes headers through any intermediate proxies
    res.write(': connected\n\n');

    addSubscriber(res);

    const cleanup = () => {
      removeSubscriber(res);
      try { res.end(); } catch {}
    };
    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);

    // Tell Fastify not to finalize the response — sse.js owns it now.
    reply.hijack();
  });
}
