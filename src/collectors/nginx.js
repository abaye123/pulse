import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { parseSitesDir } from '../lib/nginx-parser.js';
import { currentMinuteTs, insertSiteMetrics } from '../db.js';
import { state } from '../state.js';

const execAsync = promisify(exec);

// Reloads the nginx site cache into state.nginxSites. Call at startup and
// whenever we suspect configs changed (e.g. after a nginx reload action).
export async function refreshSites() {
  const { sites, error } = await parseSitesDir(config.nginxSitesDir);
  if (error) {
    console.warn(`[nginx] could not read ${config.nginxSitesDir}: ${error}`);
  }
  state.nginxSites = sites;
  return sites;
}

export function getSites() {
  return state.nginxSites;
}

// Count outgoing nginx → backend established connections, grouped by remote port.
// We use a shell pipeline here (not execFile) because ss | grep | awk is the
// clearest way to express this. The command string is fully controlled (the
// only dynamic value is nginxProcessName, which we sanitize).
async function countBackendConnections() {
  const procName = config.nginxProcessName.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!procName) return new Map();
  const cmd = `ss -tnp state established 2>/dev/null | grep ${procName} | awk '{print $5}' | awk -F: '{print $NF}' | sort | uniq -c`;
  const counts = new Map();
  try {
    const { stdout } = await execAsync(cmd, { timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
    for (const line of stdout.trim().split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (m) counts.set(Number(m[2]), Number(m[1]));
    }
  } catch (err) {
    // ss may not be present in dev or may not have permission — return empty map
  }
  return counts;
}

// Merges connection counts into the existing state.sites (populated by latency collector)
// and persists a snapshot row per site.
export async function runNginxCollector() {
  const ts = currentMinuteTs();
  const sites = state.nginxSites.length > 0 ? state.nginxSites : await refreshSites();
  const counts = await countBackendConnections();

  const rows = [];
  const enriched = sites.map((s) => {
    const conn = s.backendPort ? (counts.get(s.backendPort) || 0) : 0;
    // HTTP and SSE share the same connection pool from Nginx's perspective — we
    // can't distinguish by port alone. Record both as the same number for now;
    // future improvement: parse Nginx access logs to classify /api/events.
    const httpConnections = conn;
    const sseConnections = conn;

    const existing = state.sites.find((x) => x.name === s.canonicalName);
    const latencyMs = existing?.latencyMs ?? null;
    const status = existing?.status ?? null;

    rows.push({
      ts,
      server_name: s.canonicalName,
      http_connections: httpConnections,
      sse_connections: sseConnections,
      latency_ms: latencyMs,
      http_status: status
    });

    return {
      name: s.canonicalName,
      backendPort: s.backendPort,
      isStatic: s.isStatic,
      httpConnections,
      sseConnections,
      latencyMs,
      status
    };
  });

  insertSiteMetrics(rows);
  state.sites = enriched;
  return enriched;
}
