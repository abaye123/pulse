import { useEffect, useState } from 'react';
import { fetchJson, type HistoryResponse, type Range } from '@/lib/api';

export function useHistory(metric: string, range: Range, extra: Record<string, string> = {}) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const params = new URLSearchParams({ metric, range, ...extra });
    fetchJson<HistoryResponse>(`/api/history?${params.toString()}`)
      .then((res) => {
        if (alive) { setData(res); setError(null); }
      })
      .catch((err) => {
        if (alive) setError(err as Error);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, range, JSON.stringify(extra)]);

  return { data, error, loading };
}
