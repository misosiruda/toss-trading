# Strategy Bucket Validation Runbook

이 문서는 [Strategy Bucket Validation Protocol](strategy-bucket-validation-protocol.md)을 실제 paper-only historical replay 명령으로 옮길 때 사용하는 실행 절차다.

범위는 실행 matrix와 확인 순서 문서화다. 이 문서는 실거래 주문, broker mutation, raw `codex exec`, raw `tossctl`, natural language order, `place_order` surface를 추가하지 않는다. 기본 실행은 deterministic fixture provider를 사용하며, Codex CLI provider는 기존 paper-only guarded provider 경로에서 명시적으로만 사용한다.

## 목적

각 strategy bucket을 같은 입력, 같은 output layout, 같은 aggregate report 절차로 반복 실행한다.

검증 대상:

- `long_term`
- `swing`
- `short_term`
- `intraday`
- `hedge`

별도 policy stress preset:

- `regime_cash`

`regime_cash`는 `StrategyReplayPresetName`이지만 `strategyBucket` enum은 아니다. bucket result matrix의 승자 후보가 아니라 market regime allocation과 dynamic cash reserve stress test로 본다.

## 실행 전 경계

실행 전 다음을 확인한다.

```powershell
git status --porcelain=v1 --branch
npm run check
```

Safe runtime boundary:

```powershell
$env:BROKER_PROVIDER = "mock"
$env:TRADING_ENABLED = "false"
$env:AI_DECISION_MODE = "paper_only"
```

기본 smoke matrix는 `--use-codex-ai`를 쓰지 않는다. 따라서 raw Codex command나 live order surface를 만들지 않는다.

Codex CLI provider를 검증하려면 이 runbook의 "Codex paper-only provider matrix" 절을 따르되, `AI_DECISION_ENABLED=true`와 기존 `--use-codex-ai` option을 사용한다. raw `codex exec`를 직접 실행하지 않는다.

## 입력 선택

현재 repo-local 예시는 broad global fixture를 기준으로 둔다.

```powershell
$SourceDataDir = "data/replay-2023-01-2026-05-global-broad-yahoo-daily"
$OutputDir = "data/batch-replay"
$UniversePath = "docs/historical-universe.global-broad.json"
$RangeStart = "2023-01-01T00:00:00+09:00"
$RangeEnd = "2026-05-31T23:59:59.999+09:00"
$TargetRegimes = "bull,bear,sideways,mixed"
```

`data/`는 gitignore 대상이다. generated replay artifact는 PR에 포함하지 않고, 필요한 결론만 별도 문서나 issue에 요약한다.

## Data coverage preflight

Broad universe coverage report가 없거나 오래된 경우 먼저 coverage를 갱신한다.

```powershell
npm run historical:universe:coverage -- -- --data-dir $SourceDataDir --universe-path $UniversePath --range-start $RangeStart --range-end $RangeEnd --min-monthly-coverage-ratio 1 --min-snapshots-per-symbol 1 --require-markets 'KR,US' --require-asset-types 'STOCK,ETF' --require-strategy-buckets 'long_term,swing,short_term,intraday,hedge' --min-available-symbols 120 --min-available-market-symbols 'KR:50,US:50' --min-available-asset-type-symbols 'STOCK:80,ETF:30' --min-available-strategy-bucket-symbols 'long_term:1,swing:1,short_term:1,intraday:1,hedge:1' --output-path "$SourceDataDir/historical-universe-coverage.json"
```

Coverage가 insufficient이면 bucket 결과를 만들지 않는다. `strategyBucket` metadata 부족, lifecycle gap, required market gap은 fail-closed로 취급한다.

## Deterministic smoke matrix

이 matrix는 "명령과 artifact chain이 작동하는가"를 확인하는 최소 smoke다. Research-valid 판정을 내리기 위한 충분 조건이 아니다.

Smoke 기본값:

```powershell
$RunCount = 4
$Seed = "strategy-bucket-validation-smoke-001"
$Presets = @("long_term", "swing", "short_term", "intraday", "hedge")
```

각 bucket replay:

```powershell
foreach ($Preset in $Presets) {
  $BatchId = "strategy-bucket-$Preset-smoke-001"

  npm run historical:batch:replay:dry -- -- --source-data-dir $SourceDataDir --output-dir $OutputDir --batch-id $BatchId --seed "$Seed-$Preset" --runs $RunCount --random-window-from $RangeStart --random-window-to $RangeEnd --strategy-preset $Preset --universe-path $UniversePath --window-sampling balanced_regime --target-regimes $TargetRegimes
}
```

각 bucket aggregate report:

```powershell
foreach ($Preset in $Presets) {
  $BatchId = "strategy-bucket-$Preset-smoke-001"
  $BatchDir = "$OutputDir/$BatchId"

  npm run historical:batch:report -- -- --runs-path "$BatchDir/batch-replay-runs.jsonl" --universe-coverage-path "$SourceDataDir/historical-universe-coverage.json" --output-path "$BatchDir/batch-replay-aggregate-report.json"
}
```

Smoke 통과 조건:

| 조건 | 통과 기준 |
| --- | --- |
| Batch replay command | 모든 preset에서 command가 process error 없이 종료 |
| `batch-replay-runs.jsonl` | 각 batch directory에 생성 |
| Aggregate report command | `--runs-path` 기반으로 실행되고 JSON report 생성 |
| Source coverage | `universeCoverage.status`가 insufficient이면 결론을 닫음 |
| Safety boundary | live order, broker mutation, raw command surface 없음 |

Smoke에서 실패하면 strategy 가정 평가로 넘어가지 않는다.

## Research matrix

Research matrix는 smoke보다 긴 run count와 split artifact를 요구한다. `--validation-splits-path`를 사용할 때 `--runs` 값은 assignment 수와 같아야 한다.

권장 입력:

```powershell
$RunCount = 9
$Seed = "strategy-bucket-validation-research-001"
$ValidationSplitsPath = "data/validation-splits/strategy-bucket-validation-assignments.json"
$PaperFeeBps = 10
$PaperTaxBps = 20
$PaperSlippageBps = 5
$PaperMarketImpactBpsPerParticipationRate = 500
```

Split artifact 생성:

```powershell
npm run historical:validation:splits -- -- --range-start $RangeStart --range-end $RangeEnd --train-months 24 --validation-months 6 --test-months 3 --step-months 3 --timezone-offset-minutes 540 --embargo-duration-days 5 --output-path $ValidationSplitsPath
```

Split artifact가 준비된 경우:

```powershell
foreach ($Preset in $Presets) {
  $BatchId = "strategy-bucket-$Preset-research-001"

  npm run historical:batch:replay:dry -- -- --source-data-dir $SourceDataDir --output-dir $OutputDir --batch-id $BatchId --seed "$Seed-$Preset" --runs $RunCount --random-window-from $RangeStart --random-window-to $RangeEnd --strategy-preset $Preset --universe-path $UniversePath --window-sampling balanced_regime --target-regimes $TargetRegimes --validation-splits-path $ValidationSplitsPath --paper-fee-bps $PaperFeeBps --paper-tax-bps $PaperTaxBps --paper-slippage-bps $PaperSlippageBps --paper-market-impact-bps-per-participation-rate $PaperMarketImpactBpsPerParticipationRate
}
```

비용 값은 paper-only validation fixture다. 실제 broker fee 또는 향후 성과를 나타내지 않는다. `short_term`과 `intraday`는 total cost가 0인 결과를 research-valid 근거로 사용하지 않는다.

Research aggregate report:

```powershell
foreach ($Preset in $Presets) {
  $BatchId = "strategy-bucket-$Preset-research-001"
  $BatchDir = "$OutputDir/$BatchId"

  npm run historical:batch:report -- -- --runs-path "$BatchDir/batch-replay-runs.jsonl" --universe-coverage-path "$SourceDataDir/historical-universe-coverage.json" --expected-sampled-cpcv-split-count $RunCount --output-path "$BatchDir/batch-replay-aggregate-report.json"
}
```

Research 판정은 protocol의 `research_valid_for_paper_followup`, `conditional`, `invalid_for_current_data_or_model`, `inconclusive` 중 하나로만 기록한다. 특정 종목 판단, 매매 권유, 성과 약속 문구는 쓰지 않는다.

2026-07-13 deterministic research matrix의 입력, 결과, blocker와 판정은 [Strategy Bucket Validation Research 결과](strategy-bucket-validation-research-results.md)에 기록한다.

## `regime_cash` policy stress

`regime_cash`는 bucket 비교 matrix에 넣지 않는다. 별도 portfolio policy stress로 실행한다.

```powershell
$BatchId = "strategy-bucket-regime-cash-stress-001"

npm run historical:batch:replay:dry -- -- --source-data-dir $SourceDataDir --output-dir $OutputDir --batch-id $BatchId --seed "strategy-bucket-regime-cash-stress-001" --runs 8 --random-window-from $RangeStart --random-window-to $RangeEnd --strategy-preset regime_cash --universe-path $UniversePath --window-sampling balanced_regime --target-regimes $TargetRegimes

npm run historical:batch:report -- -- --runs-path "$OutputDir/$BatchId/batch-replay-runs.jsonl" --universe-coverage-path "$SourceDataDir/historical-universe-coverage.json" --output-path "$OutputDir/$BatchId/batch-replay-aggregate-report.json"
```

확인 항목:

- `marketRegime`
- `marketRegimesByMarket`
- dynamic cash reserve status
- cash gap
- tail loss
- max drawdown
- cost drag

## Codex paper-only provider matrix

Codex CLI provider 검증은 별도 matrix로 분리한다. deterministic smoke matrix와 섞지 않는다.

필수 환경:

```powershell
$env:AI_DECISION_MODE = "paper_only"
$env:AI_DECISION_ENABLED = "true"
```

작은 call budget으로 한 bucket만 먼저 확인한다. 이 smoke는 provider output path 확인이 목적이므로 replay sampling call cap과 Codex provider call cap을 같은 값으로 맞춘다.

```powershell
$Preset = "swing"
$BatchId = "strategy-bucket-$Preset-codex-paper-smoke-001"

npm run historical:batch:replay -- -- --use-codex-ai --source-data-dir $SourceDataDir --output-dir $OutputDir --batch-id $BatchId --seed "strategy-bucket-codex-paper-smoke-001" --runs 2 --random-window-from $RangeStart --random-window-to $RangeEnd --strategy-preset $Preset --universe-path $UniversePath --window-sampling balanced_regime --target-regimes $TargetRegimes --max-decision-calls 2 --max-codex-calls-per-run 2

npm run historical:batch:report -- -- --runs-path "$OutputDir/$BatchId/batch-replay-runs.jsonl" --universe-coverage-path "$SourceDataDir/historical-universe-coverage.json" --output-path "$OutputDir/$BatchId/batch-replay-aggregate-report.json"
```

Codex provider 결과는 AI evidence proposal 검증이다. final sizing, cash reserve, exposure, lifecycle, risk gate는 deterministic backend 결과를 기준으로 해석한다.

## 판정 checklist

각 batch report를 열고 다음을 기록한다.

| 영역 | 확인할 field |
| --- | --- |
| Run status | completed, skipped, failed count |
| Regime | byRegime, unavailable target regime |
| Split | validationSplitRoleCounts, byValidationSplitRole |
| Cost | costSummary, costSummary.byStrategyBucket |
| Liquidity | partial fill, no-fill, max participation rate |
| Risk | risk reject rate, reject code distribution |
| Sharpe | sharpeValidation status, warning code |
| CPCV/PBO | cpcvPboValidation status, PBO status, warning code |
| Triple Barrier/meta-label | label distribution, meta-label evaluation warning |
| Provider | provider failure count and rate |

Hard blocker가 있으면 performance metric을 우선하지 않는다.

## 결과 요약 template

```markdown
## Strategy bucket validation run

- Run scope: smoke | research | codex_paper_only_smoke
- Source data: `<SourceDataDir>`
- Universe: `<UniversePath>`
- Seed: `<Seed>`
- Presets: `long_term`, `swing`, `short_term`, `intraday`, `hedge`
- Generated artifacts: local `data/batch-replay`, not committed
- Global blocker: none | `<blocker>`

| Preset | Status | Completed | Skipped | Failed | Primary blocker | Follow-up |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `long_term` | `inconclusive` | `<n>` | `<n>` | `<n>` | `<code>` | `<paper-only next step>` |
| `swing` | `inconclusive` | `<n>` | `<n>` | `<n>` | `<code>` | `<paper-only next step>` |
| `short_term` | `inconclusive` | `<n>` | `<n>` | `<n>` | `<code>` | `<paper-only next step>` |
| `intraday` | `inconclusive` | `<n>` | `<n>` | `<n>` | `<code>` | `<paper-only next step>` |
| `hedge` | `inconclusive` | `<n>` | `<n>` | `<n>` | `<code>` | `<paper-only next step>` |
```

Status는 protocol의 네 가지 research 상태만 사용한다. "추천", "매수", "매도", "성과 기대" 같은 표현은 쓰지 않는다.
