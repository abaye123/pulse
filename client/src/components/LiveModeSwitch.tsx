import { useTranslation } from 'react-i18next';
import { Radio } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface LiveModeSwitchProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

export function LiveModeSwitch({ value, onChange }: LiveModeSwitchProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <label className="flex cursor-pointer items-center gap-2">
            <Radio
              className={`h-4 w-4 transition-colors ${value ? 'text-destructive animate-pulse' : 'text-muted-foreground'}`}
            />
            <span className="hidden select-none text-xs font-medium sm:inline">
              {value ? t('live.on') : t('live.off')}
            </span>
            <Switch checked={value} onCheckedChange={onChange} aria-label={t('live.toggle')} />
          </label>
        </TooltipTrigger>
        <TooltipContent>{value ? t('live.tooltipOn') : t('live.tooltipOff')}</TooltipContent>
      </Tooltip>
    </div>
  );
}
