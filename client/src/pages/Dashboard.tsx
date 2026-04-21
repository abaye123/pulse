import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { Header } from '@/components/Header';
import { ServerOverview } from '@/components/ServerOverview';
import { SystemCharts } from '@/components/SystemCharts';
import { ComposeProjectCard } from '@/components/ComposeProjectCard';
import { SitesTable } from '@/components/SitesTable';
import { useOverview } from '@/hooks/useOverview';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

export default function Dashboard() {
  const { t } = useTranslation();
  const { data, error, refresh } = useOverview(5000);

  const projects = data?.composeProjects || [];
  const standaloneFirst = useMemo(() => {
    const named = projects.filter((p) => p.name);
    const standalone = projects.filter((p) => !p.name);
    return [...named, ...standalone];
  }, [projects]);

  const lastUpdatedSec = useMemo(() => {
    if (!data?.lastCollectionTs) return null;
    return Math.max(0, Math.floor(Date.now() / 1000) - data.lastCollectionTs);
  }, [data]);

  return (
    <div className="min-h-screen bg-background">
      <Header dbStats={data?.db || null} onPurged={refresh} />

      <main className="container mx-auto px-4 py-6 space-y-6">
        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t('common.error')}</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{t('app.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('app.subtitle')}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {lastUpdatedSec === null
              ? t('overview.neverUpdated')
              : t('overview.lastUpdate', { seconds: lastUpdatedSec })}
          </p>
        </div>

        <ServerOverview overview={data} />

        <SystemCharts />

        <section>
          <h2 className="mb-3 font-heading text-xl font-semibold">{t('compose.projectsTitle')}</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {standaloneFirst.map((project) => (
              <ComposeProjectCard
                key={project.name || '__standalone__'}
                project={project}
                onChanged={refresh}
              />
            ))}
          </div>
        </section>

        <Separator />

        <SitesTable sites={data?.sites || []} onChanged={refresh} />
      </main>
    </div>
  );
}
