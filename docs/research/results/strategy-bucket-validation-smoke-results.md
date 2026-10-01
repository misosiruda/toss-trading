# Strategy Bucket Validation Smoke Results

이 문서는 `Strategy Bucket Validation Runbook`의 deterministic smoke matrix를 2026-07-10에 실행한 결과를 기록한다. 범위는 paper-only historical replay 실행 chain, coverage preflight, aggregate report 생성 여부 확인이다.

이 문서는 특정 전략, 종목, 투자 행동, 수익 가능성을 추천하지 않는다. 실거래 주문, broker mutation, raw `codex exec`, raw `tossctl`, natural language order, `place_order` surface는 실행하거나 추가하지 않았다. AI provider도 사용하지 않았으며 final sizing과 gate는 deterministic backend와 Risk Engine 경계를 따른다.

## 실행 범위

| 항목 | 값 |
| --- | --- |
| Run scope | `smoke` |
| Source data | `data/replay-2023-01-2026-05-global-broad-yahoo-daily` |
| Universe | `docs/historical-universe.global-broad.json` |
| Range | `2023-01-01T00:00:00+09:00` to `2026-05-31T23:59:59.999+09:00` |
| Seed family | `strategy-bucket-validation-smoke-20260710-002` |
| Runs per preset | `4` |
| Target regimes | `bull,bear,sideways,mixed` |
| Provider | `deterministic_fixture` |
| Generated artifacts | local `data/`, not committed |

Safe runtime boundary:

```powershell
$env:BROKER_PROVIDER = "mock"
$env:TRADING_ENABLED = "false"
$env:AI_DECISION_MODE = "paper_only"
```

실행 command:

```powershell
$SourceDataDir = "data/replay-2023-01-2026-05-global-broad-yahoo-daily"
$OutputDir = "data/batch-replay"
$UniversePath = "docs/historical-universe.global-broad.json"
$RangeStart = "2023-01-01T00:00:00+09:00"
$RangeEnd = "2026-05-31T23:59:59.999+09:00"
$RunCount = 4
$Seed = "strategy-bucket-validation-smoke-20260710-002"
$TargetRegimes = "bull,bear,sideways,mixed"
$Presets = @("long_term", "swing", "short_term", "intraday", "hedge")

foreach ($Preset in $Presets) {
  $BatchId = "strategy-bucket-$Preset-smoke-20260710-002"

  npm run historical:batch:replay:dry -- -- --source-data-dir $SourceDataDir --output-dir $OutputDir --batch-id $BatchId --seed "$Seed-$Preset" --runs $RunCount --random-window-from $RangeStart --random-window-to $RangeEnd --strategy-preset $Preset --universe-path $UniversePath --window-sampling balanced_regime --target-regimes $TargetRegimes
}

foreach ($Preset in $Presets) {
  $BatchId = "strategy-bucket-$Preset-smoke-20260710-002"
  $BatchDir = "$OutputDir/$BatchId"

  npm run historical:batch:report -- -- --runs-path "$BatchDir/batch-replay-runs.jsonl" --universe-coverage-path "$SourceDataDir/historical-universe-coverage.json" --output-path "$BatchDir/batch-replay-aggregate-report.json"
}
```

## Preflight

작업 시작 시 `npm run check`를 먼저 실행했고 build와 Node test suite가 통과했다.

기존 local replay data에 대해 coverage를 먼저 확인했을 때는 `strategyBucket` snapshot metadata가 없어 coverage가 `insufficient`로 닫혔다. 이 상태에서는 bucket 결과를 만들지 않는 것이 fail-closed 기준이다.

현재 코드로 ignored `data/` artifact를 재생성한 뒤 coverage를 다시 확인했다.

```powershell
npm run historical:yahoo:ingest -- -- --data-dir data/replay-2023-01-2026-05-global-broad-yahoo-daily --universe-path docs/historical-universe.global-broad.json --range-start 2023-01-01T00:00:00+09:00 --range-end 2026-05-31T23:59:59.999+09:00 --allow-partial --json
```

재생성 결과:

| 항목 | 값 |
| --- | ---: |
| Status | `completed_with_failures` |
| Snapshot count | `177711` |
| Failed optional symbols | `2` |

이후 coverage report는 `available`로 바뀌었다.

```powershell
npm run historical:universe:coverage -- -- --data-dir data/replay-2023-01-2026-05-global-broad-yahoo-daily --universe-path docs/historical-universe.global-broad.json --range-start 2023-01-01T00:00:00+09:00 --range-end 2026-05-31T23:59:59.999+09:00 --min-monthly-coverage-ratio 1 --min-snapshots-per-symbol 1 --require-markets 'KR,US' --require-asset-types 'STOCK,ETF' --require-strategy-buckets 'long_term,swing,short_term,intraday,hedge' --min-available-symbols 120 --min-available-market-symbols 'KR:50,US:50' --min-available-asset-type-symbols 'STOCK:80,ETF:30' --min-available-strategy-bucket-symbols 'long_term:1,swing:1,short_term:1,intraday:1,hedge:1' --output-path "data/replay-2023-01-2026-05-global-broad-yahoo-daily/historical-universe-coverage.json"
```

| Coverage field | 값 |
| --- | ---: |
| Expected months | `41` |
| Universe symbols | `214` |
| Available symbols | `211` |
| Available required symbols | `20 / 20` |
| Available optional symbols | `191 / 194` |
| KR symbols | `95` |
| US symbols | `116` |
| STOCK symbols | `131` |
| ETF symbols | `80` |
| `long_term` bucket symbols | `7` |
| `swing` bucket symbols | `6` |
| `short_term` bucket symbols | `3` |
| `intraday` bucket symbols | `1` |
| `hedge` bucket symbols | `3` |

주의:

- Optional coverage는 완전하지 않다.
- `KR:310970`, `US:SQ`는 optional missing으로 남았다.
- `KR:278240`은 optional insufficient coverage로 남았다.
- Coverage status는 `available`이지만 optional gap은 research 판정에서 계속 warning으로 취급한다.

## Command correction

처음 replay command를 PowerShell에서 unquoted `target-regimes` 값으로 실행했을 때 쉼표 값이 별도 argument로 분해되어 CLI validation에서 실패했다. replay는 시작되지 않았다.

Runbook command는 `$TargetRegimes = "bull,bear,sideways,mixed"`를 사용하도록 정리했다. PowerShell에서는 쉼표가 포함된 CLI option 값을 quote 하거나 변수 문자열로 넘겨야 한다.

## Smoke 결과

각 preset은 `historical:batch:replay:dry`와 `historical:batch:report`를 순서대로 통과했다.

| Preset | Status | Completed | Skipped | Failed | Return samples | Provider | Risk profile | Regime counts |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| `long_term` | `inconclusive` | `4` | `0` | `0` | `4` | `deterministic_fixture` | `balanced` | bull `2`, sideways `1`, mixed `1` |
| `swing` | `inconclusive` | `4` | `0` | `0` | `4` | `deterministic_fixture` | `aggressive_paper` | bull `1`, bear `1`, sideways `1`, mixed `1` |
| `short_term` | `inconclusive` | `4` | `0` | `0` | `4` | `deterministic_fixture` | `aggressive_paper` | bull `1`, bear `1`, sideways `1`, mixed `1` |
| `intraday` | `inconclusive` | `4` | `0` | `0` | `4` | `deterministic_fixture` | `aggressive_paper` | bull `1`, bear `1`, sideways `1`, mixed `1` |
| `hedge` | `inconclusive` | `4` | `0` | `0` | `4` | `deterministic_fixture` | `balanced` | bull `1`, bear `1`, sideways `1`, mixed `1` |

`long_term` smoke에는 bear regime sample이 없었다. 다른 preset은 4개 target regime이 각각 1개씩 잡혔다. 다만 run count가 `4`이므로 이 결과는 command chain smoke일 뿐 research-valid 판정이 아니다.

## 공통 hard blocker

모든 preset의 aggregate report에서 다음 validation warning이 공통으로 남았다.

| 영역 | Status | Warning |
| --- | --- | --- |
| Sharpe validation | `unavailable` | `INSUFFICIENT_RETURN_SAMPLES`, `NON_IID_RETURN_SAMPLE`, `MULTIPLE_TESTING_CONTEXT_MISSING` |
| CPCV/PBO validation | `unavailable` | `CPCV_SAMPLED_MODE_USED`, `CPCV_SPLIT_PLAN_UNAVAILABLE`, `PBO_CANDIDATE_COUNT_INSUFFICIENT`, `PBO_HOLDOUT_MATRIX_INSUFFICIENT` |
| PBO | `insufficient_matrix` | holdout matrix 부족 |
| Validation split | unavailable | `validationSplitRoleCounts` empty |
| Triple Barrier/meta-label | unavailable | source artifact not provided |

따라서 2026-07-10 smoke 결과는 모든 bucket을 `inconclusive`로 기록한다. 현재 결과로는 strategy bucket 가정이 유효하다고 결론 낼 수 없다.

## Safety 확인

| 항목 | 결과 |
| --- | --- |
| `--use-codex-ai` | 사용하지 않음 |
| Provider failure trial count | `0` |
| `totalAiDecisionFailureCount` | `0` |
| Live order path | 실행하지 않음 |
| Broker mutation | 실행하지 않음 |
| Raw command surface 추가 | 없음 |
| Generated replay artifact commit | 없음 |

## 다음 paper-only 검증 조건

다음 단계에서 research 판정을 만들려면 최소한 아래 조건이 필요하다.

- validation split assignment artifact를 준비하고 train/validation/test role별 metric을 분리한다.
- run count를 smoke 수준보다 늘리고 target regime별 sample 부족을 닫는다.
- coverage warning을 source data artifact와 함께 다시 기록한다.
- Triple Barrier/meta-label artifact를 같은 batch 기준으로 생성하거나, 없으면 명시적으로 unavailable로 유지한다.
- short-term과 intraday는 cost, liquidity, partial fill, no-fill, source data cadence를 먼저 hard gate로 본다.
- hedge는 total return ranking이 아니라 hedge compliance, downside exposure, cost drag 중심으로 별도 해석한다.
