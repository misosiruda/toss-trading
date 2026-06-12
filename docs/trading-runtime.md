# Trading Runtime

> Codex is not the trading engine. Codex is an MCP-based operations interface for inspecting, explaining, and safely controlling a deterministic trading backend.

## Runtime Principle

Trading Runtime은 Codex와 독립적으로 실행되는 backend system입니다. Codex가 꺼져 있거나 MCP 연결이 끊겨도 market data collection, screener, strategy evaluation, risk checks, order routing, execution tracking, position updates, audit logging은 계속 동작할 수 있어야 합니다.

## Core Components

### MarketDataCollector

`MarketDataCollector`는 market data provider 또는 broker API에서 다음 정보를 수집합니다.

- quote
- order book
- trade tick
- volume
- trading value
- market hours
- symbol metadata

수집 결과는 timestamp, provider, market, symbol을 포함한 `MarketSnapshot`으로 저장합니다. 장애가 발생하면 stale data 여부를 명확히 표시해야 합니다.

공식 Toss Securities Open API는 broker adapter의 primary source입니다. 비공식 `tossinvest-cli` fork는 `MarketDataCollector`의 대체 구현이 아니라 optional enrichment source로만 다룹니다.

### ExternalIntelligenceCollector

`ExternalIntelligenceCollector`는 공식 API 외부의 read-only 시장 정보를 수집하는 선택적 worker입니다.

허용 정보:

- market ranking
- market index
- market signals
- market screener
- quote flows
- quote warnings
- quote orderbook
- push listen 기반 read-only event observation

금지 정보와 동작:

- order placement, cancel, amend
- watchlist mutation
- account, portfolio, transactions, orders를 source of truth로 사용하는 것
- Codex가 raw `tossctl` command를 직접 실행하는 것

모든 external intelligence record는 `source`, `source_kind`, `official`, `command_key`, `collected_at`, `stale_after`, `normalized_schema_version`을 포함해야 합니다. stale data는 screener enrichment에서 제외합니다.

### Screener

`Screener`는 deterministic quantitative rules로 후보 종목을 선별합니다.

예시 factor:

- volume spike
- trading value
- price change
- moving average breakout
- RSI
- MACD
- VWAP
- spread
- watchlist membership
- existing position status

Screener는 LLM에게 후보 선별을 위임하지 않습니다. Codex는 결과를 조회하고 설명할 수만 있습니다.

### CandidateStore

`CandidateStore`는 screener 결과를 저장합니다.

권장 필드:

- `candidate_id`
- `market`
- `symbol`
- `name`
- `screened_at`
- `factors`
- `score`
- `reason_codes`
- `snapshot_ref`
- `expires_at`

후보는 만료 시간을 가져야 합니다. 오래된 후보를 기반으로 주문을 만들지 않도록 strategy와 risk에서 freshness를 검증합니다.

### MarketPacketBuilder

`MarketPacketBuilder`는 paper trading용 AI 입력을 만듭니다. raw provider response를 그대로 넘기지 않고, 후보 10~20개와 가상 포트폴리오 상태, 제약 조건, source reference만 포함한 compact JSON을 생성합니다.

권장 필드:

- `packet_id`
- `mode`
- `generated_at`
- `expires_at`
- `virtual_portfolio`
- `candidates`
- `constraints`

`market_packet`은 Codex CLI decision run의 유일한 입력입니다. Codex가 직접 `tossctl`이나 broker API를 호출하지 않도록 데이터 수집과 AI 판단을 분리합니다.

### CodexCliDecisionProvider

`CodexCliDecisionProvider`는 `market_packet`을 입력으로 받아 paper-only `virtual_decision` JSON을 생성합니다.

실행 정책:

- `AI_DECISION_ENABLED=false` 기본값
- `AI_DECISION_MODE=paper_only` 필수
- `codex exec --sandbox read-only` 사용
- `--output-schema` 또는 동등한 schema validation 사용
- timeout과 daily run budget 강제
- 실패 시 no-decision 처리

`virtual_decision`은 실거래 `TradingSignal`이 아니며 `OrderRouter`로 전달하지 않습니다.

### VirtualRiskEngine

`VirtualRiskEngine`은 Codex가 만든 `virtual_decision`을 가상 포트폴리오 기준으로 검증합니다.

검증 항목:

- stale packet
- virtual cash limit
- max virtual position exposure
- max new positions
- cooldown
- allowed market/symbol
- confidence range
- missing thesis or risk factors
- missing source refs

### PaperOrderEngine

`PaperOrderEngine`은 `VirtualRiskEngine`이 승인한 decision만 가상 체결로 기록합니다.

권장 상태:

- `VIRTUAL_PENDING`
- `VIRTUAL_FILLED`
- `VIRTUAL_REJECTED`
- `VIRTUAL_EXPIRED`

`PaperOrderEngine`은 broker adapter를 호출하지 않습니다.

paper-only 체결 모델:

- 기본 fill price rule은 `current_candidate_last_price`입니다.
- 기본값은 `slippageBps=0`, `feeBps=0`, `taxBps=0`, `allowFractionalShares=true`입니다.
- 옵션으로 slippage, fee, tax, fill ratio, whole-share 체결을 켤 수 있습니다.
- 모든 가상 체결은 `sourcePriceKrw`, `priceKrw`, `grossAmountKrw`, `netAmountKrw`, `feeKrw`, `taxKrw`, `slippageKrw`, `priceSourceRefs`를 남길 수 있습니다.
- SELL 체결은 평균단가와 net proceeds 기준으로 `realizedPnlKrw`를 계산할 수 있습니다.
- 이 값은 paper-only 분석용이며 실계좌 execution, 세금 계산, broker-grade 손익으로 취급하지 않습니다.

### VirtualPortfolio

`VirtualPortfolio`는 paper trading 전용 현금, 포지션, 평균단가, realized/unrealized PnL, trade history를 저장합니다.

이 값은 실계좌 포지션과 섞지 않습니다. 보고서에는 paper trading 결과임을 명시합니다.

### StrategyEngine

`StrategyEngine`은 candidate와 market snapshot을 평가해 `TradingSignal`을 생성합니다.

권장 필드:

- `signal_id`
- `strategy_id`
- `market`
- `symbol`
- `side`
- `signal_type`
- `confidence_score`
- `input_candidate_id`
- `snapshot_ref`
- `created_at`
- `expires_at`
- `reason_codes`

`confidence_score`는 deterministic formula의 산출물이어야 합니다. LLM이 confidence를 최종 산정하면 안 됩니다.

이 제한은 live trading path에 적용됩니다. Paper trading path에서는 Codex CLI가 `virtual_decision.confidence`를 제안할 수 있지만, 해당 값은 `VirtualRiskEngine`과 보고서용으로만 사용합니다.

### RiskEngine

`RiskEngine`은 주문 전 최종 gate입니다.

검증 항목:

- max order amount
- max daily loss
- max position exposure
- symbol allowlist
- market allowlist
- market hours
- duplicate order prevention
- cooldown
- open order count
- market order policy
- kill switch
- stale signal rejection
- preview requirement

Risk Engine은 `RiskDecision`을 생성합니다.

권장 필드:

- `decision_id`
- `signal_id`
- `order_intent_id`
- `approved`
- `reject_codes`
- `checked_rules`
- `risk_snapshot_ref`
- `created_at`

### OrderRouter

`OrderRouter`는 승인된 order intent만 broker adapter로 전달합니다.

책임:

- idempotency key 검증
- retry policy
- timeout 처리
- broker error normalization
- order state machine 관리
- execution tracking 연결
- reconciliation trigger

OrderRouter는 Codex의 자연어 요청을 직접 받지 않습니다.

### ExecutionTracker

`ExecutionTracker`는 주문 접수, 정정, 취소, 부분 체결, 전체 체결, 거부, 만료 상태를 추적합니다.

권장 상태:

- `PENDING`
- `ACCEPTED`
- `PARTIALLY_FILLED`
- `FILLED`
- `CANCELED`
- `REJECTED`
- `EXPIRED`
- `UNKNOWN`

`UNKNOWN` 상태는 reconciliation 대상입니다.

### PositionService

`PositionService`는 포지션, 현금, 평가금액, exposure, realized/unrealized PnL을 계산합니다.

이 값은 broker response, execution events, internal ledger를 비교해 정합성을 확인해야 합니다.

### AuditLogger

`AuditLogger`는 다음 이벤트를 저장합니다.

- market data ingestion failure
- screener run result
- candidate creation
- market packet creation
- Codex CLI virtual decision result
- virtual risk decision
- paper order result
- signal creation
- risk decision
- order preview
- order routing
- broker response
- execution update
- position reconciliation
- strategy pause/resume
- emergency stop
- MCP tool invocation

민감한 값은 masking해야 합니다.

## Suggested Scheduling Intervals

| Job | Suggested interval | Notes |
| --- | --- | --- |
| `MarketDataCollector` | 1~10 seconds or provider-dependent | 실제 API rate limit 기준으로 조정 |
| `ExternalIntelligenceCollector` | 30 seconds~5 minutes or provider-dependent | optional source이며 failure는 degraded 상태로 기록 |
| `Screener` | 3~5 minutes | 후보 만료 시간과 함께 운영 |
| `CodexCliDecisionProvider` | daily, hourly, or manually triggered | paper-only, daily run budget 적용 |
| `PaperOrderEngine` | per approved virtual decision | broker adapter 호출 금지 |
| `StrategyEngine` | 30 seconds~1 minute or event-driven | stale candidate 방지 |
| `RiskEngine` | per order intent | 모든 주문 직전 동기 검증 |
| `ExecutionTracker` | 5~30 seconds | broker state와 내부 state 비교 |
| `PositionService` | 30 seconds~5 minutes | market hours와 체결 빈도에 따라 조정 |
| `AuditLogger` flush | near real-time | 이벤트 손실 방지 우선 |
| Codex report automation | daily or hourly | trading loop 실행 금지 |

## Runtime Failure Policy

- stale market data이면 signal을 생성하지 않습니다.
- stale signal이면 주문 intent를 거절합니다.
- Risk Engine 오류는 fail-closed로 처리합니다.
- OrderRouter timeout은 reconciliation 대상입니다.
- kill switch가 켜지면 신규 주문을 차단합니다.
- broker adapter 오류는 raw error를 masking하고 normalized error code로 기록합니다.
- optional external intelligence source 오류는 `EXTERNAL_SOURCE_UNAVAILABLE`로 기록하고, 해당 source에 의존하는 후보나 signal은 생성하지 않습니다.
- Codex CLI decision 오류는 `AI_DECISION_FAILED`로 기록하고, paper order를 생성하지 않습니다.
- invalid `virtual_decision`은 `VIRTUAL_DECISION_REJECTED`로 기록하고, 이전 decision을 재사용하지 않습니다.
