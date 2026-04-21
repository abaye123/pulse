import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ApiError, postAction, type DbStats } from '@/lib/api';
import { formatBytes } from '@/lib/utils';

interface PurgeHistoryButtonProps {
  dbStats: DbStats | null;
  onPurged: () => void;
}

const RETENTION_DAYS_HINT = 30;

export function PurgeHistoryButton({ dbStats, onPurged }: PurgeHistoryButtonProps) {
  const { t } = useTranslation();
  const size = dbStats ? formatBytes(dbStats.pathBytes) : '—';

  const doPurge = async () => {
    try {
      const res = await postAction<{ ok: boolean; deleted?: number; error?: string }>('/api/action/db/purge');
      toast.success(t('history.purgeSuccess', { count: res.deleted ?? 0 }));
      onPurged();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      toast.error(t('actions.error', { message: msg }));
    }
  };

  return (
    <ConfirmDialog
      title={t('history.purge')}
      description={t('history.purgeConfirm', { days: RETENTION_DAYS_HINT })}
      confirmText={t('history.purge')}
      onConfirm={doPurge}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2">
            <Trash2 className="h-4 w-4" />
            <span className="hidden sm:inline text-xs">{size}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('history.size', { size })}</TooltipContent>
      </Tooltip>
    </ConfirmDialog>
  );
}
