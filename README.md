# channels-monitor (Pulse)

Server monitoring & management dashboard for a single Ubuntu host running ~20 Docker Compose instances reverse-proxied by Nginx.

- **Server:** Node.js 20+ / Fastify / SQLite (better-sqlite3) / dockerode / systeminformation
- **Client:** React 18 + Vite + TypeScript + Tailwind + shadcn/ui, Hebrew (RTL) + English (LTR)
- **Runtime:** PM2
- **Auth:** Google OAuth + email allowlist

## What it does

- Live CPU / RAM / load / disk / network with 1-minute resolution and 30-day retention.
- Container stats per Docker Compose project (backend + postgres + kvrocks × ~20 instances).
- Per-site Nginx stats — active connections (via `ss`) and latency (HEAD probes).
- One-click start/stop/restart for containers and whole compose projects.
- `nginx -t` and `nginx -s reload` from the UI.
- SQLite history with an on-demand purge button.

---

## 1. Prerequisites

- Ubuntu 22.04 or 24.04
- Node.js 20+ (`node -v`)
- PM2 (`npm install -g pm2`)
- Docker + Docker Compose v2 (`docker compose version`)
- Access to `/var/run/docker.sock` (run as root, or add the service user to the `docker` group)
- `ss` (from `iproute2`) on PATH — used for counting active Nginx→backend connections

---

## 2. Google OAuth setup

1. Visit https://console.cloud.google.com/ and create (or pick) a project.
2. **APIs & Services → OAuth consent screen:** set it to *External* (or *Internal* if you use Google Workspace). Add your email as a test user during development.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - Application type: *Web application*
   - Authorized redirect URI: `https://pulse.chatfree.app/auth/callback` (replace with your admin subdomain)
4. Copy the client ID and secret into `.env` (see next section).

---

## 3. Install

```bash
# Put the code where PM2 will run it
sudo mkdir -p /opt/channels-monitor
sudo chown -R "$USER:$USER" /opt/channels-monitor
git clone <repo> /opt/channels-monitor        # or rsync from this directory
cd /opt/channels-monitor

# Create data + log directories
sudo mkdir -p /var/lib/channels-monitor /var/log/channels-monitor
sudo chown -R root:root /var/lib/channels-monitor /var/log/channels-monitor
# If PM2 runs as a non-root user, change ownership to that user.

# Install deps + build the client
npm install
npm run build:client

# Configure environment
cp .env.example .env
nano .env                                      # fill in all required values
```

### Required `.env` values

| Variable | Notes |
|---|---|
| `SESSION_SECRET` | Generate with `openssl rand -hex 32`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From Cloud Console. |
| `OAUTH_CALLBACK_URL` | Must exactly match the redirect URI configured in Google. |
| `ALLOWED_EMAILS` | Comma-separated. Only these addresses may sign in. |

### Commonly overridden defaults

| Variable | Default | When to change |
|---|---|---|
| `COMPOSE_BASE_DIR` | `/mnt/HC_Volume_102971677` | Where your Docker Compose project directories live (`<base>/<project>/docker-compose.yml`). |
| `NGINX_SITES_DIR` | `/etc/nginx/sites-enabled` | If your Nginx uses a different layout (e.g. `/etc/nginx/conf.d`). |
| `NGINX_PROCESS_NAME` | `nginx` | The process name `ss -p` shows for the Nginx worker. |
| `DOCKER_COMPOSE_CMD` | `docker compose` | Keep as-is for Compose v2. Legacy v1 (`docker-compose`) is not supported. |
| `DB_PATH` | `/var/lib/channels-monitor/metrics.db` | Must be writable by the PM2 user. |
| `RETENTION_DAYS` | `30` | Daily purge (at 03:00) removes rows older than this. |

### Start

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                                    # follow the printed instructions to install the systemd unit
```

Expected server log lines:

```
[scheduler] started (every 1 minute, retention daily 03:00)
[collector] system ok in 42ms (items=7)
[collector] docker ok in 890ms (items=3)
```

Verify API: `curl http://127.0.0.1:3100/health` → `{"ok":true,"uptime":N}`

---

## 4. Nginx vhost for the admin subdomain

Example `/etc/nginx/sites-enabled/pulse.chatfree.app.conf`:

```nginx
server {
    listen 80;
    server_name pulse.chatfree.app;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name pulse.chatfree.app;

    ssl_certificate     /etc/letsencrypt/live/pulse.chatfree.app/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pulse.chatfree.app/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # SSE endpoint for the live-mode dashboard — must NOT be buffered by nginx
    location = /api/stream {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
        chunked_transfer_encoding off;
    }

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Issue certs with certbot:
```bash
sudo certbot --nginx -d pulse.chatfree.app
```

---

## 5. Running as non-root (optional)

If PM2 runs as a non-root user, two extra steps are needed:

1. **Docker socket access:** add the user to the `docker` group:
   ```bash
   sudo usermod -aG docker <user>
   ```
2. **Nginx reload without password:** create `/etc/sudoers.d/channels-monitor`:
   ```
   <user> ALL=(root) NOPASSWD: /usr/sbin/nginx -s reload
   <user> ALL=(root) NOPASSWD: /usr/sbin/nginx -t
   ```
   Validate with `sudo visudo -cf /etc/sudoers.d/channels-monitor`.

When running as root (default here), neither step is needed.

---

## 6. Updating

```bash
cd /opt/channels-monitor
git pull
npm install
npm run build:client
pm2 restart channels-monitor
pm2 logs channels-monitor --lines 50          # verify no errors on boot
```

---

## 7. Operations

| Task | Command |
|---|---|
| View live logs | `pm2 logs channels-monitor` |
| Restart | `pm2 restart channels-monitor` |
| Stop | `pm2 stop channels-monitor` |
| Backup DB | `cp /var/lib/channels-monitor/metrics.db /backups/pulse-$(date +%F).db` |
| Inspect DB | `sqlite3 /var/lib/channels-monitor/metrics.db '.tables'` |
| Check collector run | `pm2 logs channels-monitor --lines 200 \| grep collector` |
| Test OAuth redirect URI | Open `https://<your-subdomain>/auth/google` in a browser |

---

## 8. Troubleshooting

**"Docker socket permission denied" in logs.**
The PM2 user can't read `/var/run/docker.sock`. Either run as root, or add the user to the `docker` group and restart PM2 (log out and back in first, group membership is re-read on shell login).

**`ss` in nginx collector returns nothing.**
- `ss` may not be on PATH for the PM2 user — install `iproute2` (`apt install iproute2`).
- The grep pattern relies on the nginx worker process name. Check with `ss -tnp state established | grep nginx | head` and adjust `NGINX_PROCESS_NAME` if your worker is named differently.

**Sites table is empty.**
`NGINX_SITES_DIR` didn't find any `.conf` files. Confirm with `ls /etc/nginx/sites-enabled/`.

**Login redirects to `/denied`.**
Your email is not in `ALLOWED_EMAILS`. Edit `.env`, then `pm2 restart channels-monitor`.

**Login redirects back to `/login` forever.**
Cookies over HTTP are dropped because `secure: true` is enforced in production. Make sure you're hitting `https://` (terminated by Nginx), not `http://`.

**Action returns 500 with "not allowed".**
The shell wrapper refuses anything outside `docker`, `nginx`, `ss`, `sudo`. If you need to extend it, edit `src/lib/shell.js`.

**Frontend shows the "client not built" stub.**
Run `npm run build:client` and `pm2 restart channels-monitor`.

---

## 9. Directory layout

```
channels-monitor/
├── package.json
├── ecosystem.config.cjs
├── .env.example
├── README.md
├── src/                        # Node.js backend (ESM)
│   ├── server.js               # Fastify entry
│   ├── config.js               # env validation
│   ├── db.js                   # SQLite schema + helpers
│   ├── auth.js                 # OAuth + session + CSRF + requireAuth decorator
│   ├── state.js                # in-memory latest snapshot
│   ├── scheduler.js            # node-cron orchestration
│   ├── collectors/
│   │   ├── system.js
│   │   ├── docker.js
│   │   ├── nginx.js
│   │   └── latency.js
│   ├── routes/
│   │   ├── api.js              # GET /api/overview + /api/history + /api/logs
│   │   ├── actions.js          # POST /api/action/*
│   │   └── auth.js             # OAuth callback + logout + /api/session
│   └── lib/
│       ├── shell.js            # safe execFile wrapper + name validator
│       └── nginx-parser.js
└── client/                     # React frontend
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx             # router + auth guard
        ├── index.css           # theme tokens + fonts
        ├── lib/                # utils, api, i18n
        ├── hooks/              # useOverview, useHistory, useDirection
        ├── components/         # Header, ServerOverview, Compose…, Sites…, ui/*
        ├── pages/              # Login, AccessDenied, Dashboard
        └── locales/            # he.json, en.json
```

---

## 10. Security notes

- The Node process binds to `127.0.0.1` only — never expose it publicly. Nginx terminates TLS.
- Every POST requires a double-submit CSRF token (`csrf` cookie + `X-CSRF-Token` header). The client reads the cookie automatically.
- Container/project names are matched against `/^[a-z0-9][a-z0-9._-]{0,63}$/i` before any `execFile`.
- Only `/usr/bin/docker`, `/usr/sbin/nginx`, `/usr/bin/ss`, and `/usr/bin/sudo` are callable through the shell wrapper.
- Session cookies: `httpOnly`, `secure` (in prod), `sameSite=lax`, 7-day lifetime.
