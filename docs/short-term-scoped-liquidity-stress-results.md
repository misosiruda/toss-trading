# Short-Term Scoped Liquidity Stress Validation 결과

이 문서는 [Short-Term Scoped Liquidity Stress Validation 계획](short-term-scoped-liquidity-stress-validation-plan.md)에 사전 고정한 3개 scenario의 paper-only deterministic replay 결과를 기록한다.

이 결과는 특정 종목 판단, 투자 조언, 성과 보장 또는 live trading signal이 아니다. Generated artifact는 `data/batch-replay/` 아래에만 보관하며 PR에는 포함하지 않는다.

## 검증 범위

| 항목 | 값 |
| --- | --- |
| 실행 commit | `a4d3fd8098b10bd91d26c9ebf86aeaea7c2412c7` |
| Preset / candidate scope | `short_term` / `short_term` |
| Provider | `deterministic_fixture` |
| Assignment | scenario별 9, train/validation/test 각 3 |
| Source | `data/replay-2023-01-2026-05-global-broad-yahoo-daily` |
| Universe | `docs/historical-universe.global-broad.json` |
| Coverage | `data/replay-2023-01-2026-05-global-broad-yahoo-daily/historical-universe-coverage.json` |
| Validation splits | `data/validation-splits/strategy-bucket-validation-assignments.json` |
| Range | `2023-01-01T00:00:00+09:00` to `2026-05-31T23:59:59.999+09:00` |
| Seed | `short-term-scoped-liquidity-20260720-001` |
| Fee / tax / slippage | 10 / 20 / 5 bps |
| Half-spread | 0 bps |
| Market impact coefficient | 5,000 |
| Safety | `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` |

`--use-codex-ai`는 사용하지 않았다. Source의 historical `volume`과 available `averageVolume`만 사용했고 synthetic volume, order book 또는 broker data는 만들지 않았다.

## Preflight 결과

| 항목 | 결과 |
| --- | --- |
| Coverage status | `available` |
| Available symbols | 211 |
| Available `short_term` symbols | 3 |
| Corrupt lines | 0 |
| Coverage range | `2022-12-31T15:00:00Z` to `2026-05-31T14:59:59.999Z` |
| Assignment count | 9 |
| Split roles | train 3, validation 3, test 3 |
| Output collision | 0 |
| Baseline check | `npm run check`, 769 passed, 0 failed |

필수 source, universe, coverage와 validation split 파일이 존재했고 coverage가 요청 range를 포함했다. Preflight를 통과한 뒤에만 replay를 시작했다.

## 실행 무결성

- 3개 scenario, 총 27 assignment가 completed 27, skipped 0, failed 0으로 종료됐다.
- Scenario별 selection trial은 9개이며 provider mode는 모두 `deterministic_fixture`였다.
- AI decision failure는 모든 scenario에서 0이었다.
- Scenario별 role count는 train 3, validation 3, test 3으로 일치했다.
- 같은 run index의 split ID, role, window start/end, data snapshot, universe, coverage, prompt, schema와 risk policy hash가 scenario 간 일치했다.
- Scenario별 execution policy가 다르므로 `configHash`와 `costModelHash`는 분리됐다. Scenario 간 `configHash` overlap은 0이었다.
- `notModeledLiquidityCount`는 모든 scenario에서 0이었다.

Scenario별 execution policy와 cost model hash:

| Scenario | Max participation | Minimum fill ratio | Cost model hash |
| --- | ---: | ---: | --- |
| `control` | 0.1 | 0.1 | `sha256:1a84fcd85b9140da0801efa95c56a83e92b2260752bf25d8a26bd6a64106951e` |
| `cap-1e-5-min-0.1` | 0.00001 | 0.1 | `sha256:6d0db989ee71191e3d7cc2ffae61682419bb2c7ef5c807ea7db1690301be6738` |
| `cap-1e-5-min-0.5` | 0.00001 | 0.5 | `sha256:5d8aa5190e94ab424ed05be37785e9c9f8c27dfde55ad9bc805ccb7feaf09d50` |

## Scope Provenance 결과

| 검증 항목 | Control | `min-0.1` | `min-0.5` |
| --- | ---: | ---: | ---: |
| Manifest scope | `short_term` | `short_term` | `short_term` |
| Run metadata scope mismatch | 0 | 0 | 0 |
| Selection trial scope mismatch | 0 | 0 | 0 |
| Buy-eligible candidate rows, `short_term` | 8,985 | 8,985 | 8,985 |
| Buy-eligible candidate rows, other/missing | 0 | 0 | 0 |
| Trade rows, `short_term` | 253 | 260 | 258 |
| Trade rows, other/missing | 0 | 0 | 0 |
| Observed position rows, `short_term` | 593 | 658 | 659 |
| Observed position rows, other/missing | 0 | 0 | 0 |
| Partial fill rows, `short_term` | 0 | 13 | 11 |
| No-fill scoped candidate/position mismatch | 0 | 0 | 0 |

Candidate와 position 수는 packet artifact에서 반복 관측된 row 수이며 unique symbol 수가 아니다. 모든 generated buy path와 position/trade provenance는 `short_term`으로 유지됐고 `UNKNOWN`, missing 또는 다른 bucket fallback은 없었다.

No-fill은 trade count 차이로 추정하지 않고 각 run의 risk decision에서 `VIRTUAL_LIQUIDITY_INSUFFICIENT`를 직접 합산했다. 각 no-fill symbol은 같은 packet의 `short_term` candidate 또는 기존 `short_term` position에 연결됐다.

## Fixture Gate 결과

| Gate | 결과 |
| --- | --- |
| 모든 scenario 9/9 completed | 충족 |
| Assignment와 고정 입력 parity | 충족 |
| Scope provenance | 충족 |
| Control partial/no-fill 0 | 충족 |
| `min-0.1` scoped partial과 no-fill 각각 1 이상 | partial 13, no-fill 47로 충족 |
| `min-0.5` no-fill이 `min-0.1`보다 적지 않음 | 50 >= 47로 충족 |
| 모든 scenario modeled liquidity | `notModeledLiquidityCount=0`으로 충족 |
| Split role 일반화 | no-fill이 train에만 발생해 `inconclusive` 조건 적용 |

사전 정의한 수치 및 provenance gate는 충족했다. 그러나 계획 문서의 `inconclusive` 조건은 stress event가 특정 split role에만 있어 다른 role로 일반화할 수 없는 경우를 포함한다. Partial fill은 세 role에서 관측됐지만 fail-closed no-fill 47건과 50건은 모두 train에만 발생했으므로 fixture의 최종 판정은 `inconclusive`다.

## Liquidity 결과

| Scenario | Full fills | Partial fills | No-fill | Max participation | Effective partial ratio range |
| --- | ---: | ---: | ---: | ---: | --- |
| `control` | 253 | 0 | 0 | 0.001406 | 해당 없음 |
| `cap-1e-5-min-0.1` | 247 | 13 | 47 | 0.00001 | 0.144872 to 0.984937 |
| `cap-1e-5-min-0.5` | 247 | 11 | 50 | 0.00001 | 0.565035 to 0.984937 |

Effective partial ratio는 artifact의 `filledNotionalKrw / requestedNotionalKrw`로 계산했다. Trade의 `fillRatio` 필드는 execution policy의 별도 fill ratio이므로 liquidity minimum-fill 판정 비율로 재사용하지 않았다.

같은 cap에서 minimum fill ratio를 0.1에서 0.5로 높이자 partial fill은 13에서 11로 줄고 no-fill은 47에서 50으로 늘었다. Scenario 간 path 변화로 후속 portfolio 상태도 달라질 수 있으므로 단순히 두 partial row만 no-fill로 이동했다고 해석하지 않는다.

## Split Role 분포

| Scenario | Train partial / no-fill | Validation partial / no-fill | Test partial / no-fill |
| --- | ---: | ---: | ---: |
| `control` | 0 / 0 | 0 / 0 | 0 / 0 |
| `cap-1e-5-min-0.1` | 6 / 47 | 4 / 0 | 3 / 0 |
| `cap-1e-5-min-0.5` | 4 / 50 | 4 / 0 | 3 / 0 |

Partial fill은 세 role에서 모두 관측됐지만 no-fill은 train에만 나타났다. 따라서 fail-closed no-fill 동작을 validation/test role 또는 다른 regime으로 일반화하지 않는다.

## Return And Cost 경로

| Scenario | Overall | Train | Validation | Test | Trades | Meaningful rejects | Impact KRW | Total cost KRW |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `control` | 1.2378% | 2.2569% | 0.0130% | 1.4436% | 253 | 73 | 272 | 74,161 |
| `cap-1e-5-min-0.1` | 2.4340% | 5.1623% | 0.4477% | 1.6919% | 260 | 127 | 34 | 73,865 |
| `cap-1e-5-min-0.5` | 2.4205% | 5.1219% | 0.4477% | 1.6919% | 258 | 130 | 34 | 73,860 |

Return과 cost는 paper-only path 변화 확인용 부수 metric이다. Liquidity rejection이 cash, position, 후속 decision과 trade path를 바꾸므로 scenario 간 return 차이를 execution policy 우열이나 예상 성과로 해석하지 않는다.

Impact cost 감소는 cap이 modeled filled participation을 제한하는 현재 linear model의 결과다. 실제 spread, order book depth, queue position, market impact 또는 unfilled opportunity cost를 반영한 결과가 아니다.

## 판정과 한계

Liquidity execution fixture는 split-role evidence 부족으로 `inconclusive`다. `short_term` strategy 판정도 `inconclusive`를 유지한다.

이번 실행은 기존 broad run의 `UNKNOWN` bucket 한계를 닫고 scoped candidate, trade, position, partial fill과 no-fill provenance를 확인했다. 또한 현재 train assignment에서는 participation cap과 minimum fill gate가 partial/no-fill path를 만드는 것을 확인했다. 그러나 available `short_term` symbol은 3개이고 role별 return sample은 3개다. 관측 regime도 bull 7, mixed 2로 bear와 sideways가 없으며 no-fill은 train에만 편중됐다. 실제 spread/depth, queue position, opportunity cost와 독립적인 PBO candidate matrix도 없다.

따라서 이번 결과는 deterministic backend의 scoped liquidity execution contract evidence이며 strategy 유효성, 실거래 parameter 또는 예상 체결 품질의 evidence가 아니다. 기존 broad 결과와 return 또는 cost를 직접 비교해 strategy 개선으로 해석하지 않는다.

## Safety 확인

| 항목 | 결과 |
| --- | --- |
| `--use-codex-ai` | 사용하지 않음 |
| Live order path | 실행하거나 추가하지 않음 |
| Broker mutation | 실행하거나 추가하지 않음 |
| Natural language order / `place_order` | 실행하거나 추가하지 않음 |
| Raw `codex exec` / raw `tossctl` | 실행하거나 추가하지 않음 |
| Final sizing/gate | 기존 deterministic backend와 Risk Engine 유지 |
| Generated artifact commit | 없음 |

## 실행 명령

계획 문서에 고정한 preflight와 `npm run check`를 먼저 실행했다. 이후 세 scenario에 대해 다음 replay와 report 명령을 각각 실행했다.

```powershell
node dist/cli/historicalBatchReplay.js --source-data-dir $SourceDataDir --output-dir $OutputDir --batch-id $BatchId --seed $Seed --runs 9 --random-window-from $RangeStart --random-window-to $RangeEnd --strategy-preset short_term --candidate-strategy-bucket short_term --universe-path $UniversePath --window-sampling balanced_regime --target-regimes "bull,bear,sideways,mixed" --validation-splits-path $ValidationSplitsPath --paper-fee-bps 10 --paper-tax-bps 20 --paper-slippage-bps 5 --paper-half-spread-bps 0 --paper-market-impact-bps-per-participation-rate 5000 --paper-max-volume-participation-rate $Scenario.MaxParticipation --paper-min-liquidity-fill-ratio $Scenario.MinFill

node dist/cli/historicalBatchReport.js --runs-path "$BatchDir/batch-replay-runs.jsonl" --universe-coverage-path $CoveragePath --expected-sampled-cpcv-split-count 9 --output-path "$BatchDir/batch-replay-aggregate-report.json"
```

생성된 batch directory:

```text
data/batch-replay/short-term-scoped-liquidity-control-20260720-001
data/batch-replay/short-term-scoped-liquidity-cap-1e-5-min-0_1-20260720-001
data/batch-replay/short-term-scoped-liquidity-cap-1e-5-min-0_5-20260720-001
```

## 다음 검증 조건

- Available `short_term` symbol과 independent validation sample을 늘리는 작업은 별도 사전 계획으로 고정한다.
- Bear/sideways와 validation/test no-fill evidence가 없으므로 현재 결과를 해당 role/regime에 일반화하지 않는다.
- 실제 spread, order book depth, queue position과 unfilled opportunity cost는 별도 evidence와 model contract가 있을 때만 검증한다.
- Strategy 판정 변경은 liquidity fixture와 분리하고 sample, regime, PBO와 holdout evidence를 충족한 뒤 검토한다.
- 현재 ratio를 실거래 parameter로 전환하거나 결과 기반 winner를 선택하지 않는다.
