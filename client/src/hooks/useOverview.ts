import { useEffect, useRef, useState } from 'react';
import { fetchJson, type OverviewResponse } from '@/lib/api';

interface UseOverviewResult {
  data: OverviewResponse | null;
  error: Error | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Overview data source that switches between plain polling and Server-Sent Events.
 *
 * - live=false: fetches /api/overview every intervalMs (cheap — server returns a
 *   cached snapshot that's at most 1 minute stale).
 * - live=true: opens a persistent EventSource to /api/stream. The server runs a
 *   fast system collector (every 2s) while any client is streaming, so CPU/RAM
 *   updates feel real-time. Docker/nginx/latency still arrive every minute.
 *
 * In both modes, `refresh()` does a one-shot GET /api/overview for actions that
 * want an immediate update after e.g. restarting a container.
 */
export function useOverview(intervalMs = 5000, live = false): UseOverviewResult {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  async function oneShot() {
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

  useEffect(() => {
    aliveRef.current = true;

    // --- live (SSE) path --------------------------------------------------
    if (live) {
      let es: EventSource | null = null;
      let visible = typeof document === 'undefined' ? true : !document.hidden;

      const connect = () => {
        if (!visible || es) return;
        es = new EventSource('/api/stream');
        es.addEventListener('overview', (ev) => {
          try {
            const parsed = JSON.parse((ev as MessageEvent).data) as OverviewResponse;
            if (aliveRef.current) {
              setData(parsed);
              setError(null);
              setLoading(false);
            }
          } catch {
            // ignore malformed payload
          }
        });
        es.onerror = () => {
          // Browser will auto-reconnect; surface a soft error only if we've
          // never received data.
          if (aliveRef.current && !data) setError(new Error('stream disconnected'));
        };
      };

      const disconnect = () => {
        if (es) { es.close(); es = null; }
      };

      const onVis = () => {
        visible = !document.hidden;
        if (visible) connect();
        else disconnect();
      };

      connect();
      document.addEventListener('visibilitychange', onVis);

      return () => {
        aliveRef.current = false;
        document.removeEventListener('visibilitychange', onVis);
        disconnect();
      };
    }

    // --- polling path -----------------------------------------------------
    let timerId: number | null = null;
    let visible = typeof document === 'undefined' ? true : !document.hidden;

    const schedule = () => {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
      if (visible) timerId = window.setInterval(oneShot, intervalMs);
    };

    oneShot();
    schedule();

    const onVis = () => {
      visible = !document.hidden;
      if (visible) oneShot();
      schedule();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      aliveRef.current = false;
      if (timerId !== null) window.clearInterval(timerId);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, live]);

  return { data, error, loading, refresh: oneShot };
}
