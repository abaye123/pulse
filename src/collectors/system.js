import os from 'node:os';
import si from 'systeminformation';
import { currentMinuteTs, insertSystemMetric, insertDiskMetrics } from '../db.js';
import { state } from '../state.js';

export async function collectSystem() {
  const [load, mem, fs, net] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.networkStats().catch(() => [])
  ]);

  const loadavg = os.loadavg();
  const defaultIface = (net || []).find((n) => !n.iface?.startsWith('lo') && !n.iface?.startsWith('docker')) || net[0] || {};

  const system = {
    cpuPct: Number((load.currentLoad || 0).toFixed(2)),
    memUsedMb: Math.round((mem.used || 0) / 1024 / 1024),
    memTotalMb: Math.round((mem.total || 0) / 1024 / 1024),
    load: [loadavg[0], loadavg[1], loadavg[2]],
    uptimeSec: Math.round(os.uptime()),
    netRxBytes: Math.round(defaultIface.rx_bytes || 0),
    netTxBytes: Math.round(defaultIface.tx_bytes || 0)
  };

  const disks = (fs || [])
    .filter((d) => d.mount && d.size > 0)
    .map((d) => ({
      mount: d.mount,
      usedGb: Number((d.used / 1024 / 1024 / 1024).toFixed(2)),
      totalGb: Number((d.size / 1024 / 1024 / 1024).toFixed(2))
    }));

  return { system, disks };
}

export async function runSystemCollector() {
  const ts = currentMinuteTs();
  const { system, disks } = await collectSystem();

  insertSystemMetric({
    ts,
    cpu_pct: system.cpuPct,
    mem_used_mb: system.memUsedMb,
    mem_total_mb: system.memTotalMb,
    load1: system.load[0],
    load5: system.load[1],
    load15: system.load[2],
    net_rx_bytes: system.netRxBytes,
    net_tx_bytes: system.netTxBytes
  });

  insertDiskMetrics(
    disks.map((d) => ({
      ts,
      mount: d.mount,
      used_gb: d.usedGb,
      total_gb: d.totalGb
    }))
  );

  state.system = system;
  state.disks = disks;
  return { system, disks };
}
