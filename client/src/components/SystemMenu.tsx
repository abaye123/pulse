import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Server, RefreshCw, Power, ShieldCheck, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ApiError, postAction } from '@/lib/api';

const REBOOT_PHRASE = 'REBOOT';

async function runAction(url: string, successMsg: string, errorMsg: string) {
  try {
    await postAction(url);
    toast.success(successMsg);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : String(err);
    toast.error(`${errorMsg}: ${msg}`);
  }
}

export function SystemMenu() {
  const { t } = useTranslation();
  const [confirmReload, setConfirmReload] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [rebootOpen, setRebootOpen] = useState(false);
  const [rebootInput, setRebootInput] = useState('');
  const [rebootBusy, setRebootBusy] = useState(false);

  const doReload = () => runAction('/api/action/nginx/reload', t('actions.success'), t('actions.error', { message: '' }).replace(/:?\s*$/, ''));
  const doRestartNginx = () => runAction('/api/action/nginx/restart', t('actions.success'), t('actions.error', { message: '' }).replace(/:?\s*$/, ''));
  const doTest = async () => {
    try {
      const res = await postAction<{ ok: boolean; stdout: string; stderr: string }>('/api/action/nginx/test');
      const output = (res.stdout + '\n' + res.stderr).trim();
      if (res.ok) toast.success(output || 'ok');
      else toast.error(output || 'nginx -t failed');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      toast.error(t('actions.error', { message: msg }));
    }
  };

  const doReboot = async () => {
    setRebootBusy(true);
    try {
      await postAction('/api/action/server/reboot');
      toast.success(t('system.rebootSuccess'));
      setRebootOpen(false);
      setRebootInput('');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      toast.error(t('actions.error', { message: msg }));
    } finally {
      setRebootBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            <Server className="h-4 w-4" />
            <span className="hidden sm:inline">{t('system.menu')}</span>
            <ChevronDown className="h-3 w-3 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-72">
          <DropdownMenuLabel>Nginx</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setConfirmReload(true)}>
            <RefreshCw className="me-2 h-4 w-4" />
            <div className="flex flex-col items-start">
              <span>{t('system.nginxReload')}</span>
              <span className="text-xs text-muted-foreground font-normal">{t('system.nginxReloadDesc')}</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setConfirmRestart(true)}>
            <RefreshCw className="me-2 h-4 w-4" />
            <div className="flex flex-col items-start">
              <span>{t('system.nginxRestart')}</span>
              <span className="text-xs text-muted-foreground font-normal">{t('system.nginxRestartDesc')}</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={doTest}>
            <ShieldCheck className="me-2 h-4 w-4" />
            <div className="flex flex-col items-start">
              <span>{t('system.nginxTest')}</span>
              <span className="text-xs text-muted-foreground font-normal">{t('system.nginxTestDesc')}</span>
            </div>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Host</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setRebootOpen(true)} className="text-destructive focus:text-destructive">
            <Power className="me-2 h-4 w-4" />
            <div className="flex flex-col items-start">
              <span>{t('system.reboot')}</span>
              <span className="text-xs text-muted-foreground font-normal">{t('system.rebootDesc')}</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Reload confirmation */}
      <ConfirmDialogWrapper
        open={confirmReload}
        onOpenChange={setConfirmReload}
        title={t('system.nginxReload')}
        description={t('system.nginxReloadDesc')}
        confirmText={t('system.nginxReload')}
        destructive={false}
        onConfirm={doReload}
      />

      {/* Restart confirmation */}
      <ConfirmDialogWrapper
        open={confirmRestart}
        onOpenChange={setConfirmRestart}
        title={t('system.nginxRestart')}
        description={t('system.nginxRestartDesc')}
        confirmText={t('system.nginxRestart')}
        destructive={true}
        onConfirm={doRestartNginx}
      />

      {/* Reboot — type-to-confirm */}
      <AlertDialog open={rebootOpen} onOpenChange={(o) => { if (!o) { setRebootInput(''); } setRebootOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Power className="h-5 w-5" />
              {t('system.rebootConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('system.rebootConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('system.rebootConfirmInput')}</label>
            <Input
              value={rebootInput}
              onChange={(e) => setRebootInput(e.target.value)}
              placeholder={REBOOT_PHRASE}
              dir="ltr"
              className="font-mono"
              disabled={rebootBusy}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rebootBusy}>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); doReboot(); }}
              disabled={rebootBusy || rebootInput.trim() !== REBOOT_PHRASE}
              className={cn(buttonVariants({ variant: 'destructive' }))}
            >
              {rebootBusy ? t('system.rebootPending') : t('system.reboot')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// -- controlled-open variant of ConfirmDialog ---------------------------------

interface ConfirmDialogWrapperProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText: string;
  destructive: boolean;
  onConfirm: () => void | Promise<void>;
}

function ConfirmDialogWrapper({ open, onOpenChange, title, description, confirmText, destructive, onConfirm }: ConfirmDialogWrapperProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const handle = async (e: React.MouseEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await onConfirm(); onOpenChange(false); }
    finally { setBusy(false); }
  };
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handle}
            disabled={busy}
            className={cn(destructive && buttonVariants({ variant: 'destructive' }))}
          >
            {busy ? t('actions.pending') : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
