# Project Rules

This project is a personal trading backend with a Codex-attached MCP operations interface.

If `.cursor/rules` exists, read the relevant rules before making changes. If it does not exist, follow this `AGENTS.md` and the documents under `docs/`.

## Core Boundary

Codex is not the trading engine.
Codex must not own the real-time trading loop.
Codex must not make final buy/sell decisions.
Codex must not bypass the Risk Engine.
Codex must not expose live order placement by default.

Codex is an MCP-based operations interface for inspecting, explaining, and safely controlling a deterministic trading backend.

## Deterministic Backend Owns

- market data ingestion
- screening
- strategy evaluation
- risk validation
- order routing
- execution tracking
- position reconciliation
- audit logging

## Codex May Be Used For

- portfolio inspection
- candidate analysis
- signal explanation
- risk decision review
- strategy status monitoring
- report generation
- emergency stop with approval
- documentation maintenance

## Default Policy

- Read-only MCP tools first.
- Mock provider first.
- Optional `tossinvest-cli` fork usage is read-only intelligence collection only.
- Codex CLI may be used as a paper-only virtual decision provider.
- Trading disabled by default.
- No real secrets in repository.
- No live order tool enabled by default.
- All risk logic must be tested.
- Risk Engine is the final gate before any order.
- OrderRouter must not accept direct natural language order requests from Codex.

## Hard Safety Rules

- Never add live trading capability without explicit user instruction.
- Never store secrets in code or docs.
- Never expose `place_order` as an enabled MCP tool by default.
- Never expose raw `tossctl` command execution as an enabled MCP tool.
- Never expose raw `codex exec` command execution as an enabled MCP tool.
- Prefer mock provider first.
- Keep unofficial Toss web/API-derived sources out of live trading paths.
- Keep Codex CLI `virtual_decision` output out of live `TradingSignal` and `OrderIntent` paths.
- Keep Codex as an operations interface.
- Keep trading logic deterministic.
- Add tests for risk-related logic.
- Mask account numbers, tokens, order IDs, and execution data.
- Do not claim investment performance or profitability.
- Do not present examples as financial advice.

## Documentation Rules

- Use Korean for main documentation.
- Keep technical identifiers, interface names, environment variables, tool names, and file names in English.
- Keep docs practical and backend-engineering focused.
- Emphasize safety, determinism, auditability, and clear system boundaries.
- Do not include real account data, real API keys, or real brokerage credentials.

## Implementation Rules

- Do not implement code unless the user explicitly asks for implementation.
- Prefer small, milestone-scoped changes.
- Keep `BROKER_PROVIDER=mock` and `TRADING_ENABLED=false` as safe defaults.
- Keep `AI_DECISION_MODE=paper_only` and `AI_DECISION_ENABLED=false` as safe defaults until the paper worker is explicitly implemented.
- Use structured contracts for candidates, signals, risk decisions, orders, executions, and audit events.
- Treat Risk Engine failures as fail-closed.
- Add or update tests when risk-related behavior changes.
