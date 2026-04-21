import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError, postAction, type RestartPolicy } from '@/lib/api';

const POLICIES: RestartPolicy[] = ['no', 'always', 'unless-stopped', 'on-failure'];

function policyVariant(policy: RestartPolicy): 'outline' | 'secondary' | 'success' | 'warning' {
  switch (policy) {
    case 'always': return 'success';
    case 'unless-stopped': return 'secondary';
    case 'on-failure': return 'warning';
    case 'no':
    default: return 'outline';
  }
}

interface RestartPolicyBadgeProps {
  containerName: string;
  policy: RestartPolicy;
  onChanged: () => void;
}

export function RestartPolicyBadge({ containerName, policy, onChanged }: RestartPolicyBadgeProps) {
  const { t } = useTranslation();

  const setPolicy = async (next: RestartPolicy) => {
    if (next === policy) return;
    try {
      await postAction(`/api/action/container/${encodeURIComponent(containerName)}/restart-policy/${next}`);
      toast.success(t('compose.restartPolicy.updated', { policy: t(`compose.restartPolicy.${next}`) }));
      onChanged();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      toast.error(t('actions.error', { message: msg }));
    }
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center"
              aria-label={t('compose.restartPolicy.label')}
            >
              <Badge variant={policyVariant(policy)} className="cursor-pointer gap-1">
                <RefreshCcw className="h-3 w-3" />
                <span>{t(`compose.restartPolicy.${policy}`)}</span>
              </Badge>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('compose.restartPolicy.tooltip')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('compose.restartPolicy.label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {POLICIES.map((p) => (
          <DropdownMenuItem key={p} onClick={() => setPolicy(p)} disabled={p === policy}>
            {t(`compose.restartPolicy.${p}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
