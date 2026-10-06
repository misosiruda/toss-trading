# Short-Term Liquidity Stress Validation 계획

이 문서는 `short_term` paper-only historical replay에서 volume participation cap과 minimum liquidity fill ratio가 partial fill과 no-fill을 만드는지 검증하기 위한 사전 고정 계획이다.

이 검증은 특정 종목 판단, 투자 조언, 성과 보장 또는 live trading signal이 아니다. Stress ratio는 실제 시장 체결 가능성 추정치가 아니라 deterministic execution path를 확인하기 위한 보수적 paper-only fixture다.

## 검증 목적

- `maxVolumeParticipationRate`가 낮아질 때 기존 deterministic liquidity model이 requested notional을 제한하는지 확인한다.
- 같은 participation cap에서 `minLiquidityFillRatio`만 높였을 때 partial fill 대신 `VIRTUAL_LIQUIDITY_INSUFFICIENT` no-fill이 증가하는지 확인한다.
- liquidity policy가 run metadata와 `costModelHash`에 고정되고 scenario 간 assignment가 동일한지 확인한다.
- execution path 변화와 return 변화를 분리해 해석하고, liquidity stress 결과로 strategy 우열이나 parameter winner를 선택하지 않는다.

## 근거 관측

사전 기준은 `strategy-bucket-short_term-sensitivity-baseline-v5-20260713-001`의 9개 assignment와 288개 trade다.

| Metric | 관측값 |
| --- | ---: |
| Partial fill | 0 |
| Not-modeled liquidity | 0 |
| Max participation rate | 0.000243 |
| Participation `0 < p <= 0.00001` | 92 |
| Participation `0.00001 < p <= 0.00002` | 11 |
| Participation `0.00002 < p <= 0.0001` | 3 |
| Participation `p > 0.0001` | 2 |

이 분포는 scenario threshold를 고르기 위한 historical artifact 관측일 뿐이다. Stress 실행에서는 fill/reject가 후속 cash, position, risk decision을 바꾸므로 같은 건수가 재현된다고 가정하지 않는다.

## 고정 입력

모든 scenario는 아래 입력을 공유한다.

| 항목 | 값 |
| --- | --- |
| Preset | `short_term` |
| Provider | `deterministic_fixture` |
| Assignment | scenario별 9, train/validation/test 각 3 |
| Source | `data/replay-2023-01-2026-05-global-broad-yahoo-daily` |
| Universe | `docs/historical-universe.global-broad.json` |
| Validation splits | `data/validation-splits/strategy-bucket-validation-assignments.json` |
| Seed | `strategy-bucket-validation-research-20260713-001-short_term` |
| Fee | 10 bps |
| Tax | 20 bps |
| Slippage | 5 bps |
| Half-spread | 0 bps |
| Market impact coefficient | 5,000 |
| Safety | `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only` |

`--use-codex-ai`는 사용하지 않는다. Source의 `volume`과 tick 이전 window에서 계산되는 `averageVolume`만 사용하며 synthetic volume, order book 또는 broker data를 만들지 않는다.

## 사전 고정 Scenario

| Scenario | Max participation | Minimum fill ratio | 의도 |
| --- | ---: | ---: | --- |
| `control` | 0.1 | 0.1 | 기존 default liquidity policy control |
| `cap-1e-5-min-0.1` | 0.00001 | 0.1 | 낮은 cap에서 partial fill과 극단 participation no-fill 동시 관측 |
| `cap-1e-5-min-0.5` | 0.00001 | 0.5 | 같은 cap에서 minimum fill gate 강화 효과 격리 |

Scenario 값은 결과 확인 후 변경하지 않는다. Fixture 유효성 gate를 충족하지 못하면 결과를 유리하게 만들기 위해 threshold를 조정하지 않고, 실패 원인과 새 사전 계획을 별도 PR로 기록한다.

## 예상 동작

Requested participation을 `p`, max participation을 `c`, minimum fill ratio를 `m`이라고 하면 현재 model의 핵심 분기는 다음과 같다.

1. `p <= c`이면 full fill 대상이다.
2. `p > c`이고 `c / p >= m`이면 partial fill 대상이다.
3. `p > c`이고 `c / p < m`이면 trade를 만들지 않고 `VIRTUAL_LIQUIDITY_INSUFFICIENT`를 기록한다.

Baseline path에 이 규칙만 정적으로 적용하면 `cap-1e-5-min-0.1`은 `p > 0.0001`, `cap-1e-5-min-0.5`는 `p > 0.00002`에서 no-fill 후보가 생긴다. 이는 sanity check이며 실제 성공 건수 예측이나 성과 가정이 아니다.

## 측정 항목

### 실행 무결성

- completed, skipped, failed count
- scenario별 `assignmentId`, split role, window start/end parity
- run metadata의 `maxVolumeParticipationRate`, `minLiquidityFillRatio`
- scenario별 `costModelHash`
- AI decision failure count
- universe coverage와 `notModeledLiquidityCount`

### Liquidity 결과

- aggregate report `costSummary.filledCount`
- aggregate report `costSummary.partialFillCount`
- aggregate report `costSummary.maxParticipationRate`
- run별 `riskSummary.rejectCodes.VIRTUAL_LIQUIDITY_INSUFFICIENT` 합계
- trade artifact의 requested notional, filled notional, fill ratio 분포
- split role별 partial fill과 no-fill 분포

No-fill은 `VirtualTrade`를 만들지 않으므로 `tradeCount - filledCount`로 추정하지 않는다. `historical-replay-report.json`의 reject code 또는 원본 `historical-replay-risk-decisions.jsonl`을 기준으로 집계한다.

### Path 및 비용 결과

- trade count와 meaningful reject count
- fee, tax, slippage, impact component
- train/validation/test별 total return과 cost drag
- scenario별 cash, exposure, max drawdown 변화

Return과 cost 차이는 liquidity policy가 trade path를 바꾼 결과를 포함한다. 기존 trade 목록에 비용만 사후 적용한 정적 비교로 해석하지 않는다.

## 판정 Gate

### Fixture 유효

다음을 모두 만족해야 liquidity stress fixture가 유효하다.

- 모든 scenario가 completed 9, skipped 0, failed 0이다.
- assignment와 고정 입력이 scenario 간 일치한다.
- `control`의 partial fill과 `VIRTUAL_LIQUIDITY_INSUFFICIENT`가 0이다.
- `cap-1e-5-min-0.1`에서 partial fill과 `VIRTUAL_LIQUIDITY_INSUFFICIENT`가 각각 1건 이상 발생한다.
- `cap-1e-5-min-0.5`의 `VIRTUAL_LIQUIDITY_INSUFFICIENT`가 `cap-1e-5-min-0.1`보다 적지 않다.
- `notModeledLiquidityCount`가 모든 scenario에서 0이다.

### Fixture 무효 또는 미결정

다음 중 하나라도 발생하면 return 비교 전에 fixture를 무효 또는 미결정으로 닫는다.

- scenario별 assignment 또는 execution policy가 다르다.
- stress scenario에서 partial fill 또는 no-fill이 발생하지 않는다.
- volume 부재로 liquidity가 `not_modeled`된다.
- failed/skipped run이나 AI/provider failure가 있다.
- path 변화 때문에 비교 가능한 split role이 사라진다.

Exact partial/no-fill count, return 방향 또는 impact cost 크기는 pass gate가 아니다.

## 실행 절차

각 scenario의 generated artifact는 `data/batch-replay/` 아래에만 저장하고 commit하지 않는다.

```powershell
$SourceDataDir = "data/replay-2023-01-2026-05-global-broad-yahoo-daily"
$OutputDir = "data/batch-replay"
$UniversePath = "docs/historical-universe.global-broad.json"
$ValidationSplitsPath = "data/validation-splits/strategy-bucket-validation-assignments.json"
$RangeStart = "2023-01-01T00:00:00+09:00"
$RangeEnd = "2026-05-31T23:59:59.999+09:00"
$Seed = "strategy-bucket-validation-research-20260713-001-short_term"

$Scenarios = @(
  @{ Name = "control"; BatchSlug = "control"; MaxParticipation = 0.1; MinFill = 0.1 },
  @{ Name = "cap-1e-5-min-0.1"; BatchSlug = "cap-1e-5-min-0_1"; MaxParticipation = 0.00001; MinFill = 0.1 },
  @{ Name = "cap-1e-5-min-0.5"; BatchSlug = "cap-1e-5-min-0_5"; MaxParticipation = 0.00001; MinFill = 0.5 }
)

foreach ($Scenario in $Scenarios) {
  $BatchId = "strategy-bucket-short_term-liquidity-$($Scenario.BatchSlug)-20260713-001"
  node dist/cli/historicalBatchReplay.js --source-data-dir $SourceDataDir --output-dir $OutputDir --batch-id $BatchId --seed $Seed --runs 9 --random-window-from $RangeStart --random-window-to $RangeEnd --strategy-preset short_term --universe-path $UniversePath --window-sampling balanced_regime --target-regimes "bull,bear,sideways,mixed" --validation-splits-path $ValidationSplitsPath --paper-fee-bps 10 --paper-tax-bps 20 --paper-slippage-bps 5 --paper-half-spread-bps 0 --paper-market-impact-bps-per-participation-rate 5000 --paper-max-volume-participation-rate $Scenario.MaxParticipation --paper-min-liquidity-fill-ratio $Scenario.MinFill

  node dist/cli/historicalBatchReport.js --runs-path "$OutputDir/$BatchId/batch-replay-runs.jsonl" --universe-coverage-path "$SourceDataDir/historical-universe-coverage.json" --expected-sampled-cpcv-split-count 9 --output-path "$OutputDir/$BatchId/batch-replay-aggregate-report.json"
}
```

실행 전 `npm run build`를 통과해야 한다. 결과 PR에는 실제 명령, scenario별 metadata/hash, gate 판정, 한계와 generated artifact 비포함 여부를 기록한다.

## Safety Boundary

- Paper-only historical replay만 실행한다.
- Live order, broker mutation, natural language order, `place_order`를 추가하거나 실행하지 않는다.
- Raw `codex exec` 또는 raw `tossctl` surface를 추가하거나 실행하지 않는다.
- AI는 사용하지 않으며 final sizing과 risk gate는 기존 deterministic backend가 담당한다.
- Stress ratio를 실제 시장 liquidity 또는 향후 체결 품질로 일반화하지 않는다.
- 결과로 특정 종목, strategy winner 또는 실거래 parameter를 추천하지 않는다.

## 후속 범위

이 문서가 merge된 뒤 별도 PR에서만 3개 scenario를 실행하고 결과를 기록한다. Sample/regime/PBO 확장, source cadence 변경, volatility-adjusted slippage, 실제 spread evidence는 해당 결과 PR에 포함하지 않는다.
