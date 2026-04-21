import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { PurgeHistoryButton } from '@/components/PurgeHistoryButton';
import { LiveModeSwitch } from '@/components/LiveModeSwitch';
import { SystemMenu } from '@/components/SystemMenu';
import { fetchJson, type SessionUser, type DbStats } from '@/lib/api';

interface HeaderProps {
  dbStats: DbStats | null;
  onPurged: () => void;
  liveMode: boolean;
  onLiveModeChange: (value: boolean) => void;
}

export function Header({ dbStats, onPurged, liveMode, onLiveModeChange }: HeaderProps) {
  const { t } = useTranslation();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    fetchJson<SessionUser>('/api/session').then(setUser).catch(() => setUser(null));
  }, []);

  const initials = user?.name?.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <header className="sticky top-0 z-30 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container mx-auto flex h-16 items-center gap-4 px-4">
        <div className="flex items-center gap-2 font-semibold">
          <div className="rounded-lg bg-primary/10 p-1.5">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <span className="font-heading text-lg">{t('app.title')}</span>
        </div>

        <div className="ms-auto flex items-center gap-2">
          <LiveModeSwitch value={liveMode} onChange={onLiveModeChange} />
          <SystemMenu />
          <PurgeHistoryButton dbStats={dbStats} onPurged={onPurged} />
          <LanguageSwitcher />
          <ThemeSwitcher />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full" aria-label="user menu">
                {user?.picture ? (
                  <img src={user.picture} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    {initials}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="font-medium">{user?.name || '—'}</span>
                  <span className="text-xs text-muted-foreground font-normal">{user?.email || '—'}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href="/auth/logout" className="flex items-center">
                  <LogOut className="me-2 h-4 w-4" />
                  {t('nav.logout')}
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
