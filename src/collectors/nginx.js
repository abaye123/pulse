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

// Match one IPv4 or bracketed IPv6 address followed by :port, capturing the port.
const ADDR_PORT_RE = /(?:\[[0-9a-f:]+\]|\d+\.\d+\.\d+\.\d+):(\d+)/gi;

// Count ALL established connections owned by the Nginx worker, grouped by the
// port on the peer side. For a nginx→backend connection the peer is
// 127.0.0.1:<backend_port>, so grouping by peer port gives active connections
// per site. For browser→nginx connections the peer is the client's ephemeral
// port, so those buckets look random and never match a backend_port — i.e.
// they're harmless noise once we lookup sites by their specific backend port.
//
// We parse in JS (not with awk) because the column positions of `ss` output
// shift depending on whether `state X` filters include the State column, and
// a regex-based scan is robust across Ubuntu/kernel versions.
async function countBackendConnections() {
  const procName = config.nginxProcessName || 'nginx';
  try {
    const { stdout } = await execAsync(
      'ss -tnp state established',
      { timeout: 10000, maxBuffer: 8 * 1024 * 1024 }
    );
    const counts = new Map();
    for (const line of stdout.split('\n')) {
      if (!line.includes(`"${procName}"`)) continue;
      const matches = [...line.matchAll(ADDR_PORT_RE)];
      // Two addr:port tokens per connection: local first, peer second.
      if (matches.length < 2) continue;
      const peerPort = Number(matches[1][1]);
      if (!Number.isFinite(peerPort)) continue;
      counts.set(peerPort, (counts.get(peerPort) || 0) + 1);
    }
    return counts;
  } catch (err) {
    // ss not available or no permission — return empty map
    return new Map();
  }
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
