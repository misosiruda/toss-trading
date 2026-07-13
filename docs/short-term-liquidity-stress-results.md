# Short-Term Liquidity Stress Validation 결과

이 문서는 [Short-Term Liquidity Stress Validation 계획](short-term-liquidity-stress-validation-plan.md)에 사전 고정한 3개 scenario의 paper-only deterministic replay 결과를 기록한다.

이 결과는 특정 종목 판단, 투자 조언, 성과 보장 또는 live trading signal이 아니다. Generated artifact는 `data/batch-replay/` 아래에만 보관하며 PR에는 포함하지 않는다.

## 검증 범위

| 항목 | 값 |
| --- | --- |
| Preset | `short_term` |
| Provider | `deterministic_fixture` |
| Assignment | scenario별 9, train/validation/test 각 3 |
| Source | `data/replay-2023-01-2026-05-global-broad-yahoo-daily` |
| Universe | `docs/historical-universe.global-broad.json` |
| Seed | `strategy-bucket-validation-research-20260713-001-short_term` |
| Fee / tax / slippage | 10 / 20 / 5 bps |
| Half-spread | 0 bps |
| Market impact coefficient | 5,000 |
| Safety | `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` |

`--use-codex-ai`는 사용하지 않았다. Source의 `volume`과 tick 이전 window의 `averageVolume`만 사용했고 synthetic volume, order book 또는 broker data는 만들지 않았다.

## 실행 무결성

- 3개 scenario, 총 27 assignment가 completed 27, skipped 0, failed 0으로 종료됐다.
- Scenario별 role count는 train 3, validation 3, test 3으로 일치했다.
- Run index별 split ID, role, window start/end, data snapshot, universe, coverage, prompt, schema, risk policy hash가 scenario 간 일치했다.
- AI decision failure는 모든 scenario에서 0이었다.
- Universe coverage는 `available`이고 `notModeledLiquidityCount`는 모든 scenario에서 0이었다.
- Control은 이전 `impact-5000` 실행과 같은 `costModelHash`, overall return, trade count, impact cost를 재현했다.

Scenario별 execution policy와 cost model hash:

| Scenario | Max participation | Minimum fill ratio | Cost model hash |
| --- | ---: | ---: | --- |
| `control` | 0.1 | 0.1 | `sha256:1a84fcd85b9140da0801efa95c56a83e92b2260752bf25d8a26bd6a64106951e` |
| `cap-1e-5-min-0.1` | 0.00001 | 0.1 | `sha256:6d0db989ee71191e3d7cc2ffae61682419bb2c7ef5c807ea7db1690301be6738` |
| `cap-1e-5-min-0.5` | 0.00001 | 0.5 | `sha256:5d8aa5190e94ab424ed05be37785e9c9f8c27dfde55ad9bc805ccb7feaf09d50` |

## Fixture Gate 결과

| Gate | 결과 |
| --- | --- |
| 모든 scenario 9/9 completed | 충족 |
| Assignment와 고정 입력 parity | 충족 |
| Control partial/no-fill 0 | 충족 |
| `min-0.1` partial과 no-fill 각각 1 이상 | partial 11, no-fill 24로 충족 |
| `min-0.5` no-fill이 `min-0.1`보다 적지 않음 | 26 >= 24로 충족 |
| 모든 scenario modeled liquidity | `notModeledLiquidityCount=0`으로 충족 |

사전 정의한 fixture gate는 모두 충족했다. 따라서 현재 historical volume과 deterministic liquidity model 조합에서 participation cap과 minimum fill gate의 execution path를 검증하는 fixture는 유효하다.

## Liquidity 결과

| Scenario | Full fills | Partial fills | No-fill | Max participation | Partial fill ratio range |
| --- | ---: | ---: | ---: | ---: | --- |
| `control` | 287 | 0 | 0 | 0.000243 | 해당 없음 |
| `cap-1e-5-min-0.1` | 286 | 11 | 24 | 0.00001 | 0.289708 to 0.933014 |
| `cap-1e-5-min-0.5` | 284 | 9 | 26 | 0.00001 | 0.621112 to 0.933014 |

No-fill은 trade count 차이로 추정하지 않고 9개 run report의 `riskSummary.rejectCodes.VIRTUAL_LIQUIDITY_INSUFFICIENT`를 합산했다.

같은 cap에서 minimum fill ratio를 0.1에서 0.5로 높이자 partial fill은 11에서 9로 줄고 no-fill은 24에서 26으로 늘었다. 두 건의 낮은 fill-ratio 후보가 fail-closed no-fill로 전환된 결과와 일치한다.

## Split Role 분포

| Scenario | Train partial / no-fill | Validation partial / no-fill | Test partial / no-fill |
| --- | ---: | ---: | ---: |
| `control` | 0 / 0 | 0 / 0 | 0 / 0 |
| `cap-1e-5-min-0.1` | 8 / 24 | 3 / 0 | 0 / 0 |
| `cap-1e-5-min-0.5` | 8 / 24 | 1 / 2 | 0 / 0 |

Stress event는 train과 validation에만 나타났고 test에는 나타나지 않았다. 따라서 test role의 return이 scenario 간 동일한 것은 정책이 일반적으로 무관하다는 뜻이 아니라 해당 test path에 threshold를 넘는 participation이 없었다는 뜻이다.

## Strategy Bucket 귀속 한계

11건과 9건의 partial fill은 모두 aggregate report의 `UNKNOWN` strategy bucket에 귀속됐다. `short_term` bucket 자체의 partial fill은 0이었다.

이번 fixture는 `short_term` preset으로 실행한 backend execution path의 liquidity cap과 no-fill gate가 작동함을 보여준다. 그러나 stress event가 명시적인 `short_term` bucket trade에 귀속되지 않았으므로 `short_term` strategy logic의 liquidity 내성을 검증했다고 확대 해석하지 않는다.

## Return And Cost 경로

| Scenario | Overall | Train | Validation | Test | Trades | Meaningful rejects | Impact KRW | Total cost KRW |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `control` | 1.6885% | 2.1629% | 0.4333% | 2.4693% | 287 | 27 | 73 | 87,921 |
| `cap-1e-5-min-0.1` | 1.0294% | 0.1280% | 0.4909% | 2.4693% | 297 | 51 | 13 | 87,547 |
| `cap-1e-5-min-0.5` | 1.0413% | 0.1280% | 0.5265% | 2.4693% | 293 | 53 | 13 | 87,205 |

Return은 paper-only artifact 비교 metric이다. Stress scenario의 return 하락 또는 `min-0.5`가 `min-0.1`보다 0.0119%p 높은 결과를 policy 우열로 해석하지 않는다. Partial/no-fill이 cash, position, risk decision과 후속 trade path를 바꿨으며, scenario별 trade와 reject 수가 다르다.

Impact cost는 control 73 KRW에서 stress scenario 13 KRW로 감소했다. Cap이 filled participation을 제한하므로 현재 linear participation model에서 impact component도 작아진 결과다. 이는 낮은 cap이 실제 execution cost를 낮춘다는 의미가 아니다. 현재 fixture는 실제 order book depth나 unfilled opportunity cost를 모델링하지 않는다.

## 판정

Liquidity execution fixture는 `valid`다. `short_term` strategy 판정은 `inconclusive`를 유지한다.

이번 실행으로 partial fill과 fail-closed no-fill을 만들지 못했던 기술적 blocker는 닫혔다. 하지만 stress가 train/validation에 편중됐고 partial fill이 모두 `UNKNOWN` bucket에 귀속됐으며 role별 return sample은 3개다. Bear와 sideways regime, 실제 spread/depth, opportunity cost, PBO candidate matrix도 여전히 없다.

따라서 이번 결과는 deterministic backend의 liquidity execution contract evidence이며 strategy 유효성, 실거래 parameter 또는 예상 체결 품질의 evidence가 아니다.

## 실행 중 경로 정규화 확인

두 번째 scenario replay는 9/9 completed였지만 최초 report 명령은 batch ID의 `min-0.1`을 그대로 path에 사용해 `ENOENT`로 종료됐다. Batch replay가 filesystem path와 run ID의 `.`을 `_`로 정규화해 실제 directory가 `min-0_1`로 생성됐기 때문이다.

Replay를 다시 실행하지 않고 CLI가 출력한 실제 `outputDir`의 runs artifact로 report를 생성했다. 세 번째 scenario도 동일하게 `min-0_5` directory를 사용했다. Scenario policy, seed, assignment 또는 replay artifact는 변경하지 않았다.

계획 문서의 실행 예시는 표시용 `Name`과 filesystem-safe `BatchSlug`를 분리하도록 함께 수정한다.

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

Replay는 계획 문서의 고정 입력으로 `node dist/cli/historicalBatchReplay.js`를 실행했다. Report는 정규화된 output directory를 사용했다.

```powershell
$BatchDir = "$OutputDir/strategy-bucket-short_term-liquidity-cap-1e-5-min-0_1-20260713-001"
node dist/cli/historicalBatchReport.js --runs-path "$BatchDir/batch-replay-runs.jsonl" --universe-coverage-path "$SourceDataDir/historical-universe-coverage.json" --expected-sampled-cpcv-split-count 9 --output-path "$BatchDir/batch-replay-aggregate-report.json"
```

## 다음 검증 조건

- `short_term` bucket trade 자체의 participation stress 전에 [Strategy Preset Candidate Scope Audit](strategy-preset-candidate-scope-audit.md)으로 preset과 candidate path의 현재 contract 및 fail-closed 구현 조건을 고정한다.
- Train/validation에만 나타난 stress를 test role과 bear/sideways regime으로 일반화하지 않는다.
- 실제 spread, order book depth, queue position, unfilled opportunity cost는 별도 evidence와 model contract가 있을 때만 검증한다.
- Sample/regime/PBO blocker는 liquidity execution fixture와 분리된 PR에서 다룬다.
- 현재 ratio를 실거래 parameter로 전환하거나 결과 기반 winner를 선택하지 않는다.
