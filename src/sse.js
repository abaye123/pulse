// Server-Sent Events hub: keeps track of connected clients and drives a
// fast system-collector timer that runs ONLY while at least one client is
// streaming. When the last client disconnects, we fall back to the normal
// 1-minute cadence scheduled in scheduler.js.

import { runSystemCollector } from './collectors/system.js';
import { state } from './state.js';
import { dbStats } from './db.js';
import os from 'node:os';

const FAST_INTERVAL_MS = 2000;
const HEARTBEAT_MS = 25000;

const subscribers = new Set();
let fastTimer = null;
let heartbeatTimer = null;

function buildOverview() {
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
}

function write(res, payload) {
  try {
    return res.write(payload);
  } catch {
    // broken pipe — caller cleans up via 'close' event
    return false;
  }
}

function sendEvent(res, event, data) {
  write(res, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function publishOverview() {
  if (subscribers.size === 0) return;
  const snap = buildOverview();
  for (const res of subscribers) sendEvent(res, 'overview', snap);
}

function ensureHeartbeat() {
  if (heartbeatTimer || subscribers.size === 0) return;
  heartbeatTimer = setInterval(() => {
    for (const res of subscribers) write(res, `: ping\n\n`);
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function ensureFastTimer() {
  if (fastTimer || subscribers.size === 0) return;
  fastTimer = setInterval(async () => {
    try {
      await runSystemCollector();
      publishOverview();
    } catch (err) {
      // swallow — next tick will try again
    }
  }, FAST_INTERVAL_MS);
}

function stopFastTimer() {
  if (fastTimer) {
    clearInterval(fastTimer);
    fastTimer = null;
  }
}

export function addSubscriber(res) {
  subscribers.add(res);
  ensureFastTimer();
  ensureHeartbeat();
  // Send current snapshot immediately so the UI isn't blank while it waits
  // for the next collector tick.
  sendEvent(res, 'overview', buildOverview());
}

export function removeSubscriber(res) {
  subscribers.delete(res);
  if (subscribers.size === 0) {
    stopFastTimer();
    stopHeartbeat();
  }
}

export function subscriberCount() {
  return subscribers.size;
}
