export const endpoints = {
  health: "/health",
  portfolio: "/virtual/portfolio",
  decisions: "/virtual/decisions?limit=20",
  trades: "/virtual/trades?limit=20",
  report: "/paper/report",
  replay: "/replay/report",
  replayProgress: "/replay/progress",
  batchReplay: "/batch/replay/report",
  batchRuns: "/batch/replay/runs?limit=50",
  scheduler: "/scheduler/status",
  source: "/source/health",
  packets: "/market/packets?limit=5",
  audit: "/audit/events?limit=100"
};

export async function fetchEndpointData() {
  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([key, path]) => {
      try {
        return [key, await fetchJson(path)];
      } catch (error) {
        return [key, { error: endpointErrorMessage(path, error) }];
      }
    })
  );
  return Object.fromEntries(entries);
}

export function endpointFailures(data) {
  return Object.entries(data)
    .filter(([, value]) => value?.error)
    .map(([key]) => key);
}

export async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return await response.json();
}

export function endpointErrorMessage(path, error) {
  const message = error instanceof Error ? error.message : String(error);
  return `${path}: ${message}`;
}
