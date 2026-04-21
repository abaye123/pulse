import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SERVER_BLOCK_RE = /server\s*\{([\s\S]*?)\n\}/g;
const SERVER_NAME_RE = /^\s*server_name\s+([^;]+);/m;
const LISTEN_RE = /^\s*listen\s+([^;]+);/gm;
const PROXY_PASS_RE = /^\s*proxy_pass\s+([^;]+);/m;

function parseListen(raw) {
  // examples: "80", "443 ssl http2", "[::]:443 ssl", "127.0.0.1:8080"
  const m = raw.trim().match(/(?:\[.*?\]:|(?:\d+\.\d+\.\d+\.\d+:)?)?(\d+)/);
  return m ? Number(m[1]) : null;
}

function parseProxyPass(raw) {
  // examples: "http://localhost:30002;", "http://127.0.0.1:30002/;", "http://backend:8080"
  const m = raw.trim().match(/https?:\/\/([^\/:]+)(?::(\d+))?/);
  if (!m) return null;
  const host = m[1];
  const port = m[2] ? Number(m[2]) : null;
  return { host, port };
}

export function parseConfig(text) {
  const sites = [];
  let m;
  while ((m = SERVER_BLOCK_RE.exec(text)) !== null) {
    const body = m[1];

    const nameMatch = body.match(SERVER_NAME_RE);
    const rawNames = nameMatch ? nameMatch[1].trim().split(/\s+/) : [];
    const allNames = rawNames.filter((n) => n && n !== '_');
    if (allNames.length === 0) continue;
    const canonicalName = allNames[0];

    const listenPorts = [];
    let lm;
    const listenBody = body;
    LISTEN_RE.lastIndex = 0;
    while ((lm = LISTEN_RE.exec(listenBody)) !== null) {
      const p = parseListen(lm[1]);
      if (p !== null && !listenPorts.includes(p)) listenPorts.push(p);
    }

    const ppMatch = body.match(PROXY_PASS_RE);
    const upstream = ppMatch ? parseProxyPass(ppMatch[1]) : null;
    const backendPort = upstream?.port || null;
    const isStatic = backendPort === null;

    sites.push({ canonicalName, allNames, backendPort, listenPorts, isStatic });
  }
  return sites;
}

export async function parseSitesDir(dir) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err) {
    return { sites: [], error: err.message };
  }
  const confFiles = entries.filter((f) => f.endsWith('.conf') || !f.includes('.'));
  const all = [];
  for (const name of confFiles) {
    try {
      const text = await readFile(join(dir, name), 'utf8');
      const sites = parseConfig(text);
      for (const s of sites) all.push({ ...s, sourceFile: name });
    } catch (err) {
      // skip unreadable files
    }
  }
  // dedupe by canonicalName, keeping first occurrence
  const seen = new Set();
  const deduped = [];
  for (const s of all) {
    if (seen.has(s.canonicalName)) continue;
    seen.add(s.canonicalName);
    deduped.push(s);
  }
  return { sites: deduped, error: null };
}
