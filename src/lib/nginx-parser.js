import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SERVER_NAME_RE = /^\s*server_name\s+([^;]+);/m;
const LISTEN_RE = /^\s*listen\s+([^;]+);/gm;
const PROXY_PASS_RE = /^\s*proxy_pass\s+([^;]+);/m;

// Walks the text and returns all top-level `<keyword> [header] { ... }` blocks,
// counting braces so nested `location { ... }` blocks inside `server { ... }`
// don't truncate the body prematurely.
function findBlocks(text, keyword) {
  const blocks = [];
  const kwRe = new RegExp(`(^|[\\s;{}])${keyword}\\b`, 'g');
  let match;
  while ((match = kwRe.exec(text)) !== null) {
    const startIdx = match.index + (match[1] ? 1 : 0);
    let j = startIdx + keyword.length;
    let braceIdx = -1;
    while (j < text.length) {
      const c = text[j];
      if (c === '{') { braceIdx = j; break; }
      if (c === ';' || c === '}') break;
      j++;
    }
    if (braceIdx === -1) continue;
    const header = text.slice(startIdx + keyword.length, braceIdx).trim();
    let depth = 1;
    let k = braceIdx + 1;
    while (k < text.length && depth > 0) {
      const c = text[k];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      k++;
    }
    if (depth !== 0) continue;
    const body = text.slice(braceIdx + 1, k - 1);
    blocks.push({ header, body });
    kwRe.lastIndex = k;
  }
  return blocks;
}

function parseListen(raw) {
  // examples: "80", "443 ssl http2", "[::]:443 ssl", "127.0.0.1:8080"
  const m = raw.trim().match(/(?:\[.*?\]:|(?:\d+\.\d+\.\d+\.\d+:)?)?(\d+)/);
  return m ? Number(m[1]) : null;
}

function parseProxyPass(raw) {
  // http://host[:port][/path], https://host[:port][/path], or upstream-name reference.
  const m = raw.trim().match(/(https?):\/\/([^\/:\s;]+)(?::(\d+))?/);
  if (!m) return null;
  const scheme = m[1];
  const host = m[2];
  const explicitPort = m[3] ? Number(m[3]) : null;
  const defaultPort = scheme === 'https' ? 443 : 80;
  return {
    scheme,
    host,
    explicitPort,
    effectivePort: explicitPort ?? defaultPort
  };
}

function parseUpstreams(text) {
  const upstreams = new Map();
  const blocks = findBlocks(text, 'upstream');
  for (const b of blocks) {
    const name = b.header.trim();
    if (!name) continue;
    const serverMatch = b.body.match(/^\s*server\s+([^\s;]+)/m);
    if (!serverMatch) continue;
    const target = serverMatch[1];
    const colonIdx = target.lastIndexOf(':');
    const host = colonIdx >= 0 ? target.slice(0, colonIdx) : target;
    const port = colonIdx >= 0 ? Number(target.slice(colonIdx + 1)) : null;
    if (port !== null) upstreams.set(name, { host, port });
  }
  return upstreams;
}

export function parseConfig(text, extraUpstreams = new Map()) {
  const upstreams = new Map([...extraUpstreams, ...parseUpstreams(text)]);
  const sites = [];
  const serverBlocks = findBlocks(text, 'server');

  for (const { body } of serverBlocks) {
    const nameMatch = body.match(SERVER_NAME_RE);
    const rawNames = nameMatch ? nameMatch[1].trim().split(/\s+/) : [];
    const allNames = rawNames.filter((n) => n && n !== '_');
    if (allNames.length === 0) continue;
    const canonicalName = allNames[0];

    const listenPorts = [];
    let lm;
    LISTEN_RE.lastIndex = 0;
    while ((lm = LISTEN_RE.exec(body)) !== null) {
      const p = parseListen(lm[1]);
      if (p !== null && !listenPorts.includes(p)) listenPorts.push(p);
    }

    // A single server block may have multiple locations with different proxy_pass.
    // Pick the one that matches "/" if present, else the first.
    const ppMatches = [];
    const ppGlobal = /^\s*proxy_pass\s+([^;]+);/gm;
    let pm;
    while ((pm = ppGlobal.exec(body)) !== null) ppMatches.push(pm[1]);

    let backendPort = null;
    for (const raw of ppMatches) {
      const pp = parseProxyPass(raw);
      if (!pp) continue;
      // If the host is a known upstream name, resolve to its port
      const upstream = upstreams.get(pp.host);
      if (upstream) {
        backendPort = upstream.port;
      } else {
        backendPort = pp.effectivePort;
      }
      if (backendPort) break;
    }

    const hasProxyDirective = ppMatches.length > 0;
    const isStatic = !hasProxyDirective;

    sites.push({
      canonicalName,
      allNames,
      backendPort,
      listenPorts,
      isStatic,
      hasProxyDirective
    });
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

  // First pass: collect upstream blocks from every file so proxy_pass can resolve
  // upstream-name references regardless of which file the upstream lives in.
  const fileTexts = [];
  const globalUpstreams = new Map();
  for (const name of confFiles) {
    try {
      const text = await readFile(join(dir, name), 'utf8');
      fileTexts.push({ name, text });
      for (const [k, v] of parseUpstreams(text)) globalUpstreams.set(k, v);
    } catch {}
  }

  // Second pass: parse server blocks, resolving upstream references
  const all = [];
  for (const { name, text } of fileTexts) {
    try {
      const sites = parseConfig(text, globalUpstreams);
      for (const s of sites) all.push({ ...s, sourceFile: name });
    } catch {}
  }

  // Merge by canonicalName — prefer the block that has a real backend over a
  // redirect-only block (common pattern: `listen 80; return 301 https://...;`
  // on one block and `listen 443 ssl; proxy_pass ...;` on another).
  const byName = new Map();
  for (const s of all) {
    const existing = byName.get(s.canonicalName);
    if (!existing) {
      byName.set(s.canonicalName, s);
      continue;
    }
    // Prefer a block with a backendPort (real proxy) over one without
    if (!existing.backendPort && s.backendPort) {
      byName.set(s.canonicalName, s);
      continue;
    }
    // If both have backendPort or neither does, prefer the one listening on 443
    const existingHas443 = existing.listenPorts?.includes(443);
    const newHas443 = s.listenPorts?.includes(443);
    if (!existingHas443 && newHas443) {
      byName.set(s.canonicalName, s);
    }
  }

  return { sites: Array.from(byName.values()), error: null };
}
