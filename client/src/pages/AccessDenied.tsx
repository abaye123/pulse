import { useTranslation } from 'react-i18next';
import { useSearchParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShieldAlert } from 'lucide-react';

export default function AccessDenied() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const email = params.get('email') || '';
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="rounded-2xl bg-destructive/10 p-4 mb-2">
            <ShieldAlert className="h-8 w-8 text-destructive" />
          </div>
          <CardTitle className="text-2xl">{t('auth.deniedTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-muted-foreground">
            {t('auth.deniedMessage', { email })}
          </p>
          <Button asChild variant="outline">
            <Link to="/login">{t('auth.deniedBack')}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
