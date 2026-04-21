import { readCookie } from './utils';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (init.method && init.method !== 'GET' && init.method !== 'HEAD') {
    const csrf = readCookie('csrf');
    if (csrf) headers.set('X-CSRF-Token', csrf);
    if (!headers.has('Content-Type') && init.body) {
      headers.set('Content-Type', 'application/json');
    }
  }
  const res = await fetch(url, { ...init, headers, credentials: 'same-origin' });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof data === 'object' && data && 'error' in data ? String((data as { error: unknown }).error) : res.statusText;
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

export async function postAction<T = { ok: boolean; message?: string; error?: string }>(url: string): Promise<T> {
  return fetchJson<T>(url, { method: 'POST' });
}

// --------------- response shapes used by the dashboard ---------------

export interface ServerSnapshot {
  cpuPct: number;
  memUsedMb: number;
  memTotalMb: number;
  load: [number, number, number];
  uptimeSec: number;
}

export interface DiskSnapshot {
  mount: string;
  usedGb: number;
  totalGb: number;
}

export type RestartPolicy = 'no' | 'always' | 'unless-stopped' | 'on-failure';

export interface ContainerSnapshot {
  id?: string;
  name: string;
  project: string | null;
  service?: string | null;
  state: string;
  cpuPct: number;
  memUsedMb: number;
  uptimeSec: number;
  restartCount: number;
  restartPolicy: RestartPolicy;
}

export interface ComposeProject {
  name: string | null;
  containers: ContainerSnapshot[];
}

export interface SiteSnapshot {
  name: string;
  backendPort: number | null;
  isStatic?: boolean;
  httpConnections: number;
  sseConnections: number;
  latencyMs: number | null;
  status: number | null;
}

export interface DbStats {
  pathBytes: number;
  oldestTs: number | null;
  rowCount: number;
}

export interface OverviewResponse {
  lastCollectionTs: number | null;
  server: ServerSnapshot;
  disk: DiskSnapshot[];
  db: DbStats;
  composeProjects: ComposeProject[];
  sites: SiteSnapshot[];
}

export type Range = '1h' | '6h' | '24h' | '7d' | '30d';

export interface HistoryPoint {
  ts: number;
  value?: number;
  [key: string]: number | null | undefined;
}

export interface HistoryResponse {
  metric: string;
  range: Range;
  points: HistoryPoint[];
}

export interface SessionUser {
  email: string;
  name: string;
  picture: string | null;
}
