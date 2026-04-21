import * as React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, MemoryStick, Network, HardDrive } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  AreaChart,
  Area
} from 'recharts';
import { useHistory } from '@/hooks/useHistory';
import type { Range } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';

const RANGES: Range[] = ['1h', '6h', '24h', '7d', '30d'];

function formatTick(ts: number, range: Range): string {
  const d = new Date(ts * 1000);
  if (range === '1h' || range === '6h' || range === '24h') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
}

interface RangeSelectProps {
  value: Range;
  onChange: (r: Range) => void;
}

function RangeSelect({ value, onChange }: RangeSelectProps) {
  const { t } = useTranslation();
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Range)}>
      <SelectTrigger className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {RANGES.map((r) => (
          <SelectItem key={r} value={r}>
            {t(`history.range.${r}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface ChartBodyProps {
  loading: boolean;
  hasPoints: boolean;
  children: React.ReactNode;
}

function ChartBody({ loading, hasPoints, children }: ChartBodyProps) {
  const { t } = useTranslation();
  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!hasPoints) return <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">{t('charts.noData')}</p>;
  return <div className="h-64 w-full">{children}</div>;
}

function CpuTab({ range }: { range: Range }) {
  const { data, loading } = useHistory('system.cpu', range);
  const points = (data?.points || []).map((p) => ({ ts: p.ts, cpu: Number(p.value) || 0 }));
  return (
    <ChartBody loading={loading} hasPoints={points.length > 0}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="g-cpu" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="ts" tickFormatter={(v) => formatTick(v, range)} fontSize={12} stroke="hsl(var(--muted-foreground))" />
          <YAxis unit="%" fontSize={12} stroke="hsl(var(--muted-foreground))" />
          <RechartsTooltip
            labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()}
            contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
          />
          <Area type="monotone" dataKey="cpu" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#g-cpu)" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartBody>
  );
}

function MemoryTab({ range }: { range: Range }) {
  const { data, loading } = useHistory('system.mem', range);
  const points = (data?.points || []).map((p) => ({
    ts: p.ts,
    usedMb: Number(p.usedMb) || 0,
    totalMb: Number(p.totalMb) || 0
  }));
  return (
    <ChartBody loading={loading} hasPoints={points.length > 0}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="ts" tickFormatter={(v) => formatTick(v, range)} fontSize={12} stroke="hsl(var(--muted-foreground))" />
          <YAxis unit=" MB" fontSize={12} stroke="hsl(var(--muted-foreground))" />
          <RechartsTooltip
            labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()}
            contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
          />
          <Legend />
          <Line type="monotone" dataKey="usedMb" stroke="hsl(var(--secondary))" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="totalMb" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={1} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartBody>
  );
}

function NetworkTab({ range }: { range: Range }) {
  const { data, loading } = useHistory('system.net', range);
  const points = (data?.points || []).map((p) => ({
    ts: p.ts,
    rx: Number(p.rx) || 0,
    tx: Number(p.tx) || 0
  }));
  return (
    <ChartBody loading={loading} hasPoints={points.length > 0}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="ts" tickFormatter={(v) => formatTick(v, range)} fontSize={12} stroke="hsl(var(--muted-foreground))" />
          <YAxis fontSize={12} stroke="hsl(var(--muted-foreground))" />
          <RechartsTooltip
            labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()}
            contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
          />
          <Legend />
          <Line type="monotone" dataKey="rx" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="tx" stroke="hsl(var(--secondary))" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartBody>
  );
}

function DiskTab({ range }: { range: Range }) {
  const { data, loading } = useHistory('system.disk', range);
  const points = (data?.points || [])
    .map((p) => ({ ts: p.ts, usedGb: Number(p.usedGb) || 0, totalGb: Number(p.totalGb) || 0 }));
  return (
    <ChartBody loading={loading} hasPoints={points.length > 0}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="g-disk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="ts" tickFormatter={(v) => formatTick(v, range)} fontSize={12} stroke="hsl(var(--muted-foreground))" />
          <YAxis unit=" GB" fontSize={12} stroke="hsl(var(--muted-foreground))" />
          <RechartsTooltip
            labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()}
            contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
          />
          <Area type="monotone" dataKey="usedGb" stroke="hsl(var(--success))" strokeWidth={2} fill="url(#g-disk)" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartBody>
  );
}

export function SystemCharts() {
  const { t } = useTranslation();
  const [range, setRange] = useState<Range>('24h');

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('charts.title')}</CardTitle>
        <RangeSelect value={range} onChange={setRange} />
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="cpu">
          <TabsList>
            <TabsTrigger value="cpu"><Cpu className="me-2 h-4 w-4" />{t('charts.cpu')}</TabsTrigger>
            <TabsTrigger value="memory"><MemoryStick className="me-2 h-4 w-4" />{t('charts.memory')}</TabsTrigger>
            <TabsTrigger value="network"><Network className="me-2 h-4 w-4" />{t('charts.network')}</TabsTrigger>
            <TabsTrigger value="disk"><HardDrive className="me-2 h-4 w-4" />{t('charts.disk')}</TabsTrigger>
          </TabsList>
          <TabsContent value="cpu"><CpuTab range={range} /></TabsContent>
          <TabsContent value="memory"><MemoryTab range={range} /></TabsContent>
          <TabsContent value="network"><NetworkTab range={range} /></TabsContent>
          <TabsContent value="disk"><DiskTab range={range} /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
