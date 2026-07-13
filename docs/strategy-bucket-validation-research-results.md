# Strategy Bucket Validation Research 결과

이 문서는 [Strategy Bucket Validation Protocol](strategy-bucket-validation-protocol.md)과 [실행 runbook](strategy-bucket-validation-runbook.md)에 따라 2026-07-13에 수행한 paper-only deterministic research matrix 결과를 기록한다.

이 결과는 특정 종목 판단, 투자 조언, 성과 보장, live trading signal이 아니다. generated replay artifact는 `data/` 아래에만 보관하며 PR에는 포함하지 않는다.

## 실행 범위

| 항목 | 값 |
| --- | --- |
| Provider | `deterministic_fixture` |
| Source | `data/replay-2023-01-2026-05-global-broad-yahoo-daily` |
| Universe | `docs/historical-universe.global-broad.json` |
| Range | `2023-01-01T00:00:00+09:00` to `2026-05-31T23:59:59.999+09:00` |
| Split | walk-forward 3개, train/validation/test 각 3개 |
| Run count | preset별 9, 전체 45 |
| Seed family | `strategy-bucket-validation-research-20260713-001` |
| Safety | `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only` |

`long_term`, `swing`, `short_term`, `intraday`, `hedge`만 실행했다. `regime_cash`, Codex provider matrix, Triple Barrier/meta-label 생성은 이번 범위에 포함하지 않았다.

## 입력 preflight

Universe coverage는 `available`이었다.

| Metric | 결과 |
| --- | --- |
| Universe symbols | 214 |
| Available symbols | 211 |
| Required symbols | 20/20 |
| Market coverage | KR 95, US 116 |
| Asset type coverage | STOCK 131, ETF 80 |
| Bucket metadata | `long_term` 7, `swing` 6, `short_term` 3, `intraday` 1, `hedge` 3 |
| Coverage issues | 없음 |
| Coverage warning | optional symbol coverage 191/194 |

Split artifact는 `validation_split_assignment.v1`로 생성됐다. split 3개와 assignment 9개가 있고 role count는 train 3, validation 3, test 3이다. `embargoDurationDays=5`이며 replay manifest와 aggregate report가 각 role을 보존했다.

## 실행 결과

모든 preset은 completed 9, skipped 0, failed 0이었다. AI decision failure도 0이었다.

| Preset | 판정 | Train 평균 | Validation 평균 | Test 평균 | Trades | Meaningful rejects |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `long_term` | `invalid_for_current_data_or_model` | 30.4812% | 2.0618% | 0.7182% | 151 | 43 |
| `swing` | `inconclusive` | 5.7802% | 5.1076% | 5.5507% | 167 | 30 |
| `short_term` | `inconclusive` | 4.8209% | 1.2243% | 4.3509% | 291 | 33 |
| `intraday` | `invalid_for_current_data_or_model` | 1.0680% | -0.1521% | 2.2131% | 237 | 354 |
| `hedge` | `inconclusive` | 11.1658% | 3.5752% | 2.0444% | 202 | 10 |

표의 return 값은 artifact 비교를 위한 paper-only metric이다. preset 간 순위 또는 향후 성과 기대를 뜻하지 않는다.

## 판정 근거

### 공통 blocker

- overall return sample은 preset별 9개이고 role별 sample은 3개다. Sharpe validation 최소 sample 30에 미달해 모든 preset이 `unavailable`이다.
- split 고정 실행에서는 `--window-sampling balanced_regime`가 적용되지 않고 `fixed_range`로 기록됐다. 모든 preset의 regime은 bull 7, mixed 2이며 bear와 sideways sample은 없다.
- CPCV/PBO artifact는 candidate row가 preset별 1개뿐이다. `PBO_CANDIDATE_COUNT_INSUFFICIENT`, `PBO_HOLDOUT_MATRIX_INSUFFICIENT`로 PBO가 `insufficient_matrix`다.
- fee, tax, slippage, spread, market impact를 합친 total cost가 모든 preset에서 0이다. 특히 `short_term`과 `intraday`의 cost-adjusted 가정을 검증할 수 없다.
- Triple Barrier와 meta-label artifact를 제공하지 않아 label/evaluation 상태를 검증하지 못했다.
- optional universe coverage 191/194 warning이 남아 있다. required symbol, market, asset type, bucket metadata hard requirement는 충족했다.

### `long_term`

train 평균 30.4812%가 validation 2.0618%, test 0.7182%로 크게 하락했다. protocol의 “train만 좋고 validation/test에서 붕괴” 조건에 해당하므로 현재 split과 deterministic fixture 기준 `invalid_for_current_data_or_model`로 닫는다. bull/mixed 편중과 sample 부족 때문에 원인을 일반화하지 않는다.

### `swing`

train, validation, test 평균 차이는 다른 preset보다 작았다. 그러나 sample 부족, bear/sideways 부재, zero cost, PBO matrix 부족이 모두 남아 있어 `research_valid_for_paper_followup` 또는 `conditional`로 올릴 수 없다. 판정은 `inconclusive`다.

### `short_term`

validation 평균이 train/test보다 낮고 291 trades로 비교 대상 중 거래 건수가 가장 많았다. 그런데 total cost가 0이고 daily source cadence만 사용했으므로 핵심 cost/execution 가정이 검증되지 않았다. 판정은 `inconclusive`다.

### `intraday`

daily fixture는 intraday cadence를 검증하는 입력으로 충분하지 않다. validation 평균은 -0.1521%였고 meaningful reject 354건이 trades 237건보다 많았다. zero cost와 daily cadence 조건까지 함께 고려하면 현재 data/model에서는 가정이 성립하지 않으므로 `invalid_for_current_data_or_model`로 닫는다.

### `hedge`

hedge는 total return ranking 대상이 아니며 downside exposure, hedge compliance, cost drag로 판단해야 한다. 이번 split에는 bear regime이 없고 total cost도 0이므로 핵심 가정을 평가할 수 없다. 판정은 `inconclusive`다.

## Safety 확인

| 항목 | 결과 |
| --- | --- |
| `--use-codex-ai` | 사용하지 않음 |
| Provider | `deterministic_fixture` |
| AI decision failure | 0 |
| Live order path | 실행하지 않음 |
| Broker mutation | 실행하지 않음 |
| Raw `codex exec` / raw `tossctl` | 실행하거나 추가하지 않음 |
| Generated artifact commit | 없음 |

## 실행 명령

```powershell
npm run historical:universe:coverage -- -- --data-dir $SourceDataDir --universe-path $UniversePath --range-start $RangeStart --range-end $RangeEnd --min-monthly-coverage-ratio 1 --min-snapshots-per-symbol 1 --require-markets 'KR,US' --require-asset-types 'STOCK,ETF' --require-strategy-buckets 'long_term,swing,short_term,intraday,hedge' --min-available-symbols 120 --min-available-market-symbols 'KR:50,US:50' --min-available-asset-type-symbols 'STOCK:80,ETF:30' --min-available-strategy-bucket-symbols 'long_term:1,swing:1,short_term:1,intraday:1,hedge:1' --output-path "$SourceDataDir/historical-universe-coverage.json"

npm run historical:validation:splits -- -- --range-start $RangeStart --range-end $RangeEnd --train-months 24 --validation-months 6 --test-months 3 --step-months 3 --timezone-offset-minutes 540 --embargo-duration-days 5 --output-path $ValidationSplitsPath

npm run historical:batch:replay:dry -- -- --source-data-dir $SourceDataDir --output-dir $OutputDir --batch-id $BatchId --seed "$Seed-$Preset" --runs 9 --random-window-from $RangeStart --random-window-to $RangeEnd --strategy-preset $Preset --universe-path $UniversePath --window-sampling balanced_regime --target-regimes $TargetRegimes --validation-splits-path $ValidationSplitsPath

npm run historical:batch:report -- -- --runs-path "$BatchDir/batch-replay-runs.jsonl" --universe-coverage-path "$SourceDataDir/historical-universe-coverage.json" --expected-sampled-cpcv-split-count 9 --output-path "$BatchDir/batch-replay-aggregate-report.json"
```

## 다음 검증 조건

- split role sample을 Sharpe validation 최소 30 이상으로 늘릴 수 있는 assignment 설계를 별도 검토한다.
- fixed split과 regime-balanced sampling을 동시에 만족시키는 검증 설계를 문서화한다.
- `short_term`과 `intraday`는 non-zero fee, tax, slippage, spread, market impact policy와 적합한 source cadence를 먼저 고정한다.
- PBO에는 같은 split에서 비교 가능한 candidate row 2개 이상을 제공한다.
- `hedge`는 bear/downside window와 hedge compliance, downside exposure, cost drag를 별도 matrix로 검증한다.
- Triple Barrier/meta-label은 동일 batch 기준 artifact가 준비될 때만 연결한다.

이 조건을 닫기 전에는 어떤 preset도 실거래 적용 후보 또는 성과가 검증된 전략으로 표현하지 않는다.
