# Short-Term Spread And Market Impact Sensitivity 결과

이 문서는 `paper_cost_model.v5`의 fixed half-spread와 participation-based market impact가 `short_term` paper-only historical replay에 미치는 영향을 확인한 bounded sensitivity 결과를 기록한다.

이 결과는 특정 종목 판단, 투자 조언, 성과 보장 또는 live trading signal이 아니다. Generated artifact는 `data/` 아래에만 보관하며 PR에는 포함하지 않는다.

## 검증 질문

- 동일한 replay assignment에서 fixed half-spread가 증가할 때 spread cost component가 분리되어 증가하는가?
- 동일한 replay assignment에서 market impact coefficient가 증가할 때 impact cost component가 분리되어 증가하는가?
- 비용 입력이 후속 cash, risk decision, trade path를 바꿀 때 결과를 어떤 한계와 함께 해석해야 하는가?
- 이 bounded sensitivity만으로 기존 `short_term` research 판정을 변경할 수 있는가?

## 고정 입력

결과를 확인하기 전에 6개 scenario를 고정했다. 모든 scenario는 같은 source, universe, split assignment, seed, preset, fee, tax, slippage를 사용한다.

| 항목 | 값 |
| --- | --- |
| Preset | `short_term` |
| Provider | `deterministic_fixture` |
| Assignment | scenario별 9, train/validation/test 각 3 |
| Source | `data/replay-2023-01-2026-05-global-broad-yahoo-daily` |
| Universe | `docs/historical-universe.global-broad.json` |
| Seed | `strategy-bucket-validation-research-20260713-001-short_term` |
| Fee | 10 bps |
| Tax | 20 bps |
| Slippage | 5 bps |
| Safety | `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only` |

Scenario 범위:

| Scenario | Half-spread | Impact coefficient | Cost model hash |
| --- | ---: | ---: | --- |
| `baseline-v5` | 0 bps | 500 | `sha256:c01a91ef2d9d86955fe75147f2bd83a2d5cda253d9277727f56cd38d953dd6f0` |
| `spread-5` | 5 bps | 500 | `sha256:50750e5b354d3eda971fc95e47efcfecd800f5e076e9b37229f651f0559bc4c4` |
| `spread-10` | 10 bps | 500 | `sha256:a594022443dd42f4295f69b65d7b814c42956db032b361823d8f9fae2003bc81` |
| `spread-20` | 20 bps | 500 | `sha256:91526a475234fbc82239db01893d39528764bb6b4db7cec1fe2e7a18e423895d` |
| `impact-2500` | 0 bps | 2,500 | `sha256:698ae07ae2558775e91448d98f99b04dbca23a8730e429d6e9a50c53bdc11294` |
| `impact-5000` | 0 bps | 5,000 | `sha256:1a84fcd85b9140da0801efa95c56a83e92b2260752bf25d8a26bd6a64106951e` |

Impact coefficient는 filled participation rate에 곱하는 bps 계수다. 실제 order book spread나 실제 broker execution quality를 나타내지 않는다.

## 실행 무결성

- 6개 scenario, 총 54 assignment가 completed 54, skipped 0, failed 0으로 종료됐다.
- AI decision failure는 모든 scenario에서 0이었다.
- Scenario별 9개 run의 `assignmentId`, split role, window start/end가 baseline과 일치했다.
- 각 run metadata의 `halfSpreadBps`, `marketImpactBpsPerParticipationRate`가 사전 선언값과 일치했다.
- Universe coverage는 `available`, available symbol은 211개, required strategy bucket 누락은 없었다.
- Aggregate report는 scenario별 `expected-sampled-cpcv-split-count=9`로 생성했다.

## Return And Path 비교

| Scenario | Overall | Baseline delta | Train | Validation | Test | Trades | Meaningful rejects |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `baseline-v5` | 1.6945% | 0.0000%p | 2.1803% | 0.4337% | 2.4694% | 288 | 26 |
| `spread-5` | 2.3697% | +0.6752%p | 3.2350% | 0.5462% | 3.3278% | 280 | 37 |
| `spread-10` | 1.6335% | -0.0610%p | 2.5537% | -0.0556% | 2.4025% | 283 | 35 |
| `spread-20` | 1.6916% | -0.0029%p | 2.4504% | 0.0260% | 2.5984% | 286 | 36 |
| `impact-2500` | 1.6878% | -0.0067%p | 2.1604% | 0.4336% | 2.4694% | 289 | 29 |
| `impact-5000` | 1.6885% | -0.0060%p | 2.1629% | 0.4333% | 2.4693% | 287 | 27 |

Return 값은 paper-only artifact 비교 metric이다. Scenario 간 우열, 향후 결과 또는 strategy recommendation을 의미하지 않는다.

`spread-5`의 overall return이 baseline보다 높지만 이를 spread 비용의 긍정 효과로 해석하지 않는다. Spread 비용이 portfolio cash와 후속 risk/decision 상태를 바꾸면서 trades와 rejects가 달라졌고, 비교 대상은 기존 trade 목록에 비용만 사후 차감한 정적 path가 아니다. 5, 10, 20 bps 결과가 단조 관계를 보이지 않는 점은 현재 sample에서 경로 의존성이 크다는 evidence다.

## Cost And Execution 비교

| Scenario | Fee KRW | Tax KRW | Slippage KRW | Spread KRW | Impact KRW | Total cost KRW | Partial fills | Max participation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `baseline-v5` | 35,188 | 35,419 | 17,567 | 0 | 5 | 88,179 | 0 | 0.000243 |
| `spread-5` | 34,482 | 34,774 | 17,207 | 17,239 | 4 | 103,706 | 0 | 0.000243 |
| `spread-10` | 34,948 | 35,204 | 17,448 | 34,948 | 4 | 122,552 | 0 | 0.000243 |
| `spread-20` | 35,245 | 35,542 | 17,597 | 70,504 | 3 | 158,891 | 0 | 0.000243 |
| `impact-2500` | 35,078 | 35,307 | 17,509 | 0 | 32 | 87,926 | 0 | 0.000243 |
| `impact-5000` | 35,058 | 35,288 | 17,502 | 0 | 73 | 87,921 | 0 | 0.000243 |

Fixed half-spread가 증가하면 spread component는 0, 17,239, 34,948, 70,504 KRW로 증가했다. Market impact coefficient가 증가하면 impact component는 5, 32, 73 KRW로 증가했다. 따라서 두 opt-in cost component가 별도 계산되고 report에 보존되는 execution contract는 확인됐다.

Impact scenario의 total cost가 baseline보다 낮은 것은 impact 산식이 감소했기 때문이 아니다. Trade count와 filled notional path가 바뀌어 fee, tax, slippage 합계가 함께 달라졌기 때문이다. Component sensitivity와 total path outcome을 분리해서 해석해야 한다.

Market impact는 coefficient를 10배로 높인 scenario에서도 73 KRW에 그쳤다. 최대 participation rate가 0.000243이고 partial fill이 없었으므로 현재 notional과 volume 조건은 liquidity/impact stress를 충분히 만들지 못했다.

## 판정

`short_term` 판정은 `inconclusive`를 유지한다.

이번 실행으로 fixed half-spread가 항상 0이던 기술적 blocker는 닫혔다. 그러나 fixed half-spread fixture는 실제 또는 시변 spread 관측값이 아니며, return이 비용 입력에 대해 단조적이지 않고 trade path 변화에 민감했다. Impact 비용도 낮은 participation 때문에 결과를 실질적으로 구분할 수준이 아니었다.

또한 각 split role의 return sample은 3개여서 Sharpe validation은 `unavailable`이고, 비교 가능한 candidate matrix가 부족해 PBO는 `insufficient_matrix`다. Regime도 bull 7, mixed 2이며 bear와 sideways sample은 없다. 따라서 `research_valid_for_paper_followup` 또는 `conditional`로 승격할 근거가 부족하다.

## 남은 Blocker

- Fixed half-spread는 modeled됐지만 market, liquidity, time에 따라 변하는 spread는 검증하지 않았다.
- 낮은 participation rate 때문에 bounded impact coefficient 변화가 5에서 73 KRW 수준에 머물렀다.
- Partial fill과 no-fill stress가 발생하지 않았다.
- Role별 sample 3개로 Sharpe 최소 sample 30에 미달한다.
- Bear와 sideways regime sample이 없다.
- 비교 가능한 candidate row가 부족해 PBO matrix를 구성하지 못한다.
- Cost 입력이 trade path를 바꾸므로 단일 aggregate return 차이로 scenario를 선택할 수 없다.

## Safety 확인

| 항목 | 결과 |
| --- | --- |
| `--use-codex-ai` | 사용하지 않음 |
| Live order path | 실행하거나 추가하지 않음 |
| Broker mutation | 실행하거나 추가하지 않음 |
| Raw `codex exec` / raw `tossctl` | 실행하거나 추가하지 않음 |
| Final sizing/gate | 기존 deterministic backend와 Risk Engine 유지 |
| Generated artifact commit | 없음 |

## 실행 명령

Batch replay는 사전 고정한 scenario 목록을 순회하며 다음 형태로 실행했다.

```powershell
node dist/cli/historicalBatchReplay.js --source-data-dir $SourceDataDir --output-dir $OutputDir --batch-id $BatchId --seed $Seed --runs 9 --random-window-from $RangeStart --random-window-to $RangeEnd --strategy-preset short_term --universe-path $UniversePath --window-sampling balanced_regime --target-regimes $TargetRegimes --validation-splits-path $ValidationSplitsPath --paper-fee-bps 10 --paper-tax-bps 20 --paper-slippage-bps 5 --paper-half-spread-bps $Scenario.Spread --paper-market-impact-bps-per-participation-rate $Scenario.Impact
```

Aggregate report:

```powershell
node dist/cli/historicalBatchReport.js --runs-path "$BatchDir/batch-replay-runs.jsonl" --universe-coverage-path $Coverage --expected-sampled-cpcv-split-count 9 --output-path "$BatchDir/batch-replay-aggregate-report.json"
```

## 다음 검증 조건

- Fixed spread sensitivity와 실제 spread evidence를 구분한 상태로 유지한다.
- Market impact를 다시 평가하려면 결과를 본 뒤 coefficient만 키우지 말고, 사전에 고정한 paper-only liquidity stress fixture로 participation/no-fill/partial-fill 조건을 만든다.
- 후속 liquidity stress scenario와 판정 gate는 [Short-Term Liquidity Stress Validation 계획](short-term-liquidity-stress-validation-plan.md)에 사전 고정한다.
- Sample/regime/PBO blocker는 execution-cost sensitivity와 분리된 PR에서 다룬다.
- 현재 결과를 이용한 parameter winner 선택이나 실거래 적용은 진행하지 않는다.
