import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Play, Square, RotateCw } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RestartPolicyBadge } from '@/components/RestartPolicyBadge';
import { ApiError, postAction, type ComposeProject, type ContainerSnapshot } from '@/lib/api';
import { formatUptime } from '@/lib/utils';

interface ComposeProjectCardProps {
  project: ComposeProject;
  onChanged: () => void;
}

type ContainerAction = 'start' | 'stop' | 'restart';
type ComposeAction = 'up' | 'down' | 'restart';

function stateBadgeVariant(state: string): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (state === 'running') return 'success';
  if (state === 'exited' || state === 'dead') return 'destructive';
  if (state === 'restarting' || state === 'created') return 'warning';
  return 'secondary';
}

async function runAndToast(url: string, successMsg: string, errorPrefix: string, onChanged: () => void) {
  try {
    await postAction(url);
    toast.success(successMsg);
    onChanged();
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : String(err);
    toast.error(`${errorPrefix}: ${msg}`);
  }
}

function ContainerRow({ container, onChanged }: { container: ContainerSnapshot; onChanged: () => void }) {
  const { t } = useTranslation();
  const disabled = container.state !== 'running';

  const doAction = (action: ContainerAction) =>
    runAndToast(
      `/api/action/container/${encodeURIComponent(container.name)}/${action}`,
      t('actions.success'),
      t('actions.error', { message: '' }).replace(/:?\s*$/, ''),
      onChanged
    );

  const ActionButton = ({ action, icon: Icon, label, destructive }: {
    action: ContainerAction;
    icon: typeof Play;
    label: string;
    destructive?: boolean;
  }) => (
    <ConfirmDialog
      title={t('actions.confirm', { action: label, target: container.name })}
      description={t('actions.confirmDetails')}
      confirmText={label}
      destructive={!!destructive}
      onConfirm={() => doAction(action)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={label}>
            <Icon className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </ConfirmDialog>
  );

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${container.state === 'running' ? 'bg-success' : 'bg-destructive'}`} />
          <span className="truncate font-mono text-sm" dir="ltr">{container.name}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground" dir="ltr">
          <span>{container.cpuPct.toFixed(1)}%</span>
          <span>{container.memUsedMb} MB</span>
          <span>{formatUptime(container.uptimeSec)}</span>
          {container.restartCount > 0 ? <span className="text-warning">restarts: {container.restartCount}</span> : null}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {container.state === 'running' ? (
          <>
            <ActionButton action="restart" icon={RotateCw} label={t('compose.actions.restart')} />
            <ActionButton action="stop" icon={Square} label={t('compose.actions.stop')} destructive />
          </>
        ) : (
          <ActionButton action="start" icon={Play} label={t('compose.actions.start')} />
        )}
      </div>
      <RestartPolicyBadge
        containerName={container.name}
        policy={container.restartPolicy}
        onChanged={onChanged}
      />
      <Badge variant={stateBadgeVariant(container.state)} className="min-w-16 justify-center">
        {t(`compose.${container.state}`, { defaultValue: container.state })}
      </Badge>
    </div>
  );
}

export function ComposeProjectCard({ project, onChanged }: ComposeProjectCardProps) {
  const { t } = useTranslation();
  const name = project.name || t('compose.standalone');
  const running = project.containers.filter((c) => c.state === 'running').length;
  const total = project.containers.length;
  const allRunning = running === total && total > 0;

  const doCompose = (action: ComposeAction) =>
    runAndToast(
      `/api/action/compose/${encodeURIComponent(project.name || '')}/${action}`,
      t('actions.success'),
      t('actions.error', { message: '' }).replace(/:?\s*$/, ''),
      onChanged
    );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="font-mono text-base" dir="ltr">{name}</CardTitle>
        <Badge variant={allRunning ? 'success' : total === 0 ? 'secondary' : 'warning'}>
          {allRunning ? t('compose.allRunning', { count: total }) : t('compose.someDown', { running, total })}
        </Badge>
      </CardHeader>
      <CardContent className="pt-0">
        <Separator />
        <div className="divide-y">
          {project.containers.map((c) => (
            <ContainerRow key={c.name} container={c} onChanged={onChanged} />
          ))}
        </div>
      </CardContent>
      {project.name ? (
        <CardFooter className="flex gap-2 pt-0">
          <ConfirmDialog
            title={t('actions.confirm', { action: t('compose.actions.up'), target: project.name })}
            description={t('actions.confirmDetails')}
            confirmText={t('compose.actions.up')}
            destructive={false}
            onConfirm={() => doCompose('up')}
          >
            <Button size="sm" variant="outline"><Play className="me-2 h-4 w-4" />{t('compose.actions.up')}</Button>
          </ConfirmDialog>
          <ConfirmDialog
            title={t('actions.confirm', { action: t('compose.actions.restart'), target: project.name })}
            description={t('actions.confirmDetails')}
            confirmText={t('compose.actions.restart')}
            onConfirm={() => doCompose('restart')}
          >
            <Button size="sm" variant="outline"><RotateCw className="me-2 h-4 w-4" />{t('compose.actions.restart')}</Button>
          </ConfirmDialog>
          <ConfirmDialog
            title={t('actions.confirm', { action: t('compose.actions.down'), target: project.name })}
            description={t('actions.confirmDetails')}
            confirmText={t('compose.actions.down')}
            onConfirm={() => doCompose('down')}
          >
            <Button size="sm" variant="outline"><Square className="me-2 h-4 w-4" />{t('compose.actions.down')}</Button>
          </ConfirmDialog>
        </CardFooter>
      ) : null}
    </Card>
  );
}
