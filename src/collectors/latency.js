import { state } from '../state.js';
import { getSites } from './nginx.js';

const LATENCY_CONCURRENCY = 20;
const REQUEST_TIMEOUT_MS = 5000;

async function probe(site) {
  if (!site.backendPort) {
    return { name: site.canonicalName, latencyMs: null, status: null };
  }
  const url = `http://127.0.0.1:${site.backendPort}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'manual'
    });
    return {
      name: site.canonicalName,
      latencyMs: Date.now() - start,
      status: res.status
    };
  } catch (err) {
    return { name: site.canonicalName, latencyMs: null, status: null };
  } finally {
    clearTimeout(timer);
  }
}

async function limitedParallel(items, worker, concurrency) {
  const out = new Array(items.length);
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await worker(items[idx]);
      } catch {
        out[idx] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  return out.filter(Boolean);
}

export async function runLatencyCollector() {
  const sites = getSites();
  const results = await limitedParallel(sites, probe, LATENCY_CONCURRENCY);

  const byName = new Map(results.map((r) => [r.name, r]));

  // Merge latency + status into the existing state.sites (which holds connection counts
  // from the nginx collector). If state.sites is empty (first run), seed it from config.
  const base = state.sites.length > 0 ? state.sites : sites.map((s) => ({
    name: s.canonicalName,
    backendPort: s.backendPort,
    isStatic: s.isStatic,
    httpConnections: 0,
    sseConnections: 0,
    latencyMs: null,
    status: null
  }));

  state.sites = base.map((s) => {
    const hit = byName.get(s.name);
    if (!hit) return s;
    return { ...s, latencyMs: hit.latencyMs, status: hit.status };
  });

  return state.sites;
}
