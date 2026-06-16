export const disabledByDefaultMcpToolNames = [
  "place_order",
  "place_market_order",
  "run_tossctl",
  "execute_tossctl",
  "run_codex_exec",
  "execute_codex_cli",
  "place_toss_order",
  "sync_watchlist",
  "enable_live_trading",
  "update_risk_policy",
  "update_strategy_threshold",
  "transfer_cash",
  "withdraw"
] as const;

export type DisabledByDefaultMcpToolName =
  (typeof disabledByDefaultMcpToolNames)[number];
