import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { RotateCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { useHistory } from '@/hooks/useHistory';
import { ApiError, postAction, type Range, type SiteSnapshot } from '@/lib/api';
import { ConfirmDialog } from '@/components/ConfirmDialog';

const RANGES: Range[] = ['1h', '6h', '24h', '7d', '30d'];

interface SiteDetailDialogProps {
  site: SiteSnapshot | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

function formatTick(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function guessProjectFromSite(siteName: string): string | null {
  // e.g. mesudrim.chatfree.app → "mesudrim"
  const parts = siteName.split('.');
  return parts[0] || null;
}

export function SiteDetailDialog({ site, open, onOpenChange, onChanged }: SiteDetailDialogProps) {
  const { t } = useTranslation();
  const [range, setRange] = useState<Range>('24h');

  const connections = useHistory('site.connections', range, site ? { name: site.name } : {});
  const latency = useHistory('site.latency', range, site ? { name: site.name } : {});

  const project = site ? guessProjectFromSite(site.name) : null;

  const doRestart = async () => {
    if (!project) return;
    try {
      await postAction(`/api/action/compose/${encodeURIComponent(project)}/restart`);
      toast.success(t('actions.success'));
      onChanged();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      toast.error(`${t('actions.error', { message: msg })}`);
    }
  };

  if (!site) return null;

  const connPoints = (connections.data?.points || []).map((p) => ({
    ts: p.ts, http: Number(p.http) || 0, sse: Number(p.sse) || 0
  }));
  const latPoints = (latency.data?.points || [])
    .filter((p) => p.latencyMs !== null)
    .map((p) => ({ ts: p.ts, latencyMs: Number(p.latencyMs) || 0 }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-mono" dir="ltr">{site.name}</DialogTitle>
          <DialogDescription>
            {site.backendPort ? (
              <span dir="ltr">localhost:{site.backendPort}</span>
            ) : (
              <span>{t('sites.static')}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-end">
          <Select value={range} onValueChange={(v) => setRange(v as Range)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => <SelectItem key={r} value={r}>{t(`history.range.${r}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">{t('sites.latencyChart')}</h3>
            <div className="h-48 w-full">
              {latency.loading ? (
                <Skeleton className="h-full w-full" />
              ) : latPoints.length === 0 ? (
                <p className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('charts.noData')}</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={latPoints} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="ts" tickFormatter={formatTick} fontSize={11} stroke="hsl(var(--muted-foreground))" />
                    <YAxis unit=" ms" fontSize={11} stroke="hsl(var(--muted-foreground))" />
                    <RTooltip
                      labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()}
                      contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                    />
                    <Line type="monotone" dataKey="latencyMs" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">{t('sites.connectionsChart')}</h3>
            <div className="h-48 w-full">
              {connections.loading ? (
                <Skeleton className="h-full w-full" />
              ) : connPoints.length === 0 ? (
                <p className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('charts.noData')}</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={connPoints} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="ts" tickFormatter={formatTick} fontSize={11} stroke="hsl(var(--muted-foreground))" />
                    <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
                    <RTooltip
                      labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()}
                      contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                    />
                    <Line type="monotone" dataKey="http" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          {project ? (
            <ConfirmDialog
              title={t('actions.confirm', { action: t('compose.actions.restart'), target: project })}
              description={t('actions.confirmDetails')}
              confirmText={t('compose.actions.restart')}
              onConfirm={doRestart}
            >
              <Button variant="outline">
                <RotateCw className="me-2 h-4 w-4" />
                {t('sites.restartProject')}
              </Button>
            </ConfirmDialog>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
