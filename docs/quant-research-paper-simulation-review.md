# Quant Research Paper Simulation Review

이 문서는 현재 `toss-trading`의 paper-only historical replay 기반 AI 자동투자 시뮬레이션을 시니어 퀀트 엔지니어 관점에서 검토하고, 연구 문헌의 아이디어를 production-grade guardrail로 번역한 개선 기준이다.

이 문서는 투자 조언이 아니다. 특정 종목, 섹터, 시장에 대한 매수/매도 추천을 포함하지 않는다. 실거래 주문 구현, live `TradingSignal` 생성, live `OrderIntent` 생성, broker order endpoint 연결은 이 문서의 범위가 아니다.

## 적용 범위

현재 시스템의 기준은 다음과 같다.

- `historical replay`와 `batch replay`는 과거 데이터를 simulated time으로 재생하는 paper-only 실험이다.
- AI는 `VirtualDecision`을 만드는 decision provider일 뿐이다.
- 최종 가상 주문 가능 여부와 sizing은 deterministic backend의 validation, normalization, `VirtualRiskEngine`, `PaperOrderEngine`이 gate한다.
- `TRADING_ENABLED=false`, `BROKER_PROVIDER=mock`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` 기본값은 유지한다.
- Codex, Codex CLI, LLM agent, multi-agent 구조를 live execution engine으로 사용하지 않는다.

## 핵심 판단

지금까지의 테스트는 주로 1개월 이상 단위의 장기 보유 replay에 가까웠다. 앞으로의 포트폴리오 시뮬레이션은 장기, 스윙, 단기, 초단기 전략 버킷을 함께 다루되, 전략별 성과만 따로 보는 방식으로 끝나면 안 된다.

필요한 방향은 다음과 같다.

- 투자 기간별 bucket을 분리한다: `long_term`, `swing`, `short_term`, `intraday`.
- 전략별 allocation limit, turnover limit, loss limit을 둔다.
- 전체 portfolio 관점에서 symbol, sector, country, currency, asset type, market direction exposure를 합산한다.
- 시장 국면에 따라 cash reserve를 동적으로 조정한다.
- hedge는 수익 극대화 도구가 아니라 downside, concentration, volatility 방어 도구로만 다룬다.
- 모든 bucket과 hedge proposal은 `VirtualRiskEngine`의 같은 fail-closed gate를 통과해야 한다.

## 참조 연구 축의 적용 원칙

### FinRL / FinRL-Meta

FinRL 계열 연구는 trading environment, state/action/reward, cost/liquidity/risk-aversion, benchmark, reproducibility를 계층화한다는 점이 유용하다.

현재 프로젝트에 바로 적용할 기준:

- `Environment`는 live trading loop가 아니라 replay simulation contract로만 정의한다.
- `state`는 `MarketPacket`, portfolio snapshot, regime snapshot, liquidity snapshot의 조합으로 둔다.
- `action`은 AI가 직접 주문하는 값이 아니라 `VirtualDecisionItem` 제안으로 둔다.
- `reward`는 전략 자동학습 목표가 아니라 사후 평가 metric으로만 기록한다.
- transaction cost, liquidity, risk-aversion은 report metric과 risk reject 사유로 분리해 남긴다.
- benchmark는 cash-only, buy-and-hold, equal-weight, bucket-specific benchmark를 함께 둔다.

### Backtest Overfitting / PBO / CSCV

단일 기간에서 가장 좋은 결과를 낸 prompt, parameter, strategy를 선택하면 selection bias가 생긴다. 특히 prompt sweep과 risk profile sweep도 parameter sweep과 같은 overfitting 위험을 갖는다.

현재 프로젝트에 필요한 기준:

- random 1개월 window 결과 하나로 전략을 판단하지 않는다.
- `best run`만 문서화하지 않고 전체 candidate run distribution을 남긴다.
- prompt version, risk profile, universe, regime sampling policy, exit policy 조합을 trial로 기록한다.
- PBO 또는 유사 지표를 계산할 수 있도록 train/validation/test split별 성과 matrix를 저장한다.
- strategy selection은 validation 기준으로만 수행하고, test period는 마지막 검증 전까지 잠근다.

### Lopez de Prado 방법론

금융 time series는 label horizon과 feature window가 쉽게 겹친다. 일반 K-Fold나 단순 random split은 lookahead leakage를 만들 수 있다.

현재 프로젝트에 필요한 기준:

- replay tick 이후의 가격, 뉴스, 체결, portfolio state를 packet에 넣지 않는다.
- label horizon이 겹치는 sample은 purging한다.
- test window 직후 일정 기간은 embargo로 train에서 제거한다.
- fixed horizon return label만 쓰지 말고 triple-barrier label을 검토한다.
- AI가 direction 또는 thesis를 내더라도 position sizing은 deterministic risk/allocation engine에서만 처리한다.
- meta-labeling을 도입하더라도 AI confidence를 주문 크기에 직접 연결하지 않는다.

### Sharpe Ratio 통계 검증

Sharpe ratio는 단순 숫자로 비교하면 위험하다. sample size, serial correlation, non-IID return, skew/tail risk, multiple testing이 모두 영향을 준다.

현재 프로젝트에 필요한 기준:

- Sharpe 단일 지표로 strategy/prompt/risk profile을 랭킹하지 않는다.
- CAGR, MDD, Calmar, turnover, hit ratio, average win/loss, tail loss, exposure-adjusted return, fee drag를 함께 기록한다.
- serial correlation이 있는 return series는 naive annualization을 피한다.
- Sharpe confidence interval, Probabilistic Sharpe Ratio, Deflated Sharpe Ratio 계열을 후속 metric 후보로 둔다.
- strategy selection 시 trial count와 selected best metric을 같이 저장한다.

### LLM / Agent Trading Papers

LLM agent trading 논문은 architecture 실험으로 참고할 수 있지만, 현재 프로젝트에서는 LLM을 execution engine으로 쓰면 안 된다.

현재 프로젝트에 필요한 기준:

- LLM은 reasoning, evidence summarization, thesis generation provider로 제한한다.
- numeric calculation은 backend tool-verified value만 사용한다.
- prompt는 retrieval-first로 구성하고, packet에 없는 근거를 사용하면 reject한다.
- decision trace, evidence trace, rejected-action trace를 저장한다.
- multi-agent 구조를 도입하더라도 최종 action gate는 deterministic backend가 담당한다.
- hallucinated source, future data, unsupported claim은 no-trade로 처리한다.

### Market Impact / Realistic Trading Cost

fixed bps cost만으로는 단기/초단기 전략과 high-turnover 전략을 과대평가할 가능성이 크다.

현재 프로젝트에 필요한 기준:

- fee, tax, spread, slippage, volume participation rate를 별도 metric으로 기록한다.
- market impact model은 pluggable interface로 둔다.
- 기본은 conservative fixed cost + spread/slippage penalty이고, 후속으로 nonlinear impact model을 추가한다.
- turnover가 높은 전략은 비용 차감 후 성과와 gross 성과를 분리한다.
- paper-only라도 fill assumption은 보수적으로 둔다.

## A. 현재 구조에서 위험한 설계 결함 목록

| 위험 | 현재 확인된 안전장치 | 남은 결함 | 개선 기준 |
| --- | --- | --- | --- |
| `lookahead bias` | `HistoricalMarketPacketBuilder`, replay docs, prompt guard가 simulated time 이후 데이터 사용을 금지 | feature/label 생성, report metric, regime allocation 전체에서 동일한 no-lookahead invariant가 자동 검증되는지는 더 넓게 봐야 함 | feature timestamp, label horizon, packet `generatedAt`, data snapshot hash를 모두 저장하고 테스트 추가 |
| `survivorship bias` | universe manifest와 coverage CLI가 있음 | 현재 universe가 특정 시점 생존 종목 중심이면 과거 상장폐지/거래정지 종목 누락 가능 | universe snapshot을 날짜별로 versioning하고 delisted/paused status를 표현 |
| `data snooping` | batch random window와 balanced regime sampling이 있음 | 여러 risk profile, exit policy, prompt를 돌린 뒤 best result만 채택할 위험 | 모든 trial metadata와 selection rule을 저장하고 test set을 마지막까지 잠금 |
| `prompt overfitting` | `promptVersion` 기록이 일부 존재 | prompt sweep 횟수, 실패한 prompt, rejected prompt 결과가 selection bias 계산에 충분하지 않을 수 있음 | `promptTrialId`, `promptHash`, `promptFamily`, `selectedBy`를 manifest에 기록 |
| `universe selection bias` | global broad universe와 required/optional 구분이 있음 | 실험마다 universe coverage가 다른데 같은 성과 지표로 비교할 위험 | universe hash, coverage status, unavailable symbols를 run metric에 포함 |
| `unrealistic execution` | paper execution model과 fee metric 일부 존재 | fixed cost와 단순 fill이 단기/초단기 성과를 과대평가할 수 있음 | spread/slippage/volume participation/partial fill/rejected fill model 추가 |
| `timezone / market calendar mismatch` | KR/US market 구분과 snapshot timestamp가 있음 | KR/US 휴장일, 장중/장마감, 환율 timestamp align이 어긋날 수 있음 | exchange calendar snapshot과 timezone-normalized trading session id 저장 |
| KR/US 혼합 데이터 정합성 | Yahoo/TossInvest ingest에서 KRW 환산과 market metadata를 기록 | USD price, KRW FX, ETF, stock의 timestamp granularity가 다를 수 있음 | currency conversion source/time/hash와 stale FX reject rule 추가 |
| AI 판단 로그 재현성 부족 | packet hash, decision hash, prompt version, artifact JSONL이 있음 | model version, tool config, prompt trial count, external retrieval snapshot이 부족할 수 있음 | `decisionRunManifest`에 model, prompt, config, data hash, schema hash 저장 |
| risk gate 우회 가능성 | `VirtualRiskEngine`과 live `RiskEngine` 경계가 문서화되어 있음 | 신규 dashboard/API/MCP 실행 surface 추가 시 우회 위험 | quality gate에 forbidden route/tool/action drift 검사 확대 |
| strategy bucket 충돌 | 현재 risk profile 중심 | 장기 보유와 단기 매도, hedge와 directional exposure가 충돌할 수 있음 | portfolio-level net exposure resolver와 conflict log 추가 |
| cash reserve 정적화 | `minCashReserveRatio` profile 존재, market regime allocation 일부 존재 | 시장 국면에 따른 dynamic cash reserve rule이 충분히 일반화되지 않음 | regime-aware cash policy를 별도 deterministic policy로 분리 |
| hedge 복잡도 | 현재 명시적 hedge bucket 없음 | hedge가 leverage 또는 speculative short으로 변질될 위험 | hedge proposal은 reduce-risk intent만 허용하고 cost/failure 가능성 기록 |

## B. 개선 설계안

### 1. Data Layer

목표:

- replay 입력 데이터의 시점, 출처, universe, currency, calendar, coverage를 재현 가능하게 고정한다.

추가/개선 항목:

- `DataSnapshotManifest`
  - `snapshotId`
  - `dataSource`
  - `sourceVersion`
  - `rangeStart`
  - `rangeEnd`
  - `universeHash`
  - `coverageHash`
  - `currencyConversionHash`
  - `calendarHash`
  - `createdAt`
- market별 trading calendar와 session id
- symbol lifecycle: listed, delisted, suspended, unavailable
- FX source timestamp와 stale 판단
- corporate action adjustment policy

주의:

- 비공식 source는 historical replay input 또는 read-only intelligence source로만 사용한다.
- live trading path의 source of truth로 승격하지 않는다.

### 2. Feature Layer

목표:

- feature가 언제 관측 가능한 값인지 명시하고, label horizon과 겹치는 leakage를 막는다.

추가/개선 항목:

- `FeatureSnapshot`
  - `featureSetVersion`
  - `asOf`
  - `lookbackStart`
  - `lookbackEnd`
  - `inputDataSnapshotId`
  - `featureHash`
  - `featureAvailabilityLag`
- feature별 availability rule
- stale feature rejection
- no-lookahead unit test
- feature drift report

주의:

- feature 계산은 `src/market` 또는 신규 `src/features` 계층 후보에서 수행한다.
- AI provider가 feature를 임의 계산하지 않게 한다.

### 3. Decision Provider Layer

목표:

- AI 판단을 재현 가능한 paper-only proposal로 격리한다.

추가/개선 항목:

- `DecisionRunManifest`
  - `decisionRunId`
  - `providerType`
  - `modelId`
  - `promptVersion`
  - `promptHash`
  - `promptTrialId`
  - `schemaHash`
  - `packetHash`
  - `dataSnapshotId`
  - `toolPolicy`
  - `allowWebSearch`
  - `startedAt`
  - `completedAt`
- retrieval-first prompt policy
- evidence refs must be packet-bound
- unsupported claim reject
- numeric claim verification
- rejected-action trace

주의:

- AI confidence는 sizing input이 아니다.
- AI output은 live `TradingSignal`이나 live `OrderIntent`로 승격하지 않는다.

### 4. Risk / Allocation Engine Layer

목표:

- 전략별 proposal을 전체 portfolio 기준으로 net exposure, concentration, liquidity, cash, drawdown, turnover 관점에서 gate한다.

추가/개선 항목:

- strategy bucket allocation:
  - `long_term`
  - `swing`
  - `short_term`
  - `intraday`
  - `hedge`
- portfolio-level exposure aggregation:
  - symbol
  - sector
  - country
  - currency
  - market
  - asset type
  - strategy bucket
  - direction
- dynamic cash reserve policy:
  - bull: lower reserve within configured floor
  - sideways/mixed: neutral reserve
  - bear/high volatility: higher reserve
  - insufficient data: conservative reserve
- hedge policy:
  - reduce-risk intent only
  - no uncontrolled leverage
  - hedge cost and failure mode logged
- conflict resolver:
  - same symbol opposite action
  - same sector crowded exposure
  - hedge vs directional exposure

주의:

- `VirtualRiskEngine`이 최종 gate다.
- risk policy failure는 fail-closed다.

### 5. Execution Simulator Layer

목표:

- paper fill 가정을 보수적으로 만들고, 비용과 유동성을 별도 추적한다.

추가/개선 항목:

- cost model interface:
  - fixed bps
  - spread penalty
  - slippage model
  - volume participation cap
  - nonlinear market impact model
- fill model:
  - full fill
  - partial fill
  - no fill due to liquidity
  - stale price rejection
- trade-level logging:
  - notional
  - fee
  - tax
  - spread cost
  - slippage cost
  - impact cost
  - participationRate
  - turnoverContribution

주의:

- paper-only fill은 broker execution 품질을 주장하지 않는다.
- 실거래 주문 구현으로 연결하지 않는다.

### 6. Evaluation Layer

목표:

- 단일 수익률이 아니라 재현성, overfitting, regime robustness, cost sensitivity를 평가한다.

추가/개선 metric:

- total return
- CAGR
- max drawdown
- Calmar ratio
- Sharpe with confidence interval 후보
- Deflated Sharpe Ratio 후보
- hit ratio
- profit factor
- average win/loss
- turnover
- fee drag
- slippage drag
- tail loss
- exposure-adjusted return
- time in market
- cash drag
- regime별 성과
- bucket별 성과
- benchmark delta
- PBO 또는 PBO-like score

주의:

- `target return hit-rate`는 paper-only 사후 요약값이며 투자 권유가 아니다.
- best run만 보고하지 않는다.

### 7. Audit / Logging Layer

목표:

- "왜 그 판단이 나왔고, 왜 거절/승인됐는지"를 artifact만으로 재현한다.

추가/개선 항목:

- data snapshot manifest
- feature snapshot manifest
- decision run manifest
- validation failure log
- risk reject log
- allocation conflict log
- execution assumption log
- metric calculation manifest
- report generation manifest

주의:

- account number, token, order ID, execution ID, raw credential은 저장하지 않는다.
- artifact는 append-only JSONL 우선으로 다룬다.

## C. 백테스트 검증 프로토콜

### 1. 기간 분리

최소 기준:

```text
research / exploration period:
  strategy idea, feature idea, prompt idea를 만드는 기간

train period:
  parameter와 prompt 후보를 조정하는 기간

validation period:
  후보 선택과 risk profile 선택에 쓰는 기간

test period:
  최종 1회 평가 전까지 잠그는 out-of-sample 기간
```

정책:

- test period 결과를 본 뒤 prompt, parameter, universe, risk profile을 바꾸면 새 실험으로 기록한다.
- test period를 반복 사용하면 더 이상 untouched test가 아니다.
- batch replay manifest에 split role을 저장한다.

### 2. Walk-forward / Purged K-Fold / CPCV 적용안

단계적 적용:

1. 현재 batch replay를 유지하되, run별 `splitRole`을 추가한다.
2. walk-forward split을 먼저 지원한다.
3. label horizon과 feature window가 정의되면 Purged K-Fold를 추가한다.
4. trial 수와 계산 비용이 감당되면 CPCV 또는 sampled CPCV를 추가한다.

권장 split metadata:

```json
{
  "validationProtocol": "walk_forward",
  "splitId": "wf_2023q1_2024q4_train_2025q1_val",
  "trainStart": "2023-01-01T00:00:00+09:00",
  "trainEnd": "2024-12-31T23:59:59+09:00",
  "validationStart": "2025-01-01T00:00:00+09:00",
  "validationEnd": "2025-03-31T23:59:59+09:00",
  "testStart": null,
  "testEnd": null,
  "purgeDurationDays": 0,
  "embargoDurationDays": 0
}
```

### 3. Embargo Rule

초기 기본값 후보:

- daily data 장기/스윙: label horizon 또는 holding horizon의 10%와 최소 5 trading days 중 큰 값
- 단기: 최소 2 trading days
- intraday: session boundary와 data latency 기준 별도 정의

정책:

- embargo는 성과를 좋게 만들기 위한 옵션이 아니다.
- leakage를 줄이기 위한 validation protocol 일부다.
- split마다 purge/embargo로 제거된 sample 수를 저장한다.

### 4. Out-of-sample 기준

out-of-sample로 인정하려면 다음을 만족해야 한다.

- prompt/risk/exit/feature/universe 선택에 사용되지 않은 기간이다.
- data snapshot hash와 universe hash가 고정되어 있다.
- provider config와 prompt hash가 고정되어 있다.
- 실패한 run도 제외하지 않고 기록한다.
- unavailable data로 skipped된 run은 skip reason을 남긴다.

### 5. Paper Replay 재현성 기준

run 재현에 필요한 값:

- `batchId`
- `runId`
- `seed`
- `window`
- `dataSnapshotId`
- `dataSnapshotHash`
- `universeHash`
- `coverageHash`
- `configHash`
- `promptVersion`
- `promptHash`
- `schemaHash`
- `riskPolicyHash`
- `costModelHash`
- `executionModelVersion`
- `nodeVersion`
- package version 또는 git commit

### 6. Config / Data / Prompt Hash 저장

최소 artifact:

```json
{
  "runId": "paper_replay_run_001",
  "configHash": "sha256:...",
  "dataSnapshotHash": "sha256:...",
  "universeHash": "sha256:...",
  "promptHash": "sha256:...",
  "schemaHash": "sha256:...",
  "riskPolicyHash": "sha256:...",
  "costModelHash": "sha256:..."
}
```

## D. 리스크 정책 개선안

### 1. Max Symbol Exposure

정책:

- 단일 symbol exposure는 NAV 대비 한도와 절대 금액 한도를 모두 적용한다.
- 여러 strategy bucket의 같은 symbol exposure를 합산한다.
- hedge가 같은 symbol 또는 proxy exposure를 갖는 경우 net/gross를 모두 기록한다.

예상 reject code:

- `VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED`
- `VIRTUAL_SYMBOL_GROSS_EXPOSURE_EXCEEDED`

### 2. Max Sector / Country / Currency Exposure

정책:

- KR/US, sector, currency별 exposure limit을 둔다.
- ETF는 underlying exposure가 확인되지 않으면 broad bucket 또는 unknown bucket으로 보수 계산한다.
- unknown metadata가 많으면 exposure 확대를 제한한다.

예상 reject code:

- `VIRTUAL_SECTOR_EXPOSURE_EXCEEDED`
- `VIRTUAL_COUNTRY_EXPOSURE_EXCEEDED`
- `VIRTUAL_CURRENCY_EXPOSURE_EXCEEDED`
- `VIRTUAL_EXPOSURE_METADATA_MISSING`

### 3. Max Daily Turnover

정책:

- 단기/초단기 전략은 turnover limit을 별도로 둔다.
- 전체 portfolio turnover와 bucket turnover를 모두 제한한다.
- turnover 초과는 신규 진입 제한으로 처리하고 reduce-only exit은 별도 예외로 검토한다.

예상 reject code:

- `VIRTUAL_DAILY_TURNOVER_EXCEEDED`
- `VIRTUAL_BUCKET_TURNOVER_EXCEEDED`

### 4. Max Drawdown Kill Switch

정책:

- portfolio-level MDD가 threshold를 넘으면 신규 risk-increasing action을 차단한다.
- bucket-level MDD는 해당 bucket cooldown으로 연결한다.
- data 오류로 MDD 계산이 불가능하면 fail-closed 또는 conservative mode로 둔다.

예상 reject code:

- `VIRTUAL_MAX_DRAWDOWN_EXCEEDED`
- `VIRTUAL_BUCKET_DRAWDOWN_EXCEEDED`

### 5. Min Liquidity Rule

정책:

- average daily value, volume, spread, participation rate 기준을 둔다.
- liquidity가 부족하면 buy를 거절하거나 order notional을 축소한다.
- stale volume은 liquidity pass로 인정하지 않는다.

예상 reject code:

- `VIRTUAL_LIQUIDITY_TOO_LOW`
- `VIRTUAL_VOLUME_STALE`
- `VIRTUAL_PARTICIPATION_RATE_EXCEEDED`

### 6. Position Sizing Rule

정책:

- AI confidence를 직접 주문 크기로 연결하지 않는다.
- sizing은 NAV, bucket allocation, volatility, liquidity, remaining risk budget, cash reserve, open exposure로 계산한다.
- risk reducing sell은 buy보다 별도 경로로 평가하되, 보유 수량 초과는 fail-closed다.

예상 reject code:

- `VIRTUAL_SIZE_NORMALIZATION_FAILED`
- `VIRTUAL_BUCKET_BUDGET_EXCEEDED`

### 7. Cash Reserve Rule

정책:

- static `minCashReserveRatio` 위에 regime-aware reserve multiplier를 둔다.
- bull regime에서도 최소 cash floor는 유지한다.
- bear/high volatility/insufficient data에서는 cash reserve를 높인다.
- cash reserve rule은 market regime classifier의 deterministic output만 사용한다.

예상 reject code:

- `VIRTUAL_CASH_RESERVE_BREACHED`
- `VIRTUAL_REGIME_CASH_RESERVE_BREACHED`

### 8. Stale Data Rejection

정책:

- price, volume, FX, calendar, feature, portfolio snapshot 각각 stale threshold를 둔다.
- stale data가 있으면 AI 호출을 하지 않거나 risk gate에서 reject한다.
- stale reason은 report와 audit에 남긴다.

예상 reject code:

- `VIRTUAL_PRICE_STALE`
- `VIRTUAL_VOLUME_STALE`
- `VIRTUAL_FX_STALE`
- `VIRTUAL_FEATURE_STALE`
- `VIRTUAL_CALENDAR_STALE`

### 9. Model Confidence Policy

정책:

- AI confidence는 explanation quality와 uncertainty logging에만 사용한다.
- AI confidence가 높아도 deterministic risk budget, liquidity, cash, exposure 한도를 넘을 수 없다.
- confidence가 낮으면 risk engine이 더 보수적으로 reject하거나 no-op으로 정규화할 수 있다.

예상 reject code:

- `VIRTUAL_CONFIDENCE_UNSUPPORTED`
- `VIRTUAL_CONFIDENCE_EVIDENCE_MISMATCH`

## E. 코드 레벨 TODO

이 섹션은 구현 지시가 아니라 후속 작업 후보 목록이다. 코드 변경은 별도 명시 지시와 PR 단위 계획이 있을 때 진행한다.

### 1. 추가/수정 모듈 후보

Data/replay:

- `src/replay/validationProtocol.ts`
- `src/replay/purgedSplit.ts`
- `src/replay/walkForwardSplit.ts`
- `src/replay/replayRunManifest.ts`
- `src/replay/replayWindowSampler.ts`
- `src/workflows/historicalBatchReplayWorkflow.ts`

Feature:

- 신규 후보 `src/features/featureSnapshot.ts`
- 신규 후보 `src/features/featureManifest.ts`
- `src/market/historicalPacketBuilder.ts`

Decision provider:

- `src/ai/decisionPrompt.ts`
- `src/ai/codexCliDecisionProvider.ts`
- `src/paper/virtualDecisionValidation.ts`
- 신규 후보 `src/ai/decisionRunManifest.ts`

Risk/allocation:

- `src/paper/riskEngine.ts`
- `src/paper/riskBranches.ts`
- `src/paper/riskPolicy.ts`
- `src/paper/riskProfile.ts`
- `src/paper/allocationPolicy.ts`
- 신규 후보 `src/paper/strategyBucketPolicy.ts`
- 신규 후보 `src/paper/dynamicCashReservePolicy.ts`
- 신규 후보 `src/paper/hedgePolicy.ts`
- 신규 후보 `src/paper/portfolioExposureAggregator.ts`

Execution simulator:

- `src/paper/executionModel.ts`
- `src/paper/orderEngine.ts`
- 신규 후보 `src/paper/costModel.ts`
- 신규 후보 `src/paper/liquidityModel.ts`
- 신규 후보 `src/paper/fillModel.ts`

Evaluation/report:

- `src/analytics/paperPortfolioAnalytics.ts`
- `src/reports/historicalReplayReport.ts`
- `src/reports/batchReplayReport.ts`
- 신규 후보 `src/analytics/backtestOverfitting.ts`
- 신규 후보 `src/analytics/sharpeStatistics.ts`
- 신규 후보 `src/reports/replayResearchReport.ts`

Storage/audit:

- `src/storage/artifactPaths.ts`
- `src/storage/repositories.ts`
- 신규 후보 `src/storage/manifestStore.ts`
- `src/replay/historicalReplayAuditLog.ts`

Docs:

- `docs/historical-replay.md`
- `docs/risk-policy.md`
- `docs/market-regime-allocation.md`
- `docs/ai-paper-trading-runbook.md`
- `docs/PROJECT_STRUCTURE.md`

### 2. 필요한 JSON log schema 후보

`ReplayResearchManifest`:

```json
{
  "runId": "string",
  "batchId": "string",
  "validationProtocol": "walk_forward | purged_k_fold | cpcv | random_window",
  "splitRole": "train | validation | test | paper_replay",
  "configHash": "sha256:string",
  "dataSnapshotHash": "sha256:string",
  "universeHash": "sha256:string",
  "promptHash": "sha256:string",
  "riskPolicyHash": "sha256:string",
  "costModelHash": "sha256:string"
}
```

`ExecutionAssumptionLog`:

```json
{
  "tradeId": "string",
  "symbol": "string",
  "market": "KR | US",
  "simulatedAt": "string",
  "fillModel": "conservative_close | spread_slippage | nonlinear_impact",
  "requestedNotionalKrw": 0,
  "filledNotionalKrw": 0,
  "feeKrw": 0,
  "taxKrw": 0,
  "spreadCostKrw": 0,
  "slippageCostKrw": 0,
  "impactCostKrw": 0,
  "participationRate": 0,
  "liquidityRejectReason": null
}
```

`RiskAllocationTrace`:

```json
{
  "riskDecisionId": "string",
  "decisionId": "string",
  "strategyBucket": "long_term | swing | short_term | intraday | hedge",
  "preTradeExposure": {},
  "postTradeExposurePreview": {},
  "cashReserveRequiredKrw": 0,
  "cashReserveReason": "static | bull | bear | sideways | mixed | high_volatility | insufficient_data",
  "checkedRules": [],
  "rejectCodes": []
}
```

`SelectionTrialLog`:

```json
{
  "trialId": "string",
  "strategyConfigHash": "sha256:string",
  "promptHash": "sha256:string",
  "riskProfile": "conservative | balanced | aggressive_paper | custom",
  "exitPolicyHash": "sha256:string",
  "validationMetric": "string",
  "validationScore": 0,
  "selected": false,
  "selectionReason": "string"
}
```

### 3. 테스트 케이스

Data/replay:

- simulated time 이후 snapshot이 feature/packet/report에 들어가지 않는다.
- KR/US market calendar가 다른 날에도 stale calendar는 fail-closed다.
- FX timestamp가 price timestamp보다 과도하게 오래되면 reject된다.
- unavailable optional symbol은 coverage warning이고 required symbol 누락은 fail/skip이다.

Validation protocol:

- Purged K-Fold에서 label horizon이 test window와 겹치는 train sample이 제거된다.
- embargo duration에 해당하는 sample이 train에서 제거된다.
- CPCV split 생성이 deterministic seed로 재현된다.
- train/validation/test split role이 manifest에 저장된다.

Decision provider:

- prompt hash가 바뀌면 manifest hash도 바뀐다.
- packet에 없는 evidence ref를 AI가 쓰면 validation reject된다.
- AI confidence가 높아도 risk sizing cap을 넘지 않는다.
- provider timeout, invalid JSON, schema failure는 no-trade다.

Risk/allocation:

- 여러 strategy bucket의 같은 symbol exposure가 합산된다.
- sector/country/currency exposure limit 초과 시 reject된다.
- bear regime에서 dynamic cash reserve가 높아진다.
- bull regime에서도 minimum cash floor는 유지된다.
- hedge proposal이 gross leverage를 과도하게 키우면 reject된다.
- max daily turnover 초과 시 신규 buy가 reject된다.
- drawdown kill switch가 risk-increasing action을 차단한다.

Execution/cost:

- spread/slippage/fee/tax가 report metric에 분리 기록된다.
- volume participation cap 초과 시 partial fill 또는 reject가 발생한다.
- fixed bps와 nonlinear model의 cost breakdown이 같은 interface로 기록된다.
- stale volume은 liquidity pass로 처리되지 않는다.

Evaluation/report:

- best run만 선택하지 않고 trial distribution이 report에 남는다.
- Sharpe가 sample size 부족일 때 warning을 낸다.
- turnover가 높은 전략의 gross/net 성과 차이가 표시된다.
- regime별, bucket별, market별 성과가 분리된다.

Audit/storage:

- corrupt JSONL line 하나가 read-only 조회 전체를 실패시키지 않는다.
- manifest 누락은 replay 재현성 warning으로 표시된다.
- sensitive value masking이 유지된다.

### 4. Metric 계산 함수 후보

신규 또는 확장 후보:

- `calculateCagr`
- `calculateMaxDrawdown`
- `calculateCalmarRatio`
- `calculateHitRatio`
- `calculateProfitFactor`
- `calculateTurnover`
- `calculateFeeDrag`
- `calculateSlippageDrag`
- `calculateTailLoss`
- `calculateExposureAdjustedReturn`
- `calculateSharpeWithSerialCorrelationWarning`
- `calculateDeflatedSharpeCandidate`
- `calculatePboCandidate`
- `summarizeTrialDistribution`
- `summarizeBucketPerformance`
- `summarizeRegimePerformance`

정책:

- 통계적으로 불충분한 sample이면 숫자를 억지로 만들지 말고 warning을 낸다.
- 계산식 version을 report에 기록한다.

### 5. Replay Report 생성기 개선

후속 report는 아래 구획을 가져야 한다.

- run identity
- data snapshot
- validation protocol
- prompt/provider manifest
- risk/allocation policy
- execution assumption
- portfolio performance
- cost breakdown
- exposure breakdown
- regime breakdown
- bucket breakdown
- benchmark comparison
- overfitting warning
- provider failure summary
- risk reject summary
- missing/stale data summary
- reproducibility hashes
- disclaimer

금지 표현:

- 수익 보장
- 실계좌 성과
- 종목 추천
- AI가 최종 매매 판단
- live trading 가능 암시

### 6. 실패 케이스 로깅

필수 실패 카테고리:

- `DATA_SNAPSHOT_MISSING`
- `DATA_COVERAGE_INSUFFICIENT`
- `FEATURE_STALE`
- `PACKET_LOOKAHEAD_REJECTED`
- `PROMPT_HASH_MISSING`
- `AI_DECISION_FAILED`
- `AI_DECISION_SCHEMA_INVALID`
- `AI_DECISION_EVIDENCE_UNSUPPORTED`
- `RISK_EXPOSURE_REJECTED`
- `RISK_CASH_RESERVE_REJECTED`
- `RISK_LIQUIDITY_REJECTED`
- `EXECUTION_PARTIAL_FILL`
- `EXECUTION_NO_FILL`
- `REPORT_METRIC_INSUFFICIENT_SAMPLE`
- `REPRODUCIBILITY_MANIFEST_MISSING`

정책:

- 실패는 portfolio 변경으로 이어지면 안 된다.
- risk reject는 정상적인 no-trade 결과일 수 있다.
- provider failure와 risk reject를 batch failure로 섞지 않는다.

## 우선순위 제안

1. `ReplayResearchManifest`와 hash 기록을 먼저 추가한다.
2. prompt/config/trial logging을 추가해 prompt overfitting 추적 기반을 만든다.
3. cost/liquidity model을 fixed bps에서 spread/slippage/participation 기반으로 확장한다.
4. strategy bucket과 portfolio-level exposure aggregation을 추가한다.
5. regime-aware cash reserve와 hedge policy를 deterministic risk policy로 분리한다.
6. walk-forward split과 embargo를 먼저 추가하고, 이후 Purged K-Fold/CPCV로 확장한다.
7. Sharpe confidence/DSR/PBO 계열 metric은 sample 수와 trial log가 충분해진 뒤 추가한다.

## 참고 자료

- [FinRL: Deep Reinforcement Learning Framework to Automate Trading in Quantitative Finance](https://arxiv.org/abs/2111.09395)
- [FinRL: A Deep Reinforcement Learning Library for Automated Stock Trading in Quantitative Finance](https://arxiv.org/abs/2011.09607)
- [FinRL-Meta: Market Environments and Benchmarks for Data-Driven Financial Reinforcement Learning](https://arxiv.org/abs/2211.03107)
- [The Probability of Backtest Overfitting](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253)
- [Advances in Financial Machine Learning](https://www.wiley.com/en-us/Advances%2Bin%2BFinancial%2BMachine%2BLearning-p-9781119482086)
- [Machine Learning for Asset Managers](https://www.cambridge.org/core/books/machine-learning-for-asset-managers/6D9211305EA2E425D33A9F38D0AE3545)
- [The Statistics of Sharpe Ratios](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=377260)
- [The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting and Non-Normality](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551)
- [TradingGPT: Multi-Agent System with Layered Memory and Distinct Characters for Enhanced Financial Trading Performance](https://arxiv.org/abs/2309.03736)
- [FinGPT: Open-Source Financial Large Language Models](https://arxiv.org/abs/2306.06031)
- [Agentic Trading: When LLM Agents Meet Financial Markets](https://arxiv.org/abs/2605.19337)
- [Realistic Market Impact Modeling for Reinforcement Learning Trading Environments](https://arxiv.org/abs/2603.29086)
- [Investor.gov: Asset Allocation](https://www.investor.gov/introduction-investing/getting-started/asset-allocation)
- [FINRA: Asset Allocation and Diversification](https://www.finra.org/investors/investing/investing-basics/asset-allocation-diversification)
- [FINRA: Concentration Risk](https://www.finra.org/investors/insights/concentration-risk)
