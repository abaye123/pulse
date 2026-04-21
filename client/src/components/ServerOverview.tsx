import { useTranslation } from 'react-i18next';
import { Cpu, MemoryStick, Activity, HardDrive } from 'lucide-react';
import { MetricCard } from '@/components/MetricCard';
import { useHistory } from '@/hooks/useHistory';
import type { OverviewResponse } from '@/lib/api';
import { formatUptime, formatMb } from '@/lib/utils';

interface ServerOverviewProps {
  overview: OverviewResponse | null;
}

function computeDiskRatio(disks: OverviewResponse['disk']) {
  const root = disks?.find((d) => d.mount === '/') || disks?.[0];
  if (!root) return { pct: 0, used: 0, total: 0 };
  const pct = root.totalGb > 0 ? (root.usedGb / root.totalGb) * 100 : 0;
  return { pct, used: root.usedGb, total: root.totalGb, mount: root.mount };
}

export function ServerOverview({ overview }: ServerOverviewProps) {
  const { t } = useTranslation();
  const cpuHist = useHistory('system.cpu', '1h');
  const memHist = useHistory('system.mem', '1h');
  const loadHist = useHistory('system.load', '1h');

  const server = overview?.server;
  const disk = computeDiskRatio(overview?.disk || []);

  const cpuSpark = (cpuHist.data?.points || []).map((p) => ({ value: Number(p.value) || 0 }));
  const memSpark = (memHist.data?.points || []).map((p) => ({
    value: p.usedMb && p.totalMb ? (Number(p.usedMb) / Number(p.totalMb)) * 100 : 0
  }));
  const loadSpark = (loadHist.data?.points || []).map((p) => ({ value: Number(p.load1) || 0 }));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        label={t('overview.cpu')}
        value={server ? `${server.cpuPct.toFixed(1)}%` : '—'}
        hint={`${t('overview.uptime')}: ${server ? formatUptime(server.uptimeSec) : '—'}`}
        icon={Cpu}
        sparkline={cpuSpark}
      />
      <MetricCard
        label={t('overview.memory')}
        value={server ? `${((server.memUsedMb / Math.max(server.memTotalMb, 1)) * 100).toFixed(0)}%` : '—'}
        hint={
          server
            ? `${formatMb(server.memUsedMb)} / ${formatMb(server.memTotalMb)}` +
              (server.memBuffCacheMb ? ` • +${formatMb(server.memBuffCacheMb)} ${t('overview.cache')}` : '')
            : ''
        }
        icon={MemoryStick}
        sparkline={memSpark}
        sparklineColor="hsl(var(--secondary))"
      />
      <MetricCard
        label={t('overview.load')}
        value={server ? server.load[0].toFixed(2) : '—'}
        hint={server ? `${server.load[0].toFixed(2)} / ${server.load[1].toFixed(2)} / ${server.load[2].toFixed(2)}` : ''}
        icon={Activity}
        sparkline={loadSpark}
        sparklineColor="hsl(var(--warning))"
      />
      <MetricCard
        label={t('overview.disk')}
        value={`${disk.pct.toFixed(0)}%`}
        hint={`${disk.used.toFixed(1)} / ${disk.total.toFixed(1)} GB`}
        icon={HardDrive}
        sparklineColor="hsl(var(--success))"
      />
    </div>
  );
}
