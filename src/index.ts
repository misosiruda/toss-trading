export const runtimeInfo = {
  name: "toss-trading",
  tradingEnabledDefault: false,
  aiDecisionModeDefault: "paper_only",
  brokerProviderDefault: "mock"
} as const;

export function getRuntimeInfo(): typeof runtimeInfo {
  return runtimeInfo;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runtimeInfo, null, 2));
}
