import cron from 'node-cron';
import { config } from './config.js';
import { purgeOlderThan } from './db.js';
import { state } from './state.js';
import { runSystemCollector } from './collectors/system.js';
import { runDockerCollector } from './collectors/docker.js';
import { refreshSites, runNginxCollector } from './collectors/nginx.js';
import { runLatencyCollector } from './collectors/latency.js';
import { publishOverview } from './sse.js';

function now() {
  return Date.now();
}

async function safeRun(label, fn) {
  const start = now();
  try {
    const result = await fn();
    const ms = now() - start;
    const count = Array.isArray(result) ? result.length : (result && typeof result === 'object' ? Object.keys(result).length : '-');
    console.log(`[collector] ${label} ok in ${ms}ms (items=${count})`);
    return { ok: true, result };
  } catch (err) {
    const ms = now() - start;
    console.error(`[collector] ${label} failed in ${ms}ms: ${err.message}`);
    return { ok: false, error: err };
  }
}

export async function runAllCollectorsOnce() {
  // System + Docker are independent of each other and of nginx parsing
  await Promise.allSettled([
    safeRun('system', runSystemCollector),
    safeRun('docker', runDockerCollector)
  ]);

  // Latency probes use parsed nginx sites; run it before the nginx collector
  // so the site_metrics rows carry fresh latency values.
  await safeRun('latency', runLatencyCollector);
  await safeRun('nginx', runNginxCollector);

  state.lastCollectionTs = Math.floor(Date.now() / 1000);

  // Broadcast the fresh snapshot to any SSE subscribers. No-op if none.
  try { publishOverview(); } catch {}
}

export async function runRetention() {
  const cutoff = Math.floor(Date.now() / 1000) - config.retentionDays * 86400;
  try {
    const deleted = purgeOlderThan(cutoff);
    console.log(`[retention] purged ${deleted} rows older than ${config.retentionDays}d`);
    return deleted;
  } catch (err) {
    console.error(`[retention] purge failed: ${err.message}`);
    throw err;
  }
}

export async function startScheduler() {
  // Load nginx site config once at boot
  await safeRun('nginx-parse', refreshSites);

  // Initial collection so the overview endpoint has data immediately
  await runAllCollectorsOnce();

  // Every minute, on the minute
  cron.schedule('* * * * *', () => {
    runAllCollectorsOnce().catch((err) => {
      console.error(`[scheduler] tick failed: ${err.message}`);
    });
  });

  // Re-parse nginx configs every 10 minutes to pick up new sites
  cron.schedule('*/10 * * * *', () => {
    safeRun('nginx-parse', refreshSites);
  });

  // Daily retention purge at 03:00
  cron.schedule('0 3 * * *', () => {
    runRetention().catch(() => {});
  });

  // On-startup retention (spec §8)
  runRetention().catch(() => {});

  console.log('[scheduler] started (every 1 minute, retention daily 03:00)');
}
