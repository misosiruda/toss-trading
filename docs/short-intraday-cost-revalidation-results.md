# Short-Term And Intraday Cost Revalidation 결과

이 문서는 2026-07-13 strategy bucket deterministic research matrix의 zero-cost blocker를 확인하기 위해 수행한 `short_term`, `intraday` paired paper-only revalidation 결과를 기록한다.

이 결과는 특정 종목 판단, 투자 조언, 성과 보장, live trading signal이 아니다. generated artifact는 `data/` 아래에만 보관하며 PR에는 포함하지 않는다.

## 검증 질문

- fixed fee, tax, slippage, market impact를 명시하면 zero-cost 결과가 얼마나 달라지는가?
- 비용 적용 후에도 split role별 경향과 기존 research 판정을 유지할 수 있는가?
- 어떤 cost/execution blocker가 아직 남는가?

## 고정 입력

zero-cost baseline과 source, universe, date range, validation split, seed, preset을 동일하게 유지했다. execution policy만 변경했다.

| 항목 | 값 |
| --- | --- |
| Presets | `short_term`, `intraday` |
| Provider | `deterministic_fixture` |
| Assignment | preset별 9, train/validation/test 각 3 |
| Seed family | `strategy-bucket-validation-research-20260713-001` |
| Fee | 10 bps |
| Tax | 20 bps |
| Slippage | 5 bps |
| Market impact | participation rate당 500 bps |
| Safety | `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only` |

normalized execution policy는 두 preset에서 동일했다. zero-cost `costModelHash`는 `sha256:d2fc8f033760992cd4d01742e2ebc2918f5c765041e148d9a413e479e425fdf2`, cost revalidation `costModelHash`는 `sha256:9588b51ad8aee85019cbac11de6d1eef70e354585deb0849056b5c8aff81d814`로 분리됐다.

## 실행 결과

두 preset 모두 completed 9, skipped 0, failed 0이었다. AI decision failure는 0이었다.

### Return comparison

| Preset | Baseline overall | Cost overall | Delta | Cost train | Cost validation | Cost test |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `short_term` | 3.4654% | 1.6945% | -1.7709%p | 2.1803% | 0.4337% | 2.4694% |
| `intraday` | 1.0430% | 0.4975% | -0.5455%p | 0.6369% | -0.7546% | 1.6101% |

return 값은 paper-only artifact 비교 metric이다. 향후 결과 또는 preset 간 우열을 의미하지 않는다.

### Cost and execution comparison

| Preset | Baseline trades | Cost trades | Baseline rejects | Cost rejects | Fee KRW | Tax KRW | Slippage KRW | Impact KRW | Total cost KRW |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `short_term` | 291 | 288 | 33 | 26 | 35,188 | 35,419 | 17,567 | 5 | 88,179 |
| `intraday` | 237 | 436 | 354 | 580 | 19,380 | 19,447 | 9,599 | 0 | 48,426 |

cost가 portfolio cash와 후속 decision/risk 상태에 반영되므로 trade와 reject count도 baseline과 달라질 수 있다. 따라서 return delta를 기존 trade 목록에서 cost만 단순 차감한 값으로 해석하지 않는다.

두 preset 모두 spread cost는 0, partial fill은 0이었다. 최대 participation rate는 `short_term` 0.000243, `intraday` 0.000021이었다. 설정한 market impact는 `short_term`에서 5 KRW만 기록됐고 `intraday`에서는 KRW 반올림 후 0이었다.

## 판정

### `short_term`: `inconclusive` 유지

fixed fee, tax, slippage가 non-zero cost로 기록됐고 overall 평균은 baseline보다 1.7709%p 낮아졌다. zero-cost blocker는 일부 닫혔다.

다만 role별 sample이 3개이고 regime은 bull 7, mixed 2에 한정된다. Sharpe validation은 `unavailable`, PBO는 `insufficient_matrix`이며 spread는 0이다. market impact도 5 KRW로 제한돼 execution sensitivity가 충분히 검증됐다고 볼 수 없다. 따라서 `research_valid_for_paper_followup`로 승격하지 않고 `inconclusive`를 유지한다.

### `intraday`: `invalid_for_current_data_or_model` 유지

cost 적용 후 validation 평균은 -0.7546%였고 meaningful reject는 580건으로 증가했다. overall 평균도 baseline보다 0.5455%p 낮아졌다.

daily source는 intraday cadence 검증에 충분하지 않고, spread와 market impact가 실질적으로 반영되지 않았다. sample, regime, Sharpe, PBO blocker도 유지된다. 현재 data/model에서는 가정이 성립하지 않으므로 `invalid_for_current_data_or_model`을 유지한다.

## 남은 blocker

- `short_term`과 `intraday` 모두 spread model이 `not_modeled` 상태다.
- 낮은 participation rate와 KRW 반올림 때문에 market impact sensitivity가 거의 나타나지 않았다.
- `intraday`는 hourly decision cadence를 daily snapshot source로 검증했다.
- role별 return sample 3개로 Sharpe 최소 sample 30에 미달한다.
- bear와 sideways regime sample이 없다.
- 비교 가능한 candidate row가 1개라 PBO matrix가 부족하다.

## Safety 확인

| 항목 | 결과 |
| --- | --- |
| `--use-codex-ai` | 사용하지 않음 |
| Live order path | 실행하지 않음 |
| Broker mutation | 실행하지 않음 |
| Raw `codex exec` / raw `tossctl` | 실행하거나 추가하지 않음 |
| Generated artifact commit | 없음 |

## 실행 명령

```powershell
npm run historical:batch:replay:dry -- -- --source-data-dir $SourceDataDir --output-dir $OutputDir --batch-id $BatchId --seed "$Seed-$Preset" --runs 9 --random-window-from $RangeStart --random-window-to $RangeEnd --strategy-preset $Preset --universe-path $UniversePath --window-sampling balanced_regime --target-regimes $TargetRegimes --validation-splits-path $ValidationSplitsPath --paper-fee-bps 10 --paper-tax-bps 20 --paper-slippage-bps 5 --paper-market-impact-bps-per-participation-rate 500

npm run historical:batch:report -- -- --runs-path "$BatchDir/batch-replay-runs.jsonl" --universe-coverage-path "$SourceDataDir/historical-universe-coverage.json" --expected-sampled-cpcv-split-count 9 --output-path "$BatchDir/batch-replay-aggregate-report.json"
```

## 다음 검증 조건

- `short_term`은 spread와 market impact sensitivity를 분리한 bounded cost scenario를 추가한다.
- `intraday`는 intraday-compatible source cadence가 준비되기 전까지 추가 parameter tuning을 진행하지 않는다.
- sample/regime/PBO blocker는 cost revalidation과 별도 PR 범위로 다룬다.

이 조건이 닫히기 전에는 두 preset을 실거래 적용 후보 또는 성과가 검증된 전략으로 표현하지 않는다.
