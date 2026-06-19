# Market Regime Allocation

이 문서는 historical paper replay에서 KR/US 시장 상태가 다를 때 market target exposure를 동적으로 재분배하는 opt-in 기능을 설명한다.

## 목적

국장은 하락 regime이고 미장은 상승 regime인 구간처럼 market별 상태가 다를 수 있다. `marketRegimeAllocationPolicy`는 replay tick마다 현재 시점까지 관측된 스냅샷만 사용해 market별 regime을 분류하고, 선택한 `PaperAllocationPolicy.targetExposureRatio` 안에서 KR/US target exposure를 재분배한다.

이 기능은 전체 투자 비중을 올리는 기능이 아니다. 전체 terminal target exposure, scheduled exposure ceiling, cash reserve, aggregate per-decision cap, symbol exposure cap은 기존 paper risk profile이 계속 결정한다. 이 정책은 그 안에서 market별 추가 매수 cap만 조정한다.

## CLI

```powershell
npm run historical:batch:replay:dry -- -- --source-data-dir data/replay-2023-01-2026-05-yahoo-daily --output-dir data/batch-replay --batch-id batch-regime-allocation-smoke --seed batch-seed-001 --runs 10 --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --window-months 1 --decision-frequency once_per_week --max-decision-calls 5 --step-seconds 604800 --max-snapshot-age-seconds 2678400 --min-window-snapshots 1 --risk-profile aggressive_paper --market-regime-allocation --market-regime-allocation-lookback-days 20
```

옵션:

- `--market-regime-allocation`: market regime 기반 target 재분배를 활성화한다.
- `--market-regime-allocation-lookback-days`: 각 tick에서 과거 며칠을 볼지 정한다. 기본값은 `20`이다.
- `--market-regime-min-symbols`: market별 regime 분류에 필요한 최소 symbol 수다. 기본값은 `1`이다.
- `--market-regime-min-snapshots-per-symbol`: symbol별 최소 snapshot 수다. 기본값은 `2`다.

## 기본 Weight

```text
bull              1.4
mixed             1.0
sideways          0.8
insufficient_data 0.5
bear              0.35
```

예를 들어 `targetExposureRatio=0.85`이고 KR은 `bear`, US는 `bull`이면 KR/US weight를 정규화해서 합계가 `0.85`가 되도록 `marketTargetExposureRatios`를 만든다.

## Lookahead 방지

각 replay tick의 target 계산은 다음 window만 사용한다.

```text
windowStart = simulatedAt - lookbackDays
windowEnd   = simulatedAt
```

선택된 1개월 replay window 안에 있더라도 `simulatedAt` 이후의 snapshot은 regime allocation 계산에 사용하지 않는다.

## 저장되는 로그

- `batch-replay-manifest.json`: `marketRegimeAllocationPolicy`를 기록한다.
- `historical-replay-run-metadata.json`: run별 `marketRegimeAllocationPolicy`를 기록한다.
- `MarketPacket.portfolioAllocation.marketTargetExposureRatios`: tick별로 계산된 KR/US terminal target exposure ratio를 포함한다.
- `MarketPacket.portfolioAllocation.marketAllocations`: market별 현재 exposure, scheduled target gap, 추가 매수 cap을 포함한다.

## Safety Boundary

이 기능은 historical paper replay packet 생성에만 적용된다.

- live `TradingSignal`을 만들지 않는다.
- live `OrderIntent`로 전파하지 않는다.
- live `RiskEngine` 결정을 대체하지 않는다.
- 실계좌 주문 경로를 열지 않는다.
- 수익률 보장이나 투자 조언으로 해석하면 안 된다.
