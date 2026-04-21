import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS system_metrics (
    ts INTEGER PRIMARY KEY,
    cpu_pct REAL NOT NULL,
    mem_used_mb INTEGER NOT NULL,
    mem_total_mb INTEGER NOT NULL,
    load1 REAL NOT NULL,
    load5 REAL NOT NULL,
    load15 REAL NOT NULL,
    net_rx_bytes INTEGER NOT NULL,
    net_tx_bytes INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS container_metrics (
    ts INTEGER NOT NULL,
    container_name TEXT NOT NULL,
    cpu_pct REAL NOT NULL,
    mem_used_mb INTEGER NOT NULL,
    state TEXT NOT NULL,
    PRIMARY KEY (ts, container_name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_container_name_ts ON container_metrics(container_name, ts)`,
  `CREATE TABLE IF NOT EXISTS site_metrics (
    ts INTEGER NOT NULL,
    server_name TEXT NOT NULL,
    http_connections INTEGER NOT NULL,
    sse_connections INTEGER NOT NULL,
    latency_ms INTEGER,
    http_status INTEGER,
    PRIMARY KEY (ts, server_name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_site_name_ts ON site_metrics(server_name, ts)`,
  `CREATE TABLE IF NOT EXISTS disk_metrics (
    ts INTEGER NOT NULL,
    mount TEXT NOT NULL,
    used_gb REAL NOT NULL,
    total_gb REAL NOT NULL,
    PRIMARY KEY (ts, mount)
  )`
];

let db = null;

export function openDb() {
  if (db) return db;
  mkdirSync(dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  for (const stmt of MIGRATIONS) db.exec(stmt);
  return db;
}

export function currentMinuteTs() {
  return Math.floor(Date.now() / 60000) * 60;
}

// -------- inserts (used by collectors) --------

export function insertSystemMetric(row) {
  const stmt = openDb().prepare(
    `INSERT OR REPLACE INTO system_metrics
     (ts, cpu_pct, mem_used_mb, mem_total_mb, load1, load5, load15, net_rx_bytes, net_tx_bytes)
     VALUES (@ts, @cpu_pct, @mem_used_mb, @mem_total_mb, @load1, @load5, @load15, @net_rx_bytes, @net_tx_bytes)`
  );
  stmt.run(row);
}

export function insertContainerMetrics(rows) {
  if (rows.length === 0) return;
  const stmt = openDb().prepare(
    `INSERT OR REPLACE INTO container_metrics
     (ts, container_name, cpu_pct, mem_used_mb, state)
     VALUES (@ts, @container_name, @cpu_pct, @mem_used_mb, @state)`
  );
  const tx = openDb().transaction((items) => {
    for (const item of items) stmt.run(item);
  });
  tx(rows);
}

export function insertSiteMetrics(rows) {
  if (rows.length === 0) return;
  const stmt = openDb().prepare(
    `INSERT OR REPLACE INTO site_metrics
     (ts, server_name, http_connections, sse_connections, latency_ms, http_status)
     VALUES (@ts, @server_name, @http_connections, @sse_connections, @latency_ms, @http_status)`
  );
  const tx = openDb().transaction((items) => {
    for (const item of items) stmt.run(item);
  });
  tx(rows);
}

export function insertDiskMetrics(rows) {
  if (rows.length === 0) return;
  const stmt = openDb().prepare(
    `INSERT OR REPLACE INTO disk_metrics
     (ts, mount, used_gb, total_gb)
     VALUES (@ts, @mount, @used_gb, @total_gb)`
  );
  const tx = openDb().transaction((items) => {
    for (const item of items) stmt.run(item);
  });
  tx(rows);
}

// -------- reads --------

export function dbStats() {
  const d = openDb();
  const oldest = d.prepare('SELECT MIN(ts) AS ts FROM system_metrics').get();
  const counts = d.prepare(`
    SELECT
      (SELECT COUNT(*) FROM system_metrics)    AS system_rows,
      (SELECT COUNT(*) FROM container_metrics) AS container_rows,
      (SELECT COUNT(*) FROM site_metrics)      AS site_rows,
      (SELECT COUNT(*) FROM disk_metrics)      AS disk_rows
  `).get();
  const size = d.prepare('SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()').get();
  const rowCount =
    (counts?.system_rows || 0) +
    (counts?.container_rows || 0) +
    (counts?.site_rows || 0) +
    (counts?.disk_rows || 0);
  return {
    pathBytes: size?.bytes || 0,
    oldestTs: oldest?.ts || null,
    rowCount
  };
}

export function purgeOlderThan(cutoffTs) {
  const d = openDb();
  const tx = d.transaction(() => {
    const a = d.prepare('DELETE FROM system_metrics    WHERE ts < ?').run(cutoffTs).changes;
    const b = d.prepare('DELETE FROM container_metrics WHERE ts < ?').run(cutoffTs).changes;
    const c = d.prepare('DELETE FROM site_metrics      WHERE ts < ?').run(cutoffTs).changes;
    const e = d.prepare('DELETE FROM disk_metrics      WHERE ts < ?').run(cutoffTs).changes;
    return a + b + c + e;
  });
  const deleted = tx();
  d.exec('VACUUM');
  return deleted;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
