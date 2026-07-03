# Historical Replay

이 문서는 과거 시장 데이터를 simulated time으로 빠르게 흘려보내고, paper-only 가상 투자 판단과 결과를 확인하는 흐름을 설명합니다.

## 목적

Historical replay는 실제 시간을 기다리지 않고 저장된 과거 snapshot을 순서대로 `market_packet`으로 변환합니다. 이 packet은 dry-run fixture provider 또는 Codex CLI paper-only provider에 전달할 수 있습니다.

이 기능은 실거래 백테스트 엔진이 아닙니다. 결과는 가상 포트폴리오 시뮬레이션이며 투자 조언, 수익률 보장, 실계좌 성과가 아닙니다.

Codex AI historical replay 또는 batch replay를 실제로 실행하기 전후의 운영 체크리스트는 [AI Paper Trading Runbook](ai-paper-trading-runbook.md)을 기준으로 확인합니다.

## 입력과 출력

입력:

- `historical-market-snapshots.jsonl`
- 선택적 `virtual-portfolio.json`
- replay window: `startAt`, `endAt`, `stepSeconds`
- sampling policy: `everyNSteps`, `candidateChangedOnly`, `decisionFrequency`, `maxDecisionCalls`
- decision provider: dry-run fixture 또는 Codex CLI paper-only provider
- paper risk profile: `conservative`, `balanced`, `aggressive_paper`
- optional paper exit policy: take-profit, stop-loss, rebalance threshold

RH2 후속 구현에서 calendar/FX fixture를 replay input 정합성 검증에 연결할 때의 contract는 [Replay Calendar And FX Contract](replay-calendar-fx-contract.md)를 기준으로 한다.

출력:

- `historical-replay-report.json`
- `historical-replay-progress.json`
- `historical-replay-run-metadata.json`
- `historical-replay-packets.jsonl`
- `historical-replay-decisions.jsonl`
- `historical-replay-risk-decisions.jsonl`
- `historical-replay-trades.jsonl`
- `historical-replay-portfolio-timeline.jsonl`
- dashboard `/replay/report` read-only 조회
- CLI stdout markdown report

`historical-replay-progress.json`은 dashboard 표시용 snapshot입니다. 전체 분석과 재현에는 append-only JSONL 로그를 사용합니다.

`historical-replay-run-metadata.json`은 replay 실행 단위의 재현성 근거를 저장합니다.

포함되는 metadata:

- `identity`: `runId`, optional `batchId`, optional `runIndex`
- `window`: explicit/random window source, start/end, selected month, seed, timezone offset
- `configuration`: clock, sampling policy, initial cash, packet/risk profile/constraint, paper exit policy 요약
- `logPaths`: packet, decision, risk decision, trade, portfolio timeline log path
- `status`: `running`, `completed`, `failed`

Batch replay runner는 후속 단계에서 이 metadata를 각 실행 결과의 기본 manifest로 사용합니다.

## Research Reproducibility Manifest

`ReplayResearchManifest`는 research-grade replay 비교를 위한 최소 재현성 key contract입니다. Q1-2부터 single historical replay는 `historical-replay-research-manifest.json`을 저장하고, `historical-replay-run-metadata.json`, `historical-replay-report.json`, batch run record는 같은 manifest hash reference를 남깁니다. Calendar/FX fixture가 replay 결과에 영향을 주는 RH2 후속 구현에서는 [Replay Calendar And FX Contract](replay-calendar-fx-contract.md)의 hash 정책에 따라 fixture와 stale policy를 hash source에 포함합니다.

필수 hash는 `sha256:<64 hex>` 형식이며, hash 대상은 JSON-compatible plain data를 stable key order로 직렬화한 값입니다. `Date`는 ISO string으로 canonicalize하고, `undefined`, `NaN`, `Infinity`, function, symbol, class instance 같은 비 JSON 입력은 fail-closed로 거절합니다.

필드:

- `manifestVersion`: `replay_research_manifest.v1`
- `mode`: `paper_only`
- `runId`
- `batchId`: batch run이 아니면 `null`
- `createdAt`
- `configHash`
- `dataSnapshotHash`
- `universeHash`
- `universeSnapshotDate`: `--universe-path`가 있으면 universe manifest의 `snapshotDate`, 없으면 `null`
- `coverageHash`
- `promptHash`
- `schemaHash`
- `riskPolicyHash`
- `costModelHash`
- `executionModelVersion`
- `warnings`

보안/운영 기준:

- 민감 정보 원문을 hash source, manifest, report에 저장하지 않는다.
- `configHash`에는 요청 configuration뿐 아니라 replay가 실제로 사용하는 초기 `VirtualPortfolio` cash/position state를 포함한다.
- `dataSnapshotHash`에는 replay packet 생성, 후보 feature, audit reference에 영향을 주는 normalized historical snapshot field를 포함한다.
- `universeHash`는 `--universe-path`가 있으면 `HistoricalUniverseManifest`의 `snapshotDate`, lifecycle metadata, required/optional symbol metadata를 포함한 normalized manifest를 hash한다. `--universe-path`가 없으면 기존처럼 replay snapshot에서 관측된 symbol 요약을 hash하고 `universeSnapshotDate`는 `null`로 둔다.
- hash가 없는 legacy run은 실행 실패가 아니라 report의 `reproducibility.status: "partial"`과 warning으로 표시한다.
- 이 manifest는 paper-only 검증 artifact이며 live `TradingSignal`, live `OrderIntent`, broker order endpoint로 연결하지 않는다.
- RH4 기준 `costModelHash`는 `paper_cost_model.v3` object를 hash한 값이다. 이 object에는 `executionModelVersion`, fill/fee/tax/slippage model name, spread placeholder, market impact model name, liquidity model name, normalized `executionPolicy`가 포함된다.

## Artifact Contract

고정 `--data-dir` artifact의 파일명 source of truth는 `src/storage/artifactPaths.ts`의 `STORAGE_ARTIFACT_CONTRACTS`입니다. `src/storage/repositories.ts`의 `createStoragePaths`는 이 상수를 사용해 writer와 Local Operations reader가 같은 경로를 보게 합니다.

| Artifact | 형식/역할 | Domain contract | Writer | Local Operations reader | 실패 추적 기준 |
| --- | --- | --- | --- | --- | --- |
| `virtual-portfolio.json` | JSON snapshot | `VirtualPortfolio` | `FileVirtualPortfolioStore` | `/virtual/portfolio` | 최신 paper-only portfolio state 확인 |
| `market-packets.jsonl` | JSONL append-only log | `MarketPacket` | `FileMarketPacketStore` | `/market/packets` | AI decision 이전 후보, source refs, packet hash 확인 |
| `virtual-decisions.jsonl` | JSONL append-only log | `VirtualDecision` | `FileVirtualDecisionStore` | `/virtual/decisions` | schema/semantic validation을 통과해 저장된 paper decision 확인 |
| `virtual-trades.jsonl` | JSONL append-only log | `VirtualTrade` | `FileVirtualTradeStore` | `/virtual/trades` | paper fill 발생 여부 확인 |
| `audit-events.jsonl` | JSONL append-only log | `AuditEvent` | `FileAuditLog` | `/audit/events` | provider failure, validation reject, risk reject, order/audit stage 확인 |
| `tossinvest-sources.jsonl` | JSONL append-only log | `TossInvestCliCollectResult` | `FileTossInvestSourceStore` | `/source/health` | read-only source collection status와 degradation reason 확인 |
| `historical-market-snapshots.jsonl` | JSONL append-only log | `HistoricalMarketSnapshot` | `FileHistoricalMarketSnapshotStore` | 없음 | replay 입력 snapshot과 corrupt line count 확인 |
| `historical-replay-report.json` | JSON report | `HistoricalReplayReport` | `HistoricalReplayWorkflow` | `/replay/report` | 최종 summary, warning, failure count 확인 |
| `historical-replay-progress.json` | JSON snapshot | `HistoricalReplayProgress` | `HistoricalReplayWorkflow` | `/replay/progress` | 실행 중 latest status, processed tick, 최근 event 확인 |
| `historical-replay-run-metadata.json` | JSON metadata | `HistoricalReplayRunMetadata` | `HistoricalReplayWorkflow` | 없음 | run id, window, profile, log path, status 확인 |
| `historical-replay-research-manifest.json` | JSON metadata | `ReplayResearchManifest` | `HistoricalReplayWorkflow` | 없음 | config/data/prompt/schema/risk/cost hash 확인 |
| `historical-replay-packets.jsonl` | JSONL append-only log | `MarketPacket` | `HistoricalReplayWorkflow` | 없음 | simulated tick별 packet 생성 결과 확인 |
| `historical-replay-decisions.jsonl` | JSONL append-only log | `VirtualDecision` | `HistoricalReplayWorkflow` | 없음 | exit/provider decision과 packet binding 확인 |
| `historical-replay-risk-decisions.jsonl` | JSONL append-only log | `VirtualRiskDecision` | `HistoricalReplayWorkflow` | 없음 | risk approval/rejection과 reject code 확인 |
| `historical-replay-trades.jsonl` | JSONL append-only log | `VirtualTrade` | `HistoricalReplayWorkflow` | 없음 | replay 중 paper fill 발생 여부 확인 |
| `historical-replay-portfolio-timeline.jsonl` | JSONL append-only log | `HistoricalPortfolioTimelineItem` | `HistoricalReplayWorkflow` | 없음 | simulated tick별 portfolio state 확인 |
| `batch-replay-aggregate-report.json` | JSON report | `BatchReplayAggregateReport` | `historicalBatchReport CLI` | `/batch/replay/report` | batch summary, regime별 통계, `aiDecisionFailureCount` 확인 |

동적 batch artifact는 `--output-dir`과 `batchId`로 경로가 결정되며 `src/storage/artifactPaths.ts`의 `DYNAMIC_STORAGE_ARTIFACT_CONTRACTS`에 따로 둡니다.

| Artifact | 경로 패턴 | Reader | 경로 검증 |
| --- | --- | --- | --- |
| `batch-replay-manifest.json` | `batch-replay/<batchId>/batch-replay-manifest.json` | `readBatchReplayManifests` | `createBatchReplayManifestPath` |
| `batch-replay-runs.jsonl` | `batch-replay/<batchId>/batch-replay-runs.jsonl` | `/batch/replay/runs` | `resolveBatchReplayRunsArtifactPath` |
| `batch-replay-selection-trials.jsonl` | `batch-replay/<batchId>/batch-replay-selection-trials.jsonl` | 없음 | `createBatchReplayArtifactPaths` |

JSONL artifact는 read-only 조회에서 정상 line을 계속 반환하고 `corruptLineCount`로 손상 line 수를 노출합니다. 손상된 JSONL 한 줄 때문에 dashboard/API 전체 조회가 실패하면 안 됩니다. JSON snapshot/report가 손상되면 해당 reader는 `status: "corrupt"` 또는 `fileStatus: "corrupt"`로 응답하고 replay 실행이나 주문 생성을 시작하지 않습니다.

## Portfolio Valuation

Historical replay는 각 simulated tick에서 보유 포지션을 해당 tick까지 관측 가능한 최신 historical snapshot 가격으로 재평가합니다.

저장되는 position valuation 필드:

- `marketPriceKrw`
- `marketValueKrw`
- `unrealizedPnlKrw`
- `priceUpdatedAt`
- `priceStaleAfter`
- `priceSourceRefs`
- `isPriceStale`

가격이 없는 포지션은 기존 `marketValueKrw`를 유지하고, 값이 없으면 `quantity * averagePriceKrw`를 fallback으로 사용합니다. 이 fallback은 성과 검증용 현재가가 아니라 데이터 결손 상태로 해석해야 합니다.

## Benchmark Report

`historical-replay-report.json`은 replay 결과와 함께 최소 비교 기준을 생성합니다.

포함되는 benchmark:

- `strategy`: 실제 paper replay portfolio timeline 기준
- `cashOnly`: 초기 순자산을 현금으로 보유한 기준
- `equalWeightBuyAndHold`: 첫 priced replay packet의 후보를 동일가중으로 매수 후 보유한 기준
- `initialPortfolioBuyAndHold`: 초기 포트폴리오를 거래 없이 보유한 기준
- `comparisons`: strategy metric에서 각 benchmark metric을 뺀 차이

포함되는 metric:

- `initialNetWorthKrw`
- `finalNetWorthKrw`
- `totalReturnRatio`
- `maxDrawdownRatio`
- `tickVolatilityRatio`
- `turnoverRatio`
- `feeDragKrw`

`comparisons`는 `strategyVsCashOnly`, `strategyVsEqualWeightBuyAndHold`, `strategyVsInitialPortfolioBuyAndHold`를 포함합니다. 각 delta는 strategy metric minus benchmark metric입니다. 비교 대상 benchmark를 만들 수 없으면 `benchmarkAvailable=false`와 `null` delta를 기록합니다.

이 benchmark는 저장된 replay packet과 portfolio timeline만 사용합니다. 외부 지수, 미래 가격, 실계좌 성과와 비교하지 않습니다.

Historical replay report의 `Execution Costs` section은 완료된 `VirtualTrade`에서 fee/tax/slippage/spread/impact cost를 합산합니다.

Historical replay report의 `Advanced Performance Metrics` section은 `performance_metrics.v1` 산식으로 portfolio timeline과 virtual trade cost를 함께 요약합니다.

포함되는 metric:

- `totalReturnRatio`: final net worth 기준 paper return
- `grossTotalReturnRatio`: modeled cost를 되돌려 더한 cost-before paper return
- `costAdjustedTotalReturnRatio`: modeled cost가 반영된 paper return
- `costDragRatio`: initial net worth 대비 modeled cost
- `cagrRatio`: replay 기간이 30일 이상일 때만 계산하는 annualized return
- `maxDrawdownRatio`: timeline peak 대비 drawdown
- `calmarRatio`: `cagrRatio / abs(maxDrawdownRatio)`
- `hitRatio`, `profitFactor`, `averageWinRatio`, `averageLossRatio`
- `tailLossRatio`: return sample이 20개 이상일 때 worst 5% return 평균
- `sharpeRatio`: sample return 기준이며 annualize하지 않는다
- `exposureAdjustedReturnRatio`: `totalReturnRatio / avgExposureRatio`
- `warnings`: sample 부족, zero volatility, annualization 제한, serial correlation 미보정 경고

이 metric은 paper-only 사후 분석용입니다. 짧은 replay, return sample 부족, zero drawdown, zero volatility에서는 숫자를 억지로 만들지 않고 `null`과 warning을 기록합니다. `advancedPerformance.sharpeRatio`는 per-sample 값이며 Lo 방식의 serial-correlation adjustment나 Deflated Sharpe Ratio가 아닙니다. Lo-style 조정값은 별도 `sharpeValidation.metrics.loAdjustedSharpe` field에 기록됩니다.

Historical replay report의 `Sharpe Statistical Validation` section은 `sharpe_validation.v1` schema로 single replay return sample을 검증합니다.

포함되는 field:

- `schemaVersion`: `sharpe_validation.v1`
- `status`: sample Sharpe 계산 가능 여부
- `sample`: return sample count, minimum sample count, annualization 상태
- `distribution`: mean, volatility, skewness, excess kurtosis, lag 5까지의 autocorrelation diagnostic
- `metrics.sampleSharpe`: standalone sample Sharpe 결과, standard error, 95% confidence interval
- `metrics.loAdjustedSharpe`: `autocorrelationMaxLag`가 지정된 경우 Lo-style serial correlation adjusted Sharpe 계산
- `metrics.probabilisticSharpeRatio`: standalone calculator는 명시적 `benchmarkSharpeRatio`가 있을 때 계산할 수 있다. 현재 single replay report 호출은 benchmark를 주입하지 않으므로 `not_applicable` 상태를 기록한다.
- `metrics.deflatedSharpeRatio`: standalone calculator는 independent trial count와 `trialSharpeRatioStandardDeviation`이 충분할 때 계산할 수 있다. 현재 single replay report 호출은 다중 trial dispersion을 주입하지 않으므로 insufficient sample 또는 `missing_selection_context` 상태를 기록한다.
- `selectionContext`: single replay는 `candidateCount=1`, `trialCount=1`, `trialSharpeRatioStandardDeviation=null`, `multipleTestingAdjustment=none`으로 기록
- `warnings`: insufficient sample, zero volatility, serial correlation 미보정, multiple testing context 부족 경고

RH5 Sharpe 통계 검증의 design과 `sharpe_validation.v1` schema는 [Sharpe Statistical Validation Contract](sharpe-statistical-validation-contract.md)를 기준으로 한다. 이 contract는 sample Sharpe confidence interval, benchmark-gated Probabilistic Sharpe Ratio, Deflated Sharpe Ratio 후보를 sample warning과 selection context warning으로 분리하기 위한 사후 검증 layer이며, live signal이나 자동 sizing으로 연결하지 않는다.

Q3-2 기준:

- `paper_cost_model.v3` / `execution_simulator.v3`는 fixed bps fee/tax/slippage 산식은 유지하고, candidate volume이 있을 때만 volume participation cap을 적용합니다.
- 기본 `marketImpactBpsPerParticipationRate=0`에서는 market impact가 `not_modeled`이며 `impactCostKrw=0`입니다. 이 값을 0보다 크게 설정한 paper-only fixture에서는 filled notional과 filled participation rate를 기준으로 `linear_participation_bps` impact cost를 계산하고 `costModelHash`에 해당 policy를 포함합니다.
- `HistoricalMarketSnapshot.volume`은 `MarketCandidate.volume`으로 전달되고, 현재 tick 이전 snapshot window에서 계산한 `averageVolume`은 `MarketCandidate.averageVolume`으로 전달됩니다.
- `HistoricalMarketSnapshot.sector`가 있으면 `MarketCandidate.sector`로 전달되어 sector exposure cap과 evidence `featureRefs`에서 사용할 수 있습니다. sector가 없는 과거 dataset은 unknown metadata로 보수 처리됩니다.
- `VirtualTrade`에는 `requestedNotionalKrw`, `filledNotionalKrw`, `fillStatus`, `liquidityStatus`, `participationRate`, `maxParticipationRate`, `volume`, `averageVolume`이 추가로 기록될 수 있습니다.
- volume이 충분하면 `fillStatus: "filled"`와 `liquidityStatus: "sufficient"`가 기록됩니다.
- volume cap 때문에 일부만 체결되면 `fillStatus: "partial"`과 `liquidityStatus: "partial"`가 기록됩니다.
- volume 정보가 없으면 legacy full-fill behavior를 보존하고 `liquidityStatus: "not_modeled"`로 기록합니다.
- stale volume 또는 최소 체결 비율 미만 no-fill은 `VirtualTrade`를 만들지 않고 `historical-replay-risk-decisions.jsonl`에 `VIRTUAL_LIQUIDITY_STALE` 또는 `VIRTUAL_LIQUIDITY_INSUFFICIENT` reject code로 남습니다.
- 이 모델은 paper-only simulator이며 live `TradingSignal`, live `OrderIntent`, broker order endpoint로 연결하지 않습니다.

## Flow

```mermaid
flowchart TD
    SnapshotStore["historical-market-snapshots.jsonl"] --> Clock["SimulatedClock"]
    Clock --> PacketBuilder["HistoricalMarketPacketBuilder"]
    PacketBuilder --> ExitPolicy["PaperExitPolicy (optional)"]
    PacketBuilder --> Sampling["ReplaySamplingPolicy"]
    Sampling --> Provider{"Decision Provider"}
    Provider --> DryRun["Dry-run fixture"]
    Provider --> Codex["Codex CLI paper-only provider"]
    ExitPolicy --> Risk["VirtualRiskEngine"]
    DryRun --> Risk["VirtualRiskEngine"]
    Codex --> Risk
    Risk --> PaperOrder["PaperOrderEngine"]
    PaperOrder --> Report["historical-replay-report.json"]
    Report --> Dashboard["Dashboard /replay/report"]
```

## Decision 처리 경계

Historical replay의 tick 처리는 simulated time 기준으로 아래 순서를 유지합니다.

1. `HistoricalMarketPacketBuilder`가 현재 tick까지 관측 가능한 snapshot만 사용해 packet을 생성합니다.
2. optional `PaperExitPolicy`가 보유 포지션에 대한 deterministic paper-only exit decision을 먼저 생성합니다.
3. exit decision은 `VirtualRiskEngine`과 `PaperOrderEngine`을 통과해 paper artifact로 기록됩니다.
4. `ReplaySamplingPolicy`가 provider 호출 여부를 결정합니다.
5. provider decision은 packet id와 no-lookahead data ref 검증을 통과한 뒤 기록됩니다.
6. 같은 tick에서 exit이 실행된 symbol의 provider decision item은 실행 전에 suppression됩니다.
7. provider decision item도 동일한 `VirtualRiskEngine`과 `PaperOrderEngine` 경계를 통과합니다.
8. provider timeout, invalid output, packet mismatch는 audit/progress에 기록되지만 paper order로 변환하지 않습니다.

`src/replay/historicalReplayDecisionBoundary.ts`는 decision confidence binding, audit event append, risk/order execution, progress event 변환만 담당합니다. 이 helper는 packet 생성, simulated clock, sampling 여부, provider 호출 여부를 결정하지 않습니다.

이 경계는 replay 전용입니다. exit policy는 live trading policy가 아니며, replay runner는 live trading loop로 재사용하지 않습니다.

## 실행

dry-run은 AI 호출 없이 deterministic fixture decision을 사용합니다.

```powershell
npm run historical:replay:dry -- data/paper 2025-01-02T09:00:00+09:00 2025-01-02T15:30:00+09:00 60 5
```

Codex CLI provider를 사용할 때는 `.env`에 로컬 실행 설정을 둡니다.

```text
AI_DECISION_MODE=paper_only
AI_DECISION_ENABLED=true
CODEX_EXEC_PATH=codex
CODEX_EXEC_SANDBOX=read-only
CODEX_EXEC_TIMEOUT_SECONDS=300
CODEX_OUTPUT_SCHEMA_PATH=schemas/virtual-decision.schema.json
CODEX_DECISION_MAX_RUNS_PER_DAY=5
CODEX_DECISION_ALLOW_WEB_SEARCH=false
```

Historical replay CLI는 기존 paper CLI와 같은 `CODEX_*` 설정명을 fallback으로 읽습니다. 같은 목적의 `AI_DECISION_*` 값이 함께 있으면 `AI_DECISION_OUTPUT_SCHEMA_PATH`, `AI_DECISION_MAX_RUNS_PER_DAY`, `CODEX_ALLOW_WEB_SEARCH`가 우선됩니다.

```powershell
npm run historical:replay -- data/paper 2025-01-02T09:00:00+09:00 2025-01-02T15:30:00+09:00 60 5
```

positional arguments:

```text
dataDir startAt endAt stepSeconds everyNSteps
```

예:

- `dataDir`: `data/paper`
- `startAt`: `2025-01-02T09:00:00+09:00`
- `endAt`: `2025-01-02T15:30:00+09:00`
- `stepSeconds`: `60`
- `everyNSteps`: `5`

### 랜덤 1개월 Window 선택

batch replay의 선행 단계로 seed 기반 랜덤 calendar-month window를 선택할 수 있습니다.

선택만 확인:

```powershell
npm run historical:replay:dry -- -- --random-window --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --random-window-seed batch-seed-001 --window-months 1 --print-window-only
```

선택된 window로 dry-run replay 실행:

```powershell
npm run historical:replay:dry -- -- --data-dir data/paper --random-window --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --random-window-seed batch-seed-001 --window-months 1 --step-seconds 60 --every-n-steps 5
```

특성:

- 같은 `--random-window-seed`와 같은 range는 항상 같은 window를 선택합니다.
- window는 지정 range 안에 완전히 포함되는 calendar-month 단위로만 선택됩니다.
- `--print-window-only`는 replay를 실행하지 않고 선택된 window metadata만 JSON으로 출력합니다.
- 이 선택 metadata는 batch runner와 aggregate report에서 재현성 근거로 사용할 예정입니다.

### Historical Data Availability 확인

선택된 replay window에 실제 historical snapshot이 있는지 사전에 확인할 수 있습니다.

```powershell
npm run historical:availability -- -- --data-dir data/paper --random-window --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --random-window-seed batch-seed-001 --window-months 1 --min-window-snapshots 1
```

특정 symbol coverage도 함께 요구할 수 있습니다.

```powershell
npm run historical:availability -- -- --data-dir data/paper --start-at 2025-02-01T00:00:00+09:00 --end-at 2025-02-28T23:59:59.999+09:00 --required-symbols KR:005930,KR:000660 --min-snapshots-per-symbol 1
```

Calendar fixture도 availability gate에 연결할 수 있습니다. Fixture 파일은 JSON array 또는 JSONL을 지원하며, market별 rule은 `MARKET:EXCHANGE:TIMEZONE` 형식으로 지정합니다.

```powershell
npm run historical:availability -- -- --data-dir data/paper --start-at 2025-02-01T00:00:00+09:00 --end-at 2025-02-28T23:59:59.999+09:00 --calendar-fixtures-path data/calendar/market-calendar.jsonl --calendar-rule KR:KRX:Asia/Seoul --calendar-rule US:NYSE:America/New_York
```

Calendar fixture가 지정되면 휴장일, fixture 누락, session mismatch, timezone mismatch가 availability issue로 기록되고 `insufficient`로 fail-closed 처리됩니다. 이 옵션은 availability preflight에 연결되며, batch replay CLI에서도 같은 fixture와 rule 옵션을 run별 preflight에 전달합니다. Batch sampler는 calendar-valid 후보가 하나 이상 있으면 calendar-invalid 후보를 제외한 뒤 deterministic seed 선택을 수행합니다. Calendar-valid 후보가 하나도 없으면 기존 preflight가 해당 run을 fail-closed skip 처리합니다. Report/dashboard warning 표시는 RH2 후속 범위입니다.

실제 replay 실행 전에 데이터 부족을 fail-closed로 막으려면 `--require-data-availability`를 사용합니다.

```powershell
npm run historical:replay:dry -- -- --data-dir data/paper --random-window --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --random-window-seed batch-seed-001 --window-months 1 --require-data-availability
```

availability report는 저장된 `historical-market-snapshots.jsonl`과 명시적으로 지정한 calendar fixture 파일만 읽습니다. 외부 데이터 수집, broker API 호출, replay 실행, 주문 생성은 수행하지 않습니다.

### Batch Run Metadata

반복 batch 실행에서 개별 run을 추적하려면 metadata용 식별자를 CLI에 전달할 수 있습니다.

```powershell
npm run historical:replay:dry -- -- --data-dir data/paper --start-at 2025-02-01T00:00:00+09:00 --end-at 2025-02-28T23:59:59.999+09:00 --step-seconds 60 --every-n-steps 5 --batch-id batch-2025-q1-smoke --batch-run-index 0 --run-id batch-2025-q1-smoke-run-000000
```

이 옵션은 `historical-replay-run-metadata.json`에만 저장됩니다. replay sampling, AI decision, risk decision, paper order 처리 정책을 바꾸지 않습니다.

### Batch Replay Runner

여러 random 1개월 window를 반복 실행하고 run별 결과를 JSONL로 남길 수 있습니다.

```powershell
npm run historical:batch:replay:dry -- -- --source-data-dir data/replay-2026-04-12-2026-06-12 --output-dir data/batch-replay --batch-id batch-smoke-001 --seed batch-seed-001 --runs 10 --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --window-months 1 --decision-frequency once_per_week --max-decision-calls 5 --step-seconds 604800 --max-snapshot-age-seconds 2678400 --min-window-snapshots 1
```

출력 구조:

```text
data/batch-replay/
└── batch-smoke-001/
    ├── batch-replay-manifest.json
    ├── batch-replay-runs.jsonl
    ├── batch-replay-selection-trials.jsonl
    └── runs/
        └── batch-smoke-001_run_000000_202604/
            ├── historical-replay-report.json
            ├── historical-replay-run-metadata.json
            ├── historical-replay-packets.jsonl
            ├── historical-replay-decisions.jsonl
            ├── historical-replay-risk-decisions.jsonl
            ├── historical-replay-trades.jsonl
            └── historical-replay-portfolio-timeline.jsonl
```

- batch runner는 source data directory의 `historical-market-snapshots.jsonl`을 읽고, run별 출력은 batch output directory 아래에 분리해 씁니다.
- 각 run은 `seed:runIndex`를 사용해 deterministic random window를 선택합니다.
- availability check가 `insufficient`이면 해당 run은 `skipped`로 기록되고 replay workflow를 실행하지 않습니다.
- `runHistoricalBatchReplay()`에 `calendarValidation`을 직접 전달하거나 batch CLI에 `--calendar-fixtures-path`, `--calendar-rule`을 지정하면 각 run availability preflight가 calendar fixture issue도 fail-closed로 평가합니다.
- Random/balanced batch sampler는 `calendarValidation`이 있고 calendar-valid 후보가 하나 이상 있을 때 holiday/session mismatch/timezone mismatch 후보를 제외한 뒤 window를 선택합니다.
- Batch CLI calendar fixture option 예시:

```powershell
npm run historical:batch:replay:dry -- -- --source-data-dir data/replay-2026-04-12-2026-06-12 --output-dir data/batch-replay --batch-id batch-calendar-smoke --seed batch-calendar-seed --runs 10 --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --window-months 1 --step-seconds 604800 --max-snapshot-age-seconds 2678400 --min-window-snapshots 1 --calendar-fixtures-path data/calendar/market-calendar.jsonl --calendar-rule KR:KRX:Asia/Seoul --calendar-rule US:NYSE:America/New_York
```

- 각 run record는 `marketRegime`을 포함합니다. label은 `bull`, `bear`, `sideways`, `mixed`, `insufficient_data` 중 하나입니다.
- `--window-sampling balanced_regime`을 사용하면 requested market regime bucket을 순환하며 window를 선택합니다.
- `--validation-splits-path`를 사용하면 random/balanced sampling 대신 입력 assignment의 `splitRole`별 fixed window를 실행합니다. 이때 assignment 수는 `--runs`와 같아야 하며, `fixedWindow`와 함께 사용할 수 없습니다.
- 기본 batch runner는 deterministic paper replay를 실행합니다. Codex CLI AI 호출은 `--use-codex-ai`를 명시하고 환경 변수가 활성화된 경우에만 수행합니다.
- Codex CLI AI 호출은 run마다 별도 `CodexCliDecisionProvider`를 생성하고 `codex exec --ephemeral`을 사용합니다. `--max-codex-calls-per-run`은 batch 전체가 아니라 각 run의 paper-only 호출 상한입니다.
- `--use-codex-ai` 실행 전에는 기본으로 preflight decision을 1회 수행합니다. 이미 Codex 연결을 별도 확인한 경우에만 `--skip-codex-preflight`로 생략합니다.
- `batch-replay-runs.jsonl`은 후속 aggregate report의 입력으로 사용됩니다.
- split assignment 실행 시 `batch-replay-manifest.json`의 `validationProtocol`에는 protocol, assignment count, role count가 저장되고 각 run record의 `validationSplit`에는 실제 사용한 assignment가 저장됩니다.
- `batch-replay-selection-trials.jsonl`은 prompt/config/risk/exit hash, run outcome, `selected=false` selection marker를 모든 completed/skipped/failed run에 대해 기록합니다. 이 파일은 best run만 남기는 selection bias를 막기 위한 research artifact이며, live trading signal이나 자동 strategy selection으로 사용하지 않습니다.

#### Market Regime Balanced Sampling

기본 batch replay는 seed 기반 random month sampling을 사용합니다. 장세별 결과를 더 균형 있게 비교하려면 `balanced_regime` sampling을 명시합니다.

```powershell
npm run historical:batch:replay:dry -- -- --source-data-dir data/replay-2023-01-2026-05-yahoo-daily --output-dir data/batch-replay --batch-id batch-balanced-regime-smoke --seed batch-seed-001 --runs 4 --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --window-months 1 --decision-frequency once_per_week --max-decision-calls 1 --step-seconds 604800 --max-snapshot-age-seconds 2678400 --min-window-snapshots 1 --window-sampling balanced_regime
```

동작:

- 기본 target regime은 `bull,bear,sideways,mixed`입니다.
- `--target-regimes bull,bear,sideways,mixed`처럼 target을 명시할 수 있습니다.
- sampler는 전체 후보 month를 먼저 `marketRegime`으로 분류한 뒤, 사용 가능한 target bucket만 active target으로 둡니다.
- run index는 active target regime을 순환합니다. 예를 들어 active target이 4개이고 run이 4개이면 각 regime이 1번씩 target이 됩니다.
- target bucket 안의 month 선택은 seed, run index, target regime, replay range를 사용해 deterministic하게 수행합니다.
- 선택 결과는 run record의 `windowSampling.targetRegime`, `targetCandidateCount`, `marketRegime`에 저장됩니다.
- manifest의 `windowSampling`에는 requested/active/unavailable target regime, 전체 candidate count, bucket count가 저장됩니다.

이 sampling은 분석용 window selection metadata입니다. trading signal, risk approval, order intent, strategy 자동 조정으로 사용하지 않습니다.

#### Paper Risk Profile

Historical replay와 batch replay는 paper-only 실험용 risk profile을 선택할 수 있습니다.

```powershell
npm run historical:batch:replay:dry -- -- --source-data-dir data/replay-2023-01-2026-05-yahoo-daily --output-dir data/batch-replay --batch-id batch-aggressive-profile-smoke --seed batch-seed-001 --runs 10 --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --window-months 1 --decision-frequency once_per_week --max-decision-calls 5 --step-seconds 604800 --max-snapshot-age-seconds 2678400 --min-window-snapshots 1 --risk-profile aggressive_paper
```

| Profile | `targetExposureRatio` | `maxNewPositions` | `maxBudgetPerSymbolKrw` | `maxPositionWeightRatio` | `minCashReserveRatio` |
| --- | ---: | ---: | ---: | ---: | ---: |
| `conservative` | 0.35 | 3 | 100,000 | 0.35 | 0.10 |
| `balanced` | 0.55 | 4 | 200,000 | 0.45 | 0.08 |
| `aggressive_paper` | 0.85 | 5 | 400,000 | 0.65 | 0.05 |

- 기본값은 `conservative`입니다.
- `--max-new-positions`, `--max-budget-per-symbol-krw`를 명시하면 선택한 profile의 packet constraint와 paper risk policy에 같은 override가 반영됩니다.
- 각 profile은 `portfolioAllocation` snapshot을 packet에 추가합니다. 이 snapshot은 현재 노출, terminal target, 현재 ramp 단계의 scheduled exposure ceiling, 추가 매수 가능 금액, aggregate per-decision budget, symbol exposure cap을 포함합니다.
- `targetExposureRatio`는 최종 목표 노출입니다. `aggressive_paper`는 `deploymentRampDays=10`, `maxInitialDeploymentRatio=0.25`, `maxDailyGrossBuyRatio=0.12`, `maxInitialOpenPositions=2`, `maxNewPositionsPerDay=2`, `positionSlotRampDays=10`을 사용해 초기 자금과 포지션 슬롯을 단계적으로 배포합니다.
- `maxBudgetPerDecisionRatio`는 후보별 cap이 아니라 한 provider decision 안에서 승인되는 BUY 합계 cap입니다.
- `aggressive_paper`에서 `--initial-cash-krw`가 큰 경우 `maxBudgetPerSymbolKrw`, `maxBudgetPerDecisionKrw`, `maxSymbolExposureKrw`가 profile ratio에 맞춰 확장됩니다. 초기자금 기반 simulation에서 `maxSymbolExposureKrw`는 `maxSymbolExposureRatio=0.25`를 따릅니다.
- dashboard `mixed_global` simulation은 KR/US terminal target을 50/50으로 나누고, ramp 중에는 market별 scheduled quota만 추가 매수에 사용할 수 있습니다.
- `aggressive_paper`는 더 큰 paper-only 매수 후보를 허용하되, 초기 lump-sum 진입과 단일 시장 선점을 막기 위한 profile입니다.
- 선택된 profile, allocation policy, 정규화된 risk policy는 `batch-replay-manifest.json`과 각 run의 `historical-replay-run-metadata.json`에 기록됩니다.
- 이 profile은 `VirtualRiskEngine`과 `PaperOrderEngine` 경로에만 적용됩니다. live `RiskEngine`, `TradingSignal`, `OrderIntent`, `OrderRouter`로 전파하지 않습니다.
- profile 이름은 투자 조언, 수익률 보장, 실계좌 성과 예측으로 해석하면 안 됩니다.

#### Aggressive Codex Prompt Policy

Codex CLI provider를 historical replay에서 사용할 때 `--risk-profile aggressive_paper`를 지정하면 별도 prompt policy를 사용합니다.

| Risk profile | Prompt policy | Prompt version |
| --- | --- | --- |
| `conservative` | `default` | `paper-v14-historical-replay-v1` |
| `balanced` | `default` | `paper-v14-historical-replay-v1` |
| `aggressive_paper` | `aggressive_paper` | `paper-v14-historical-replay-aggressive-paper-v2` |

`aggressive_paper` prompt policy는 다음을 Codex 입력 prompt에 추가합니다.

- paper-only historical replay에만 적용되며 live trading에는 적용하지 않습니다.
- 월 15\~30% 수익률 목표를 쫓기 위해 trade를 강제하지 않습니다.
- `buyEligible=true`, 강한 `featureScores` 또는 `reasonCodes`, fresh `dataRefs`, packet constraint 내 현금 여력이 동시에 있을 때만 `VIRTUAL_BUY`를 더 적극적으로 검토합니다.
- `targetExposureRatio`를 즉시 채우려 하지 않고, `scheduledExposureCeilingRatio`, `maxAdditionalBuyBudgetKrw`, `maxBudgetPerDecisionKrw`, market allocation cap 안에서만 `VIRTUAL_BUY`를 검토합니다.
- `budgetKrw`는 `marketPacket.constraints.maxBudgetPerSymbolKrw`를 넘지 않으며, concentration/drawdown/stale-data/cash-reserve risk를 `riskFactors`에 명시해야 합니다.
- evidence, eligibility, constraints가 부족하면 `aggressive_paper`에서도 `VIRTUAL_HOLD`가 올바른 판단입니다.

batch replay에서 Codex CLI를 사용할 경우 선택된 prompt policy와 prompt version은 `batch-replay-manifest.json`의 `decisionProvider.promptPolicy`, `decisionProvider.promptVersion`에 기록됩니다.

#### Paper Exit Policy

Historical replay와 batch replay는 AI/provider 판단과 별도로 deterministic paper-only exit rule을 실행할 수 있습니다. 기본값은 비활성입니다.

```powershell
npm run historical:batch:replay:dry -- -- --source-data-dir data/replay-2023-01-2026-05-yahoo-daily --output-dir data/batch-replay --batch-id batch-exit-policy-smoke --seed batch-seed-001 --runs 10 --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --window-months 1 --decision-frequency once_per_week --max-decision-calls 5 --step-seconds 604800 --max-snapshot-age-seconds 2678400 --min-window-snapshots 1 --risk-profile aggressive_paper --paper-take-profit-ratio 0.15 --paper-stop-loss-ratio 0.08 --paper-rebalance-max-position-weight-ratio 0.55
```

옵션:

- `--paper-take-profit-ratio 0.15`: 보유 포지션의 미실현 수익률이 15% 이상이면 reduce-only `VIRTUAL_SELL` sell-all decision을 생성합니다.
- `--paper-stop-loss-ratio 0.08`: 보유 포지션의 미실현 수익률이 -8% 이하이면 reduce-only `VIRTUAL_SELL` sell-all decision을 생성합니다.
- `--paper-rebalance-max-position-weight-ratio 0.55`: 포지션 평가액이 가상 순자산의 55%를 초과하면 `targetWeightPct=0.55` reduce-only sell decision을 생성합니다.
- `--paper-take-profit-mode full_exit|partial_then_trail`: take-profit 처리 방식을 선택합니다. 기본값은 `full_exit`입니다.
- `--paper-take-profit-sell-ratio 0.5`: `partial_then_trail` 모드에서 최초 take-profit 도달 시 매도할 보유 수량 비율입니다.
- `--paper-trailing-stop-from-peak-ratio 0.08`: `partial_then_trail` 모드에서 partial take-profit 이후 peak 가격 대비 하락률이 이 값을 넘으면 잔여 수량을 sell-all 합니다.

동작:

- exit rule은 AI/provider call count에 포함되지 않습니다.
- exit decision도 기존 `VirtualRiskEngine`과 `PaperOrderEngine`만 통과합니다.
- 같은 tick에서 exit이 발생한 종목은 provider가 같은 종목에 대해 낸 decision item을 실행하지 않습니다.
- stop-loss가 take-profit/rebalance보다 우선하고, take-profit이 rebalance보다 우선합니다.
- `full_exit` 모드는 기존과 같이 take-profit 도달 시 전량 매도합니다.
- `partial_then_trail` 모드는 replay runner 내부 paper-only state로 종목별 partial take-profit 실행 여부와 peak 가격을 추적합니다. 이 state는 live trading path나 broker adapter로 전달하지 않습니다.
- `partial_then_trail`에서 partial take-profit은 같은 position에 대해 한 번만 실행합니다.
- risk profile의 `maxPositionWeightRatio`보다 exit policy의 `rebalanceMaxPositionWeightRatio`가 낮으면 자동 변경하지 않고 replay warning으로만 기록합니다.
- 실행된 exit policy는 `historical-replay-decisions.jsonl`, `historical-replay-risk-decisions.jsonl`, `historical-replay-trades.jsonl`, `historical-replay-run-metadata.json`, `historical-replay-report.json`, `batch-replay-manifest.json`에 기록됩니다.

이 정책은 paper-only replay 실험용입니다. live `TradingSignal`, `OrderIntent`, `OrderRouter`로 전파하지 않으며 수익률 목표 달성이나 실계좌 성과를 보장하지 않습니다.

예: partial take-profit 후 trailing stop 실험

```powershell
npm run historical:batch:replay:dry -- -- --source-data-dir data/replay-2023-01-2026-05-yahoo-daily --output-dir data/batch-replay --batch-id batch-exit-v2-partial-trail --seed batch-seed-001 --runs 10 --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --window-months 1 --decision-frequency once_per_week --max-decision-calls 5 --step-seconds 604800 --max-snapshot-age-seconds 2678400 --risk-profile aggressive_paper --paper-take-profit-ratio 0.15 --paper-stop-loss-ratio 0.08 --paper-rebalance-max-position-weight-ratio 0.55 --paper-take-profit-mode partial_then_trail --paper-take-profit-sell-ratio 0.5 --paper-trailing-stop-from-peak-ratio 0.08
```

#### Historical Universe Coverage

확장 universe는 `docs/historical-universe.kr-expanded.json`에 저장합니다.

- `required=true`: 현재 core replay dataset에 반드시 있어야 하는 symbol입니다.
- `required=false`: 더 넓은 실험을 위한 expansion target입니다.
- 기본 coverage status는 required symbol만 기준으로 판단합니다.
- optional symbol까지 강제하려면 `--require-optional-symbols` 또는 batch replay의 `--require-optional-universe-symbols`를 사용합니다.

`Universe manifest` 생명주기 snapshot 계약:

- `snapshotDate`: `YYYY-MM-DD` 형식의 필수 날짜입니다. 이 값은 universe 구성과 lifecycle metadata가 어느 날짜 기준인지 고정합니다.
- `lifecycleStatus`: symbol 단위 status이며 `active`, `suspended`, `delisted`, `unknown` 중 하나입니다.
- 기존 fixture처럼 status 근거가 없는 manifest member는 parser에서 `unknown`으로 보수 처리하되, candidate eligibility gate에는 전파하지 않습니다.
- historical replay에서 `--universe-path`가 있고 manifest member에 `lifecycleStatus`가 명시되어 있으면 candidate에는 `lifecycleStatus`와 `HISTORICAL_LIFECYCLE_<STATUS>` reason code가 기록됩니다.
- manifest에 없는 replay symbol은 `unknown`으로 간주해 candidate trading을 차단합니다.
- 명시된 `active`가 아닌 `suspended`, `delisted`, `unknown` status와 manifest 누락 symbol은 buy/sell eligibility를 차단하고 `VirtualRiskEngine`의 `VIRTUAL_LIFECYCLE_NOT_ELIGIBLE` reject code로 fail-closed 처리됩니다.
- schema sample은 `docs/historical-universe.lifecycle-sample.json`에 둡니다.
- coverage report는 batch aggregate report와 replay research dashboard에 read-only summary와 universe selection bias warning으로 연결합니다.

coverage report 생성:

```powershell
npm run historical:universe:coverage -- -- --data-dir data/replay-2023-01-2026-05-yahoo-daily --universe-path docs/historical-universe.kr-expanded.json --range-start 2023-01-01T00:00:00+09:00 --range-end 2026-05-31T23:59:59.999+09:00 --min-monthly-coverage-ratio 1 --min-snapshots-per-symbol 1 --output-path data/replay-2023-01-2026-05-yahoo-daily/historical-universe-coverage.json
```

JSON 출력이 필요하면 `--json`을 추가합니다.

batch replay에서 universe required symbol을 availability check에 반영:

```powershell
npm run historical:batch:replay:dry -- -- --source-data-dir data/replay-2023-01-2026-05-yahoo-daily --output-dir data/batch-replay --batch-id batch-universe-coverage-smoke --seed batch-seed-001 --runs 4 --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --window-months 1 --decision-frequency once_per_week --max-decision-calls 1 --step-seconds 604800 --max-snapshot-age-seconds 2678400 --min-window-snapshots 1 --universe-path docs/historical-universe.kr-expanded.json
```

이 검증은 저장된 `historical-market-snapshots.jsonl`만 읽습니다. 외부 데이터 수집, broker API 호출, replay 결과 최적화, 주문 생성은 수행하지 않습니다.

#### Global KR/US/ETF Yahoo Daily Dataset

국장, 미장, ETF를 함께 쓰는 replay dataset은 `docs/historical-universe.global-broad.json`과 Yahoo daily chart ingest CLI로 생성합니다.

`global-broad` universe는 20개 core symbol을 `required=true`로 유지하고, 나머지 확장 symbol은 `required=false`로 둡니다. 대형 universe에서는 개별 optional symbol 실패보다 전체 실험 폭이 중요하므로 coverage 단계에서 전체/시장별/자산유형별 최소 확보 수를 함께 검사합니다.

```powershell
npm run historical:yahoo:ingest -- -- --data-dir data/replay-2023-01-2026-05-global-yahoo-daily --universe-path docs/historical-universe.global-broad.json --range-start 2023-01-01T00:00:00+09:00 --range-end 2026-05-31T23:59:59.999+09:00 --allow-partial --json
```

동작:

- Yahoo chart daily OHLCV를 `historical-market-snapshots.jsonl`로 저장합니다.
- `market=US` 또는 Yahoo currency가 `USD`인 가격은 같은 날짜 이전의 `KRW=X` daily close로 KRW 환산합니다.
- snapshot에는 universe의 `assetType`, `assetClass`, `region`, `riskTags`를 보존합니다.
- 이 CLI는 historical replay input만 생성하며 replay 실행, Codex CLI 호출, broker API 호출, 주문 생성을 수행하지 않습니다.

생성 후 coverage는 시장과 자산유형 존재 여부, 그리고 broad universe 최소 확보량을 함께 강제합니다.

```powershell
npm run historical:universe:coverage -- -- --data-dir data/replay-2023-01-2026-05-global-yahoo-daily --universe-path docs/historical-universe.global-broad.json --range-start 2023-01-01T00:00:00+09:00 --range-end 2026-05-31T23:59:59.999+09:00 --min-monthly-coverage-ratio 1 --min-snapshots-per-symbol 1 --require-markets 'KR,US' --require-asset-types 'STOCK,ETF' --min-available-symbols 120 --min-available-market-symbols 'KR:50,US:50' --min-available-asset-type-symbols 'STOCK:80,ETF:30' --output-path data/replay-2023-01-2026-05-global-yahoo-daily/historical-universe-coverage.json
```

global dataset으로 batch replay를 실행할 때는 source data dir과 universe path를 함께 바꿉니다.

```powershell
npm run historical:batch:replay:dry -- -- --source-data-dir data/replay-2023-01-2026-05-global-yahoo-daily --output-dir data/batch-replay --batch-id batch-global-smoke --seed batch-global-smoke --runs 4 --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --window-months 1 --decision-frequency once_per_week --max-decision-calls 1 --step-seconds 604800 --max-snapshot-age-seconds 2678400 --min-window-snapshots 1 --universe-path docs/historical-universe.global-broad.json --window-sampling balanced_regime --target-regimes bull,bear,sideways,mixed --market-regime-allocation
```

Codex CLI provider를 사용할 때도 같은 `--source-data-dir`와 `--universe-path`를 사용합니다. `--use-codex-ai`는 `AI_DECISION_ENABLED=true`가 명시된 경우에만 활성화됩니다.

Historical packet builder는 매 decision step마다 해당 시점까지의 최신 fresh snapshot 전체를 점수화한 뒤 후보를 선별합니다. AI packet은 schema 상 최대 20개 후보로 제한되어 있으므로, broad universe를 그대로 AI에 넘기지 않고 deterministic screener가 점수, 시장 분산, 자산유형 분산을 먼저 적용합니다.

#### Global KR/US/ETF TossInvest Daily Dataset

Yahoo snapshot을 제외하고 TossInvest read-only chart만으로 global broad replay dataset을 만들 때는 같은 universe manifest를 `historical:tossctl:ingest`에 전달합니다. 미장 symbol은 public search API로 TossInvest product code를 resolve한 뒤 `day:1` chart를 조회합니다. 이 수집은 historical replay input만 생성하며 broker API 호출, 주문 생성, replay 실행을 수행하지 않습니다.

```powershell
npm run historical:tossctl:ingest -- --enable --data-dir data/tossinvest-daily-global-broad-2024-01-01-2026-06-17 --universe-path docs/historical-universe.global-broad.json --interval 1d --start-date 2024-01-01 --end-date 2026-06-17 --count 450 --allow-partial --json
```

생성 후에는 같은 universe coverage CLI로 국장/미장/ETF 확보량을 검증합니다.

```powershell
npm run historical:universe:coverage -- -- --data-dir data/tossinvest-daily-global-broad-2024-01-01-2026-06-17 --universe-path docs/historical-universe.global-broad.json --range-start 2024-01-01T00:00:00+09:00 --range-end 2026-06-17T23:59:59.999+09:00 --min-monthly-coverage-ratio 1 --min-snapshots-per-symbol 1 --require-markets 'KR,US' --require-asset-types 'STOCK,ETF' --min-available-symbols 120 --min-available-market-symbols 'KR:50,US:50' --min-available-asset-type-symbols 'STOCK:80,ETF:30' --output-path data/tossinvest-daily-global-broad-2024-01-01-2026-06-17/historical-universe-coverage.json
```

#### Batch Replay에서 Codex CLI AI 사용

실제 Codex CLI paper-only provider를 batch replay에서 사용하려면 명시 옵션과 환경 변수가 모두 필요합니다.

```text
AI_DECISION_MODE=paper_only
AI_DECISION_ENABLED=true
CODEX_EXEC_PATH=codex
CODEX_EXEC_TIMEOUT_SECONDS=300
AI_DECISION_MAX_RUNS_PER_DAY=50
CODEX_ALLOW_WEB_SEARCH=false
CODEX_OUTPUT_SCHEMA_PATH=schemas/virtual-decision.schema.json
```

권장 첫 실행은 10개 random month, run당 최대 5회 판단, 주간 판단입니다.

```powershell
npm run historical:batch:replay -- -- --use-codex-ai --source-data-dir data/replay-2026-04-12-2026-06-12 --output-dir data/batch-replay --batch-id batch-codex-001 --seed batch-seed-001 --runs 10 --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --window-months 1 --decision-frequency once_per_week --max-decision-calls 5 --max-codex-calls-per-run 5 --step-seconds 604800 --max-snapshot-age-seconds 2678400 --min-window-snapshots 1
```

- `--use-codex-ai`가 없으면 Codex CLI를 호출하지 않습니다.
- `--use-codex-ai`는 `AI_DECISION_ENABLED=true`가 아니면 fail-fast 됩니다.
- 각 run의 Codex call cap은 `--max-codex-calls-per-run`으로 제한합니다. 이 값은 batch 전체 daily budget이 아니라 run마다 새로 생성되는 Codex provider의 per-run 상한입니다.
- 일반 paper CLI와 single historical replay의 provider run budget은 `AI_DECISION_MAX_RUNS_PER_DAY`를 먼저 읽고, 값이 없으면 기존 paper CLI 호환 설정인 `CODEX_DECISION_MAX_RUNS_PER_DAY`를 사용합니다.
- replay sampling call cap은 `--max-decision-calls`로 제한합니다.
- Codex CLI는 `read-only` sandbox로 호출됩니다.
- Codex output schema는 `AI_DECISION_OUTPUT_SCHEMA_PATH` 또는 fallback `CODEX_OUTPUT_SCHEMA_PATH`로 전달됩니다.
- provider 실패, timeout, packet mismatch는 paper order 없이 audit/progress log에 실패로 기록됩니다.
- Codex output은 `VirtualDecision`으로만 처리되며 live `TradingSignal` 또는 `OrderIntent`로 연결하지 않습니다.
- 모든 가상 매수/매도는 기존 `VirtualRiskEngine`과 `PaperOrderEngine` 경로만 통과합니다.
- 실행 전후 `.env`, data availability, budget cap, progress/audit/report 확인 순서는 [AI Paper Trading Runbook](ai-paper-trading-runbook.md)을 따릅니다.

### Market Regime Classification

Market regime은 window 안 snapshot만 사용해 deterministic하게 계산합니다.

- symbol별 window 첫 가격과 마지막 가격의 return ratio를 계산합니다.
- 기본값 기준 최소 2개 snapshot이 있는 symbol만 분류에 사용합니다.
- 평균 return이 `+3%` 이상이고 상승 symbol 비율이 `60%` 이상이면 `bull`입니다.
- 평균 return이 `-3%` 이하이고 하락 symbol 비율이 `60%` 이상이면 `bear`입니다.
- 평균 return의 절대값이 `1%` 이하이면 `sideways`입니다.
- 위 조건이 충돌하거나 방향성과 breadth가 엇갈리면 `mixed`입니다.
- 분류 가능한 symbol이 부족하면 `insufficient_data`입니다.

이 분류는 batch 결과를 나중에 조건별로 나누기 위한 metadata입니다. trading signal, risk approval, order intent로 사용하지 않습니다.

Batch run record는 전체 window 기준 `marketRegime`과 별도로 `marketRegimesByMarket`를 기록합니다.

- `marketRegime`: window 안 모든 classified symbol을 합쳐 계산한 기존 label입니다.
- `marketRegimesByMarket.KR`: KR snapshot만 사용해 계산한 label입니다.
- `marketRegimesByMarket.US`: US snapshot만 사용해 계산한 label입니다.
- window 안에 해당 market snapshot이 없으면 해당 key를 만들지 않습니다.

이 metadata는 국장/미장 장세가 서로 다를 때 후속 paper-only policy의 입력 후보가 될 수 있습니다. 기본 batch replay에서는 metadata로만 저장되며, `--market-regime-allocation` 또는 `--dynamic-cash-reserve`를 명시한 경우에만 각각 market allocation 또는 cash reserve risk gate 입력으로 사용됩니다.

### Dynamic Cash Reserve

Batch replay에서 market regime 기반 현금 reserve를 켜려면 `--dynamic-cash-reserve`를 명시합니다.

```powershell
npm run historical:batch:replay:dry -- -- --source-data-dir data/replay-2023-01-2026-05-global-yahoo-daily --output-dir data/batch-replay --batch-id batch-dynamic-cash-smoke --seed batch-dynamic-cash-smoke --runs 4 --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --window-months 1 --decision-frequency once_per_week --max-decision-calls 1 --step-seconds 604800 --max-snapshot-age-seconds 2678400 --min-window-snapshots 1 --universe-path docs/historical-universe.global-broad.json --window-sampling balanced_regime --target-regimes bull,bear,sideways,mixed --dynamic-cash-reserve --dynamic-cash-reserve-lookback-days 20
```

옵션:

- `--dynamic-cash-reserve`: dynamic cash reserve policy를 활성화합니다.
- `--dynamic-cash-reserve-lookback-days`: 각 tick에서 regime 계산에 사용할 lookback 일수입니다. 기본값은 `20`입니다.
- `--dynamic-cash-reserve-min-symbols`: 분류에 필요한 최소 symbol 수입니다. 기본값은 `1`입니다.
- `--dynamic-cash-reserve-min-snapshots-per-symbol`: symbol별 최소 snapshot 수입니다. 기본값은 `2`입니다.
- `--dynamic-cash-reserve-high-volatility-return-threshold`: high volatility 판단에 사용할 평균 absolute return threshold입니다. 기본값은 `0.08`입니다.
- `--dynamic-cash-reserve-high-volatility-ratio`: high volatility일 때 요구할 최소 현금 reserve ratio입니다. 기본값은 `0.30`입니다.

동작:

- static `minCashReserveRatio`와 `minCashReserveKrw`를 낮추지 않습니다.
- tick별 `simulatedAt` 이후 snapshot은 regime 계산에 사용하지 않습니다.
- bear, insufficient data, high volatility 구간에서 static reserve보다 높은 reserve가 필요하면 `VIRTUAL_REGIME_CASH_RESERVE_BREACHED`를 기록하고 BUY를 reject합니다.
- 설정은 run metadata의 `configuration.riskPolicy.dynamicCashReservePolicy`와 research manifest hash에 포함됩니다.
- market regime allocation은 market별 target exposure를 조정하고, dynamic cash reserve는 portfolio 전체 cash floor를 조정합니다.
- dynamic cash reserve와 hedge policy의 reject summary는 `historical-replay-report.json`의 `riskSummary.policySummary`와 `historical-replay-run-metadata.json`의 `riskPolicySummary`에 기록됩니다. `hedge` summary는 `strategyBucket=hedge`로 기록된 virtual trade의 count, BUY notional, modeled cost도 함께 집계합니다.

### Walk-forward Validation Split

`src/replay/walkForwardSplit.ts`는 Q6 validation protocol의 첫 단계로 deterministic walk-forward split metadata를 생성합니다.

현재 범위:

- 월 단위 rolling train/validation/test window를 생성합니다.
- `validationProtocol: "walk_forward"`와 `splitId`, `splitIndex`, `trainStart`, `validationStart`, optional `testStart`를 schema로 검증합니다.
- `walkForwardSplitAssignments()`는 하나의 split을 `train`, `validation`, optional `test` role metadata로 확장합니다.
- `embargoDurationDays`는 split metadata에 기록할 수 있습니다. 기본값은 `0`입니다.
- `applyValidationEmbargoPolicy()`는 train 후보 sample 중 validation 시작 직전 embargo window에 포함되는 sample을 제외하고 split별 exclusion summary를 계산합니다.
- Q6-3부터 batch replay는 `--validation-splits-path`로 assignment array를 받아 `train`, `validation`, `test` role window를 fixed range로 실행할 수 있습니다.
- split assignment는 `batch-replay-manifest.json`의 `validationProtocol` summary, `batch-replay-runs.jsonl`의 `validationSplit`, aggregate report의 `validationSplitRoleCounts`와 `byValidationSplitRole`에 저장됩니다.
- `train` role assignment에 `embargoDurationDays > 0`이 있으면 batch replay window는 `validationStart - embargoDurationDays` 직전까지로 잘라 embargo sample이 train replay, availability, regime, packet, metric에 포함되지 않게 합니다.
- purge duration은 현재 `0`으로 고정됩니다. purge 적용과 CPCV/Purged K-Fold 연결은 Q7 범위입니다.

예시:

```json
{
  "validationProtocol": "walk_forward",
  "splitId": "wf_001_train_2025-01-01_2025-02-28_validation_2025-03-01_2025-03-31_test_2025-04-01_2025-04-30",
  "splitIndex": 0,
  "splitRole": "validation",
  "trainStart": "2024-12-31T15:00:00.000Z",
  "trainEnd": "2025-02-28T14:59:59.999Z",
  "validationStart": "2025-02-28T15:00:00.000Z",
  "validationEnd": "2025-03-31T14:59:59.999Z",
  "testStart": "2025-03-31T15:00:00.000Z",
  "testEnd": "2025-04-30T14:59:59.999Z",
  "purgeDurationDays": 0,
  "embargoDurationDays": 5
}
```

Embargo summary 예시:

```json
{
  "validationProtocol": "walk_forward",
  "splitId": "wf_001_train_2025-01-01_2025-02-28_validation_2025-03-01_2025-03-31_test_2025-04-01_2025-04-30",
  "splitIndex": 0,
  "sampleCount": 60,
  "trainCandidateSampleCount": 40,
  "includedTrainSampleCount": 35,
  "excludedSampleCount": 5,
  "purgeExcludedSampleCount": 0,
  "embargoExcludedSampleCount": 5,
  "purgeDurationDays": 0,
  "embargoDurationDays": 5,
  "embargoStart": "2025-02-23T15:00:00.000Z",
  "embargoEnd": "2025-02-28T14:59:59.999Z"
}
```

Batch replay에 연결할 때 `--validation-splits-path`는 assignment array 또는 `{ "assignments": [...] }` 형식의 JSON 파일을 받습니다. 각 assignment는 하나의 run에 1:1로 대응하므로 파일의 assignment 수와 `--runs` 값이 같아야 합니다.

```powershell
npm run historical:batch:replay:dry -- -- --source-data-dir data/replay-2023-01-2026-05-global-yahoo-daily --output-dir data/batch-replay --batch-id batch-walk-forward-smoke --seed batch-walk-forward-smoke --runs 3 --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --step-seconds 604800 --max-snapshot-age-seconds 2678400 --validation-splits-path data/validation-splits/walk-forward-assignments.json
```

### Purged K-Fold Validation Split

`src/replay/purgedSplit.ts`는 Q7 validation protocol의 첫 단계로 deterministic Purged K-Fold split metadata를 생성합니다.

현재 범위:

- `validationProtocol: "purged_k_fold"` plan과 split schema를 제공합니다.
- 입력 sample은 `sampleId`, `labelStart`, `labelEnd`를 가져야 하며 label horizon이 유효하지 않으면 fail-closed 됩니다.
- sample은 `labelStart`, `labelEnd`, `sampleId` 순서로 정렬한 뒤 contiguous K-Fold로 나눕니다.
- 각 split은 test fold를 제외한 train 후보 중 test label horizon과 겹치는 sample을 `purgedSampleIds`로 제외합니다.
- `embargoDurationDays > 0`이면 test window 직후 embargo 구간의 train 후보를 `embargoedSampleIds`로 제외합니다.
- split별 `trainSampleIds`, `testSampleIds`, `purgedSampleIds`, `embargoedSampleIds`, exclusion count를 schema로 검증합니다.
- Q7-1은 standalone generator와 test 범위입니다. batch replay manifest/report 연결, split metric matrix 저장, CPCV, PBO-like score는 Q7-2 범위입니다.

이 metadata는 leakage 방지를 위한 research validation artifact입니다. replay 실행, AI/provider 판단, risk approval, paper order, live trading signal로 직접 연결하지 않습니다.

### Combinatorial Purged CV Split

`src/replay/combinatorialPurgedCv.ts`는 RH6 full CPCV/PBO의 standalone split generator입니다.

현재 범위:

- `validationProtocol: "combinatorial_purged_cv"` plan과 combination schema를 제공합니다.
- 입력 sample은 기존 `PurgedKFoldSample` schema를 재사용하며, `sampleId`, `labelStart`, `labelEnd`가 유효하지 않으면 fail-closed 됩니다.
- sample은 `labelStart`, `labelEnd`, `sampleId` 순서로 정렬한 뒤 contiguous fold로 나눕니다.
- `testFoldCount`개 test fold 조합을 lexicographic order로 생성하고, 각 combination에 `trainFoldIds`, `testFoldIds`, `trainSampleIds`, `testSampleIds`, `purgedSampleIds`, `embargoedSampleIds`를 기록합니다.
- exhaustive mode에서 전체 조합 수가 `maxCombinationCount`를 초과하면 plan 생성을 거부합니다.
- sampled mode는 non-empty `randomSeed`를 요구하며, 전체 조합 수가 budget을 초과하면 deterministic seed로 일부 combination index만 emit합니다.
- train 후보 sample이 test label window와 겹치면 `purgedSampleIds`로 제외하고, `purgeDurationDays > 0`이면 test label window를 전후로 확장해 더 보수적으로 제외합니다.
- 비인접 test fold 조합에서도 각 held-out fold 이후 embargo 구간에 들어오는 train 후보 sample은 `embargoedSampleIds`로 제외합니다.

이 generator는 paper-only historical replay 결과를 사후 검증하기 위한 split artifact입니다. batch replay manifest/report 연결, dashboard 표시, strategy 자동 선택, live signal 생성은 이번 범위에 포함하지 않습니다.

### CPCV/PBO Validation Artifact

`src/replay/cpcvPboValidation.ts`는 RH6 full CPCV/PBO의 standalone validation artifact schema와 PBO calculator입니다.

현재 범위:

- `schemaVersion: "cpcv_pbo_validation.v1"` report schema를 제공합니다.
- `config`, `splitPlan`, `performanceMatrix`, `selectionLog`, `pbo`, `warnings`를 하나의 artifact로 검증합니다.
- `config`는 `combinatorial_purged_cv` split plan의 fold, purge/embargo, combination mode, seed, budget과 일치해야 하며 mismatch는 fail-closed로 거부합니다.
- 각 combination에서 `trainMetric` 후보가 2개 이상일 때 가장 높은 candidate를 선택하고, 동률이면 `candidate_key_asc` tie breaker를 적용합니다.
- selected candidate의 `testMetric` rank를 descending mid-rank percentile로 계산하며, tied test metric 후보는 같은 percentile을 공유합니다. percentile이 `0.5` 이하인 scored combination 비율을 `pbo.probability`로 기록합니다.
- train-side candidate competition이 없거나 comparable test metric matrix가 없으면 `pbo.status="insufficient_matrix"`, `probability=null`, warning을 기록합니다.
- sampled CPCV split plan을 입력으로 받으면 report `status`는 `sampled`이고 `CPCV_SAMPLED_MODE_USED` warning을 남깁니다.

이 artifact는 여러 candidate의 selection bias를 사후 설명하기 위한 paper-only 검증 지표입니다. batch replay aggregate report 연결, dashboard 표시, strategy 자동 선택, live signal 생성은 후속 범위입니다.

### Batch Aggregate Report

batch replay가 생성한 `batch-replay-runs.jsonl`을 읽어 전체 및 market regime별 결과를 집계할 수 있습니다.

```powershell
npm run historical:batch:report -- -- --runs-path data/batch-replay/batch-smoke-001/batch-replay-runs.jsonl --output-path data/batch-replay/batch-smoke-001/batch-replay-aggregate-report.json
```

목표 수익률 threshold별 hit-rate를 함께 계산하려면 ratio 값을 comma-separated로 전달합니다.

```powershell
npm run historical:batch:report -- -- --runs-path data/batch-replay/batch-smoke-001/batch-replay-runs.jsonl --output-path data/batch-replay/batch-smoke-001/batch-replay-aggregate-report.json --target-return-thresholds "0.15,0.30"
```

`batch-replay-runs.jsonl`과 같은 directory에 `batch-replay-selection-trials.jsonl`이 있으면 aggregate report CLI가 자동으로 읽어 `trialSummary`를 추가합니다. 다른 위치의 trial log를 사용해야 하면 `--selection-trials-path`로 명시합니다.

새로 생성되는 batch run record의 `summary.costSummary`는 single `HistoricalReplayReport.costSummary`에서 가져온 fee, tax, slippage, spread, market impact, total cost, fill count, participation rate, cost model version을 보관합니다. Aggregate report는 이 값을 `overall.costSummary`, `byRegime.*.costSummary`, `byValidationSplitRole.*.costSummary`로 합산합니다. `summary.costSummary`가 없는 legacy run record는 비용 sample에서 제외되며, replay research report는 cost sample이 하나도 없을 때만 `costBreakdown.status="unavailable"` warning을 남깁니다.

Aggregate report는 `overall`, `byRegime.*`, `byValidationSplitRole.*` group summary마다 같은 group return sample을 기준으로 `sharpeValidation`을 생성합니다. 이 field는 lag 5까지의 autocorrelation diagnostic, sample size warning, non-IID warning, Lo-style adjusted Sharpe, benchmark가 없는 PSR `not_applicable` 상태, 아직 계산하지 않는 DSR 상태를 read-only 검증 지표로 기록합니다. 기존 저장 artifact에는 이 field가 없을 수 있으며, dashboard 표시 연결은 후속 PR 범위입니다.

`historical-universe-coverage.json`을 aggregate report에 포함하려면 `--universe-coverage-path`를 전달합니다. 지정하지 않아도 `batch-replay-runs.jsonl`과 같은 directory에 `historical-universe-coverage.json`이 있으면 자동으로 읽습니다.

```powershell
npm run historical:batch:report -- -- --runs-path data/batch-replay/batch-smoke-001/batch-replay-runs.jsonl --universe-coverage-path data/replay-2023-01-2026-05-yahoo-daily/historical-universe-coverage.json --output-path data/batch-replay/batch-smoke-001/batch-replay-aggregate-report.json
```

coverage summary는 `universeCoverage`에 저장되고, `status=insufficient` 또는 optional coverage gap이 있으면 `universe selection bias warning`을 함께 기록합니다. 이 값은 완료된 paper-only artifact를 해석하기 위한 read-only 경고이며 strategy 자동 선택, live signal, 주문 생성으로 연결하지 않습니다.

`validationSplit`이 포함된 run record가 있으면 aggregate report는 `summary.validationSplitRoleCounts`와 `byValidationSplitRole`을 함께 생성합니다. 이 값은 이미 실행된 paper-only 결과를 train/validation/test 역할별로 분리해 보는 사후 분석 metadata이며, strategy 자동 선택이나 live trading signal로 사용하지 않습니다.

selection trial log와 validation split metadata가 함께 있으면 aggregate report는 `overfittingDiagnostics`도 생성합니다. 이 진단은 selection candidate를 provider/provider metadata/prompt/risk/allocation/market-regime allocation/exit/risk profile 조합으로 묶고, train/validation/test role별 return metric matrix와 `splitId:splitRole`별 metric을 만든 뒤 train return sample이 있는 candidate가 2개 이상일 때 train에서 가장 높은 평균 return을 가진 candidate가 비교 가능한 validation/test holdout split에서 median 아래로 떨어지는 비율을 `pboLikeScore`로 기록합니다. holdout return이 median과 같으면 동률로 보고 below-median으로 계산하지 않습니다. `configHash`는 replay window와 initial portfolio까지 포함할 수 있으므로 candidate key에는 쓰지 않고, matrix row의 `configHashes`에 관측값 목록으로 남깁니다. 이는 sampled CPCV/PBO-like 사후 경고 지표이며, Bailey PBO 또는 full CPCV의 엄밀한 구현이라고 해석하지 않습니다.

예상 sampled CPCV split 수를 검증하려면 report CLI에 `--expected-sampled-cpcv-split-count`를 전달합니다.
이 값을 전달했는데 selection trial log가 없으면 `overfittingDiagnostics`를 생성해 actual split count `0`과 mismatch warning을 기록합니다.

```powershell
npm run historical:batch:report -- -- --runs-path data/batch-replay/batch-smoke-001/batch-replay-runs.jsonl --output-path data/batch-replay/batch-smoke-001/batch-replay-aggregate-report.json --expected-sampled-cpcv-split-count 3
```

`overfittingDiagnostics`의 주요 필드:

- `sampledCpcvSplitCount`: `splitId:splitRole` 조합 기준으로 관측된 sampled split 수
- `sampledCpcvSplitCountMatchesExpected`: expected count를 전달한 경우 actual과 일치하는지 여부
- `splitMetricMatrix`: candidate별 provider metadata hash, train/validation/test 및 `splitId:splitRole` return sample count, average, median, run ID, 관측 `configHashes`
- `selectedCandidateKey`: train role 평균 return 기준으로 선택된 candidate key
- `holdoutDegradation`: selected candidate의 validation/test holdout split별 average, rank, 같은 split의 train metric 우선 기준 degradation
- `pboLikeScore`: train return sample이 있는 candidate가 2개 이상일 때 selected candidate가 return sample이 2개 이상인 holdout split에서 median 아래로 떨어진 비율
- `warnings`: candidate 수, train/holdout sample, split count가 부족하거나 일부 holdout split이 unscored로 제외될 때의 경고

집계 report는 다음 정보를 포함합니다.

- 전체 run 수, completed/skipped/failed count
- selection trial 수, selected/unselected count, status count
- sampled CPCV/PBO-like overfitting diagnostics와 warning
- prompt/config/risk/exit hash별 trial distribution
- provider failure, risk reject, no-trade trial count
- return sample이 있는 completed run 수
- 전체 및 regime별 평균/중앙값/min/max paper return ratio
- 전체 및 regime별 win rate
- 전체 및 regime별 advanced performance metric summary와 sample warning
- 전체 및 regime별 target return threshold hit-rate
- 전체 및 market별 regime count
- validation split role count
- final virtual net worth 평균
- split role별 평균/중앙값/min/max paper return ratio와 run ID 목록
- 전체 및 regime별 평균 exposure ratio, cash ratio, time-in-market ratio
- final cash ratio, final position ratio 평균
- trade/rejected count 요약
- Codex provider 호출 실패 count 요약
- meaningful reject count와 dust/no-op reject count 분리
- 집계에 포함된 run ID 목록

Run-level `historical-replay-report.json`의 portfolio construction metric:

- `avgExposureRatio`: timeline snapshot별 `positionMarketValueKrw / virtualNetWorthKrw` 평균
- `avgCashRatio`: timeline snapshot별 `cashKrw / virtualNetWorthKrw` 평균
- `maxExposureRatio`, `minExposureRatio`
- `timeInMarketRatio`: exposure ratio가 `0.05`를 초과한 snapshot 비율
- `finalCashRatio`, `finalPositionRatio`

`cashDragApproxKrw`는 아직 report에 넣지 않습니다. 기준 benchmark와 재투자 가정에 따라 값이 크게 달라질 수 있어, 부정확한 placeholder 대신 후속 PR에서 별도 정의한 뒤 추가합니다.

이 report는 이미 완료된 paper-only batch run record와 selection trial log를 읽는 사후 분석 도구입니다. replay 실행, Codex CLI AI 호출, 외부 데이터 수집, broker API 호출, 주문 생성은 수행하지 않습니다.

집계된 수익률과 target return hit-rate는 paper-only 시뮬레이션 결과를 요약한 값입니다. 투자 조언, 수익률 보장, 실계좌 성과, live trading signal로 해석하면 안 됩니다.

Dashboard는 `--data-dir`로 지정된 directory의 `batch-replay-aggregate-report.json`을 `/batch/replay/report`에서 read-only로 조회합니다. batch output directory를 dashboard data dir로 지정하면 반복 리플레이 요약과 장세별 결과를 확인할 수 있습니다.

## Lookahead Guard

Historical replay는 simulated time 이후 데이터를 현재 packet에 넣지 않습니다.

적용된 guard:

- `FileHistoricalMarketSnapshotStore.readUpTo`는 `asOf` 이후 snapshot을 제외합니다.
- `HistoricalMarketPacketBuilder`는 `snapshot.observedAt > simulatedAt`이면 candidate에서 제외하고 warning을 남깁니다.
- `runHistoricalReplay`와 `runCodexHistoricalReplay`는 `SimulatedClock` tick만 기준으로 packet을 생성합니다.
- Codex historical prompt는 `packet.generatedAt` 이후 데이터 사용, 미래 가격, 미래 뉴스, 미래 체결, 미래 포트폴리오 상태 사용을 금지합니다.
- sampling skip은 portfolio를 변경하지 않습니다.

## Safety Boundary

- 실주문을 만들지 않습니다.
- live `TradingSignal` 또는 live `OrderIntent`를 생성하지 않습니다.
- dashboard는 replay를 실행하지 않고 `/replay/report`를 조회만 합니다.
- raw `codex exec` MCP tool을 노출하지 않습니다.
- raw `tossctl` MCP tool을 노출하지 않습니다.
- `CodexHistoricalReplayDecisionProvider` 결과는 paper-only `VirtualDecision`으로만 처리합니다.
- 모든 가상 주문은 `VirtualRiskEngine`을 통과해야 합니다.
- provider failure, timeout, packet mismatch는 paper order 없이 audit event와 timeline만 남깁니다.
- batch replay는 완료된 replay 내부의 provider failure를 `aiDecisionFailureCount`로 집계합니다. replay workflow 자체가 throw한 경우만 run `failed`로 기록합니다.

## Dashboard

```powershell
npm run dashboard -- --data-dir data/paper
```

Dashboard는 저장된 `historical-replay-report.json`을 `/replay/report`로 조회하고, 저장된 `batch-replay-aggregate-report.json`을 `/batch/replay/report`로 조회합니다. 조회 endpoint는 `GET`/`HEAD`만 허용되며 replay 실행 버튼을 제공하지 않습니다.
