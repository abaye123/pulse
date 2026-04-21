import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Moon, Sun } from 'lucide-react';

function currentIsDark() {
  return document.documentElement.classList.contains('dark');
}

export function ThemeSwitcher() {
  const { t } = useTranslation();
  const [isDark, setIsDark] = useState<boolean>(() => currentIsDark());

  useEffect(() => {
    setIsDark(currentIsDark());
  }, []);

  const toggle = () => {
    const next = !isDark;
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('monitor_theme', next ? 'dark' : 'light');
    setIsDark(next);
  };

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={isDark ? t('theme.toggleLight') : t('theme.toggleDark')}>
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}
