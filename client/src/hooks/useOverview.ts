import { useEffect, useRef, useState } from 'react';
import { fetchJson, type OverviewResponse } from '@/lib/api';

interface UseOverviewResult {
  data: OverviewResponse | null;
  error: Error | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useOverview(intervalMs = 5000): UseOverviewResult {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const visibleRef = useRef<boolean>(typeof document === 'undefined' ? true : !document.hidden);

  async function tick() {
    try {
      const res = await fetchJson<OverviewResponse>('/api/overview');
      if (aliveRef.current) {
        setData(res);
        setError(null);
      }
    } catch (e) {
      if (aliveRef.current) setError(e as Error);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }

  function schedule() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (visibleRef.current) {
      timerRef.current = window.setInterval(tick, intervalMs);
    }
  }

  useEffect(() => {
    aliveRef.current = true;
    tick();
    schedule();

    const onVis = () => {
      visibleRef.current = !document.hidden;
      if (visibleRef.current) {
        // immediate refresh when becoming visible
        tick();
      }
      schedule();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      aliveRef.current = false;
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);

  return { data, error, loading, refresh: tick };
}
