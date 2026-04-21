import * as React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SiteDetailDialog } from '@/components/SiteDetailDialog';
import type { SiteSnapshot } from '@/lib/api';

type SortKey = 'name' | 'backendPort' | 'httpConnections' | 'latencyMs' | 'status';

interface SitesTableProps {
  sites: SiteSnapshot[];
  onChanged: () => void;
}

export function SitesTable({ sites, onChanged }: SitesTableProps) {
  const { t } = useTranslation();
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [openSite, setOpenSite] = useState<SiteSnapshot | null>(null);

  const sorted = useMemo(() => {
    const copy = [...sites];
    copy.sort((a, b) => {
      const av = (a as unknown as Record<SortKey, number | string | null>)[sortKey];
      const bv = (b as unknown as Record<SortKey, number | string | null>)[sortKey];
      const mult = sortDir === 'asc' ? 1 : -1;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return -1 * mult;
      if (av > bv) return 1 * mult;
      return 0;
    });
    return copy;
  }, [sites, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortHead = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <TableHead>
      <Button variant="ghost" size="sm" onClick={() => toggleSort(k)} className="-ms-2 h-7 px-2">
        {children}
        <ChevronsUpDown className="ms-2 h-3 w-3 opacity-50" />
      </Button>
    </TableHead>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sites.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead k="name">{t('sites.columns.name')}</SortHead>
              <SortHead k="backendPort">{t('sites.columns.port')}</SortHead>
              <SortHead k="httpConnections">{t('sites.columns.connections')}</SortHead>
              <SortHead k="latencyMs">{t('sites.columns.latency')}</SortHead>
              <SortHead k="status">{t('sites.columns.status')}</SortHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((s) => (
              <TableRow
                key={s.name}
                className="cursor-pointer"
                onClick={() => setOpenSite(s)}
              >
                <TableCell className="font-mono text-sm" dir="ltr">{s.name}</TableCell>
                <TableCell dir="ltr">
                  {s.backendPort ?? <Badge variant="outline">{t('sites.static')}</Badge>}
                </TableCell>
                <TableCell dir="ltr">{s.httpConnections}</TableCell>
                <TableCell dir="ltr">{s.latencyMs !== null ? `${s.latencyMs} ms` : '—'}</TableCell>
                <TableCell>
                  {s.status !== null ? (
                    <Badge variant={s.status >= 500 ? 'destructive' : s.status >= 400 ? 'warning' : 'success'}>
                      {s.status}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">—</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <SiteDetailDialog
        site={openSite}
        open={openSite !== null}
        onOpenChange={(o) => !o && setOpenSite(null)}
        onChanged={onChanged}
      />
    </Card>
  );
}
