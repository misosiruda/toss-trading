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

계약 source of truth:

| Contract | Source | 검증 책임 |
| --- | --- | --- |
| `VirtualDecision` output | `schemas/virtual-decision.schema.json` | Codex CLI가 직접 출력할 수 있는 paper-only field만 허용 |
| `VirtualDecision` runtime/storage | `src/domain/schemas.ts` | 저장 record의 `decisionHash`, `confidenceBreakdown` 같은 backend-generated field 포함 |
| `MarketPacket` | `src/domain/schemas.ts` | candidate, source refs, feature refs, portfolio constraint의 구조 검증 |
| `VirtualRiskDecision` | `src/domain/schemas.ts` | paper risk gate 승인/거절 결과 기록 |
| `VirtualTrade` | `src/domain/schemas.ts` | `PaperOrderEngine`이 기록하는 paper-only 체결 결과 |
| packet-bound semantic validation | `src/paper/virtualDecisionValidation.ts` | packet hash, identity metadata, candidate refs, claim support, action eligibility 검증 |

Artifact 위치 계약:

| Contract | Primary artifact | Replay artifact | 조회/추적 책임 |
| --- | --- | --- | --- |
| `MarketPacket` | `market-packets.jsonl` | `historical-replay-packets.jsonl` | risk 전 단계 입력 packet과 source refs 확인 |
| `VirtualDecision` | `virtual-decisions.jsonl` | `historical-replay-decisions.jsonl` | validation을 통과한 paper-only decision만 저장 |
| `VirtualRiskDecision` | `audit-events.jsonl` | `historical-replay-risk-decisions.jsonl` | 승인/거절, reject code, fail-closed 원인 추적 |
| `VirtualTrade` | `virtual-trades.jsonl` | `historical-replay-trades.jsonl` | risk 승인 이후 paper fill만 저장 |
| `AuditEvent` | `audit-events.jsonl` | `historical-replay-progress.json`의 `recentEvents`, `historical-replay-report.json`의 warning/failure summary | provider failure, validation reject, order stage 추적 |

`src/storage/artifactPaths.ts`는 위 파일명의 source of truth입니다. JSONL artifact는 append-only로 다루며, read-only 조회는 손상 line을 건너뛰고 `corruptLineCount`를 반환해야 합니다. 손상 line이나 누락 파일은 risk gate 우회, replay 실행, paper order 생성으로 이어지면 안 됩니다.

권장 reject code:

- `VIRTUAL_PACKET_STALE`
- `VIRTUAL_DECISION_STALE`
- `VIRTUAL_CANDIDATE_NOT_FOUND`
- `VIRTUAL_PRICE_MISSING`
- `VIRTUAL_CASH_EXCEEDED`
- `VIRTUAL_CASH_RESERVE_BREACHED`
- `VIRTUAL_REGIME_CASH_RESERVE_BREACHED`
- `VIRTUAL_BUDGET_EXCEEDED`
- `VIRTUAL_TARGET_EXPOSURE_EXCEEDED`
- `VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED`
- `VIRTUAL_POSITION_WEIGHT_EXCEEDED`
- `VIRTUAL_BUCKET_BUDGET_EXCEEDED`
- `VIRTUAL_BUCKET_TURNOVER_EXCEEDED`
- `VIRTUAL_SECTOR_EXPOSURE_EXCEEDED`
- `VIRTUAL_COUNTRY_EXPOSURE_EXCEEDED`
- `VIRTUAL_CURRENCY_EXPOSURE_EXCEEDED`
- `VIRTUAL_EXPOSURE_METADATA_MISSING`
- `VIRTUAL_HEDGE_NOT_REDUCE_RISK`
- `VIRTUAL_HEDGE_GROSS_EXPOSURE_EXCEEDED`
- `VIRTUAL_HEDGE_METADATA_MISSING`
- `VIRTUAL_POSITION_NOT_FOUND`
- `VIRTUAL_SELL_AMOUNT_REQUIRED`
- `VIRTUAL_SELL_AMOUNT_EXCEEDED`
- `VIRTUAL_COOLDOWN_ACTIVE`
- `VIRTUAL_DECISION_SCHEMA_INVALID`
- `VIRTUAL_DECISION_SOURCE_MISSING`

`virtual_decision` reject는 실거래 risk decision과 섞지 않고 별도 audit event로 기록합니다.

## Paper Strategy Bucket Metadata

장기 투자, 스윙, 단기, 초단기, hedge 전략을 같은 paper portfolio에서 비교하려면 replay artifact가 strategy bucket metadata를 잃지 않아야 합니다.

현재 paper-only contract는 다음 bucket만 허용합니다.

```text
long_term
swing
short_term
intraday
hedge
```

적용 범위:

- `HistoricalMarketSnapshot.strategyBucket`은 historical replay snapshot metadata입니다.
- `HistoricalMarketSnapshot.sector`는 historical replay snapshot metadata이며, universe/collector가 제공한 경우 candidate로 전달됩니다.
- `MarketCandidate.strategyBucket`은 backend가 생성한 후보 metadata이며 bucket source of truth입니다.
- `VirtualPosition.strategyBucket`은 paper fill 이후 position에 보존되는 metadata입니다.
- `VirtualPosition.sector`는 paper fill 이후 position에 보존되는 exposure metadata입니다.
- `VirtualTrade.strategyBucket`은 paper fill 당시 기록되는 audit metadata입니다.

정책 경계:

- `VirtualDecision` AI output에는 `strategyBucket`을 추가하지 않습니다.
- AI decision provider가 임의 bucket을 선택하거나 바꾸는 경로를 만들지 않습니다.
- `PaperOrderEngine`은 candidate 또는 기존 position의 bucket만 position/trade에 복사합니다.
- 이번 단계는 metadata contract와 artifact propagation만 다룹니다.
- bucket budget, turnover, sector/country/currency exposure reject는 후속 `portfolioExposureAggregator`와 `VirtualRiskEngine` PR에서 구현합니다.

metadata가 없는 position/candidate는 후속 aggregation에서 `unknown` bucket으로 보수적으로 취급해야 합니다. `unknown`은 저장 schema의 허용 bucket이 아니라 aggregation용 fallback key입니다.

## Paper Portfolio Exposure Aggregation

`portfolioExposureAggregator`는 paper portfolio의 노출도를 deterministic하게 계산하는 공통 모듈입니다. 이 단계의 목적은 strategy bucket risk gate를 바로 열기 전에, report와 후속 `VirtualRiskEngine` rule이 같은 산식을 쓰도록 만드는 것입니다.

현재 계산 축:

- market
- symbol
- asset type
- asset class
- strategy bucket
- gross exposure
- net exposure
- unknown metadata exposure

정책 경계:

- 같은 `market:symbol` position row가 여러 bucket에 나뉘어 있어도 symbol exposure는 합산합니다.
- `assetType`, `assetClass`, `strategyBucket` 중 하나라도 없으면 해당 position의 gross exposure를 `unknownMetadataExposureKrw`에 포함합니다.
- `UNKNOWN`과 `unknown`은 aggregation fallback key이며, 저장 schema의 실제 strategy bucket enum이 아닙니다.
- net worth가 0 이하이면 ratio는 `0`으로 고정해 report와 risk rule에서 `NaN`이 전파되지 않게 합니다.
- 이번 단계는 exposure 계산과 report 노출까지만 담당합니다. 신규 buy reject, bucket budget, turnover, sector/country/currency limit은 후속 `VirtualRiskEngine` rule에서 적용합니다.

## Paper Portfolio Exposure Risk Gates

`VirtualRiskEngine`은 명시된 policy가 있을 때만 portfolio concentration gate를 적용합니다. 기본값은 disabled이므로 기존 paper replay는 policy를 전달하지 않는 한 새 concentration reject로 바뀌지 않습니다.

현재 적용 gate:

- strategy bucket budget: 신규 BUY 이후 해당 bucket exposure가 policy cap을 넘으면 `VIRTUAL_BUCKET_BUDGET_EXCEEDED`
- strategy bucket turnover: 신규 BUY notional이 해당 bucket turnover cap을 넘으면 `VIRTUAL_BUCKET_TURNOVER_EXCEEDED`
- sector exposure: 신규 BUY 이후 같은 sector exposure가 cap을 넘으면 `VIRTUAL_SECTOR_EXPOSURE_EXCEEDED`
- country exposure: 현재 schema의 `region` metadata를 country axis로 사용하며, cap 초과 시 `VIRTUAL_COUNTRY_EXPOSURE_EXCEEDED`
- currency exposure: `riskTags`에 `currency_exposed`가 있거나 `assetClass=currency`, 또는 `region=US|GLOBAL`이면 currency exposure로 취급하며, cap 초과 시 `VIRTUAL_CURRENCY_EXPOSURE_EXCEEDED`
- unknown metadata exposure: asset type/class, strategy bucket, sector, region, currency 판단 metadata 중 하나라도 없으면 해당 gross exposure를 unknown으로 보수 집계하고, cap 초과 시 `VIRTUAL_EXPOSURE_METADATA_MISSING`

정책 경계:

- BUY에 대해서만 신규 exposure cap을 적용합니다.
- `reduceOnly: true`인 SELL은 risk 축소성 paper action이므로 bucket turnover gate에서 제외합니다.
- sector는 position metadata를 우선 사용하고, 없으면 같은 `market:symbol` candidate metadata를 사용합니다. 둘 다 없으면 unknown으로 취급합니다.
- historical replay에서 sector cap을 켜려면 universe/collector/snapshot 경로가 `HistoricalMarketSnapshot.sector`를 제공해야 합니다. 기존 sectorless replay data는 cap 평가 시 unknown metadata로 남아 fail-closed 될 수 있습니다.
- country 전용 schema는 아직 열지 않고 기존 `region`을 사용합니다. 별도 ISO country/currency field는 후속 schema 확장 PR에서 검토합니다.

## Paper Trading Policy Parameters

`VirtualRiskEngine`은 paper-only 판단에 대해 다음 정책을 정규화해서 평가합니다.

| 정책 | 기본값 | 설명 |
| --- | ---: | --- |
| `maxBudgetPerDecisionKrw` | packet `maxBudgetPerSymbolKrw` | AI decision 1건의 최대 paper notional |
| `maxSymbolExposureKrw` | packet `maxBudgetPerSymbolKrw` | 동일 종목의 최대 paper exposure |
| `maxPositionWeightRatio` | `0.35` | NAV 대비 단일 종목 paper 비중 한도 |
| `maxStrategyBucketExposureKrw` | disabled | bucket별 최대 paper exposure 금액 |
| `maxStrategyBucketExposureRatio` | disabled | NAV 대비 bucket별 최대 paper exposure 비율 |
| `maxBucketTurnoverKrw` | disabled | bucket별 단일 BUY turnover 금액 |
| `maxBucketTurnoverRatio` | disabled | NAV 대비 bucket별 단일 BUY turnover 비율 |
| `maxSectorExposureKrw` | disabled | sector별 최대 paper exposure 금액 |
| `maxSectorExposureRatio` | disabled | NAV 대비 sector별 최대 paper exposure 비율 |
| `maxCountryExposureKrw` | disabled | country/region별 최대 paper exposure 금액 |
| `maxCountryExposureRatio` | disabled | NAV 대비 country/region별 최대 paper exposure 비율 |
| `maxCurrencyExposureKrw` | disabled | currency exposure 최대 금액 |
| `maxCurrencyExposureRatio` | disabled | NAV 대비 currency exposure 최대 비율 |
| `maxUnknownMetadataExposureKrw` | disabled | metadata unknown exposure 최대 금액 |
| `maxUnknownMetadataExposureRatio` | disabled | NAV 대비 metadata unknown exposure 최대 비율 |
| `minCashReserveRatio` | `0.10` | NAV 대비 최소 현금 reserve |
| `minCashReserveKrw` | `0` | 절대 최소 현금 reserve |
| `dynamicCashReservePolicy` | disabled | market regime과 high volatility 기준으로 최소 현금 reserve를 상향하는 opt-in policy |
| `hedgePolicy` | disabled | hedge bucket/inverse exposure BUY가 실제 net downside exposure를 낮추는지 검증하는 opt-in policy |
| `cooldownEntries` | `[]` | symbol/action 단위의 임시 진입 제한 |

정책 목적:

- `cash_reserve`는 모든 현금을 소진하는 BUY를 막습니다.
- `regime_cash_reserve`는 `dynamicCashReservePolicy`가 설정된 replay에서 시장 regime과 변동성 기준으로 현금 reserve를 추가로 상향합니다.
- `position_weight`는 NAV가 커져도 단일 종목 집중도가 과도해지지 않게 막습니다.
- `sector_exposure`, `country_exposure`, `currency_exposure`는 한쪽 portfolio 쏠림을 deterministic하게 막습니다.
- `exposure_metadata`는 sector/country/currency/bucket metadata가 부족한 상태에서 신규 진입을 보수적으로 제한합니다.
- `bucket_budget`과 `bucket_turnover`는 장기/스윙/단기/초단기/hedge bucket 중 한쪽으로 paper portfolio가 치우치는 것을 줄입니다.
- `hedge_policy`는 hedge를 수익 전략이 아니라 portfolio downside 방어 action으로만 허용합니다.
- `cooldown`은 같은 symbol/action/reject code 반복으로 AI가 같은 실수를 빠르게 되풀이하는 상황을 줄이기 위한 입력입니다.
- `reduceOnly: true`인 `VIRTUAL_SELL`은 리스크 축소성 paper 매도이므로 cooldown 예외로 둡니다.

현재 정책은 paper-only `VirtualRiskEngine`에 한정됩니다. 실거래 `RiskEngine`, `TradingSignal`, `OrderIntent`, `OrderRouter` 경로로 전파하지 않습니다.

### Dynamic Cash Reserve

`dynamicCashReservePolicy`는 static `minCashReserveRatio`와 `minCashReserveKrw`를 약화하지 않습니다. 각 replay tick에서 현재 `simulatedAt` 이전 snapshot만 사용해 market regime을 계산하고, static reserve보다 더 높은 reserve가 필요한 경우에만 `VIRTUAL_REGIME_CASH_RESERVE_BREACHED`를 추가합니다.

기본 방향:

| Regime | 기본 reserve ratio |
| --- | ---: |
| `bull` | `max(static floor, 0.02)` |
| `sideways` | `0.10` |
| `mixed` | `0.15` |
| `bear` | `0.25` |
| `insufficient_data` | `0.35` |
| high volatility | `0.30` |

high volatility는 classified symbol의 absolute return 평균이 `highVolatilityReturnThreshold` 이상일 때 적용됩니다. 기본 threshold는 `0.08`입니다.

적용 범위:

- historical/batch replay의 paper-only `VirtualRiskEngine`에서만 사용합니다.
- `--dynamic-cash-reserve`를 명시한 batch replay에서 risk profile policy 위에 병합됩니다.
- 설정은 `historical-replay-run-metadata.json`의 `configuration.riskPolicy.dynamicCashReservePolicy`와 research manifest hash에 포함됩니다.
- tick별 `dynamicCashReserveMarketRegime`은 runtime context이며 run metadata의 static configuration에는 저장하지 않습니다.
- market regime allocation은 market별 target exposure ratio를 조정하고, dynamic cash reserve는 전체 portfolio cash floor를 조정합니다. 두 정책은 서로 대체하지 않습니다.

### Hedge Policy

`hedgePolicy`는 paper-only BUY 중 `strategyBucket=hedge`이거나 `assetClass=inverse`, `riskTags=inverse`인 후보에만 적용되는 opt-in gate입니다. 일반 long/swing/short-term/intraday BUY는 이 policy가 설정되어 있어도 hedge gate를 타지 않습니다.

허용 조건:

- hedge 후보는 `assetType`, `assetClass`, `strategyBucket` metadata를 가져야 합니다.
- 기본값 기준 hedge 후보의 `strategyBucket`은 반드시 `hedge`여야 합니다.
- Q5-2 구현은 inverse exposure만 net downside exposure를 낮추는 hedge로 인정합니다.
- 정확한 leverage ratio field가 없으므로 `assetClass=leveraged` 또는 `riskTags=leveraged` metadata는 보수적으로 3x effective exposure로 계산합니다.
- 신규 hedge BUY 이후 `0 <= net downside exposure < current net downside exposure`가 되어야 합니다.
- 신규 hedge BUY 이후 gross exposure가 `maxGrossExposureKrw` 또는 `maxGrossExposureRatio`를 넘으면 reject합니다.

Reject code:

- `VIRTUAL_HEDGE_METADATA_MISSING`: hedge 여부 또는 기존 portfolio downside exposure를 판단할 metadata가 부족합니다.
- `VIRTUAL_HEDGE_NOT_REDUCE_RISK`: hedge bucket이 아니거나, inverse exposure가 아니거나, net downside exposure를 낮추지 못하거나, net short 성격으로 뒤집힙니다.
- `VIRTUAL_HEDGE_GROSS_EXPOSURE_EXCEEDED`: hedge가 net exposure를 낮추더라도 gross exposure cap을 넘습니다.

정책 경계:

- 이 정책은 `VirtualRiskEngine`의 paper-only BUY gate에만 연결됩니다.
- 실거래 `RiskEngine`, `TradingSignal`, `OrderIntent`, `OrderRouter` 경로로 전파하지 않습니다.
- hedge reject와 hedge trade cost는 historical replay report의 `riskSummary.policySummary.hedge`와 run metadata의 `riskPolicySummary.hedge`에 요약됩니다.
- dynamic cash reserve reject는 historical replay report의 `riskSummary.policySummary.dynamicCashReserve`와 run metadata의 `riskPolicySummary.dynamicCashReserve`에 요약됩니다.

## Live RiskEngine Implementation Boundary

`LiveRiskEngine`은 `src/risk/`에 위치하며, 이미 구조화된 live order intent와 risk snapshot을 입력으로 받아 deterministic `RiskDecision`을 생성합니다.

현재 구현 범위:

- runtime root payload normalization before rule evaluation
- kill switch
- max order amount
- max daily loss
- symbol/market/total exposure
- aggregate symbol exposure across matching position rows
- aggregate sellable quantity across matching position rows
- risk snapshot freshness with `maxSnapshotAgeMs`
- pending buy order exposure reservation
- pending sell order quantity reservation
- symbol allowlist
- market allowlist
- market hours
- duplicate order prevention
- cooldown
- open order count
- market order policy
- stale signal rejection
- stale risk snapshot rejection
- sell position ownership and quantity
- preview requirement
- malformed root live risk payload rejection
- malformed snapshot audit metadata rejection
- malformed live order preview rejection
- malformed numeric order intent and risk snapshot rejection
- malformed snapshot collection rejection
- malformed numeric risk policy rejection
- malformed boolean risk policy rejection
- malformed risk policy collection rejection
- malformed cooldown expiry rejection
- unknown market order policy rejection

현재 제외 범위:

- broker gateway 호출
- `OrderRouter` 연결
- official order endpoint 호출
- Local Operations API/MCP/dashboard mutation surface
- Codex CLI `virtual_decision`을 live order intent로 변환하는 경로
- `TRADING_ENABLED=true` 기본값 또는 live order placement 활성화

기본 live risk policy는 fail-closed입니다. 명시적 policy 없이 평가하면 kill switch, allowlist, amount/exposure, open order, preview gate가 승인으로 열리지 않습니다. 이 기본값은 live trading enable이 아니라 안전한 module contract입니다.

## Paper Risk Profiles

Historical replay와 batch replay는 명시 옵션으로 paper-only risk profile을 선택할 수 있습니다. profile은 packet constraint와 `VirtualRiskEngine` policy를 함께 정규화하는 실험 설정이며, 기본값은 `conservative`입니다.

| Profile | `maxNewPositions` | `maxBudgetPerDecisionKrw` | `maxSymbolExposureKrw` | `maxPositionWeightRatio` | `minCashReserveRatio` |
| --- | ---: | ---: | ---: | ---: | ---: |
| `conservative` | 3 | 100,000 | 100,000 | 0.35 | 0.10 |
| `balanced` | 4 | 200,000 | 250,000 | 0.45 | 0.08 |
| `aggressive_paper` | 5 | 400,000 | 600,000 | 0.65 | 0.05 |

적용 범위:

- `conservative`는 기존 historical replay 기본 constraint와 같은 보수적 profile입니다.
- `balanced`는 paper-only 실험에서 신규 포지션 수와 종목별 예산을 중간 수준으로 높입니다.
- `aggressive_paper`는 terminal `targetExposureRatio=0.85`를 즉시 채우지 않습니다. `deploymentRampDays=10`, day-1 scheduled ceiling `0.25`, day-2 이후 gross buy cap `0.12`, 초기 포지션 슬롯 2개를 사용해 paper-only notional과 포지션 슬롯을 단계적으로 배포합니다.
- `aggressive_paper`의 `maxBudgetPerDecisionRatio=0.2`는 후보별 cap이 아니라 한 provider decision 안에서 승인되는 BUY 합계 cap입니다.
- 초기자금 기반 simulation에서 `aggressive_paper`의 symbol exposure cap은 `maxSymbolExposureRatio=0.25`를 따릅니다.
- dashboard `mixed_global` simulation은 KR/US terminal target을 50/50으로 나누며, ramp 중에는 미관측 시장 quota를 다른 시장이 빌리지 못하게 합니다.
- CLI override인 `--max-new-positions`, `--max-budget-per-symbol-krw`는 선택한 profile 위에 적용됩니다.
- 선택된 profile과 정규화된 risk policy는 replay metadata에 남겨 사후 분석에서 재현할 수 있게 합니다.

이 profile은 paper-only replay 경로에만 적용됩니다. live `RiskEngine`, `TradingSignal`, `OrderIntent`, `OrderRouter`, broker adapter 설정을 변경하지 않습니다.

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
