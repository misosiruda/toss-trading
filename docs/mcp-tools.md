# MCP Tools

> Codex is not the trading engine. Codex is an MCP-based operations interface for inspecting, explaining, and safely controlling a deterministic trading backend.

## Tool Policy Summary

MCP Server는 Codex에 운영 인터페이스를 제공합니다. 기본 정책은 read-only입니다. side-effect tool은 최소화하고, 명시적 approval과 audit log를 요구합니다. raw broker order API는 Codex에 직접 노출하지 않습니다.

## Read-only Tools

Read-only tool은 저장된 backend state를 조회합니다. 외부 CLI나 broker API를 Codex 요청 시점에 직접 실행하지 않습니다.

### `get_account_summary`

계좌 요약을 조회합니다. 계좌번호는 masking합니다.

Input:

```json
{
  "account_ref": "default"
}
```

Output:

```json
{
  "account_ref": "default",
  "masked_account_number": "1234-****-****",
  "broker_provider": "mock",
  "trading_enabled": false,
  "total_equity_krw": 10000000,
  "cash_krw": 5000000,
  "position_value_krw": 5000000,
  "daily_pnl_krw": 0,
  "updated_at": "2026-05-19T09:00:00+09:00"
}
```

### `get_positions`

보유 포지션을 조회합니다.

```json
{
  "market": "KR",
  "include_zero": false
}
```

```json
{
  "positions": [
    {
      "market": "KR",
      "symbol": "005930",
      "quantity": 10,
      "average_price": 70000,
      "market_value_krw": 700000,
      "unrealized_pnl_krw": 0,
      "updated_at": "2026-05-19T09:00:00+09:00"
    }
  ]
}
```

### `get_cash_balance`

현금 잔고를 조회합니다.

```json
{
  "currency": "KRW"
}
```

```json
{
  "currency": "KRW",
  "available_cash": 5000000,
  "settled_cash": 5000000,
  "pending_cash": 0,
  "updated_at": "2026-05-19T09:00:00+09:00"
}
```

### `get_screened_candidates`

최근 screener 후보 목록을 조회합니다.

```json
{
  "market": "KR",
  "limit": 20
}
```

```json
{
  "candidates": [
    {
      "candidate_id": "cand_mock_001",
      "market": "KR",
      "symbol": "005930",
      "score": 82,
      "reason_codes": ["VOLUME_SPIKE", "MA_BREAKOUT"],
      "screened_at": "2026-05-19T09:00:00+09:00",
      "expires_at": "2026-05-19T09:05:00+09:00"
    }
  ]
}
```

### `get_candidate_detail`

후보의 factor와 snapshot reference를 조회합니다.

```json
{
  "candidate_id": "cand_mock_001"
}
```

```json
{
  "candidate_id": "cand_mock_001",
  "market": "KR",
  "symbol": "005930",
  "factors": {
    "volume_spike_ratio": 2.4,
    "rsi": 58.2,
    "spread_bps": 5
  },
  "snapshot_ref": "snapshot_mock_001",
  "reason_codes": ["VOLUME_SPIKE", "MA_BREAKOUT"]
}
```

### `get_latest_signals`

최근 trading signal 목록을 조회합니다.

```json
{
  "strategy_id": "mock_momentum_v1",
  "limit": 20
}
```

```json
{
  "signals": [
    {
      "signal_id": "sig_mock_001",
      "strategy_id": "mock_momentum_v1",
      "market": "KR",
      "symbol": "005930",
      "side": "BUY",
      "signal_type": "MOMENTUM_BREAKOUT",
      "created_at": "2026-05-19T09:00:00+09:00",
      "expires_at": "2026-05-19T09:03:00+09:00"
    }
  ]
}
```

### `get_signal_detail`

Signal 생성 근거를 조회합니다.

```json
{
  "signal_id": "sig_mock_001"
}
```

```json
{
  "signal_id": "sig_mock_001",
  "input_candidate_id": "cand_mock_001",
  "reason_codes": ["CANDIDATE_SCORE_THRESHOLD", "TREND_FILTER_PASS"],
  "snapshot_ref": "snapshot_mock_001",
  "llm_generated": false
}
```

### `get_risk_decisions`

Risk Engine 판단 목록을 조회합니다.

```json
{
  "approved": false,
  "limit": 20
}
```

```json
{
  "risk_decisions": [
    {
      "decision_id": "risk_mock_001",
      "signal_id": "sig_mock_001",
      "approved": false,
      "reject_codes": ["MAX_ORDER_AMOUNT_EXCEEDED"],
      "created_at": "2026-05-19T09:00:01+09:00"
    }
  ]
}
```

### `get_strategy_status`

Strategy runtime 상태를 조회합니다.

```json
{
  "strategy_id": "mock_momentum_v1"
}
```

```json
{
  "strategy_id": "mock_momentum_v1",
  "status": "PAUSED",
  "trading_enabled": false,
  "last_run_at": "2026-05-19T09:00:00+09:00",
  "last_error": null
}
```

### `get_open_orders`

미체결 주문을 조회합니다. order ID는 masking합니다.

```json
{
  "market": "KR"
}
```

```json
{
  "open_orders": [
    {
      "masked_order_id": "ord_****_001",
      "market": "KR",
      "symbol": "005930",
      "side": "BUY",
      "quantity": 1,
      "status": "ACCEPTED",
      "created_at": "2026-05-19T09:00:02+09:00"
    }
  ]
}
```

### `get_recent_executions`

최근 체결을 조회합니다. execution ID는 masking합니다.

```json
{
  "limit": 20
}
```

```json
{
  "executions": [
    {
      "masked_execution_id": "exec_****_001",
      "masked_order_id": "ord_****_001",
      "market": "KR",
      "symbol": "005930",
      "side": "BUY",
      "quantity": 1,
      "price": 70000,
      "executed_at": "2026-05-19T09:00:03+09:00"
    }
  ]
}
```

### `get_audit_events`

감사 이벤트를 조회합니다.

```json
{
  "event_type": "RISK_DECISION",
  "limit": 50
}
```

### Future external intelligence tools

`tossinvest-cli` fork 같은 optional source를 구현하더라도 Codex에는 raw command runner를 노출하지 않습니다. 필요한 경우 다음처럼 normalized store를 조회하는 read-only tool만 추가합니다.

- `get_external_market_intelligence`
- `get_external_market_signal_snapshot`
- `get_intelligence_source_status`

이 tool들은 `ExternalMarketSignalStore` 또는 `MarketSnapshotStore`에 이미 저장된 값을 조회합니다. collector process 실행, auth/config 변경, watchlist mutation, order command 실행은 수행하지 않습니다.

### Future paper trading tools

Codex CLI paper trading을 구현하더라도 MCP에는 저장된 paper state를 조회하는 read-only tool만 기본 노출합니다.

- `get_virtual_portfolio`
- `get_virtual_positions`
- `get_virtual_decisions`
- `get_virtual_trades`
- `get_virtual_performance`

이 tool들은 `VirtualPortfolio`, `VirtualLedger`, `VirtualDecisionStore`를 조회합니다. MCP tool 호출 시점에 `codex exec`를 실행하지 않습니다.

```json
{
  "events": [
    {
      "event_id": "audit_mock_001",
      "event_type": "RISK_DECISION",
      "actor": "system",
      "summary": "Order rejected by RiskEngine",
      "masked_refs": ["risk_****_001"],
      "created_at": "2026-05-19T09:00:01+09:00"
    }
  ]
}
```

## Limited Operational Tools

이 tool들은 side effect가 있으므로 `approval_mode = "prompt"`를 권장합니다.

### `preview_order`

주문을 실행하지 않고 Risk Engine 검증 결과와 예상 주문 내용을 미리 봅니다.

```json
{
  "signal_id": "sig_mock_001",
  "quantity": 1,
  "order_type": "LIMIT",
  "limit_price": 70000
}
```

```json
{
  "preview_id": "preview_mock_001",
  "expires_at": "2026-05-19T09:01:00+09:00",
  "risk_approved": true,
  "estimated_order_amount_krw": 70000,
  "warnings": []
}
```

### `pause_strategy`

Strategy 실행을 중지합니다. 신규 signal 생성을 막기 위한 운영 제어입니다.

```json
{
  "strategy_id": "mock_momentum_v1",
  "reason": "manual maintenance"
}
```

### `resume_strategy`

중지된 strategy를 재개합니다. `TRADING_ENABLED=false`이면 signal 생성만 재개되고 주문 실행은 계속 차단될 수 있습니다.

```json
{
  "strategy_id": "mock_momentum_v1",
  "reason": "manual resume after check"
}
```

### `emergency_stop`

신규 주문과 strategy 실행을 즉시 차단합니다.

```json
{
  "reason": "manual emergency stop",
  "scope": "ALL"
}
```

## Disabled-by-default Tools

다음 tool은 기본적으로 Codex에 노출하지 않습니다.

- `place_order`
- `place_market_order`
- `run_tossctl`
- `execute_tossctl`
- `run_codex_exec`
- `execute_codex_cli`
- `place_toss_order`
- `sync_watchlist`
- `enable_live_trading`
- `update_risk_policy`
- `update_strategy_threshold`
- `transfer_cash`
- `withdraw`

실거래가 가능한 tool은 별도 threat model, 사용자 승인, 테스트, mock 검증, audit log, rollback 절차가 없으면 추가하지 않습니다.

## Approval Policy Recommendation

- `default_tools_approval_mode = "prompt"`
- read-only tools는 필요 시 tool별 `approval_mode = "approve"`로 명시
- operational tools는 `approval_mode = "prompt"` 유지
- disabled-by-default tools는 `disabled_tools`에 명시
- MCP Server 자체는 `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false` 환경에서 먼저 실행
- external intelligence source는 기본 비활성화하고, enabled되더라도 read-only normalized data 조회만 MCP에 노출
- Codex CLI paper trading은 backend worker에서만 실행하고, MCP에는 virtual state 조회만 노출
- enabled/disabled tool 변경은 pull request 또는 명시적 변경 이력으로 관리

예시는 [.codex/config.example.toml](../.codex/config.example.toml)을 참고합니다.
