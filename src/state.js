// In-memory latest snapshot, updated by scheduler after each collection.
// The /api/overview endpoint reads from here so 5s polling doesn't re-hit
// expensive sources (Docker stats, ss) — freshness is ~1 minute, which
// matches the collection cadence.

export const state = {
  lastCollectionTs: null,
  system: null,          // { cpuPct, memUsedMb, memTotalMb, load: [l1,l5,l15], uptimeSec }
  disks: [],             // [{ mount, usedGb, totalGb }]
  composeProjects: [],   // [{ name, containers: [{ name, state, cpuPct, memUsedMb, uptimeSec, restartCount }] }]
  sites: [],             // [{ name, backendPort, httpConnections, sseConnections, latencyMs, status }]
  nginxSites: []         // parsed config cache (from nginx.js parseSites)
};
