# Server Monitoring & Management Dashboard — Specification

You are building a Node.js monitoring & management web app for a single Ubuntu server running ~20 Docker Compose instances (reverse-proxied by Nginx). Read this entire document before starting. Follow every instruction carefully.

---

## 1. Server context (important background)

The server you'll run on has:

- **OS:** Ubuntu 24.04
- **Reverse proxy:** Nginx (running as systemd service `nginx`), configured under `/etc/nginx/sites-enabled/`. Each enabled site is a `.conf` file with a `server_name` directive and usually a `proxy_pass http://localhost:PORT;` directive pointing to a Docker container port.
- **Docker setup:** ~20 instances, each with 3 containers (app backend, postgres, kvrocks). Containers are named with a consistent prefix per instance (e.g. `mesudrim-backend`, `mesudrim-postgres`, `mesudrim-kvrocks`).
- **Docker Compose projects:** live in `/opt/channels/<instance-name>/docker-compose.yml` (confirm this path at install time — ask the user if unsure).
- **Backend apps** are Go binaries exposing SSE endpoints at `/api/events`.
- **Let's Encrypt** manages SSL via certbot timer.

The app MUST run on the same server with access to the Docker socket and read access to `/etc/nginx/sites-enabled/`.

---

## 2. Project goals

Build a single web app accessible at a chosen subdomain (e.g. `admin.chatfree.app`) that provides:

1. **Live server status** — CPU, RAM, disk, load averages, network.
2. **Historical metrics** — 1-minute resolution, 30-day retention, stored in SQLite.
3. **Per-container status** — running/stopped/unhealthy, CPU/RAM usage, uptime, restart count.
4. **Per-site status** — from Nginx: active HTTP/HTTPS connections, active SSE connections to backend, response latency (measured by the app itself via HEAD requests every minute).
5. **Control actions** — start/stop/restart individual containers, start/stop/restart entire compose projects (all 3 containers of an instance), reload Nginx.
6. **History size indicator** — show disk size of the SQLite DB with a "purge old history" button.
7. **Google OAuth login** — only emails in `ALLOWED_EMAILS` env var can access.

---

## 3. Tech stack (use exactly these — do not substitute)

- **Runtime:** Node.js 20+ with ES modules (`"type": "module"` in package.json)
- **Web framework:** Fastify (`fastify`, `@fastify/static`, `@fastify/cookie`, `@fastify/session`, `@fastify/oauth2`)
- **Database:** SQLite via `better-sqlite3` (synchronous, fast, no pool needed)
- **Docker API:** `dockerode`
- **System metrics:** `systeminformation` (CPU, RAM, disk, network)
- **Nginx config parsing:** regex-based, no external lib needed (see parsing rules below)
- **Scheduled tasks:** `node-cron`
- **Logging:** `pino` (Fastify's built-in logger)
- **Process manager:** PM2 (the user will run `pm2 start ecosystem.config.cjs`)
- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui components. Icons from `lucide-react`. Charts from `recharts` (integrates better with React than Chart.js). Fonts from Google Fonts.
- **Internationalization:** `i18next` + `react-i18next` with two languages: Hebrew (`he`, default, RTL) and English (`en`, LTR). Language switcher in the header, persisted in localStorage.
- **Language:** Hebrew + English UI (user-toggleable). Code comments in English.

Do NOT introduce any other dependencies beyond what's listed here and in the shadcn dependency chain. If you think you need another one, ask first.

---

## 4. Directory layout

Create exactly this structure. The server (`src/`) and client (`client/`) are separate — the server builds and serves the client's static output from `client/dist/`.

```
channels-monitor/
├── package.json                # server dependencies + scripts
├── ecosystem.config.cjs        # PM2 config
├── .env.example                # template for the user's .env
├── README.md                   # install + operations docs
├── src/                        # Node.js backend
│   ├── server.js               # Fastify app entry (serves client/dist + /api)
│   ├── config.js               # reads .env, validates required vars
│   ├── db.js                   # SQLite setup, migrations, query helpers
│   ├── auth.js                 # Google OAuth + allowlist middleware
│   ├── collectors/
│   │   ├── system.js           # CPU, RAM, disk, network
│   │   ├── docker.js           # container list, stats, actions
│   │   ├── nginx.js            # parse sites-enabled, count connections
│   │   └── latency.js          # HEAD-request each site, measure time
│   ├── scheduler.js            # node-cron jobs (every 1 min)
│   ├── routes/
│   │   ├── api.js              # JSON API for the dashboard
│   │   ├── actions.js          # POST endpoints for start/stop/restart
│   │   └── auth.js             # /auth/google, /auth/callback, /auth/logout
│   └── lib/
│       ├── shell.js            # safe child_process wrapper
│       └── nginx-parser.js     # parse server_name + proxy_pass from .conf
└── client/                     # React frontend (Vite + TS + Tailwind + shadcn)
    ├── package.json            # client dependencies
    ├── vite.config.ts
    ├── tsconfig.json
    ├── tailwind.config.ts
    ├── postcss.config.js
    ├── components.json         # shadcn CLI config
    ├── index.html              # Vite entry, with <html dir="rtl" lang="he">
    ├── public/
    │   └── favicon.svg
    └── src/
        ├── main.tsx            # React entry, mounts App, initializes i18n
        ├── App.tsx             # router + auth guard wrapper
        ├── index.css           # Tailwind directives + CSS custom props for theme
        ├── lib/
        │   ├── utils.ts        # shadcn's cn() helper
        │   ├── api.ts          # fetch wrappers with CSRF token handling
        │   └── i18n.ts         # i18next setup, loads he + en resources
        ├── hooks/
        │   ├── useOverview.ts  # SWR-style polling of /api/overview (5s interval)
        │   ├── useHistory.ts   # fetches /api/history for charts
        │   └── useDirection.ts # returns 'rtl' | 'ltr' based on current language
        ├── components/
        │   ├── ui/             # shadcn components (button, card, dialog, etc.)
        │   ├── Header.tsx
        │   ├── LanguageSwitcher.tsx
        │   ├── ServerOverview.tsx
        │   ├── MetricCard.tsx
        │   ├── SystemCharts.tsx
        │   ├── ComposeProjectCard.tsx
        │   ├── SitesTable.tsx
        │   ├── SiteDetailDialog.tsx
        │   ├── ConfirmDialog.tsx
        │   └── PurgeHistoryButton.tsx
        ├── pages/
        │   ├── Dashboard.tsx
        │   ├── Login.tsx
        │   └── AccessDenied.tsx
        └── locales/
            ├── he.json         # Hebrew strings
            └── en.json         # English strings
```

---

## 5. Environment variables

`.env.example`:

```
# Server
PORT=3100
HOST=127.0.0.1                 # bind to localhost; Nginx proxies to it
NODE_ENV=production

# Session
SESSION_SECRET=<generate with: openssl rand -hex 32>

# Google OAuth
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
OAUTH_CALLBACK_URL=https://admin.chatfree.app/auth/callback

# Allowlist — comma-separated emails that may log in
ALLOWED_EMAILS=you@example.com,teammate@example.com

# Paths
NGINX_SITES_DIR=/etc/nginx/sites-enabled
COMPOSE_BASE_DIR=/opt/channels
DB_PATH=/var/lib/channels-monitor/metrics.db

# Retention
RETENTION_DAYS=30
```

Validate on startup: if any required var is missing, log a clear error and exit with code 1.

---

## 6. Database schema (SQLite via better-sqlite3)

Create the DB file if it doesn't exist. On every startup, run migrations idempotently.

```sql
-- system metrics: one row per minute
CREATE TABLE IF NOT EXISTS system_metrics (
  ts INTEGER PRIMARY KEY,         -- unix seconds, aligned to minute
  cpu_pct REAL NOT NULL,
  mem_used_mb INTEGER NOT NULL,
  mem_total_mb INTEGER NOT NULL,
  load1 REAL NOT NULL,
  load5 REAL NOT NULL,
  load15 REAL NOT NULL,
  net_rx_bytes INTEGER NOT NULL,  -- cumulative
  net_tx_bytes INTEGER NOT NULL
);

-- container metrics: one row per container per minute
CREATE TABLE IF NOT EXISTS container_metrics (
  ts INTEGER NOT NULL,
  container_name TEXT NOT NULL,
  cpu_pct REAL NOT NULL,
  mem_used_mb INTEGER NOT NULL,
  state TEXT NOT NULL,            -- 'running' | 'exited' | 'restarting' | ...
  PRIMARY KEY (ts, container_name)
);
CREATE INDEX IF NOT EXISTS idx_container_name_ts ON container_metrics(container_name, ts);

-- site metrics: one row per site per minute
CREATE TABLE IF NOT EXISTS site_metrics (
  ts INTEGER NOT NULL,
  server_name TEXT NOT NULL,
  http_connections INTEGER NOT NULL,    -- active connections on :80 / :443 with this Host
  sse_connections INTEGER NOT NULL,     -- active connections from Nginx to backend port
  latency_ms INTEGER,                   -- null if request failed
  http_status INTEGER,                  -- last HEAD response code
  PRIMARY KEY (ts, server_name)
);
CREATE INDEX IF NOT EXISTS idx_site_name_ts ON site_metrics(server_name, ts);

-- disk metrics: one row per mount per minute (usually just /)
CREATE TABLE IF NOT EXISTS disk_metrics (
  ts INTEGER NOT NULL,
  mount TEXT NOT NULL,
  used_gb REAL NOT NULL,
  total_gb REAL NOT NULL,
  PRIMARY KEY (ts, mount)
);
```

Use `PRAGMA journal_mode = WAL;` for better concurrency.
Use `PRAGMA synchronous = NORMAL;` for better write throughput.

---

## 7. Collectors (every 1 minute via node-cron)

All collectors write to the DB with the same `ts` — the current minute rounded down. Implement a helper `currentMinuteTs()` returning `Math.floor(Date.now() / 60000) * 60`.

### 7.1 System collector (`src/collectors/system.js`)

Use `systeminformation`:
- `currentLoad()` → CPU percent
- `mem()` → RAM used/total
- `currentLoad().avgLoad` — NOT reliable; use `os.loadavg()` from Node's built-in `os` module instead
- `fsSize()` → per-mount disk usage
- `networkStats()` → rx/tx bytes for the default interface

### 7.2 Docker collector (`src/collectors/docker.js`)

Use `dockerode` connecting to `/var/run/docker.sock`.
- List all containers (including stopped ones) with `docker.listContainers({ all: true })`.
- For running containers, call `container.stats({ stream: false })` to get CPU/memory.
- CPU percent calculation from `stats`:
  ```
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cpuCount = stats.cpu_stats.online_cpus || 1;
  const cpuPct = (systemDelta > 0 && cpuDelta > 0)
    ? (cpuDelta / systemDelta) * cpuCount * 100
    : 0;
  ```
- Memory from `stats.memory_stats.usage` (in bytes).
- Collect stats in parallel with `Promise.all`, but limit concurrency to 10 to avoid overwhelming the Docker daemon.
- Group containers into "compose projects" using the label `com.docker.compose.project` (dockerode exposes this as `container.Labels['com.docker.compose.project']`). Containers without this label are shown as standalone.

### 7.3 Nginx collector (`src/collectors/nginx.js`)

This has two parts:

**A. Parse sites-enabled once at startup and on SIGHUP**
Read every `.conf` file in `NGINX_SITES_DIR`. Use `src/lib/nginx-parser.js` to extract, per `server { ... }` block:
- `server_name` (multiple values possible; first real hostname is the canonical name, skip `_`)
- Upstream `proxy_pass` target (extract host:port) — if none, mark site as static
- Listen ports (80 / 443 / other)

Store in memory as an array of `{ canonicalName, allNames: string[], backendPort: number|null, listenPorts: number[], isStatic: boolean }`.

Expose a function `getSites()` that returns this array.

**B. Count active connections per site every minute**

The challenge: Nginx doesn't directly tell you "connections for site X". We infer from `ss`:

```bash
# Active incoming connections on 80 and 443
ss -tn state established '( sport = :80 or sport = :443 )'

# Active outgoing connections FROM nginx TO backend ports
ss -tnp state established '( dport >= :30000 and dport <= :30100 )' | grep nginx
```

But we can't tell the incoming Host header from ss alone. Instead:
- **HTTP connections per site:** count outgoing Nginx→backend connections per backend port, then map port → site using the parsed config. This gives you "active requests currently being proxied to this site".
- **SSE connections per site:** same as above — since SSE holds the connection open, it's indistinguishable from a long HTTP request by port. This is fine.

Implementation:
```javascript
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);

async function countBackendConnections() {
  // get all established connections from nginx (process owner www-data) with their remote ports
  const { stdout } = await execAsync(
    "ss -tnp state established | grep nginx | awk '{print $5}' | awk -F: '{print $NF}' | sort | uniq -c"
  );
  // parse: lines like "   123 30001"
  const counts = new Map();
  for (const line of stdout.trim().split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (m) counts.set(Number(m[2]), Number(m[1]));
  }
  return counts; // port → count
}
```

Then for each site, look up `counts.get(site.backendPort) || 0` and write a row.

Store HTTP + SSE combined in `http_connections` AND separately put the same number in `sse_connections` for now (we can't distinguish). Add a code comment explaining why, and note this as a future improvement (parsing Nginx access logs to classify `/api/events` requests).

### 7.4 Latency collector (`src/collectors/latency.js`)

For each site with a backend, do a HEAD request to `http://localhost:<port>/` with a 5-second timeout. Record the duration in `latency_ms` and the HTTP status. Use `undici` or Node's built-in `fetch`. Run these in parallel with `Promise.all`, concurrency-limited to 20.

---

## 8. Retention & purge

On startup and daily at 03:00 (cron), delete rows older than `RETENTION_DAYS` from all tables:

```sql
DELETE FROM system_metrics  WHERE ts < ?;
DELETE FROM container_metrics WHERE ts < ?;
DELETE FROM site_metrics WHERE ts < ?;
DELETE FROM disk_metrics WHERE ts < ?;
VACUUM;
```

The purge button in the UI calls the same logic immediately but with `RETENTION_DAYS` (so it effectively only removes rows that would be purged at 03:00 anyway). **Do NOT allow purging newer data** — there's no reason to let the user nuke recent history by accident.

---

## 9. Authentication

### 9.1 Flow
- `GET /login` → static `login.html` with a "Sign in with Google" button linking to `/auth/google`.
- `GET /auth/google` → redirects to Google OAuth consent (use `@fastify/oauth2`).
- `GET /auth/callback` → Google redirects here with a code. Exchange for access token, fetch userinfo, check email against `ALLOWED_EMAILS`.
  - If allowed: set session cookie (`req.session.user = { email, name, picture }`) and redirect to `/`.
  - If not: render a 403 page with "Access denied for <email>".
- `GET /auth/logout` → destroy session, redirect to `/login`.

### 9.2 Protection middleware
Every route except `/login`, `/auth/*`, `/public/*` must check `req.session.user`. If missing, redirect to `/login` for HTML requests, or return 401 JSON for `/api/*` requests.

### 9.3 Session config
- Cookie name: `monitor_sid`
- `httpOnly: true`
- `secure: true` (requires HTTPS — assume Nginx terminates SSL)
- `sameSite: 'lax'`
- `maxAge: 7 * 24 * 3600 * 1000` (7 days)

---

## 10. HTTP API

All routes under `/api` require auth.

### Read endpoints (GET)

- `GET /api/overview` → current snapshot:
  ```json
  {
    "server": { "cpuPct": 12.3, "memUsedMb": 4200, "memTotalMb": 15360, "load": [0.5, 0.7, 0.8], "uptimeSec": 123456 },
    "disk": [{ "mount": "/", "usedGb": 40.2, "totalGb": 120 }],
    "db": { "pathBytes": 123456789, "oldestTs": 1700000000, "rowCount": 1234567 },
    "composeProjects": [
      {
        "name": "mesudrim",
        "containers": [
          { "name": "mesudrim-backend", "state": "running", "cpuPct": 2.1, "memUsedMb": 120, "uptimeSec": 3600, "restartCount": 0 },
          { "name": "mesudrim-postgres", "state": "running", ... },
          { "name": "mesudrim-kvrocks", "state": "running", ... }
        ]
      }
    ],
    "sites": [
      { "name": "mesudrim.chatfree.app", "backendPort": 30002, "httpConnections": 12, "sseConnections": 12, "latencyMs": 8, "status": 200 }
    ]
  }
  ```

- `GET /api/history?metric=system&range=24h` → time-series for charts. Support ranges: `1h`, `6h`, `24h`, `7d`, `30d`.
  - metrics: `system.cpu`, `system.mem`, `system.load`, `container.cpu?name=X`, `container.mem?name=X`, `site.connections?name=X`, `site.latency?name=X`
  - Aggregate on the server for long ranges (e.g. 30d → 1-hour buckets using AVG) to keep payload small. Target: never return more than ~1000 points.

- `GET /api/logs/container/:name?lines=200` → last N lines of `docker logs` for a container.

- `GET /api/session` → `{ email, name, picture }` for the logged-in user.

### Action endpoints (POST)

All actions require auth + CSRF token (see section 12).

- `POST /api/action/container/:name/start`
- `POST /api/action/container/:name/stop`
- `POST /api/action/container/:name/restart`
- `POST /api/action/compose/:project/up` — runs `docker compose -f /opt/channels/<project>/docker-compose.yml up -d`
- `POST /api/action/compose/:project/down`
- `POST /api/action/compose/:project/restart`
- `POST /api/action/nginx/reload` — runs `sudo nginx -s reload` (see systemd sudo config in §14)
- `POST /api/action/nginx/test` — runs `sudo nginx -t`, returns stdout+stderr
- `POST /api/action/db/purge` — purges rows older than RETENTION_DAYS

Every action endpoint:
1. Validates the target exists (e.g. container name in dockerode list).
2. Executes the action.
3. Logs to stdout: `[action] user=<email> target=<name> action=<action> result=<ok|error>`
4. Returns `{ ok: true, message: "Container restarted" }` or `{ ok: false, error: "..." }`.

---

## 11. Frontend (`client/`)

### 11.1 Stack setup

Initialize with Vite React-TS template, then add Tailwind, shadcn, and supporting libs:

```bash
cd channels-monitor
npm create vite@latest client -- --template react-ts
cd client
npm install
npm install -D tailwindcss@3 postcss autoprefixer @types/node
npx tailwindcss init -p
# shadcn-ui init
npx shadcn@latest init
# (choose: Default style, Slate base color — we override below; CSS vars: yes)
npm install lucide-react recharts i18next react-i18next i18next-browser-languagedetector react-router-dom clsx tailwind-merge
```

Then install the shadcn components we actually use (add as you build — don't install all 50+):

```bash
npx shadcn@latest add button card dialog dropdown-menu table tabs badge separator alert skeleton tooltip switch select
```

Configure `vite.config.ts` to proxy `/api` and `/auth` to the backend during dev:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3100',
      '/auth': 'http://127.0.0.1:3100'
    }
  }
});
```

### 11.2 Build + serve integration

- `client/package.json` script `"build": "vite build"` outputs to `client/dist/`.
- The root `package.json` has a script `"build:client": "cd client && npm ci && npm run build"`.
- `src/server.js` uses `@fastify/static` to serve `client/dist/` as the root. Any unmatched non-API GET falls back to `index.html` (SPA fallback) so React Router works.
- Document in README: `npm run build:client` must run before `pm2 start`.

### 11.3 Color palette — indigo / sky

Override shadcn's default slate palette. Edit `client/src/index.css` and `tailwind.config.ts`:

**Design tokens (CSS custom properties in `index.css`):**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* Background & surface */
    --background: 210 40% 98%;              /* sky-50 ~ very light */
    --foreground: 222 47% 11%;              /* slate-900 */
    --card: 0 0% 100%;
    --card-foreground: 222 47% 11%;
    --popover: 0 0% 100%;
    --popover-foreground: 222 47% 11%;

    /* Primary — indigo 600 */
    --primary: 239 84% 60%;
    --primary-foreground: 210 40% 98%;

    /* Secondary — sky 500 */
    --secondary: 199 89% 48%;
    --secondary-foreground: 0 0% 100%;

    /* Muted & accent */
    --muted: 210 40% 96%;
    --muted-foreground: 215 16% 47%;
    --accent: 210 40% 96%;
    --accent-foreground: 222 47% 11%;

    /* Semantic */
    --destructive: 0 84% 60%;               /* red-500 */
    --destructive-foreground: 0 0% 100%;
    --success: 142 71% 45%;                 /* green-500 */
    --success-foreground: 0 0% 100%;
    --warning: 38 92% 50%;                  /* amber-500 */
    --warning-foreground: 0 0% 0%;

    /* Borders & inputs */
    --border: 214 32% 91%;
    --input: 214 32% 91%;
    --ring: 239 84% 60%;                    /* matches primary */

    --radius: 0.625rem;
  }

  .dark {
    --background: 222 47% 11%;              /* slate-900 */
    --foreground: 210 40% 98%;
    --card: 222 47% 14%;
    --card-foreground: 210 40% 98%;
    --popover: 222 47% 14%;
    --popover-foreground: 210 40% 98%;

    --primary: 234 89% 74%;                 /* indigo-400 — brighter in dark */
    --primary-foreground: 222 47% 11%;

    --secondary: 199 89% 64%;               /* sky-400 */
    --secondary-foreground: 222 47% 11%;

    --muted: 217 33% 18%;
    --muted-foreground: 215 20% 65%;
    --accent: 217 33% 18%;
    --accent-foreground: 210 40% 98%;

    --destructive: 0 63% 60%;
    --destructive-foreground: 0 0% 100%;
    --success: 142 71% 55%;
    --success-foreground: 0 0% 0%;
    --warning: 38 92% 60%;
    --warning-foreground: 0 0% 0%;

    --border: 217 33% 20%;
    --input: 217 33% 20%;
    --ring: 234 89% 74%;
  }
}

@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground antialiased; }
}
```

**`tailwind.config.ts`** — extend with the semantic colors and load our Google fonts:

```typescript
import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))'
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        }
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      fontFamily: {
        sans: ['Inter', 'Heebo', 'system-ui', 'sans-serif'],
        heading: ['Inter', 'Heebo', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      }
    }
  },
  plugins: []
} satisfies Config;
```

### 11.4 Google Fonts

In `client/index.html` `<head>`, add the preconnect + font links:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Heebo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

**Why both Inter and Heebo?** Inter has excellent Latin rendering; Heebo has excellent Hebrew rendering. Listing Inter first and Heebo second in the `font-sans` stack means Latin chars render in Inter and Hebrew chars fall through to Heebo automatically (because Inter doesn't ship Hebrew glyphs). The user sees one coherent typeface.

### 11.5 Icons — lucide-react

Import icons per-use. Always pass `className` for sizing (don't use the `size` prop — it's harder to align with Tailwind):

```tsx
import { Server, Cpu, MemoryStick, HardDrive, Activity, Network, Play, Square, RotateCw, Trash2, LogOut, Languages, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';

<Cpu className="h-4 w-4 text-primary" />
```

**Icon sizing convention:** `h-4 w-4` for inline + badges, `h-5 w-5` for buttons, `h-6 w-6` for card headers. Never bare (inherit font-size).

### 11.6 Internationalization (i18next)

**`client/src/lib/i18n.ts`:**

```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import he from '@/locales/he.json';
import en from '@/locales/en.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { he: { translation: he }, en: { translation: en } },
    fallbackLng: 'he',
    supportedLngs: ['he', 'en'],
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'monitor_lang'
    },
    interpolation: { escapeValue: false }
  });

export default i18n;
```

**Direction hook (`client/src/hooks/useDirection.ts`):**

```typescript
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
```

Call `useDirection()` once at the top of `App.tsx`. This syncs `<html dir=... lang=...>` with the active language every time it changes.

**Translation files — `client/src/locales/he.json`:**

```json
{
  "app": {
    "title": "ניטור שרת",
    "subtitle": "ניהול קונטיינרים ואתרים"
  },
  "nav": { "dashboard": "דשבורד", "logout": "התנתק" },
  "overview": {
    "cpu": "מעבד",
    "memory": "זיכרון",
    "load": "עומס",
    "disk": "דיסק",
    "uptime": "זמן פעילות"
  },
  "compose": {
    "projectsTitle": "שירותי דוקר",
    "allRunning": "{{count}} פעילים",
    "someDown": "{{running}}/{{total}} פעילים",
    "actions": { "up": "הפעל", "down": "כבה", "restart": "הפעל מחדש" }
  },
  "sites": {
    "title": "אתרים",
    "columns": {
      "name": "שם האתר",
      "port": "פורט",
      "connections": "חיבורים",
      "latency": "זמן תגובה",
      "status": "סטטוס"
    }
  },
  "actions": {
    "start": "הפעל",
    "stop": "עצור",
    "restart": "הפעל מחדש",
    "confirm": "האם לבצע {{action}} על {{target}}?",
    "cancel": "ביטול",
    "confirmButton": "אישור",
    "success": "הפעולה בוצעה",
    "error": "שגיאה: {{message}}"
  },
  "history": {
    "title": "היסטוריה",
    "size": "גודל היסטוריה: {{size}}",
    "purge": "נקה היסטוריה ישנה",
    "range": { "1h": "שעה", "6h": "6 שעות", "24h": "יממה", "7d": "שבוע", "30d": "חודש" }
  },
  "auth": {
    "loginTitle": "התחברות",
    "signInWithGoogle": "התחבר עם גוגל",
    "deniedTitle": "הגישה נדחתה",
    "deniedMessage": "האימייל {{email}} אינו מורשה להיכנס למערכת זו."
  },
  "language": "שפה"
}
```

**`client/src/locales/en.json`:**

```json
{
  "app": { "title": "Server Monitor", "subtitle": "Container & site management" },
  "nav": { "dashboard": "Dashboard", "logout": "Sign out" },
  "overview": {
    "cpu": "CPU", "memory": "Memory", "load": "Load", "disk": "Disk", "uptime": "Uptime"
  },
  "compose": {
    "projectsTitle": "Docker services",
    "allRunning": "{{count}} running",
    "someDown": "{{running}}/{{total}} running",
    "actions": { "up": "Start", "down": "Stop", "restart": "Restart" }
  },
  "sites": {
    "title": "Sites",
    "columns": { "name": "Site", "port": "Port", "connections": "Connections", "latency": "Latency", "status": "Status" }
  },
  "actions": {
    "start": "Start", "stop": "Stop", "restart": "Restart",
    "confirm": "Perform {{action}} on {{target}}?",
    "cancel": "Cancel", "confirmButton": "Confirm",
    "success": "Action completed",
    "error": "Error: {{message}}"
  },
  "history": {
    "title": "History",
    "size": "History size: {{size}}",
    "purge": "Purge old history",
    "range": { "1h": "1 hour", "6h": "6 hours", "24h": "24 hours", "7d": "7 days", "30d": "30 days" }
  },
  "auth": {
    "loginTitle": "Sign in",
    "signInWithGoogle": "Sign in with Google",
    "deniedTitle": "Access denied",
    "deniedMessage": "The email {{email}} is not authorized to access this system."
  },
  "language": "Language"
}
```

**Using translations in components:**

```tsx
import { useTranslation } from 'react-i18next';

export function MetricCard() {
  const { t } = useTranslation();
  return <h3>{t('overview.cpu')}</h3>;
}
```

### 11.7 RTL correctness rules

- Always use **logical Tailwind properties** instead of directional ones:
  - `ms-*` / `me-*` instead of `ml-*` / `mr-*` (margin-start, margin-end)
  - `ps-*` / `pe-*` instead of `pl-*` / `pr-*`
  - `start-*` / `end-*` instead of `left-*` / `right-*`
  - `text-start` / `text-end` instead of `text-left` / `text-right`
- For icons that have directional meaning (arrows, chevrons): mirror them via `className={dir === 'rtl' ? 'rtl:scale-x-[-1]' : ''}` — Tailwind ships the `rtl:` variant automatically when `dir="rtl"` is on the html element.
- Numbers stay LTR inside RTL text — wrap multi-digit numbers in `<span dir="ltr">` when they appear inline in Hebrew sentences. For standalone table cells this isn't needed.
- Charts (recharts): the component library is direction-agnostic, but axis labels may need manual rtl handling. Test with Hebrew and English.

### 11.8 Page layout

Single-page dashboard. Top to bottom:

1. **Header** — sticky top bar: app logo + `t('app.title')`, user email + avatar dropdown (logout), `LanguageSwitcher` (toggle he/en), `PurgeHistoryButton` with current DB size.
2. **ServerOverview** — 4 `MetricCard` components in a responsive grid (1 col mobile, 2 tablet, 4 desktop): CPU%, RAM%, Load 1min, Disk%. Each card: icon from lucide, current value large, small sparkline (recharts `<AreaChart>` with minimal styling — no axes, no tooltip on hover for the spark).
3. **SystemCharts** — shadcn `Tabs` with 4 tabs (CPU / Memory / Network / Disk). Each tab shows a recharts `LineChart` with a time-range toggle (shadcn `Select` or a button group). Ranges from the translations file.
4. **Compose projects** — list of `ComposeProjectCard` components (shadcn `Card`). Header: project name, status badge (`<Badge variant="success">3/3</Badge>` or similar). Body (collapsible via shadcn `Collapsible` or show always): 3 rows, one per container. Each row: name, status dot, CPU%, RAM MB, uptime, 3 icon buttons (Play / Square / RotateCw from lucide) with tooltips. Card footer: project-level actions (Up / Down / Restart).
5. **SitesTable** — shadcn `Table` with sortable columns. Rows clickable → open `SiteDetailDialog`.
6. **SiteDetailDialog** — shadcn `Dialog` with two charts (latency over time, connections over time), the upstream port, and quick links to restart the related compose project.

### 11.9 Live updates

Implement a simple polling hook — don't pull in SWR or React Query unless you ask first.

```tsx
// client/src/hooks/useOverview.ts
import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/api';

export function useOverview(intervalMs = 5000) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const res = await fetchJson<OverviewResponse>('/api/overview');
        if (alive) { setData(res); setError(null); }
      } catch (e) {
        if (alive) setError(e as Error);
      }
    }
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [intervalMs]);

  return { data, error };
}
```

When the tab is hidden (Page Visibility API), pause polling to save resources — resume on visibility change.

### 11.10 Confirmation dialogs (`ConfirmDialog.tsx`)

All destructive actions (stop, down, restart, purge) open a shadcn `AlertDialog` with translated title + body. Cancel button is default, Confirm button uses `variant="destructive"`.

### 11.11 Toasts / notifications

Use shadcn's `sonner` (or `toast` if you prefer the older recipe) for success/error notifications after actions. Install with `npx shadcn@latest add sonner`.

### 11.12 Dark mode

Persist the user's choice in localStorage (`monitor_theme` key). Add a sun/moon toggle in the header next to the language switcher. Apply `class="dark"` on `<html>`. Honor `prefers-color-scheme` as the initial default if no saved preference exists.

---

## 12. Security

- All POST endpoints require a CSRF token. Implement a simple double-submit pattern: on page load, set a random `csrf` cookie (not httpOnly), and require the frontend to read it and send as `X-CSRF-Token` header on every POST. The server verifies `req.cookies.csrf === req.headers['x-csrf-token']`.
- Never expose raw shell input — actions take only container/project names from a whitelist (the current `docker ps -a` list / compose dir listing). Reject anything else with 400.
- Nginx config: terminate SSL, set `proxy_pass http://127.0.0.1:3100`, add `proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr;`.
- The app binds to `127.0.0.1` only — never expose directly to the internet.

---

## 13. Shell execution safety (`src/lib/shell.js`)

Create a wrapper that:
- Uses `execFile` (not `exec`) with explicit argv arrays — never pass concatenated strings.
- Has a 30-second timeout per call.
- Captures stdout + stderr.
- Rejects if the binary isn't in a whitelist: `/usr/bin/docker`, `/usr/sbin/nginx`, `/usr/bin/ss`, `/usr/bin/sudo`.
- Validates target names against a regex `/^[a-z0-9][a-z0-9._-]{0,63}$/i` and rejects anything else.

Example:
```javascript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const ALLOWED_BINS = new Set(['/usr/bin/docker', '/usr/sbin/nginx', '/usr/bin/ss', '/usr/bin/sudo']);
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export async function run(bin, args, { timeout = 30000 } = {}) {
  if (!ALLOWED_BINS.has(bin)) throw new Error(`Binary not allowed: ${bin}`);
  for (const a of args) {
    if (typeof a !== 'string') throw new Error('All args must be strings');
    // args may contain flags starting with '-'; only validate names in callers
  }
  const { stdout, stderr } = await execFileAsync(bin, args, { timeout });
  return { stdout, stderr };
}

export function validateName(name) {
  if (!NAME_RE.test(name)) throw new Error(`Invalid name: ${name}`);
  return name;
}
```

Callers always `validateName()` any user-supplied identifier before passing.

---

## 14. systemd sudo configuration (document in README, don't apply automatically)

For `nginx -s reload` and `nginx -t` to work without a password, the README should instruct the user to create `/etc/sudoers.d/channels-monitor`:

```
# allow the monitoring app to reload/test nginx without a password
<pm2-user> ALL=(root) NOPASSWD: /usr/sbin/nginx -s reload
<pm2-user> ALL=(root) NOPASSWD: /usr/sbin/nginx -t
```

Where `<pm2-user>` is the user running PM2 (could be `root` itself). If running as root, no sudoers change is needed. For `docker compose` commands, the user needs to either run as root OR be in the `docker` group.

---

## 15. PM2 config (`ecosystem.config.cjs`)

```javascript
module.exports = {
  apps: [{
    name: 'channels-monitor',
    script: './src/server.js',
    node_args: '--enable-source-maps',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/var/log/channels-monitor/error.log',
    out_file: '/var/log/channels-monitor/out.log',
    merge_logs: true,
    time: true
  }]
};
```

Document in README: `sudo mkdir -p /var/log/channels-monitor /var/lib/channels-monitor && sudo chown -R <user>:<user> /var/log/channels-monitor /var/lib/channels-monitor`.

---

## 16. README.md contents

Include:
1. Overview — what the app does
2. Prerequisites (Node 20+, PM2, Docker socket access, sudoers entry)
3. Google OAuth setup — step-by-step to create a Cloud Console project, OAuth consent screen, credentials, redirect URI
4. Installation:
   ```
   cd /opt/channels-monitor
   npm install
   npm run build:client          # builds the React app to client/dist/
   cp .env.example .env
   vim .env
   pm2 start ecosystem.config.cjs
   pm2 save
   pm2 startup                   # for auto-start on reboot
   ```
   When updating the code: `git pull && npm install && npm run build:client && pm2 restart channels-monitor`.
5. Nginx vhost example for the admin subdomain with SSL (point user to certbot).
6. Operations:
   - Viewing logs: `pm2 logs channels-monitor`
   - Restarting: `pm2 restart channels-monitor`
   - Backing up the SQLite DB: `cp /var/lib/channels-monitor/metrics.db /backups/`
7. Troubleshooting — common errors (Docker socket permissions, missing sudoers line, wrong allowed email, etc.)

---

## 17. Quality bar (do NOT skip)

- **Error handling:** every `await` that touches external systems (Docker, ss, fetch) must be wrapped in try/catch. Failures in a single collector must NOT crash the scheduler — log and continue.
- **Graceful shutdown:** on SIGTERM/SIGINT, close the HTTP server, wait for in-flight requests (max 10s), close the DB, then exit 0.
- **Observability:** log every scheduled collector run with duration + counts (e.g. `system-collector: ok in 42ms`). Log every action with user email.
- **No hard-coded paths in the code** — read them from config.
- **RTL correctness:** every Tailwind spacing class uses logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`, `text-end`). Test both languages before declaring a component done — switch to English and verify the layout mirrors correctly.
- **i18n completeness:** every user-visible string must come from the translation files. No hardcoded Hebrew or English in JSX. ESLint rule suggestion: add `react/jsx-no-literals` warning to catch stragglers during development (optional but recommended).
- **Testing stub:** include one simple health check route `GET /health` that returns `{ ok: true, uptime: process.uptime() }` — used by PM2 healthcheck or an external uptime monitor.

---

## 18. Order of implementation

Build in this order. Commit after each step:

**Backend first — the server must work before the fancy UI:**

1. Scaffold project root, `package.json`, `config.js` with env validation
2. `db.js` with schema + migrations
3. Collectors (system → docker → nginx → latency)
4. `scheduler.js` wiring all collectors
5. `auth.js` + login/logout/callback routes
6. `api.js` read endpoints (overview, history)
7. `actions.js` endpoints
8. Retention/purge cron + endpoint

**Frontend next — after the API is stable and smoke-tested with curl:**

9. Scaffold `client/` with Vite + TS + Tailwind + shadcn init
10. Apply color palette (§11.3) and Google Fonts (§11.4). Verify dark mode toggle works on a blank page before anything else.
11. Set up i18n (§11.6) and the direction hook (§11.7). Verify `<html dir>` flips when you switch language.
12. Login page + auth guard + router (`Login.tsx`, `App.tsx`)
13. `ServerOverview` + `MetricCard` + live polling hook
14. `SystemCharts` with recharts + time-range selector
15. `ComposeProjectCard` + container action buttons + `ConfirmDialog`
16. `SitesTable` + `SiteDetailDialog`
17. `PurgeHistoryButton` + toast notifications

**Wrap up:**

18. README + `.env.example` + PM2 config + Nginx vhost example
19. End-to-end smoke test: build client, run via PM2, sign in, see metrics, restart a container, switch language, toggle dark mode.

---

## 19. What to ask the user BEFORE coding

Before writing any code, ask the user:
1. Confirm the exact path of `COMPOSE_BASE_DIR`. (I guessed `/opt/channels`.)
2. Confirm that `www-data` is the nginx process user. (Check with `ps aux | grep nginx | head -2`.)
3. Confirm the admin subdomain they want (for the OAuth redirect URI).
4. Confirm whether PM2 runs as root or as another user (affects sudoers setup).
5. Confirm the version of Docker Compose in use (`docker compose version` — we use the v2 plugin syntax `docker compose ...`, not the old `docker-compose`).

Only proceed once you have answers. If any answer is surprising, adapt the relevant parts of this spec.

---

End of spec. Start with step 1 (scaffold) after confirming the five questions above.
