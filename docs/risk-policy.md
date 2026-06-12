# Risk Policy

> Codex is not the trading engine. Codex is an MCP-based operations interface for inspecting, explaining, and safely controlling a deterministic trading backend.

## Policy Principle

Risk Engine은 모든 주문 직전의 최종 gate입니다. Codex, MCP Server, StrategyEngine, OrderRouter는 Risk Engine을 우회할 수 없습니다.

Risk policy는 deterministic code와 명시적 설정으로 관리합니다. Codex는 risk decision을 조회하고 설명할 수 있지만, 런타임에 정책을 약화하거나 수정할 수 없습니다.

Paper trading에도 같은 철학을 적용합니다. Codex CLI는 `virtual_decision`을 만들 수 있지만, `VirtualRiskEngine`이 가상 현금, 노출도, stale data, cooldown을 검증한 뒤에만 `PaperOrderEngine`이 가상 체결을 기록합니다. 이 경로는 실거래 `RiskEngine`, `TradingSignal`, `OrderIntent`와 분리합니다.

## Paper Trading Risk Boundary

`VirtualRiskEngine`은 AI 판단을 대체하지 않고, AI가 만든 가상 주문 제안을 거절하거나 축소하는 gate입니다.

필수 조건:

- `AI_DECISION_MODE=paper_only`
- `PAPER_TRADING_ENABLED=true`
- `TRADING_ENABLED=false`
- `virtual_decision` schema validation 통과
- source freshness 통과
- virtual cash/exposure/cooldown 통과

권장 reject code:

- `VIRTUAL_PACKET_STALE`
- `VIRTUAL_DECISION_STALE`
- `VIRTUAL_CANDIDATE_NOT_FOUND`
- `VIRTUAL_PRICE_MISSING`
- `VIRTUAL_CASH_EXCEEDED`
- `VIRTUAL_CASH_RESERVE_BREACHED`
- `VIRTUAL_BUDGET_EXCEEDED`
- `VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED`
- `VIRTUAL_POSITION_WEIGHT_EXCEEDED`
- `VIRTUAL_POSITION_NOT_FOUND`
- `VIRTUAL_SELL_AMOUNT_REQUIRED`
- `VIRTUAL_SELL_AMOUNT_EXCEEDED`
- `VIRTUAL_COOLDOWN_ACTIVE`
- `VIRTUAL_DECISION_SCHEMA_INVALID`
- `VIRTUAL_DECISION_SOURCE_MISSING`

`virtual_decision` reject는 실거래 risk decision과 섞지 않고 별도 audit event로 기록합니다.

## Paper Trading Policy Parameters

`VirtualRiskEngine`은 paper-only 판단에 대해 다음 정책을 정규화해서 평가합니다.

| 정책 | 기본값 | 설명 |
| --- | ---: | --- |
| `maxBudgetPerDecisionKrw` | packet `maxBudgetPerSymbolKrw` | AI decision 1건의 최대 paper notional |
| `maxSymbolExposureKrw` | packet `maxBudgetPerSymbolKrw` | 동일 종목의 최대 paper exposure |
| `maxPositionWeightRatio` | `0.35` | NAV 대비 단일 종목 paper 비중 한도 |
| `minCashReserveRatio` | `0.10` | NAV 대비 최소 현금 reserve |
| `minCashReserveKrw` | `0` | 절대 최소 현금 reserve |
| `cooldownEntries` | `[]` | symbol/action 단위의 임시 진입 제한 |

정책 목적:

- `cash_reserve`는 모든 현금을 소진하는 BUY를 막습니다.
- `position_weight`는 NAV가 커져도 단일 종목 집중도가 과도해지지 않게 막습니다.
- `cooldown`은 같은 symbol/action/reject code 반복으로 AI가 같은 실수를 빠르게 되풀이하는 상황을 줄이기 위한 입력입니다.
- `reduceOnly: true`인 `VIRTUAL_SELL`은 리스크 축소성 paper 매도이므로 cooldown 예외로 둡니다.

현재 정책은 paper-only `VirtualRiskEngine`에 한정됩니다. 실거래 `RiskEngine`, `TradingSignal`, `OrderIntent`, `OrderRouter` 경로로 전파하지 않습니다.

## Required Risk Rules

### Kill Switch

`kill_switch = true`이면 신규 주문을 모두 거절합니다.

권장 reject code:

- `KILL_SWITCH_ACTIVE`

Kill switch 변경은 audit log를 남기고, 재개 시에도 명시적 승인과 사유가 필요합니다.

### Max Order Amount

주문 1건의 최대 금액을 제한합니다.

기본 예시:

- `MAX_ORDER_AMOUNT_KRW=100000`

권장 reject code:

- `MAX_ORDER_AMOUNT_EXCEEDED`

### Max Daily Loss

일 손실 한도를 초과하면 신규 주문을 차단합니다.

권장 reject code:

- `MAX_DAILY_LOSS_EXCEEDED`

계산 기준은 realized PnL, unrealized PnL, fees, currency conversion 포함 여부를 명확히 문서화해야 합니다.

### Max Position Exposure

종목별, 시장별, 전체 계좌 기준 exposure를 제한합니다.

권장 reject code:

- `MAX_SYMBOL_EXPOSURE_EXCEEDED`
- `MAX_MARKET_EXPOSURE_EXCEEDED`
- `MAX_TOTAL_EXPOSURE_EXCEEDED`

### Symbol Allowlist

허용된 symbol만 거래할 수 있습니다.

기본 예시:

- `ALLOWED_SYMBOLS=005930,AAPL,MSFT,NVDA`

권장 reject code:

- `SYMBOL_NOT_ALLOWED`

이 값은 예시이며 투자 추천이 아닙니다.

### Market Allowlist

허용된 market만 거래할 수 있습니다.

기본 예시:

- `ALLOWED_MARKETS=KR,US`

권장 reject code:

- `MARKET_NOT_ALLOWED`

### Market Hours

market hours 밖의 신규 주문은 기본 거절합니다.

권장 reject code:

- `MARKET_CLOSED`
- `MARKET_HOURS_UNKNOWN`

provider 장애로 market hours를 확인할 수 없으면 fail-closed로 처리합니다.

### Duplicate Order Prevention

동일 signal, symbol, side, quantity, strategy context의 중복 주문을 방지합니다.

권장 reject code:

- `DUPLICATE_ORDER_INTENT`
- `IDEMPOTENCY_KEY_REUSED`

### Cooldown

동일 symbol 또는 strategy에서 너무 잦은 주문 생성을 막습니다.

권장 reject code:

- `COOLDOWN_ACTIVE`

### Open Order Count

미체결 주문 수가 한도를 초과하면 신규 주문을 거절합니다.

권장 reject code:

- `OPEN_ORDER_LIMIT_EXCEEDED`

### Market Order Policy

Market order는 기본 금지하거나 별도 승인 대상으로 둡니다.

권장 reject code:

- `MARKET_ORDER_DISABLED`
- `MARKET_ORDER_REQUIRES_APPROVAL`

초기 구현에서는 limit order 중심으로 설계합니다.

### Preview-before-place

실주문 전 `preview_order`를 요구합니다.

기본 예시:

- `REQUIRE_PREVIEW=true`
- `PREVIEW_TTL_SECONDS=60`

권장 reject code:

- `PREVIEW_REQUIRED`
- `PREVIEW_EXPIRED`
- `PREVIEW_MISMATCH`

## Risk Decision Contract

Risk Engine은 모든 판단을 구조화된 `RiskDecision`으로 남깁니다.

```json
{
  "decision_id": "risk_mock_001",
  "order_intent_id": "intent_mock_001",
  "signal_id": "sig_mock_001",
  "approved": false,
  "reject_codes": ["MAX_ORDER_AMOUNT_EXCEEDED"],
  "checked_rules": [
    "KILL_SWITCH",
    "MAX_ORDER_AMOUNT",
    "SYMBOL_ALLOWLIST",
    "MARKET_HOURS"
  ],
  "created_at": "2026-05-19T09:00:01+09:00"
}
```

## Audit Requirements

다음 이벤트는 반드시 감사 로그 대상입니다.

- risk rule evaluation
- rejected order intent
- approved order intent
- preview creation
- preview expiration
- kill switch activation/deactivation
- strategy pause/resume
- MCP operational tool invocation
- risk policy file or config change

Audit log는 다음 원칙을 지킵니다.

- account number masking
- token masking
- order ID masking
- execution ID masking
- 원본 broker credential 저장 금지
- 변경 전/후 정책 hash 기록
- actor, source, timestamp 기록

## Fail-closed Policy

Risk Engine이 판단에 필요한 데이터를 얻지 못하면 주문을 승인하지 않습니다.

예시:

- market hours unknown
- position snapshot stale
- cash balance stale
- signal expired
- candidate expired
- broker adapter unhealthy
- audit logger unavailable

이 경우 reject 또는 system halt로 처리하고 Codex에는 설명 가능한 error code만 노출합니다.
