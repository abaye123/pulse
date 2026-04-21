import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';

export function useDirection() {
  const { i18n } = useTranslation();
  const dir = i18n.language.startsWith('he') ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = i18n.language;
  }, [dir, i18n.language]);

  return dir;
}
